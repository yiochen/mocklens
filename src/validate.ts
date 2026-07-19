import fs from 'node:fs';
import path from 'node:path';
import type { Browser } from 'playwright';
import type { Config, Device, ElementInfo, Finding, Report, ScreenReport } from './types.js';
import { round1 } from './types.js';
import type { Screen } from './screens.js';
import { openScreenPage } from './browser.js';

/** Small rendering tolerance (px) shared by all layout checks. */
const TOL = 1;

// ---------------------------------------------------------------------------
// Raw data collected inside the page. Everything below is plain JSON so it
// survives page.evaluate serialization.
// ---------------------------------------------------------------------------

interface RawRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RawElement {
  selector: string;
  tag: string;
  id: string;
  classes: string[];
  text: string;
  rect: RawRect;
  offRight: number;
  offLeft: number;
  outerRight: boolean;
  outerLeft: boolean;
  /** data-mocklens-ignore reason from the element or nearest ancestor, null when absent. */
  ignore: string | null;
  clipVertical: boolean;
  clipHorizontal: boolean;
  clipScroll: number;
  clipClient: number;
  isBar: boolean;
}

interface RawBrokenImage {
  selector: string;
  src: string;
  id: string;
  classes: string[];
  rect: RawRect;
}

interface RawScan {
  innerWidth: number;
  innerHeight: number;
  docScrollWidth: number;
  docScrollHeight: number;
  rootScrollDisabled: boolean;
  elements: RawElement[];
  brokenImages: RawBrokenImage[];
}

interface RawBarCover {
  barSelector: string;
  barRect: RawRect;
  ignore: string | null;
  coveredSelector: string;
  coveredText: string;
  overlap: number;
}

// ---------------------------------------------------------------------------
// In-page scan functions. These are serialized and run in Chromium, so they
// must be fully self-contained (no references to module scope).
// ---------------------------------------------------------------------------

