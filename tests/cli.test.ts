import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Finding, Report, ScreenReport } from '../src/types.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'fixtures');
const CLI = path.join(ROOT, 'dist', 'cli.js');
const OUT = path.join(FIXTURES, '.mocklens');

const DEVICES = ['iphone-se', 'iphone-14', 'pixel-7'];
const SCREENS = [
  'valid',
  'document-overflow',
  'element-overflow-right',
  'element-overflow-left',
  'viewport-width-plus-padding',
  'decorative-intentional',
  'carousel-peek',
  'clipped-text-accidental',
  'clipped-text-intentional',
  'broken-image',
  'fixed-bottom-cover',
  'long-page',
  'external-request',
  'runtime-error',
];

const FINDING_TYPES = new Set([
  'document-overflow',
  'element-overflow-right',
  'element-overflow-left',
  'clipped-text',
  'broken-image',
  'page-error',
  'external-request',
  'fixed-bottom-cover',
  'fixed-overlay-cover',
]);

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[]): CliResult {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: FIXTURES,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function readJson<T>(rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(OUT, rel), 'utf8')) as T;
}

function screensOf(name: string): ScreenReport[] {
  return report.screens.filter((s) => s.name === name);
}

function unsuppressed(s: ScreenReport): Finding[] {
  return s.findings.filter((f) => !f.suppressed);
}

function hasFinding(s: ScreenReport, type: Finding['type'], suppressed?: boolean): boolean {
  return s.findings.some((f) => f.type === type && (suppressed === undefined || f.suppressed === suppressed));
}

let listRun: CliResult;
let unknownRun: CliResult;
let validOnlyRun: CliResult;
let checkRun: CliResult;
let filteredReport: Report;
let fullRun: CliResult;
let report: Report;

// CLI runs are slow (real Chromium), so each command runs exactly once here
// and every test asserts against the captured output / written files.
beforeAll(() => {
  fs.rmSync(OUT, { recursive: true, force: true });

  listRun = runCli(['list']);
  unknownRun = runCli(['frobnicate']);
  validOnlyRun = runCli(['validate', '--screen', 'valid']);
  checkRun = runCli(['check', '--screen', 'valid', '--device', 'iphone-14']);

  // Filtered run first, because every validate overwrites report.json.
  const filteredRun = runCli(['validate', '--screen', 'document-overflow']);
  filteredReport = readJson<Report>('report.json');

  fullRun = runCli(['validate']);
  report = readJson<Report>('report.json');

  expect(filteredRun.status).toBe(1);
}, 600_000);

describe('real errors are detected', () => {
  it('document-overflow fixture: document + right element overflow on every device', () => {
    for (const s of screensOf('document-overflow')) {
      expect(hasFinding(s, 'document-overflow', false)).toBe(true);
      expect(hasFinding(s, 'element-overflow-right', false)).toBe(true);
      expect(s.ok).toBe(false);
    }
    expect(screensOf('document-overflow')).toHaveLength(3);
  });

  it('element-overflow-right fixture: right overflow without document scroll', () => {
    for (const s of screensOf('element-overflow-right')) {
      expect(hasFinding(s, 'element-overflow-right', false)).toBe(true);
      expect(hasFinding(s, 'document-overflow')).toBe(false);
    }
  });

  it('element-overflow-left fixture: left overflow without document scroll', () => {
    for (const s of screensOf('element-overflow-left')) {
      expect(hasFinding(s, 'element-overflow-left', false)).toBe(true);
      expect(hasFinding(s, 'document-overflow')).toBe(false);
    }
  });

  it('viewport-width-plus-padding fixture: document + right element overflow', () => {
    for (const s of screensOf('viewport-width-plus-padding')) {
      expect(hasFinding(s, 'document-overflow', false)).toBe(true);
      expect(hasFinding(s, 'element-overflow-right', false)).toBe(true);
    }
  });

  it('broken-image fixture: broken-image error', () => {
    for (const s of screensOf('broken-image')) {
      expect(hasFinding(s, 'broken-image', false)).toBe(true);
      expect(s.ok).toBe(false);
    }
  });

  it('external-request fixture: external-request + broken-image, and nothing else', () => {
    for (const s of screensOf('external-request')) {
      expect(hasFinding(s, 'external-request', false)).toBe(true);
      expect(hasFinding(s, 'broken-image', false)).toBe(true);
      // The console "Failed to load resource" noise must be deduped away.
      expect(hasFinding(s, 'page-error')).toBe(false);
      expect(s.ok).toBe(false);
    }
  });

  it('runtime-error fixture: page-error mentioning the thrown message', () => {
    for (const s of screensOf('runtime-error')) {
      const pe = s.findings.find((f) => f.type === 'page-error' && !f.suppressed);
      expect(pe).toBeDefined();
      expect(`${pe?.message ?? ''} ${pe?.detail ?? ''}`).toContain('mock runtime error');
      expect(s.ok).toBe(false);
    }
  });
});

