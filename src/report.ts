import type { ElementInfo, Finding, Report } from './types.js';

export const SANITY_RULES = [
  'document-overflow',
  'element-overflow-left',
  'element-overflow-right',
  'clipped-text',
  'broken-image',
  'page-error',
  'external-request',
  'fixed-bottom-cover',
  'fixed-overlay-cover',
] as const;

const DISCLAIMER =
  'Sanity check only: this does not judge composition, hierarchy, consistency, aesthetics, usability, or fidelity to the brief.';

function suppressionReason(f: Finding): string {
  const m = / \(data-mocklens-ignore: "(.*)"\)$/.exec(f.message);
  if (m !== null) return m[1] ?? '';
  return '(no reason given)';
}

function rect(element: ElementInfo): string {
  const r = element.rect;
  const text = element.text === '' ? '' : ` text=${JSON.stringify(element.text)}`;
  return `${element.selector} [x=${r.x}, y=${r.y}, w=${r.width}, h=${r.height}]${text}`;
}

/** Complete, deterministic agent-facing terminal rendering of a validation report. */
export function renderReport(report: Report): string {
  const lines: string[] = [];
  const verdict = report.summary.ok ? 'PASS' : 'FAIL';
  lines.push(`MOCKLENS SANITY CHECK — ${verdict}`);
  lines.push(`Coverage: ${report.scope.coverage}`);
  lines.push(`Config: ${report.scope.config}`);
  lines.push(
    `Configured: ${report.scope.configured.uniqueScreens} unique screens × ${report.scope.configured.devices} devices = ${report.scope.configured.combinations} combinations`,
  );
  lines.push(
    `Checked: ${report.scope.covered.uniqueScreens} unique screens × ${report.scope.covered.devices} devices = ${report.scope.covered.combinations} combinations`,
  );
  if (report.scope.coverage === 'FILTERED') {
    lines.push(`Requested screens: ${report.scope.requested.screens.join(', ') || '(all)'}`);
    lines.push(`Requested devices: ${report.scope.requested.devices.join(', ') || '(all)'}`);
  }
  lines.push(`Rules checked (${SANITY_RULES.length}): ${SANITY_RULES.join(', ')}`);
  lines.push(`Scope: ${DISCLAIMER}`);
  lines.push('');

  for (const s of report.screens) {
    lines.push(`${s.name} (${s.device} ${s.viewport.width}×${s.viewport.height})`);
    lines.push(`  source: ${s.source}`);
    if (s.screenshot !== null) lines.push(`  screenshot: ${s.screenshot}`);
    if (s.findings.length === 0) {
      lines.push('  ok — no findings');
    } else {
      for (const f of s.findings) {
        if (f.suppressed) {
          lines.push(`  SUPPRESSED ${f.type} — ${suppressionReason(f)}`);
        } else {
          lines.push(`  ${f.severity.toUpperCase()} ${f.type} — ${f.message}`);
        }
        if (f.element !== undefined) lines.push(`    element: ${rect(f.element)}`);
        if (f.coveredElement !== undefined) lines.push(`    covered: ${rect(f.coveredElement)}`);
        if (f.overlap !== undefined) {
          lines.push(
            `    overlap: ${f.overlap.width}×${f.overlap.height}px (${f.overlap.area}px²) at scroll ${f.overlap.scrollX},${f.overlap.scrollY}`,
          );
        }
        if (f.detail !== undefined && f.detail !== '') lines.push(`    detail: ${f.detail}`);
        if (f.suggestion !== '') lines.push(`    suggestion: ${f.suggestion}`);
      }
    }
    lines.push('');
  }

  const { uniqueScreens, devices, combinations, errors, warnings, suppressed } = report.summary;
  lines.push(
    `SANITY CHECK ${verdict}: ${uniqueScreens} unique screens × ${devices} devices = ${combinations} combinations; ${errors} errors, ${warnings} warnings, ${suppressed} suppressed.`,
  );
  lines.push(DISCLAIMER);
  return lines.join('\n');
}
