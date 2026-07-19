import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface PackedFile {
  path: string;
}

interface PackEntry {
  filename: string;
  files: PackedFile[];
}

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

describe('npm package artifact', () => {
  it('contains only the runtime package boundary and exposes the CLI binary', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mocklens-pack-'));
    try {
      const raw = run('npm', ['pack', '--json', '--pack-destination', temp], ROOT);
      const [pack] = JSON.parse(raw) as PackEntry[];
      expect(pack).toBeDefined();

      const files = pack.files.map((f) => f.path).sort();
      expect(files).toContain('package.json');
      expect(files).toContain('README.md');
      expect(files).toContain('LICENSE');
      expect(files).toContain('dist/cli.js');
      expect(files).toContain('dist/cli.d.ts');
      expect(files.some((f) => f.startsWith('fixtures/'))).toBe(false);
      expect(files.some((f) => f.startsWith('tests/'))).toBe(false);
      expect(files.some((f) => f.startsWith('src/'))).toBe(false);
      expect(files.some((f) => f.startsWith('example/'))).toBe(false);
      expect(files).not.toContain('goal.md');

      const consumer = path.join(temp, 'consumer');
      fs.mkdirSync(consumer);
      run('npm', ['init', '-y'], consumer);
      run('npm', ['install', '--ignore-scripts', path.join(temp, pack.filename)], consumer);

      const help = run('npx', ['mocklens', '--help'], consumer);
      expect(help).toContain('mocklens');
      expect(help).toContain('Usage: mocklens <command> [options]');
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  }, 120_000);
});