describe('intentional exceptions are respected', () => {
  it.each(['decorative-intentional', 'carousel-peek', 'clipped-text-intentional'])(
    '%s: zero unsuppressed errors, at least one suppressed finding, ok',
    (name) => {
      for (const s of screensOf(name)) {
        expect(unsuppressed(s).filter((f) => f.severity === 'error')).toHaveLength(0);
        expect(s.counts.suppressed).toBeGreaterThanOrEqual(1);
        expect(s.ok).toBe(true);
      }
    },
  );

  it('carousel-peek: document never scrolls horizontally', () => {
    for (const s of screensOf('carousel-peek')) {
      expect(hasFinding(s, 'document-overflow')).toBe(false);
    }
  });

  it('decorative-intentional: document-overflow stays silent under overflow-x: hidden', () => {
    for (const s of screensOf('decorative-intentional')) {
      expect(hasFinding(s, 'document-overflow')).toBe(false);
    }
  });
});

describe('reports identify useful likely offenders', () => {
  it('document-overflow: offender is the wide banner, with rect and px amounts', () => {
    const s = screensOf('document-overflow').find((x) => x.device === 'iphone-14');
    expect(s).toBeDefined();
    const f = s?.findings.find((x) => x.type === 'element-overflow-right' && !x.suppressed);
    expect(f?.element?.selector).toContain('wide-banner');
    expect(f?.element?.rect.width).toBeGreaterThan(390);
    expect(Number.isFinite(f?.element?.rect.x)).toBe(true);
    expect(f?.message).toMatch(/extends [\d.]+px past the right edge of a 390px viewport/);
    expect(f?.suggestion.length).toBeGreaterThan(0);
    // document-overflow message should name the likely offender too
    const d = s?.findings.find((x) => x.type === 'document-overflow');
    expect(d?.message).toContain('wide-banner');
  });

  it('element-overflow-right fixture: offender selector points at the peek card', () => {
    const s = screensOf('element-overflow-right').find((x) => x.device === 'iphone-14');
    const f = s?.findings.find((x) => x.type === 'element-overflow-right' && !x.suppressed);
    expect(f?.element?.selector).toContain('peek-card');
    expect(f?.message).toMatch(/extends [\d.]+px past the right edge of a 390px viewport/);
    expect(f?.suggestion.length).toBeGreaterThan(0);
  });

  it('element-overflow-left fixture: offender selector points at the pull quote', () => {
    const s = screensOf('element-overflow-left').find((x) => x.device === 'iphone-14');
    const f = s?.findings.find((x) => x.type === 'element-overflow-left' && !x.suppressed);
    expect(f?.element?.selector).toContain('pull-quote');
    expect(f?.message).toMatch(/extends [\d.]+px past the left edge of a 390px viewport/);
  });
});

describe('exit codes', () => {
  it('full validate over all fixtures exits 1', () => {
    expect(fullRun.status).toBe(1);
  });

  it('validate --screen valid exits 0', () => {
    expect(validOnlyRun.status).toBe(0);
    expect(validOnlyRun.stdout).toContain('PASS');
  });
});

describe('valid screens pass', () => {
  it.each(['valid', 'long-page'])('%s: zero unsuppressed findings on every device', (name) => {
    const entries = screensOf(name);
    expect(entries).toHaveLength(3);
    for (const s of entries) {
      expect(unsuppressed(s)).toHaveLength(0);
      expect(s.ok).toBe(true);
    }
  });
});

