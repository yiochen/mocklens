import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { loadConfig, MocklensError } from '../src/config.js';
import { discoverScreens } from '../src/screens.js';
import type { Report } from '../src/types.js';
import {
  buildVisualInputs,
  buildReadinessReport,
  checkpointUx,
  checkpointVisual,
  loadCheckpointLedger,
  loadUxManifest,
  uxCheckpointStatus,
  visualCheckpointStatus,
  renderCheckpointSummary,
  renderReadinessReport,
} from '../src/checkpoint.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'dist', 'cli.js');
const READINESS_FIXTURES = path.join(ROOT, 'fixtures', 'readiness');
const FIXTURE_RESULTS = path.join(ROOT, 'fixture_results', 'readiness');
const READINESS_E2E_CASE =
  'check readiness end to end > enforces missing, current, filtered, and stale proof with schema v3 agreement';

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function project(): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mocklens-checkpoint-'));
  fs.cpSync(path.join(READINESS_FIXTURES, 'project'), cwd, { recursive: true });
  return cwd;
}

function copyFixture(cwd: string, source: string, target: string): void {
  fs.copyFileSync(path.join(READINESS_FIXTURES, source), path.join(cwd, target));
}

function writeFixtureTemplate(
  cwd: string,
  source: string,
  target: string,
  replacements: Record<string, string>,
): void {
  let contents = fs.readFileSync(path.join(READINESS_FIXTURES, source), 'utf8');
  for (const [placeholder, value] of Object.entries(replacements)) contents = contents.replaceAll(placeholder, value);
  fs.writeFileSync(path.join(cwd, target), contents);
}

function writeManifest(cwd: string, name = 'valid.json'): void {
  copyFixture(cwd, path.join('manifests', name), 'mocklens.ux.json');
}

function context(cwd: string) {
  const config = loadConfig(undefined, cwd);
  const screens = discoverScreens(config.screensDir);
  const manifest = loadUxManifest(config, screens);
  if (manifest === null) throw new Error('test manifest missing');
  return { config, screens, manifest };
}

function cli(cwd: string, args: string[]): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function normalizeCliOutput(value: string, cwd: string): string {
  const roots = [...new Set([cwd, fs.realpathSync(cwd)])].sort((a, b) => b.length - a.length);
  let normalized = value;
  for (const root of roots) {
    normalized = normalized.replaceAll(root, '<fixture-project>');
    normalized = normalized.replaceAll(root.split(path.sep).join('/'), '<fixture-project>');
  }
  return normalized;
}

function expectFixtureResult(
  name: string,
  cwd: string,
  command: string,
  expectedExit: number,
  result: CliResult,
): void {
  const contents = [
    'Mocklens checked-in CLI fixture result',
    'Test file: tests/checkpoint.test.ts',
    `Test case: ${READINESS_E2E_CASE}`,
    'Fixture input: fixtures/readiness/',
    `Command: ${command}`,
    `Expected exit: ${expectedExit}`,
    '',
    '--- stdout ---',
    normalizeCliOutput(result.stdout, cwd).trimEnd() || '(empty)',
    '',
    '--- stderr ---',
    normalizeCliOutput(result.stderr, cwd).trimEnd() || '(empty)',
    '',
  ].join('\n');
  const file = path.join(FIXTURE_RESULTS, name);
  if (process.env.UPDATE_FIXTURE_RESULTS === '1') {
    fs.mkdirSync(FIXTURE_RESULTS, { recursive: true });
    fs.writeFileSync(file, contents);
  }
  expect(fs.readFileSync(file, 'utf8')).toBe(contents);
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
    writeManifest(cwd, 'malformed.txt');
    expect(() => context(cwd)).toThrow(/invalid JSON/);
  });

  it('rejects duplicate IDs, unsafe paths, unknown screens, and unknown devices', () => {
    const cwd = project();
    writeManifest(cwd, 'duplicate-ids.json');
    expect(() => context(cwd)).toThrow(/duplicate UX requirement ID/);

    writeManifest(cwd, 'unsafe-screen.json');
    expect(() => context(cwd)).toThrow(/unsafe path/);

    writeManifest(cwd, 'unknown-screen.json');
    expect(() => context(cwd)).toThrow(/unknown screen/);

    writeManifest(cwd, 'unknown-device.json');
    expect(() => context(cwd)).toThrow(/unknown configured device/);
  });
});

