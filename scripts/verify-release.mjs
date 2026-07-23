#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

function fail(message) {
  console.error(`Release verification failed: ${message}`);
  process.exit(1);
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    fail(`${name} requires a value`);
  }
  return value;
}

const root = process.cwd();
const packagePath = path.join(root, 'package.json');
const changelogPath = path.join(root, 'CHANGELOG.md');

if (!fs.existsSync(packagePath)) fail('package.json is missing');
if (!fs.existsSync(changelogPath)) fail('CHANGELOG.md is missing');

const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const version = packageJson.version;
const versionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

if (typeof version !== 'string' || !versionPattern.test(version)) {
  fail(`package.json version "${String(version)}" is not valid semantic versioning`);
}

const tag = readOption('--tag') ?? process.env.GITHUB_REF_NAME;
if (!tag) fail('provide --tag or GITHUB_REF_NAME');

const expectedTag = `v${version}`;
if (tag !== expectedTag) {
  fail(`release tag "${tag}" must exactly match package version "${expectedTag}"`);
}

const prereleaseValue =
  readOption('--prerelease') ?? process.env.RELEASE_PRERELEASE;
if (prereleaseValue !== 'true' && prereleaseValue !== 'false') {
  fail('provide --prerelease true|false or RELEASE_PRERELEASE');
}

const versionWithoutBuildMetadata = version.split('+', 1)[0];
const versionIsPrerelease = versionWithoutBuildMetadata.includes('-');
const releaseIsPrerelease = prereleaseValue === 'true';
if (versionIsPrerelease !== releaseIsPrerelease) {
  fail(
    versionIsPrerelease
      ? `version "${version}" requires a GitHub prerelease`
      : `stable version "${version}" requires a non-prerelease GitHub release`,
  );
}

const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const changelog = fs.readFileSync(changelogPath, 'utf8');
const changelogHeading = new RegExp(
  `^## \\[${escapedVersion}\\] - \\d{4}-\\d{2}-\\d{2}$`,
  'm',
);
if (!changelogHeading.test(changelog)) {
  fail(
    `CHANGELOG.md needs a dated "## [${version}] - YYYY-MM-DD" heading`,
  );
}

console.log(
  `Release metadata verified: ${tag} (${releaseIsPrerelease ? 'prerelease' : 'stable'})`,
);
