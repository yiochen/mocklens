import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Finding, Report } from '../src/types.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'fixtures', 'overlay');
const CLI = path.join(ROOT, 'dist', 'cli.js');
let report: Report;

function finding(name: string): Finding | undefined {
  return report.screens.find((screen) => screen.name === name)?.findings.find((item) => item.type.includes('cover'));
}

beforeAll(() => {
  fs.rmSync(path.join(FIXTURE, '.mocklens'), { recursive: true, force: true });
  const result = spawnSync(process.execPath, [CLI, 'validate'], { cwd: FIXTURE, encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(1);
  report = JSON.parse(fs.readFileSync(path.join(FIXTURE, '.mocklens', 'report.json'), 'utf8')) as Report;
}, 120_000);

describe('fixed and sticky overlay coverage', () => {
  it('reports permanent floating and bottom-bar coverage with both geometries', () => {
    for (const name of ['floating-amount', 'save-bar-field']) {
      const item = finding(name);
      expect(item?.severity).toBe('error');
      expect(item?.element?.selector).toBeTruthy();
      expect(item?.coveredElement?.selector).toBeTruthy();
      expect(item?.overlap?.area).toBeGreaterThan(0);
    }
  });

  it('warns when initially covered content becomes reachable', () => {
    expect(finding('reachable-scroll')?.severity).toBe('warning');
  });

  it('does not flag padded bars, dialogs, or decorative overlays', () => {
    for (const name of ['padded-bottom-bar', 'modal', 'decorative-fixed']) expect(finding(name)).toBeUndefined();
  });

  it('keeps intentional coverage visible but suppressed', () => {
    expect(finding('suppressed-overlay')?.suppressed).toBe(true);
  });
});