describe('UX checkpoints and staleness', () => {
  it('builds actionable full and filtered readiness reports', () => {
    const cwd = project();
    writeManifest(cwd);
    const { config, screens, manifest } = context(cwd);
    const full = buildReadinessReport(config, manifest, screens, screens, config.devices, 'FULL', true);
    expect(full.counts.ux).toEqual({ current: 0, missing: 2, stale: 0, total: 2 });
    expect(full.counts.visual).toEqual({ current: 0, missing: 2, stale: 0, total: 2 });
    expect(full.ready).toBe(false);
    const output = renderReadinessReport(full);
    expect(output).toContain('UX PROOF — FAIL');
    expect(output).toContain('VISUAL PROOF — FAIL');
    expect(output).toContain('DELIVERY READINESS — FAIL');
    expect(output).toContain('MISSING clear-primary-action [screen]');
    expect(output).toContain('mocklens checkpoint ux clear-primary-action --proof');
    expect(output).toContain('mocklens checkpoint visual --screen home --device phone --proof');
    expect(output).toContain('does not judge the truth or quality');

    const home = screens.filter((screen) => screen.name === 'home');
    const filtered = buildReadinessReport(config, manifest, screens, home, config.devices, 'FILTERED', true);
    expect(renderReadinessReport(filtered)).toContain('Project delivery readiness was not evaluated.');
    expect(filtered.ready).toBe(false);
    expect(filtered.remainingProject).toEqual({ ux: 2, visual: 2 });
  });

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

    copyFixture(cwd, path.join('variants', 'unrelated-edited.html'), path.join('screens', 'unrelated.html'));
    expect(uxCheckpointStatus(config, manifest, requirement, discoverScreens(config.screensDir)).status).toBe('current');

    copyFixture(cwd, path.join('variants', 'home-edited.html'), path.join('screens', 'home.html'));
    let status = uxCheckpointStatus(config, manifest, requirement, discoverScreens(config.screensDir));
    expect(status.reasons).toContain('screens/home.html changed');
    copyFixture(cwd, path.join('project', 'screens', 'home.html'), path.join('screens', 'home.html'));

    copyFixture(cwd, path.join('variants', 'tokens-edited.css'), path.join('screens', 'theme', 'tokens.css'));
    status = uxCheckpointStatus(config, manifest, requirement, discoverScreens(config.screensDir));
    expect(status).toEqual({ status: 'stale', reasons: ['screens/theme/tokens.css changed'] });

    copyFixture(cwd, path.join('project', 'screens', 'theme', 'tokens.css'), path.join('screens', 'theme', 'tokens.css'));
    ({ config, screens, manifest } = context(cwd));
    copyFixture(cwd, path.join('variants', 'manifest-requirement-changed.json'), 'mocklens.ux.json');
    ({ config, screens, manifest } = context(cwd));
    status = uxCheckpointStatus(config, manifest, manifest.requirements[0]!, screens);
    expect(status.reasons).toContain('requirement clear-primary-action changed');

    writeManifest(cwd);
    copyFixture(cwd, path.join('variants', 'config-device-changed.json'), 'mocklens.config.json');
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
    copyFixture(cwd, path.join('ledger', 'interrupted.json'), '.mocklens.checkpoints.json.999.interrupted.tmp');
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
    copyFixture(cwd, path.join('variants', 'shared-edited.css'), path.join('screens', 'shared.css'));
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
    const screenshotBytes = fs.readFileSync(path.join(READINESS_FIXTURES, 'visual', 'screenshot.txt'));
    copyFixture(cwd, path.join('visual', 'screenshot.txt'), path.join('.mocklens', 'screenshots', 'phone', 'home.png'));
    writeFixtureTemplate(cwd, path.join('visual', 'sanity-state.json'), path.join('.mocklens', 'sanity-state.json'), {
      __INPUT_HASH__: inputHash,
    });
    copyFixture(cwd, path.join('visual', 'manifest.json'), path.join('.mocklens', 'screenshots', 'manifest.json'));
    writeFixtureTemplate(cwd, path.join('visual', 'state.json'), path.join('.mocklens', 'screenshots', 'state.json'), {
      __INPUT_HASH__: inputHash,
      __SCREENSHOT_HASH__: crypto.createHash('sha256').update(screenshotBytes).digest('hex'),
    });
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
    fs.copyFileSync(
      path.join(READINESS_FIXTURES, 'visual', 'screenshot.txt'),
      path.join(cwd, '.mocklens', 'screenshots', 'phone', 'home.png'),
    );
    expect(visualCheckpointStatus(config, screen, config.devices[0]!).status).toBe('current');
    fs.copyFileSync(
      path.join(READINESS_FIXTURES, 'visual', 'screenshot-changed.txt'),
      path.join(cwd, '.mocklens', 'screenshots', 'phone', 'home.png'),
    );
    expect(visualCheckpointStatus(config, screen, config.devices[0]!).reasons).toContain('.mocklens/screenshots/phone/home.png changed');
  });

  it('refuses stale or failing sanity state and empty proof', () => {
    const cwd = project();
    const { config, screens } = writeVisualArtifacts(cwd);
    const screen = screens.find((item) => item.name === 'home')!;
    expect(() => checkpointVisual(config, [screen], config.devices, ' ')).toThrow(/non-empty/);
    copyFixture(cwd, path.join('variants', 'home-edited.html'), path.join('screens', 'home.html'));
    expect(() => checkpointVisual(config, [screen], config.devices, 'Evidence')).toThrow(/sanity result is stale/);
    expect(fs.existsSync(path.join(cwd, 'mocklens.checkpoints.json'))).toBe(false);
  });
});

