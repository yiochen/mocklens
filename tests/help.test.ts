import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'dist', 'cli.js');

function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mocklens-help-'));
  try {
    const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

describe('command-specific help', () => {
  it('keeps the top-level help concise and points to drill-down help', () => {
    const result = run(['--help']);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Usage: mocklens <command> [options]');
    expect(result.stdout).toContain('mocklens <command> --help');
    expect(result.stdout).toContain('Run "mocklens <command> --help"');
    expect(result.stdout).toContain('checkpoint ux');
    expect(result.stdout).toContain('checkpoint visual');
    expect(result.stdout).toContain('--config <path>');
    expect(result.stdout).not.toContain('--form-factor');
    expect(result.stdout).not.toContain('--proof <text>');
    expect(result.stdout).not.toContain('--port <');
  });

  it.each([
    {
      args: ['init', '--help'],
      usage: 'mocklens init [--config <path>] [--dir <path>] [--force]',
      includes: ['--dir <path>', '--force'],
      excludes: ['--screen <name>', '--port <number>'],
    },
    {
      args: ['new-screen', '--help'],
      usage: 'mocklens new-screen <name>... --device <name> [options]',
      includes: ['--device <name>', '--form-factor <name>'],
      excludes: ['--proof <text>', '--port <number>'],
    },
    {
      args: ['list', '--help'],
      usage: 'mocklens list [--config <path>]',
      includes: ['--config <path>'],
      excludes: ['--device <name>', '--full-page'],
    },
    {
      args: ['screenshot', '--help'],
      usage: 'mocklens screenshot [options]',
      includes: ['--screen <name>', '--device <name>', '--full-page'],
      excludes: ['--proof <text>', '--port <number>'],
    },
    {
      args: ['validate', '--help'],
      usage: 'mocklens validate [options]',
      includes: ['--screen <name>', '--device <name>'],
      excludes: ['--full-page', '--proof <text>'],
    },
    {
      args: ['check', '--help'],
      usage: 'mocklens check [options]',
      includes: ['--screen <name>', '--device <name>', '--full-page'],
      excludes: ['--proof <text>', '--port <number>'],
    },
    {
      args: ['serve', '--help'],
      usage: 'mocklens serve [--config <path>] [--port <number>]',
      includes: [
        '--port <number>',
        'mocklens serve --config example/mocklens.config.json',
        'mocklens.notes.json',
      ],
      excludes: ['--screen <name>', '--proof <text>', '--full-page'],
    },
  ])('$args returns only its own options', ({ args, usage, includes, excludes }) => {
    const result = run(args);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(usage);
    for (const value of includes) expect(result.stdout).toContain(value);
    for (const value of excludes) expect(result.stdout).not.toContain(value);
  });

  it('drills into checkpoint and both checkpoint subcommands', () => {
    const checkpoint = run(['checkpoint', '--help']);
    expect(checkpoint.status).toBe(0);
    expect(checkpoint.stdout).toContain('mocklens checkpoint <ux|visual>');
    expect(checkpoint.stdout).toContain('mocklens checkpoint ux --help');
    expect(checkpoint.stdout).not.toContain('--proof <text>');

    const ux = run(['checkpoint', 'ux', '--help']);
    expect(ux.status).toBe(0);
    expect(ux.stdout).toContain('mocklens checkpoint ux <requirement-id> --proof <text>');
    expect(ux.stdout).toContain('--proof <text>');
    expect(ux.stdout).not.toContain('--screen <name>');
    expect(ux.stdout).not.toContain('--device <name>');

    const visual = run(['checkpoint', 'visual', '--help']);
    expect(visual.status).toBe(0);
    expect(visual.stdout).toContain('mocklens checkpoint visual --screen <name>...');
    expect(visual.stdout).toContain('--screen <name>');
    expect(visual.stdout).toContain('--device <name>');
    expect(visual.stdout).toContain('--proof <text>');
  });

  it('rejects help for unknown commands and checkpoint subcommands', () => {
    const command = run(['frobnicate', '--help']);
    expect(command.status).toBe(2);
    expect(command.stderr).toContain('unknown command: frobnicate');

    const checkpoint = run(['checkpoint', 'frobnicate', '--help']);
    expect(checkpoint.status).toBe(2);
    expect(checkpoint.stderr).toContain('unknown checkpoint subcommand: frobnicate');
  });
});
