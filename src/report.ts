import type { Finding, Report } from './types.js';

/**
 * Suppressed findings carry the reason in their message as a trailing
 * `(data-mocklens-ignore: "<reason>")` — pull it back out for display.
 */
function suppressionReason(f: Finding): string {
  const m = / \(data-mocklens-ignore: "(.*)"\)$/.exec(f.message);
  if (m !== null) return m[1] ?? '';
  if (/ \(data-mocklens-ignore\)$/.test(f.message)) return '(no reason given)';
  return '(no reason given)';
}

/** Plain-text terminal rendering of a validation Report. */
export function renderReport(report: Report): string {
  const lines: string[] = [];
  for (const s of report.screens) {
    lines.push(`${s.name} (${s.device} ${s.viewport.width}×${s.viewport.height})`);
    if (s.findings.length === 0) {
      lines.push('  ok — no findings');
    } else {
      for (const f of s.findings) {
        if (f.suppressed) {
          lines.push(`  suppressed: ${f.type} ${f.element?.selector ?? ''} (${suppressionReason(f)})`);
        } else {
          const target = f.element !== undefined ? `  ${f.element.selector}` : '';
          lines.push(`  ${f.severity.toUpperCase()} ${f.type}${target} — ${f.message}`);
          if (f.suggestion !== '') lines.push(`    → ${f.suggestion}`);
        }
      }
    }
    lines.push('');
  }
  const screens = new Set(report.screens.map((s) => s.name)).size;
  const devices = new Set(report.screens.map((s) => s.device)).size;
  const { errors, warnings, suppressed, ok } = report.summary;
  lines.push(
    `${screens} screens × ${devices} devices: ${errors} errors, ${warnings} warnings, ${suppressed} suppressed — ${ok ? 'PASS' : 'FAIL'}`,
  );
  return lines.join('\n');
}