describe('expected errors', () => {
  it('uses MocklensError for validation failures', () => {
    const cwd = project();
    writeManifest(cwd, 'empty-object.json');
    try {
      context(cwd);
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(MocklensError);
    }
  });
});

describe('check readiness end to end', () => {
  it('enforces missing, current, filtered, and stale proof with schema v3 agreement', async () => {
    const cwd = project();
    writeManifest(cwd);

    const missingUx = await cli(cwd, ['check']);
    expectFixtureResult('01-missing-ux-and-visual.txt', cwd, 'mocklens check', 1, missingUx);
    expect(missingUx.code, missingUx.stderr).toBe(1);
    expect(missingUx.stdout).toContain('MOCKLENS SANITY CHECK — PASS');
    expect(missingUx.stdout).toContain('UX PROOF — FAIL');
    expect(missingUx.stdout).toContain('VISUAL PROOF — FAIL');

    expect((await cli(cwd, ['checkpoint', 'ux', 'clear-primary-action', '--proof', 'Primary action reviewed'])).code).toBe(0);
    expect((await cli(cwd, ['checkpoint', 'ux', 'detail-flow', '--proof', 'Flow reviewed'])).code).toBe(0);
    const missingVisual = await cli(cwd, ['check']);
    expectFixtureResult('02-missing-visual.txt', cwd, 'mocklens check', 1, missingVisual);
    expect(missingVisual.code, missingVisual.stderr).toBe(1);
    expect(missingVisual.stdout).toContain('UX PROOF — PASS');
    expect(missingVisual.stdout).toContain('VISUAL PROOF — FAIL');

    const visual = await cli(cwd, [
      'checkpoint', 'visual', '--screen', 'home', '--screen', 'detail', '--device', 'phone', '--proof', 'Viewport PNGs reviewed',
    ]);
    expect(visual.code, visual.stderr).toBe(0);
    const ready = await cli(cwd, ['check']);
    expectFixtureResult('03-ready.txt', cwd, 'mocklens check', 0, ready);
    expect(ready.code, ready.stderr).toBe(0);
    expect(ready.stdout).toContain('DELIVERY READINESS — PASS');
    expect(ready.stdout).toContain('All required delivery screens and devices have current sanity, UX, and visual proof.');
    let report = JSON.parse(fs.readFileSync(path.join(cwd, '.mocklens', 'report.json'), 'utf8')) as Report;
    expect(report.version).toBe(3);
    expect(report.readiness.ready).toBe(true);
    expect(report.readiness.coverage).toEqual({
      configured: { screens: 2, devices: 1, combinations: 2 },
      evaluated: { screens: 2, devices: 1, combinations: 2 },
    });
    expect(report.readiness.counts.ux).toEqual({ current: 2, missing: 0, stale: 0, total: 2 });
    expect(report.readiness.counts.visual).toEqual({ current: 2, missing: 0, stale: 0, total: 2 });

    copyFixture(cwd, path.join('variants', 'behavior-error.js'), path.join('screens', 'behavior.js'));
    const mechanicalFailure = await cli(cwd, ['check']);
    expectFixtureResult('04-mechanical-failure.txt', cwd, 'mocklens check', 1, mechanicalFailure);
    expect(mechanicalFailure.code, mechanicalFailure.stderr).toBe(1);
    expect(mechanicalFailure.stdout).toContain('MOCKLENS SANITY CHECK — FAIL');
    expect(mechanicalFailure.stdout).toContain('UX PROOF — PASS');
    expect(mechanicalFailure.stdout).toContain('VISUAL PROOF — PASS');
    expect(mechanicalFailure.stdout).toContain('DELIVERY READINESS — FAIL');
    copyFixture(cwd, path.join('project', 'screens', 'behavior.js'), path.join('screens', 'behavior.js'));
    expect((await cli(cwd, ['check'])).code).toBe(0);

    const filtered = await cli(cwd, ['check', '--screen', 'home', '--device', 'phone']);
    expectFixtureResult(
      '05-filtered.txt',
      cwd,
      'mocklens check --screen home --device phone',
      0,
      filtered,
    );
    expect(filtered.code, filtered.stderr).toBe(0);
    expect(filtered.stdout).toContain('UX proof scope: FILTERED');
    expect(filtered.stdout).toContain('Project delivery readiness was not evaluated.');
    expect(filtered.stdout).not.toContain('DELIVERY READINESS — PASS');
    report = JSON.parse(fs.readFileSync(path.join(cwd, '.mocklens', 'report.json'), 'utf8')) as Report;
    expect(report.readiness.ready).toBe(false);
    expect(report.readiness.visual).toHaveLength(1);

    copyFixture(cwd, path.join('variants', 'shared-edited.css'), path.join('screens', 'shared.css'));
    const stale = await cli(cwd, ['check']);
    expectFixtureResult('06-stale.txt', cwd, 'mocklens check', 1, stale);
    expect(stale.code, stale.stderr).toBe(1);
    expect(stale.stdout).toContain('STALE clear-primary-action [screen]');
    expect(stale.stdout).toContain('recorded hash:');
    expect(stale.stdout).toContain('current hash:');
    expect(stale.stdout).toContain('cause: stylesheet screens/shared.css changed');
    report = JSON.parse(fs.readFileSync(path.join(cwd, '.mocklens', 'report.json'), 'utf8')) as Report;
    expect(report.readiness.counts.ux.stale).toBe(2);
    expect(report.readiness.counts.visual.stale).toBe(2);
    const firstReport = fs.readFileSync(path.join(cwd, '.mocklens', 'report.json'), 'utf8');
    expect((await cli(cwd, ['check'])).code).toBe(1);
    expect(fs.readFileSync(path.join(cwd, '.mocklens', 'report.json'), 'utf8')).toBe(firstReport);
  }, 120_000);
});
