import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'dist', 'cli.js');

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(cwd: string, args: string[]): CliResult {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function tempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mocklens-init-'));
}

describe('init command', () => {
  it('creates a starter workspace that list can use', () => {
    const cwd = tempProject();
    const init = runCli(cwd, ['init']);
    expect(init.status).toBe(0);
    expect(init.stdout).toContain('mocklens init created a starter workspace');

    for (const rel of [
      'mocklens.config.json',
      'screens/shared.css',
      'screens/home.html',
      'screens/detail.html',
      'screens/empty-state.html',
      'screens/README.md',
    ]) {
      expect(fs.existsSync(path.join(cwd, rel)), rel).toBe(true);
    }

    const config = JSON.parse(fs.readFileSync(path.join(cwd, 'mocklens.config.json'), 'utf8')) as {
      screensDir: string;
    };
    expect(config.screensDir).toBe('screens');

    const list = runCli(cwd, ['list']);
    expect(list.status).toBe(0);
    expect(list.stdout).toContain('home');
    expect(list.stdout).toContain('detail');
    expect(list.stdout).toContain('empty-state');
  });

  it('uses --dir for the generated screen folder', () => {
    const cwd = tempProject();
    const init = runCli(cwd, ['init', '--dir', 'mocks/mobile']);
    expect(init.status).toBe(0);
    expect(fs.existsSync(path.join(cwd, 'mocks/mobile/home.html'))).toBe(true);
    const config = JSON.parse(fs.readFileSync(path.join(cwd, 'mocklens.config.json'), 'utf8')) as {
      screensDir: string;
    };
    expect(config.screensDir).toBe('mocks/mobile');
  });

  it('refuses to overwrite existing scaffold files by default', () => {
    const cwd = tempProject();
    expect(runCli(cwd, ['init']).status).toBe(0);
    fs.writeFileSync(path.join(cwd, 'screens', 'home.html'), 'custom home', 'utf8');

    const second = runCli(cwd, ['init']);
    expect(second.status).toBe(2);
    expect(second.stderr).toContain('init would overwrite existing file(s)');
    expect(fs.readFileSync(path.join(cwd, 'screens', 'home.html'), 'utf8')).toBe('custom home');
  });

  it('overwrites scaffold files when --force is passed', () => {
    const cwd = tempProject();
    expect(runCli(cwd, ['init']).status).toBe(0);
    fs.writeFileSync(path.join(cwd, 'screens', 'home.html'), 'custom home', 'utf8');

    const forced = runCli(cwd, ['init', '--force']);
    expect(forced.status).toBe(0);
    expect(forced.stdout).toContain('mocklens init updated a starter workspace');
    expect(fs.readFileSync(path.join(cwd, 'screens', 'home.html'), 'utf8')).toContain('Launch Board');
  });

  it('rejects unsafe screen directories', () => {
    const cwd = tempProject();
    const init = runCli(cwd, ['init', '--dir', '../outside']);
    expect(init.status).toBe(2);
    expect(init.stderr).toContain('--dir must stay inside the config file directory');
  });
});
