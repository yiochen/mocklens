import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface Manifest {
  version: number;
  screenshots: {
    screen: string;
    device: string;
    viewport: { width: number; height: number };
    fullPage: boolean;
    path: string;
  }[];
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

/** Read PNG dimensions straight from the IHDR chunk (no image deps). */
function pngSize(file: string): { width: number; height: number } {
  const buf = fs.readFileSync(file);
  expect(buf.toString('ascii', 1, 4)).toBe('PNG');
  expect(buf.toString('ascii', 12, 16)).toBe('IHDR');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

let shotRun: CliResult;
let manifest: Manifest;

beforeAll(() => {
  fs.rmSync(path.join(OUT, 'screenshots'), { recursive: true, force: true });
  shotRun = runCli(['screenshot', '--full-page']);
  manifest = readJson<Manifest>('screenshots/manifest.json');
}, 600_000);

describe('screenshots for every screen x device', () => {
  it('screenshot --full-page exits 0', () => {
    expect(shotRun.status).toBe(0);
  });

  it('writes normal and full-page PNGs for all 14 screens x 3 devices', () => {
    for (const screen of SCREENS) {
      for (const device of DEVICES) {
        for (const suffix of ['.png', '.full.png']) {
          const file = path.join(OUT, 'screenshots', device, screen + suffix);
          expect(fs.existsSync(file), `${device}/${screen}${suffix}`).toBe(true);
          expect(fs.statSync(file).size).toBeGreaterThan(1000);
        }
      }
    }
  });

  it('manifest.json has 84 entries with viewport and relative paths', () => {
    expect(manifest.version).toBe(1);
    expect(manifest.screenshots).toHaveLength(84);
    for (const e of manifest.screenshots) {
      expect(Object.keys(e).sort()).toEqual(['device', 'fullPage', 'path', 'screen', 'viewport']);
      expect(SCREENS).toContain(e.screen);
      expect(DEVICES).toContain(e.device);
      expect(e.viewport.width).toBeGreaterThan(0);
      expect(e.viewport.height).toBeGreaterThan(0);
      expect(e.path.startsWith('/')).toBe(false);
      expect(e.path).not.toContain('..');
      expect(fs.existsSync(path.join(OUT, 'screenshots', e.path))).toBe(true);
    }
    expect(manifest.screenshots.filter((e) => e.fullPage)).toHaveLength(42);
    expect(manifest.screenshots.filter((e) => !e.fullPage)).toHaveLength(42);
    expect(manifest.screenshots.some((e) => e.screen.includes('ignored'))).toBe(false);
  });

  it('long-page full-page PNG is significantly taller than its viewport PNG', () => {
    const normal = pngSize(path.join(OUT, 'screenshots', 'iphone-14', 'long-page.png'));
    const full = pngSize(path.join(OUT, 'screenshots', 'iphone-14', 'long-page.full.png'));
    expect(full.height).toBeGreaterThan(normal.height * 2);
    expect(full.width).toBe(normal.width);
  });
});
