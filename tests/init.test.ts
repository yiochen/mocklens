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
  it('creates config and shared files without inventing screens', () => {
    const cwd = tempProject();
    const init = runCli(cwd, ['init']);
    expect(init.status).toBe(0);
    expect(init.stdout).toContain('MOCKLENS INITIALIZED');
    expect(init.stdout).toContain('"iphone-14"');
    expect(init.stdout).toContain('no HTML screens were created');

    for (const rel of [
      'mocklens.config.json',
      'screens/shared.css',
      'screens/README.md',
    ]) {
      expect(fs.existsSync(path.join(cwd, rel)), rel).toBe(true);
    }

    const config = JSON.parse(fs.readFileSync(path.join(cwd, 'mocklens.config.json'), 'utf8')) as {
      screensDir: string;
    };
    expect(config.screensDir).toBe('screens');
    const guidance = fs.readFileSync(path.join(cwd, 'screens', 'README.md'), 'utf8');
    expect(guidance).toContain('Intent → Model → Cover');
    expect(guidance).toContain('hardest credible content state');
    expect(guidance).toContain('mocklens checkpoint ux');
    expect(guidance).toContain('DELIVERY READINESS — PASS');

    const list = runCli(cwd, ['list']);
    expect(list.status).toBe(0);
    expect(list.stdout).toContain('screens (0)');
  });

  it('uses --dir for the generated screen folder', () => {
    const cwd = tempProject();
    const init = runCli(cwd, ['init', '--dir', 'mocks/mobile']);
    expect(init.status).toBe(0);
    expect(fs.existsSync(path.join(cwd, 'mocks/mobile/shared.css'))).toBe(true);
    const config = JSON.parse(fs.readFileSync(path.join(cwd, 'mocklens.config.json'), 'utf8')) as {
      screensDir: string;
    };
    expect(config.screensDir).toBe('mocks/mobile');
  });

  it('is idempotent when a valid config already exists', () => {
    const cwd = tempProject();
    expect(runCli(cwd, ['init']).status).toBe(0);
    fs.writeFileSync(path.join(cwd, 'screens', 'shared.css'), 'custom css', 'utf8');

    const second = runCli(cwd, ['init']);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain('MOCKLENS ALREADY INITIALIZED');
    expect(second.stdout).toContain('No files changed');
    expect(fs.readFileSync(path.join(cwd, 'screens', 'shared.css'), 'utf8')).toBe('custom css');
  });

  it('--force replaces init-owned files but never screen HTML', () => {
    const cwd = tempProject();
    expect(runCli(cwd, ['init']).status).toBe(0);
    fs.writeFileSync(path.join(cwd, 'screens', 'shared.css'), 'custom css', 'utf8');
    fs.writeFileSync(path.join(cwd, 'screens', 'custom.html'), 'custom screen', 'utf8');

    const forced = runCli(cwd, ['init', '--force']);
    expect(forced.status).toBe(0);
    expect(forced.stdout).toContain('Replaced init-owned files');
    expect(fs.readFileSync(path.join(cwd, 'screens', 'shared.css'), 'utf8')).not.toBe('custom css');
    expect(fs.readFileSync(path.join(cwd, 'screens', 'custom.html'), 'utf8')).toBe('custom screen');
  });

  it('rejects malformed existing config without modifying it', () => {
    const cwd = tempProject();
    const file = path.join(cwd, 'mocklens.config.json');
    fs.writeFileSync(file, '{bad json', 'utf8');
    const result = runCli(cwd, ['init']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('invalid JSON');
    expect(fs.readFileSync(file, 'utf8')).toBe('{bad json');
  });

  it('rejects unsafe screen directories', () => {
    const cwd = tempProject();
    const init = runCli(cwd, ['init', '--dir', '../outside']);
    expect(init.status).toBe(2);
    expect(init.stderr).toContain('--dir must stay inside the config file directory');
  });
});