describe('machine-readable output is structurally stable', () => {
  it('report.json has the exact documented shape', () => {
    expect(Object.keys(report).sort()).toEqual(['readiness', 'scope', 'screens', 'summary', 'tool', 'version']);
    expect(report.version).toBe(3);
    expect(report.tool).toBe('mocklens');
    expect(report.readiness).toEqual({
      evaluated: false,
      uxTrackingConfigured: false,
      proofScope: 'FULL',
      coverage: {
        configured: { screens: 0, devices: 0, combinations: 0 },
        evaluated: { screens: 0, devices: 0, combinations: 0 },
      },
      counts: {
        ux: { current: 0, missing: 0, stale: 0, total: 0 },
        visual: { current: 0, missing: 0, stale: 0, total: 0 },
      },
      requirements: [],
      visual: [],
      remainingProject: null,
      sanityOk: false,
      uxProofOk: true,
      visualProofOk: true,
      ready: false,
    });
    expect(Object.keys(report.summary).sort()).toEqual(['combinations', 'devices', 'errors', 'ok', 'suppressed', 'uniqueScreens', 'warnings']);
    expect(report.summary.combinations).toBe(42);
    expect(report.summary.uniqueScreens).toBe(14);
    expect(report.scope.coverage).toBe('FULL');

    for (const s of report.screens) {
      expect(Object.keys(s).sort()).toEqual(['counts', 'device', 'findings', 'name', 'ok', 'screenshot', 'source', 'viewport']);
      expect(Object.keys(s.counts).sort()).toEqual(['error', 'suppressed', 'warning']);
      expect(Object.keys(s.viewport).sort()).toEqual(['height', 'width']);
      for (const f of s.findings) {
        for (const key of ['type', 'severity', 'suppressed', 'message', 'suggestion']) {
          expect(Object.keys(f), `finding missing key ${key}`).toContain(key);
        }
        for (const key of Object.keys(f)) {
          expect(['type', 'severity', 'suppressed', 'message', 'suggestion', 'element', 'coveredElement', 'overlap', 'detail']).toContain(key);
        }
        expect(FINDING_TYPES.has(f.type)).toBe(true);
        expect(['error', 'warning']).toContain(f.severity);
        expect(typeof f.suppressed).toBe('boolean');
        if (f.element !== undefined) {
          expect(Object.keys(f.element).sort()).toEqual(['classes', 'id', 'rect', 'selector', 'tag', 'text']);
          expect(Object.keys(f.element.rect).sort()).toEqual(['height', 'width', 'x', 'y']);
        }
      }
    }
  });
});

describe('clipped-text', () => {
  it('accidental fixture warns unsuppressed clipped-text', () => {
    for (const s of screensOf('clipped-text-accidental')) {
      const f = s.findings.find((x) => x.type === 'clipped-text' && !x.suppressed);
      expect(f).toBeDefined();
      expect(f?.severity).toBe('warning');
      expect(f?.element?.selector).toContain('clamp');
      expect(s.ok).toBe(true); // warnings don't fail a screen
    }
  });

  it('intentional fixture clipped-text is suppressed', () => {
    for (const s of screensOf('clipped-text-intentional')) {
      expect(hasFinding(s, 'clipped-text', true)).toBe(true);
      expect(hasFinding(s, 'clipped-text', false)).toBe(false);
    }
  });
});

describe('fixed-bottom-cover', () => {
  it('errors and identifies the covered content', () => {
    for (const s of screensOf('fixed-bottom-cover')) {
      const f = s.findings.find((x) => x.type === 'fixed-bottom-cover' && !x.suppressed);
      expect(f).toBeDefined();
      expect(f?.severity).toBe('error');
      expect(f?.element?.selector).toContain('bar');
      expect(`${f?.message ?? ''} ${f?.detail ?? ''}`).toContain('final');
      expect(s.ok).toBe(false);
    }
  });
});

describe('CLI surface', () => {
  it('check output is a complete agent-facing sanity report', () => {
    expect(checkRun.status).toBe(0);
    expect(checkRun.stdout).toContain('MOCKLENS SANITY CHECK — PASS');
    expect(checkRun.stdout).toContain('Coverage: FILTERED');
    expect(checkRun.stdout).toContain('Configured: 14 unique screens × 3 devices = 42 combinations');
    expect(checkRun.stdout).toContain('Checked: 1 unique screens × 1 devices = 1 combinations');
    expect(checkRun.stdout).toContain('Rules checked (9):');
    expect(checkRun.stdout).toContain('Sanity check only');
    expect(checkRun.stdout).toContain('source: screens/valid.html');
    expect(checkRun.stdout).toContain('screenshot: .mocklens/screenshots/iphone-14/valid.png');
    expect(checkRun.stdout).not.toContain('verify visually');
  });

  it('list exits 0 and shows all 14 screens and 3 devices', () => {
    expect(listRun.status).toBe(0);
    for (const name of SCREENS) {
      expect(listRun.stdout).toContain(name);
    }
    for (const d of DEVICES) {
      expect(listRun.stdout).toContain(d);
    }
  });

  it('discovery skips "_"-prefixed paths', () => {
    expect(listRun.stdout).not.toContain('_partials');
    expect(listRun.stdout).not.toContain('ignored');
    expect(report.screens.some((s) => s.name.includes('ignored'))).toBe(false);
  });

  it('unknown command exits 2 with usage', () => {
    expect(unknownRun.status).toBe(2);
    expect(`${unknownRun.stdout}${unknownRun.stderr}`).toContain('Usage:');
  });

  it('--screen filter: report.json contains only that screen', () => {
    expect(filteredReport.screens.length).toBeGreaterThan(0);
    expect(new Set(filteredReport.screens.map((s) => s.name))).toEqual(new Set(['document-overflow']));
    expect(filteredReport.screens.map((s) => s.device).sort()).toEqual([...DEVICES].sort());
  });
});