function scanPage(tol: number): RawScan {
  const SKIP = new Set([
    'HTML', 'HEAD', 'BODY', 'SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE', 'BASE', 'TEMPLATE', 'NOSCRIPT',
  ]);
  // Tags treated as text-bearing even without a direct text node.
  const TEXT_TAGS = new Set([
    'P', 'SPAN', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'A', 'BUTTON', 'LI', 'TD', 'TH', 'LABEL',
    'SMALL', 'EM', 'STRONG', 'B', 'I', 'U', 'MARK', 'ABBR', 'CITE', 'Q', 'TIME', 'CODE', 'PRE',
    'BLOCKQUOTE', 'FIGCAPTION', 'DT', 'DD', 'SUMMARY', 'LEGEND', 'OPTION', 'INPUT', 'TEXTAREA',
  ]);
  const iw = window.innerWidth;
  const ih = window.innerHeight;
  const docEl = document.documentElement;
  const body = document.body;
  const scrollingEl = document.scrollingElement ?? docEl;

  const isClipValue = (v: string): boolean => v === 'hidden' || v === 'clip';
  const rootScrollDisabled =
    isClipValue(getComputedStyle(docEl).overflowX) ||
    (body !== null && isClipValue(getComputedStyle(body).overflowX));

  const isVisible = (el: Element): boolean => {
    if (el.getClientRects().length === 0) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) !== 0;
  };

  const selectorOf = (el: Element): string => {
    const segments: string[] = [];
    let cur: Element | null = el;
    while (cur !== null && cur !== body && cur !== docEl && segments.length < 4) {
      let seg = cur.tagName.toLowerCase();
      if (cur.id !== '') {
        seg += '#' + cur.id;
        segments.unshift(seg);
        break;
      }
      const classes = Array.from(cur.classList).slice(0, 2);
      if (classes.length > 0) seg += '.' + classes.join('.');
      const parent: Element | null = cur.parentElement;
      if (parent !== null) {
        const self = cur;
        const sameTag = Array.from(parent.children).filter((c) => c.tagName === self.tagName);
        if (sameTag.length > 1) seg += ':nth-of-type(' + String(sameTag.indexOf(self) + 1) + ')';
      }
      segments.unshift(seg);
      cur = parent;
    }
    return segments.join(' > ');
  };

  const ignoreReasonOf = (el: Element): string | null => {
    let cur: Element | null = el;
    while (cur !== null) {
      if (cur.hasAttribute('data-mocklens-ignore')) {
        return cur.getAttribute('data-mocklens-ignore') ?? '';
      }
      cur = cur.parentElement;
    }
    return null;
  };

  const collapseText = (el: Element): string =>
    (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);

  const isTextBearer = (el: Element): boolean => {
    if (TEXT_TAGS.has(el.tagName)) return true;
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === 3 && (node.textContent ?? '').trim().length > 0) return true;
    }
    return false;
  };

  const all = Array.from(document.querySelectorAll('*')).filter((el) => !SKIP.has(el.tagName));

  // Offender status for every scannable element, visibility-independent:
  // ancestors must be checked even when they themselves are not reportable.
  const offender = new Map<Element, { right: boolean; left: boolean }>();
  for (const el of all) {
    const r = el.getBoundingClientRect();
    offender.set(el, { right: r.right - iw > tol, left: -r.left > tol });
  }

  const hasOffenderAncestor = (el: Element, dir: 'right' | 'left'): boolean => {
    let cur = el.parentElement;
    while (cur !== null && cur !== body) {
      const o = offender.get(cur);
      if (o !== undefined && o[dir]) return true;
      cur = cur.parentElement;
    }
    return false;
  };

  const elements: RawElement[] = [];
  for (const el of all) {
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const own = offender.get(el) ?? { right: false, left: false };

    let clipVertical = false;
    let clipHorizontal = false;
    let clipScroll = 0;
    let clipClient = 0;
    const clippedX = isClipValue(cs.overflowX);
    const clippedY = isClipValue(cs.overflowY);
    if ((clippedX || clippedY) && (el.textContent ?? '').trim().length > 0 && isTextBearer(el)) {
      clipVertical = clippedY && el.scrollHeight > el.clientHeight + tol;
      const nowrap = cs.whiteSpace === 'nowrap' || cs.whiteSpace === 'pre';
      clipHorizontal = clippedX && nowrap && el.scrollWidth > el.clientWidth + tol;
      if (clipVertical) {
        clipScroll = el.scrollHeight;
        clipClient = el.clientHeight;
      } else if (clipHorizontal) {
        clipScroll = el.scrollWidth;
        clipClient = el.clientWidth;
      }
    }

    const isBar =
      (cs.position === 'fixed' || cs.position === 'sticky') &&
      r.bottom >= ih - tol &&
      r.width >= iw * 0.4;

    elements.push({
      selector: selectorOf(el),
      tag: el.tagName.toLowerCase(),
      id: el.id,
      classes: Array.from(el.classList),
      text: collapseText(el),
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      offRight: r.right - iw,
      offLeft: -r.left,
      outerRight: own.right && !hasOffenderAncestor(el, 'right'),
      outerLeft: own.left && !hasOffenderAncestor(el, 'left'),
      ignore: ignoreReasonOf(el),
      clipVertical,
      clipHorizontal,
      clipScroll,
      clipClient,
      isBar,
    });
  }

  const brokenImages: RawBrokenImage[] = [];
  for (const img of Array.from(document.querySelectorAll('img'))) {
    const src = img.getAttribute('src') ?? '';
    if (src !== '' && img.complete && img.naturalWidth === 0) {
      const r = img.getBoundingClientRect();
      brokenImages.push({
        selector: selectorOf(img),
        src: img.currentSrc || img.src,
        id: img.id,
        classes: Array.from(img.classList),
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      });
    }
  }

  return {
    innerWidth: iw,
    innerHeight: ih,
    docScrollWidth: scrollingEl.scrollWidth,
    docScrollHeight: scrollingEl.scrollHeight,
    rootScrollDisabled,
    elements,
    brokenImages,
  };
}

/**
 * Re-measure bottom bars after scrolling to the very bottom of the page and
 * find content hidden behind them. Bars are re-located by the selector built
 * in scanPage. Helpers are duplicated because evaluate serializes functions.
 */
