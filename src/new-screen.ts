import fs from 'node:fs';
import path from 'node:path';
import { MocklensError } from './config.js';
import type { Config, Device } from './types.js';

export interface NewScreenOptions {
  cwd: string;
  config: Config;
  names: string[];
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
  const names = options.names.map(normalizedName);
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  if (duplicates.length > 0) {
    throw new MocklensError(`duplicate screen name(s): ${[...new Set(duplicates)].join(', ')}`);
  }
  const formFactor = safeMetadataValue(options.formFactor, '--form-factor');
  const device = options.config.devices.find((candidate) => candidate.name === options.deviceName);
  if (device === undefined) {
    throw new MocklensError(
      `unknown device: ${options.deviceName} — configured devices: ${options.config.devices.map((d) => d.name).join(', ')}`,
    );
  }
  safeMetadataValue(device.name, 'configured device name');
  const sharedCss = path.join(options.config.screensDir, 'shared.css');
  if (!fs.existsSync(sharedCss)) {
    throw new MocklensError(
      `shared stylesheet not found: ${path.relative(options.cwd, sharedCss)} — run mocklens init or create shared.css first`,
    );
  }
  const planned = names.map((name) => {
    const relativeFile = `${name}.${device.name}.html`;
    const file = path.resolve(options.config.screensDir, ...relativeFile.split('/'));
    let cssHref = path.relative(path.dirname(file), sharedCss).split(path.sep).join('/');
    if (!cssHref.startsWith('.')) cssHref = `./${cssHref}`;
    return { name, relativeFile, file, cssHref };
  });
  const conflicts = planned.filter((item) => fs.existsSync(item.file));
  if (conflicts.length > 0) {
    throw new MocklensError(
      `screen file(s) already exist: ${conflicts.map((item) => path.relative(options.cwd, item.file)).join(', ')} — no files created`,
    );
  }

  for (const item of planned) {
    fs.mkdirSync(path.dirname(item.file), { recursive: true });
    fs.writeFileSync(item.file, screenHtml(item.name, device, formFactor, item.cssHref), {
      encoding: 'utf8',
      flag: 'wx',
    });
  }

  const created = planned.map((item) => `  - ${path.relative(options.cwd, item.file)}`).join('\n');
  const filters = planned.map((item) => `--screen ${item.relativeFile.slice(0, -'.html'.length)}`).join(' ');
  return `MOCKLENS CREATED ${planned.length} SCREEN${planned.length === 1 ? '' : 'S'}

Files:
${created}

Primary target: ${device.name} (${device.width}×${device.height}, ${formFactor})
Next: mocklens check ${filters} --device ${device.name}`;
}
