import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERIFY_RELEASE = path.join(ROOT, 'scripts', 'verify-release.mjs');

function fixture(version: string, changelogVersion = version): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mocklens-release-'));
  fs.writeFileSync(
    path.join(directory, 'package.json'),
    `${JSON.stringify({ version }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(directory, 'CHANGELOG.md'),
    `# Changelog\n\n## [${changelogVersion}] - 2026-07-22\n`,
  );
  return directory;
}

function verify(
  directory: string,
  tag: string,
  prerelease: boolean,
): string {
  return execFileSync(
    process.execPath,
    [
      VERIFY_RELEASE,
      '--tag',
      tag,
      '--prerelease',
      String(prerelease),
    ],
    {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

describe('release metadata verification', () => {
  it('accepts matching stable and prerelease metadata', () => {
    const stable = fixture('1.2.3');
    const stableBuild = fixture('1.2.3+build.5');
    const prerelease = fixture('2.0.0-beta.1');
    try {
      expect(verify(stable, 'v1.2.3', false)).toContain(
        'Release metadata verified',
      );
      expect(verify(stableBuild, 'v1.2.3+build.5', false)).toContain(
        'Release metadata verified',
      );
      expect(verify(prerelease, 'v2.0.0-beta.1', true)).toContain(
        'Release metadata verified',
      );
    } finally {
      fs.rmSync(stable, { recursive: true, force: true });
      fs.rmSync(stableBuild, { recursive: true, force: true });
      fs.rmSync(prerelease, { recursive: true, force: true });
    }
  });

  it('rejects a tag that does not match package.json', () => {
    const directory = fixture('1.2.3');
    try {
      expect(() => verify(directory, 'v1.2.4', false)).toThrow(
        /must exactly match package version/,
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects release type and changelog mismatches', () => {
    const prerelease = fixture('2.0.0-beta.1');
    const missingChangelog = fixture('1.2.3', '1.2.2');
    try {
      expect(() => verify(prerelease, 'v2.0.0-beta.1', false)).toThrow(
        /requires a GitHub prerelease/,
      );
      expect(() => verify(missingChangelog, 'v1.2.3', false)).toThrow(
        /CHANGELOG\.md needs a dated/,
      );
    } finally {
      fs.rmSync(prerelease, { recursive: true, force: true });
      fs.rmSync(missingChangelog, { recursive: true, force: true });
    }
  });
});