function scanBarCovers(args: { tol: number; selectors: string[] }): (RawBarCover | null)[] {
  const { tol, selectors } = args;
  const SKIP = new Set([
    'HTML', 'HEAD', 'BODY', 'SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE', 'BASE', 'TEMPLATE', 'NOSCRIPT',
  ]);
  const TEXT_TAGS = new Set([
    'P', 'SPAN', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'A', 'BUTTON', 'LI', 'TD', 'TH', 'LABEL',
    'SMALL', 'EM', 'STRONG', 'B', 'I', 'U', 'MARK', 'ABBR', 'CITE', 'Q', 'TIME', 'CODE', 'PRE',
    'BLOCKQUOTE', 'FIGCAPTION', 'DT', 'DD', 'SUMMARY', 'LEGEND', 'OPTION', 'INPUT', 'TEXTAREA',
  ]);
  const scrollingEl = document.scrollingElement ?? document.documentElement;
  window.scrollTo(0, scrollingEl.scrollHeight);
  const body = document.body;

  const isVisible = (el: Element): boolean => {
    if (el.getClientRects().length === 0) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) !== 0;
  };

  const ignoreReasonOf = (el: Element): string | null => {
    let cur: Element | null = el;
    while (cur !== null) {
      if (cur.hasAttribute('data-mocklens-ignore')) {
        return cur.getAttribute('data-mocklens-ignore') ?? '';
      }
      cur = cur.parentElement;
    }
    return null;
  };

  const collapseText = (el: Element): string =>
    (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);

  const selectorOf = (el: Element): string => {
    const segments: string[] = [];
    let cur: Element | null = el;
    while (cur !== null && cur !== body && cur !== document.documentElement && segments.length < 4) {
      let seg = cur.tagName.toLowerCase();
      if (cur.id !== '') {
        seg += '#' + cur.id;
        segments.unshift(seg);
        break;
      }
      const classes = Array.from(cur.classList).slice(0, 2);
      if (classes.length > 0) seg += '.' + classes.join('.');
      const parent: Element | null = cur.parentElement;
      if (parent !== null) {
        const self = cur;
        const sameTag = Array.from(parent.children).filter((c) => c.tagName === self.tagName);
        if (sameTag.length > 1) seg += ':nth-of-type(' + String(sameTag.indexOf(self) + 1) + ')';
      }
      segments.unshift(seg);
      cur = parent;
    }
    return segments.join(' > ');
  };

  const isTextBearer = (el: Element): boolean => {
    if (TEXT_TAGS.has(el.tagName)) return true;
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === 3 && (node.textContent ?? '').trim().length > 0) return true;
    }
    return false;
  };

  return selectors.map((sel): RawBarCover | null => {
    let bar: Element | null = null;
    try {
      bar = document.querySelector(sel);
    } catch {
      bar = null;
    }
    if (bar === null || !isVisible(bar)) return null;
    const br = bar.getBoundingClientRect();
    let best: { el: Element; overlap: number } | null = null;
    for (const el of Array.from(document.querySelectorAll('*'))) {
      if (SKIP.has(el.tagName)) continue;
      if (el === bar || bar.contains(el) || el.contains(bar)) continue;
      if (!isVisible(el) || !isTextBearer(el)) continue;
      const r = el.getBoundingClientRect();
      const vOverlap = Math.min(r.bottom, br.bottom) - Math.max(r.top, br.top);
      const hOverlap = Math.min(r.right, br.right) - Math.max(r.left, br.left);
      if (vOverlap > 4 && hOverlap > 0 && (best === null || vOverlap > best.overlap)) {
        best = { el, overlap: vOverlap };
      }
    }
    if (best === null) return null;
    const winner: { el: Element; overlap: number } = best;
    return {
      barSelector: sel,
      barRect: { x: br.x, y: br.y, width: br.width, height: br.height },
      ignore: ignoreReasonOf(bar),
      coveredSelector: selectorOf(winner.el),
      coveredText: collapseText(winner.el),
      overlap: winner.overlap,
    };
  });
}

// ---------------------------------------------------------------------------
// Finding construction (Node side)
// ---------------------------------------------------------------------------

function elementInfo(el: {
  selector: string;
  tag: string;
  id: string;
  classes: string[];
  text: string;
  rect: RawRect;
}): ElementInfo {
  return {
    selector: el.selector,
    tag: el.tag,
    id: el.id,
    classes: el.classes,
    text: el.text,
    rect: {
      x: round1(el.rect.x),
      y: round1(el.rect.y),
      width: round1(el.rect.width),
      height: round1(el.rect.height),
    },
  };
}