describe('new-screen command', () => {
  it('creates device-aware variants with standalone metadata and a blank scaffold', () => {
    const cwd = tempProject();
    expect(runCli(cwd, ['init']).status).toBe(0);

    const created = runCli(cwd, ['new-screen', 'settings', '--device', 'iphone-14']);
    expect(created.status).toBe(0);
    expect(created.stdout).toContain('screens/settings.iphone-14.html');

    const file = path.join(cwd, 'screens/settings.iphone-14.html');
    const html = fs.readFileSync(file, 'utf8');
    expect(html).toContain('<meta name="mocklens:form-factor" content="phone">');
    expect(html).toContain('<meta name="mocklens:primary-device" content="iphone-14">');
    expect(html).toContain('<meta name="mocklens:viewport" content="390x844">');
    expect(html).toContain('Start designing this screen.');

    const second = runCli(cwd, ['new-screen', 'settings', '--device', 'pixel-7']);
    expect(second.status).toBe(0);
    expect(fs.existsSync(path.join(cwd, 'screens/settings.pixel-7.html'))).toBe(true);

    const list = runCli(cwd, ['list']);
    expect(list.status).toBe(0);
    expect(list.stdout).toContain('settings.iphone-14 (device=iphone-14 form-factor=phone)');
    expect(list.stdout).toContain('settings.pixel-7 (device=pixel-7 form-factor=phone)');
  });

  it('supports nested screen paths', () => {
    const cwd = tempProject();
    expect(runCli(cwd, ['init']).status).toBe(0);
    const created = runCli(cwd, ['new-screen', 'states/empty', '--device', 'iphone-se']);
    expect(created.status, created.stderr).toBe(0);
    const html = fs.readFileSync(path.join(cwd, 'screens/states/empty.iphone-se.html'), 'utf8');
    expect(html).toContain('href="../shared.css"');
    expect(html).toContain('Start designing this screen.');
  });

  it('creates batches atomically and prints one focused check command', () => {
    const cwd = tempProject();
    expect(runCli(cwd, ['init']).status).toBe(0);
    const created = runCli(cwd, ['new-screen', 'today', 'add-expense', 'summary', '--device', 'iphone-14']);
    expect(created.status, created.stderr).toBe(0);
    expect(created.stdout).toContain('MOCKLENS CREATED 3 SCREENS');
    expect(created.stdout).toContain('--screen today.iphone-14 --screen add-expense.iphone-14 --screen summary.iphone-14');
    for (const name of ['today', 'add-expense', 'summary']) {
      expect(fs.existsSync(path.join(cwd, `screens/${name}.iphone-14.html`))).toBe(true);
    }

    const conflict = runCli(cwd, ['new-screen', 'another', 'today', '--device', 'iphone-14']);
    expect(conflict.status).toBe(2);
    expect(conflict.stderr).toContain('no files created');
    expect(fs.existsSync(path.join(cwd, 'screens/another.iphone-14.html'))).toBe(false);
  });

  it('refuses duplicates and gives actionable device errors', () => {
    const cwd = tempProject();
    expect(runCli(cwd, ['init']).status).toBe(0);
    expect(runCli(cwd, ['new-screen', 'settings', '--device', 'iphone-14']).status).toBe(0);

    const duplicate = runCli(cwd, ['new-screen', 'settings', '--device', 'iphone-14']);
    expect(duplicate.status).toBe(2);
    expect(duplicate.stderr).toContain('screen file(s) already exist');

    const device = runCli(cwd, ['new-screen', 'settings', '--device', 'unknown-phone']);
    expect(device.status).toBe(2);
    expect(device.stderr).toContain('configured devices: iphone-se, iphone-14, pixel-7');

    const removedTemplateFlag = runCli(cwd, [
      'new-screen',
      'settings',
      '--device',
      'iphone-14',
      '--template',
      'list',
    ]);
    expect(removedTemplateFlag.status).toBe(2);
    expect(removedTemplateFlag.stderr).toContain('unknown flag: --template');
  });

  it('rejects unknown devices declared in screen metadata', () => {
    const cwd = tempProject();
    expect(runCli(cwd, ['init']).status).toBe(0);
    expect(runCli(cwd, ['new-screen', 'home', '--device', 'iphone-14']).status).toBe(0);
    const file = path.join(cwd, 'screens/home.iphone-14.html');
    const html = fs.readFileSync(file, 'utf8').replace(
      'content="iphone-14">\n<meta name="mocklens:target-devices" content="iphone-14"',
      'content="future-phone">\n<meta name="mocklens:target-devices" content="future-phone"',
    );
    fs.writeFileSync(file, html, 'utf8');

    const list = runCli(cwd, ['list']);
    expect(list.status).toBe(2);
    expect(list.stderr).toContain('references unknown device(s): future-phone');
    expect(list.stderr).toContain('add them to mocklens.config.json or update the screen');
  });
});
