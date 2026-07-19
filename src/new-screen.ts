import fs from 'node:fs';
import path from 'node:path';
import { MocklensError } from './config.js';
import type { Config, Device } from './types.js';

export interface NewScreenOptions {
  cwd: string;
  config: Config;
  name: string;
  deviceName: string;
  formFactor: string;
}

const SAFE_SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function normalizedName(raw: string): string {
  const normalized = raw.trim().replaceAll('\\', '/');
  const parts = normalized.split('/');
  if (parts.length === 0 || parts.some((part) => !SAFE_SEGMENT.test(part))) {
    throw new MocklensError(
      'screen name must use lowercase kebab-case path segments (for example settings or account/empty-state)',
    );
  }
  return parts.join('/');
}

function safeMetadataValue(raw: string, flag: string): string {
  if (!SAFE_SEGMENT.test(raw)) {
    throw new MocklensError(`${flag} must use lowercase kebab-case`);
  }
  return raw;
}

function titleFor(name: string): string {
  return name
    .split('/')
    .at(-1)!
    .split('-')
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(' ');
}

function screenHtml(name: string, device: Device, formFactor: string, cssHref: string): string {
  const title = titleFor(name);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="mocklens:form-factor" content="${formFactor}">
<meta name="mocklens:primary-device" content="${device.name}">
<meta name="mocklens:target-devices" content="${device.name}">
<meta name="mocklens:viewport" content="${device.width}x${device.height}">
<title>${title}</title>
<link rel="stylesheet" href="${cssHref}">
<style>
  h1, h2, p { margin: 0; }
</style>
</head>
<body>
<main class="screen stack">
  <header class="topbar"><h1>${title}</h1></header>
  <section class="card"><p class="muted">Start designing this screen.</p></section>
</main>
</body>
</html>
`;
}

export function runNewScreen(options: NewScreenOptions): string {
  const name = normalizedName(options.name);
  const formFactor = safeMetadataValue(options.formFactor, '--form-factor');
  const device = options.config.devices.find((candidate) => candidate.name === options.deviceName);
  if (device === undefined) {
    throw new MocklensError(
      `unknown device: ${options.deviceName} — configured devices: ${options.config.devices.map((d) => d.name).join(', ')}`,
    );
  }
  safeMetadataValue(device.name, 'configured device name');
  const relativeFile = `${name}.${device.name}.html`;
  const file = path.resolve(options.config.screensDir, ...relativeFile.split('/'));
  if (fs.existsSync(file)) {
    throw new MocklensError(`screen already exists: ${path.relative(options.cwd, file)} — choose another name or device`);
  }

  const sharedCss = path.join(options.config.screensDir, 'shared.css');
  if (!fs.existsSync(sharedCss)) {
    throw new MocklensError(
      `shared stylesheet not found: ${path.relative(options.cwd, sharedCss)} — run mocklens init or create shared.css first`,
    );
  }
  let cssHref = path.relative(path.dirname(file), sharedCss).split(path.sep).join('/');
  if (!cssHref.startsWith('.')) cssHref = `./${cssHref}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    screenHtml(name, device, formFactor, cssHref),
    { encoding: 'utf8', flag: 'wx' },
  );

  const relative = path.relative(options.cwd, file);
  const screenName = relativeFile.slice(0, -'.html'.length);
  return `created ${relative}\n\nNext steps:\n  1. Edit ${relative}.\n  2. Run mocklens check --screen ${screenName} --device ${device.name}.`;
}