function ignoreSuffix(reason: string | null): { suppressed: boolean; suffix: string } {
  if (reason === null) return { suppressed: false, suffix: '' };
  return {
    suppressed: true,
    suffix: reason === '' ? ' (data-mocklens-ignore)' : ` (data-mocklens-ignore: "${reason}")`,
  };
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

async function validateScreen(
  browser: Browser,
  config: Config,
  screen: Screen,
  device: Device,
): Promise<ScreenReport> {
  const { page, context, events } = await openScreenPage(browser, screen.file, device, 1);
  try {
    const scan = await page.evaluate(scanPage, TOL);
    const iw = scan.innerWidth;
    const findings: Finding[] = [];

    // 1. element overflow — outermost offenders only, so descendants of a
    //    too-wide container don't each produce a finding.
    const rightOffenders = scan.elements.filter((e) => e.outerRight);
    for (const el of rightOffenders) {
      const amt = round1(el.offRight);
      const { suppressed, suffix } = ignoreSuffix(el.ignore);
      findings.push({
        type: 'element-overflow-right',
        severity: 'error',
        suppressed,
        message: `extends ${amt}px past the right edge of a ${iw}px viewport${suffix}`,
        suggestion: `Element extends ${amt}px past the right edge of a ${iw}px viewport — check fixed widths, vw units plus padding, or missing overflow clipping.`,
        element: elementInfo(el),
      });
    }
    for (const el of scan.elements.filter((e) => e.outerLeft)) {
      const amt = round1(el.offLeft);
      const { suppressed, suffix } = ignoreSuffix(el.ignore);
      findings.push({
        type: 'element-overflow-left',
        severity: 'error',
        suppressed,
        message: `extends ${amt}px past the left edge of a ${iw}px viewport${suffix}`,
        suggestion: `Element extends ${amt}px past the left edge of a ${iw}px viewport — check negative margins, absolute/fixed positioning, or missing overflow clipping.`,
        element: elementInfo(el),
      });
    }

    // 2. document overflow — the page itself can scroll horizontally.
    //    NOTE: element-level data-mocklens-ignore annotations intentionally do
    //    NOT suppress this check: annotating a decorative element must never
    //    hide a genuinely sideways-scrollable page.
    if (scan.docScrollWidth > iw + TOL && !scan.rootScrollDisabled) {
      const top = rightOffenders
        .filter((e) => e.ignore === null)
        .slice(0, 5)
        .map((e) => e.selector);
      findings.push({
        type: 'document-overflow',
        severity: 'error',
        suppressed: false,
        message:
          `page scrolls horizontally — document is ${round1(scan.docScrollWidth)}px wide in a ${iw}px viewport` +
          (top.length > 0 ? ` — likely offenders: ${top.join(', ')}` : ''),
        suggestion:
          'Find and fix the elements wider than the viewport (fixed widths, 100vw plus padding, absolutely positioned elements). Only clamp overflow-x at the root when the overflow is purely decorative.',
      });
    }

    // 3. clipped text
    for (const el of scan.elements) {
      if (!el.clipVertical && !el.clipHorizontal) continue;
      const { suppressed, suffix } = ignoreSuffix(el.ignore);
      const dir =
        el.clipVertical && el.clipHorizontal
          ? 'vertically and horizontally'
          : el.clipVertical
            ? 'vertically'
            : 'horizontally';
      findings.push({
        type: 'clipped-text',
        severity: 'warning',
        suppressed,
        message: `text is clipped ${dir} — content is ${round1(el.clipScroll)}px but the box is ${round1(el.clipClient)}px with overflow hidden${suffix}`,
        suggestion:
          'Give the element more room, reduce the content, or — if the truncation is intentional — annotate it with data-mocklens-ignore.',
        element: elementInfo(el),
      });
    }

    // 4. broken images
    for (const img of scan.brokenImages) {
      findings.push({
        type: 'broken-image',
        severity: 'error',
        suppressed: false,
        message: 'image failed to load',
        suggestion: `Check the src path — the file must exist relative to the screen: ${img.src}`,
        element: elementInfo({ selector: img.selector, tag: 'img', id: img.id, classes: img.classes, text: '', rect: img.rect }),
        detail: `src: ${img.src}`,
      });
    }

    // 6. external requests (collected before page errors so console noise can
    //    be matched against their URLs)
    const externalUrls = new Set<string>();
    for (const req of events.requests) {
      if (!req.url.startsWith('http://') && !req.url.startsWith('https://')) continue;
      let host: string;
      try {
        host = new URL(req.url).hostname;
      } catch {
        continue;
      }
      if (LOCAL_HOSTS.has(host)) continue;
      if (config.allowedExternalHosts.includes(host)) continue;
      if (externalUrls.has(req.url)) continue;
      externalUrls.add(req.url);
      findings.push({
        type: 'external-request',
        severity: 'error',
        suppressed: false,
        message: `page requests an external resource from ${new URL(req.url).host}`,
        suggestion: `Bundle the resource locally — mocks must render offline: ${req.url}`,
        detail: `${req.url} (${req.resourceType})`,
      });
    }

    // 5. page errors (uncaught exceptions + console errors)
    const badResourceUrls = new Set<string>([
      ...scan.brokenImages.map((b) => b.src),
      ...events.failedRequests.map((f) => f.url),
      ...externalUrls,
    ]);
    const seenError = new Set<string>();
    const pushPageError = (message: string, detail: string): void => {
      if (seenError.has(message)) return;
      seenError.add(message);
      findings.push({
        type: 'page-error',
        severity: 'error',
        suppressed: false,
        message,
        suggestion: 'Fix or remove the failing script — a static mock should render without JavaScript errors.',
        detail,
      });
    };
    for (const pe of events.pageErrors) {
      pushPageError(`uncaught exception: ${pe.message}`, pe.stack !== '' ? pe.stack : pe.message);
    }
    for (const ce of events.consoleErrors) {
      if (ce.text.startsWith('Failed to load resource')) {
        // Resource-load failures are already reported as broken-image /
        // external-request findings: drop the console duplicate (matched by
        // URL when the console message carries one; dropped unconditionally
        // when it does not).
        if (ce.url === '' || badResourceUrls.has(ce.url)) continue;
      }
      pushPageError(`console error: ${ce.text}`, ce.url !== '' ? `${ce.text} (at ${ce.url})` : ce.text);
    }

    // 7. fixed/sticky bottom bar covering content at the end of the page
    const barSelectors = scan.elements.filter((e) => e.isBar).map((e) => e.selector);
    if (barSelectors.length > 0 && scan.docScrollHeight > scan.innerHeight + 50) {
      const covers = await page.evaluate(scanBarCovers, { tol: TOL, selectors: barSelectors });
      await page.evaluate(() => window.scrollTo(0, 0));
      for (const cover of covers) {
        if (cover === null) continue;
        const barEl = scan.elements.find((e) => e.selector === cover.barSelector);
        const { suppressed, suffix } = ignoreSuffix(cover.ignore);
        findings.push({
          type: 'fixed-bottom-cover',
          severity: 'warning',
          suppressed,
          message: `fixed/sticky bottom bar covers content when scrolled to the end${suffix}`,
          suggestion: `Add padding-bottom (at least the bar's height, ${round1(cover.barRect.height)}px) to the page or scroll container so trailing content clears the fixed bar.`,
          element: barEl !== undefined ? elementInfo(barEl) : undefined,
          detail: `covers ${cover.coveredSelector} — "${cover.coveredText}" (overlap ${round1(cover.overlap)}px)`,
        });
      }
    }

    // Deterministic order: by type, then selector, then message.
    findings.sort((a, b) => {
      if (a.type !== b.type) return a.type < b.type ? -1 : 1;
      const sa = a.element?.selector ?? '';
      const sb = b.element?.selector ?? '';
      if (sa !== sb) return sa < sb ? -1 : 1;
      if (a.message !== b.message) return a.message < b.message ? -1 : 1;
      return 0;
    });

    const errorCount = findings.filter((f) => f.severity === 'error' && !f.suppressed).length;
    const warningCount = findings.filter((f) => f.severity === 'warning' && !f.suppressed).length;
    const suppressedCount = findings.filter((f) => f.suppressed).length;

    return {
      name: screen.name,
      device: device.name,
      viewport: { width: round1(device.width), height: round1(device.height) },
      ok: errorCount === 0,
      findings,
      counts: { error: errorCount, warning: warningCount, suppressed: suppressedCount },
    };
  } finally {
    await context.close();
  }
}

/** Run all checks for every screen × device and aggregate into a Report. */
export async function runValidation(
  browser: Browser,
  config: Config,
  screens: Screen[],
  devices: Device[],
): Promise<Report> {
  const reports: ScreenReport[] = [];
  for (const screen of screens) {
    for (const device of devices) {
      reports.push(await validateScreen(browser, config, screen, device));
    }
  }
  return {
    version: 1,
    tool: 'mocklens',
    screens: reports,
    summary: {
      screens: reports.length,
      errors: reports.reduce((n, r) => n + r.counts.error, 0),
      warnings: reports.reduce((n, r) => n + r.counts.warning, 0),
      suppressed: reports.reduce((n, r) => n + r.counts.suppressed, 0),
      ok: reports.every((r) => r.ok),
    },
  };
}

/** Write <outDir>/report.json; returns the file path. */
export function writeReport(config: Config, report: Report): string {
  fs.mkdirSync(config.outDir, { recursive: true });
  const file = path.join(config.outDir, 'report.json');
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  return file;
}
