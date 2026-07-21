import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { loadConfig, MocklensError } from '../src/config.js';
import { discoverScreens } from '../src/screens.js';
import {
  buildVisualInputs,
  checkpointUx,
  checkpointVisual,
  loadCheckpointLedger,
  loadUxManifest,
  uxCheckpointStatus,
  visualCheckpointStatus,
  renderCheckpointSummary,
} from '../src/checkpoint.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'dist', 'cli.js');

function project(): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mocklens-checkpoint-'));
  fs.mkdirSync(path.join(cwd, 'screens', 'theme'), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, 'mocklens.config.json'),
    `${JSON.stringify({ screensDir: 'screens', outDir: '.mocklens', devices: [{ name: 'phone', width: 390, height: 844 }] }, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(cwd, 'screens', 'home.html'), '<link rel="stylesheet" href="shared.css"><main>Home</main>\n');
  fs.writeFileSync(path.join(cwd, 'screens', 'detail.html'), '<link href="shared.css" rel="stylesheet"><main>Detail</main>\n');
  fs.writeFileSync(path.join(cwd, 'screens', 'unrelated.html'), '<main>Other</main>\n');
  fs.writeFileSync(path.join(cwd, 'screens', 'shared.css'), '@import "theme/tokens.css";\nmain { color: var(--ink); }\n');
  fs.writeFileSync(path.join(cwd, 'screens', 'theme', 'tokens.css'), ':root { --ink: #111; }\n');
  return cwd;
}

function writeManifest(cwd: string, requirements: unknown[] = [
  { id: 'clear-primary-action', kind: 'screen', description: 'The primary action is discoverable.', screens: ['home'] },
  { id: 'detail-flow', kind: 'flow', description: 'The flow connects home and detail.', screens: ['home', 'detail'] },
]): void {
  fs.writeFileSync(
    path.join(cwd, 'mocklens.ux.json'),
    `${JSON.stringify({ version: 1, goal: 'Ship a clear flow.', delivery: { screens: ['home', 'detail'], devices: ['phone'] }, requirements }, null, 2)}\n`,
  );
}

function context(cwd: string) {
  const config = loadConfig(undefined, cwd);
  const screens = discoverScreens(config.screensDir);
  const manifest = loadUxManifest(config, screens);
  if (manifest === null) throw new Error('test manifest missing');
  return { config, screens, manifest };
}

function cli(cwd: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('UX manifest validation', () => {
  it('keeps projects without a manifest compatible', () => {
    const cwd = project();
    const config = loadConfig(undefined, cwd);
    expect(loadUxManifest(config, discoverScreens(config.screensDir))).toBeNull();
  });

  it('accepts the versioned manifest and rejects malformed JSON', () => {
    const cwd = project();
    writeManifest(cwd);
    expect(context(cwd).manifest.requirements).toHaveLength(2);
    fs.writeFileSync(path.join(cwd, 'mocklens.ux.json'), '{bad');
    expect(() => context(cwd)).toThrow(/invalid JSON/);
  });

  it('rejects duplicate IDs, unsafe paths, unknown screens, and unknown devices', () => {
    const cwd = project();
    const base = { id: 'same-id', kind: 'screen', description: 'Evidence.', screens: ['home'] };
    writeManifest(cwd, [base, base]);
    expect(() => context(cwd)).toThrow(/duplicate UX requirement ID/);

    writeManifest(cwd, [{ ...base, id: 'unsafe', screens: ['../home'] }]);
    expect(() => context(cwd)).toThrow(/unsafe path/);

    writeManifest(cwd, [{ ...base, id: 'missing-screen', screens: ['missing'] }]);
    expect(() => context(cwd)).toThrow(/unknown screen/);

    writeManifest(cwd);
    const file = path.join(cwd, 'mocklens.ux.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { delivery: { devices: string[] } };
    raw.delivery.devices = ['tablet'];
    fs.writeFileSync(file, JSON.stringify(raw));
    expect(() => context(cwd)).toThrow(/unknown configured device/);
  });
});

describe('UX checkpoints and staleness', () => {
  it('records and replaces deterministic, human-readable proof', () => {
    const cwd = project();
    writeManifest(cwd);
    const { config, screens, manifest } = context(cwd);
    expect(checkpointUx(config, manifest, screens, 'clear-primary-action', 'Create button is above the fold.')).toContain('RECORDED');
    const first = fs.readFileSync(path.join(cwd, 'mocklens.checkpoints.json'), 'utf8');
    expect(first.endsWith('\n')).toBe(true);
    expect(first).not.toContain(cwd);
    expect(first).not.toMatch(/created|updated|timestamp/i);
    checkpointUx(config, manifest, screens, 'clear-primary-action', 'Create button is above the fold.');
    expect(fs.readFileSync(path.join(cwd, 'mocklens.checkpoints.json'), 'utf8')).toBe(first);
    expect(checkpointUx(config, manifest, screens, 'clear-primary-action', 'Create button is labeled and prominent.')).toContain('REPLACED');
    const ledger = loadCheckpointLedger(config);
    expect(ledger.ux['clear-primary-action']?.proof).toBe('Create button is labeled and prominent.');
    expect(Object.keys(ledger.ux['clear-primary-action']?.inputs ?? {})).toEqual([...Object.keys(ledger.ux['clear-primary-action']?.inputs ?? {})].sort());
  });

  it('rejects empty proof and unknown requirements before writing', () => {
    const cwd = project();
    writeManifest(cwd);
    const { config, screens, manifest } = context(cwd);
    expect(() => checkpointUx(config, manifest, screens, 'clear-primary-action', '   ')).toThrow(/non-empty/);
    expect(() => checkpointUx(config, manifest, screens, 'unknown-id', 'Evidence')).toThrow(/unknown UX requirement/);
    expect(fs.existsSync(path.join(cwd, 'mocklens.checkpoints.json'))).toBe(false);
  });

  it('invalidates only relevant HTML, recursive CSS, requirements, and devices', () => {
    const cwd = project();
    writeManifest(cwd);
    let { config, screens, manifest } = context(cwd);
    const requirement = manifest.requirements[0]!;
    checkpointUx(config, manifest, screens, requirement.id, 'Evidence');
    expect(uxCheckpointStatus(config, manifest, requirement, screens).status).toBe('current');

    fs.appendFileSync(path.join(cwd, 'screens', 'unrelated.html'), '<!-- edit -->');
    expect(uxCheckpointStatus(config, manifest, requirement, discoverScreens(config.screensDir)).status).toBe('current');

    const home = path.join(cwd, 'screens', 'home.html');
    const originalHome = fs.readFileSync(home, 'utf8');
    fs.appendFileSync(home, '<!-- edit -->');
    let status = uxCheckpointStatus(config, manifest, requirement, discoverScreens(config.screensDir));
    expect(status.reasons).toContain('screens/home.html changed');
    fs.writeFileSync(home, originalHome);

    fs.appendFileSync(path.join(cwd, 'screens', 'theme', 'tokens.css'), '\n/* edit */');
    status = uxCheckpointStatus(config, manifest, requirement, discoverScreens(config.screensDir));
    expect(status).toEqual({ status: 'stale', reasons: ['screens/theme/tokens.css changed'] });

    fs.writeFileSync(path.join(cwd, 'screens', 'theme', 'tokens.css'), ':root { --ink: #111; }\n');
    ({ config, screens, manifest } = context(cwd));
    const raw = JSON.parse(fs.readFileSync(path.join(cwd, 'mocklens.ux.json'), 'utf8')) as { requirements: Array<{ description: string }> };
    raw.requirements[0]!.description = 'A changed requirement.';
    fs.writeFileSync(path.join(cwd, 'mocklens.ux.json'), JSON.stringify(raw));
    ({ config, screens, manifest } = context(cwd));
    status = uxCheckpointStatus(config, manifest, manifest.requirements[0]!, screens);
    expect(status.reasons).toContain('requirement clear-primary-action changed');

    writeManifest(cwd);
    const configRaw = JSON.parse(fs.readFileSync(path.join(cwd, 'mocklens.config.json'), 'utf8')) as { devices: Array<{ height: number }> };
    configRaw.devices[0]!.height = 900;
    fs.writeFileSync(path.join(cwd, 'mocklens.config.json'), JSON.stringify(configRaw));
    ({ config, screens, manifest } = context(cwd));
    status = uxCheckpointStatus(config, manifest, manifest.requirements[0]!, screens);
    expect(status.reasons).toContain('device phone changed');
  });

  it('preserves independent proofs from parallel CLI writers', async () => {
    const cwd = project();
    writeManifest(cwd);
    const [one, two] = await Promise.all([
      cli(cwd, ['checkpoint', 'ux', 'clear-primary-action', '--proof', 'Primary evidence']),
      cli(cwd, ['checkpoint', 'ux', 'detail-flow', '--proof', 'Flow evidence']),
    ]);
    expect(one.code, one.stderr).toBe(0);
    expect(two.code, two.stderr).toBe(0);
    const ledger = loadCheckpointLedger(loadConfig(undefined, cwd));
    expect(Object.keys(ledger.ux)).toEqual(['clear-primary-action', 'detail-flow']);
  });

  it('ignores an interrupted writer temp file and preserves the prior ledger', () => {
    const cwd = project();
    writeManifest(cwd);
    const { config, screens, manifest } = context(cwd);
    checkpointUx(config, manifest, screens, 'clear-primary-action', 'Original');
    fs.writeFileSync(path.join(cwd, '.mocklens.checkpoints.json.999.interrupted.tmp'), '{partial');
    expect(loadCheckpointLedger(config).ux['clear-primary-action']?.proof).toBe('Original');
  });

  it('renders current, missing, and structured stale reasons for check output', () => {
    const cwd = project();
    writeManifest(cwd);
    const { config, screens, manifest } = context(cwd);
    checkpointUx(config, manifest, screens, 'clear-primary-action', 'Evidence');
    let summary = renderCheckpointSummary(config, manifest, screens);
    expect(summary).toContain('CURRENT clear-primary-action');
    expect(summary).toContain('MISSING detail-flow');
    expect(summary).toContain('MISSING home@phone');
    fs.appendFileSync(path.join(cwd, 'screens', 'shared.css'), '\n/* changed */');
    summary = renderCheckpointSummary(config, manifest, discoverScreens(config.screensDir));
    expect(summary).toContain('STALE clear-primary-action');
    expect(summary).toContain('screens/shared.css changed');
  });
});

describe('visual checkpoints', () => {
  function writeVisualArtifacts(cwd: string): ReturnType<typeof context> {
    writeManifest(cwd);
    const ctx = context(cwd);
    const screen = ctx.screens.find((item) => item.name === 'home')!;
    const device = ctx.config.devices[0]!;
    const inputHash = buildVisualInputs(ctx.config, screen, device).hash;
    const screenshotDir = path.join(cwd, '.mocklens', 'screenshots', 'phone');
    fs.mkdirSync(screenshotDir, { recursive: true });
    const screenshotBytes = Buffer.from('png bytes');
    fs.writeFileSync(path.join(screenshotDir, 'home.png'), screenshotBytes);
    fs.writeFileSync(path.join(cwd, '.mocklens', 'sanity-state.json'), JSON.stringify({
      version: 1,
      results: { 'home@phone': { screen: 'home', device: 'phone', inputHash, ok: true } },
    }));
    fs.writeFileSync(path.join(cwd, '.mocklens', 'screenshots', 'manifest.json'), JSON.stringify({
      version: 1,
      screenshots: [{ screen: 'home', device: 'phone', fullPage: false, path: 'phone/home.png' }],
    }));
    fs.writeFileSync(path.join(cwd, '.mocklens', 'screenshots', 'state.json'), JSON.stringify({
      version: 1,
      screenshots: {
        'home@phone': {
          screen: 'home',
          device: 'phone',
          path: 'phone/home.png',
          inputHash,
          screenshotSha256: crypto.createHash('sha256').update(screenshotBytes).digest('hex'),
        },
      },
    }));
    return ctx;
  }

  it('validates the whole batch before writing', () => {
    const cwd = project();
    const { config, screens } = writeVisualArtifacts(cwd);
    const selected = screens.filter((screen) => screen.name === 'home' || screen.name === 'detail');
    expect(() => checkpointVisual(config, selected, config.devices, 'Reviewed both')).toThrow(/batch refused/);
    expect(fs.existsSync(path.join(cwd, 'mocklens.checkpoints.json'))).toBe(false);
  });

  it('records screenshot hashes and recognizes source and screenshot staleness', () => {
    const cwd = project();
    const { config, screens } = writeVisualArtifacts(cwd);
    const screen = screens.find((item) => item.name === 'home')!;
    expect(checkpointVisual(config, [screen], config.devices, 'Viewport is balanced.')).toContain('RECORDED');
    expect(visualCheckpointStatus(config, screen, config.devices[0]!).status).toBe('current');
    fs.writeFileSync(path.join(cwd, '.mocklens', 'screenshots', 'phone', 'home.png'), Buffer.from('png bytes'));
    expect(visualCheckpointStatus(config, screen, config.devices[0]!).status).toBe('current');
    fs.writeFileSync(path.join(cwd, '.mocklens', 'screenshots', 'phone', 'home.png'), Buffer.from('new png bytes'));
    expect(visualCheckpointStatus(config, screen, config.devices[0]!).reasons).toContain('.mocklens/screenshots/phone/home.png changed');
  });

  it('refuses stale or failing sanity state and empty proof', () => {
    const cwd = project();
    const { config, screens } = writeVisualArtifacts(cwd);
    const screen = screens.find((item) => item.name === 'home')!;
    expect(() => checkpointVisual(config, [screen], config.devices, ' ')).toThrow(/non-empty/);
    fs.appendFileSync(path.join(cwd, 'screens', 'home.html'), '<!-- stale -->');
    expect(() => checkpointVisual(config, [screen], config.devices, 'Evidence')).toThrow(/sanity result is stale/);
    expect(fs.existsSync(path.join(cwd, 'mocklens.checkpoints.json'))).toBe(false);
  });
});

describe('expected errors', () => {
  it('uses MocklensError for validation failures', () => {
    const cwd = project();
    fs.writeFileSync(path.join(cwd, 'mocklens.ux.json'), '{}');
    try {
      context(cwd);
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(MocklensError);
    }
  });
});
