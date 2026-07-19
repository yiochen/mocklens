import fs from 'node:fs';
import path from 'node:path';
import { MocklensError } from './config.js';
import type { Config, Device } from './types.js';

export const SCREEN_TEMPLATES = ['blank', 'list', 'detail', 'empty', 'error', 'dialog-open'] as const;
export type ScreenTemplate = (typeof SCREEN_TEMPLATES)[number];

export interface NewScreenOptions {
  cwd: string;
  config: Config;
  name: string;
  deviceName: string;
  formFactor: string;
  template: string;
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

function bodyFor(template: ScreenTemplate, title: string): string {
  switch (template) {
    case 'blank':
      return `<main class="screen stack">\n  <header class="topbar"><h1>${title}</h1></header>\n  <section class="card"><p class="muted">Start designing this screen.</p></section>\n</main>`;
    case 'list':
      return `<main class="screen stack">\n  <header class="topbar"><h1>${title}</h1><button class="icon-button" aria-label="Add item">+</button></header>\n  <section class="stack">\n    <article class="card"><strong>First item</strong><p class="muted">Supporting information</p></article>\n    <article class="card"><strong>Second item</strong><p class="muted">Supporting information</p></article>\n    <article class="card"><strong>Third item</strong><p class="muted">Supporting information</p></article>\n  </section>\n</main>`;
    case 'detail':
      return `<main class="screen stack">\n  <header class="topbar"><h1>${title}</h1></header>\n  <section class="card stack"><h2>Item details</h2><p class="muted">Describe the selected item and its important attributes.</p></section>\n  <a class="button" href="#">Primary action</a>\n</main>`;
    case 'empty':
      return `<main class="screen centered">\n  <section class="stack centered-content"><div class="state-mark">+</div><h1>${title}</h1><p class="muted">Nothing is here yet.</p><a class="button" href="#">Create one</a></section>\n</main>`;
    case 'error':
      return `<main class="screen centered">\n  <section class="stack centered-content"><div class="state-mark error">!</div><h1>Something went wrong</h1><p class="muted">Check your connection and try again.</p><a class="button" href="#">Try again</a></section>\n</main>`;
    case 'dialog-open':
      return `<main class="screen stack" aria-hidden="true">\n  <header class="topbar"><h1>${title}</h1></header><section class="card"><p class="muted">Background content</p></section>\n</main>\n<div class="scrim"></div>\n<section class="dialog card" role="dialog" aria-modal="true" aria-labelledby="dialog-title">\n  <h2 id="dialog-title">Confirm action</h2><p class="muted">This is a static open-dialog state.</p><div class="dialog-actions"><a href="#" class="button secondary">Cancel</a><a href="#" class="button">Confirm</a></div>\n</section>`;
  }
}

function screenHtml(name: string, device: Device, formFactor: string, template: ScreenTemplate, cssHref: string): string {
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
  .centered { min-height: 100vh; display: grid; place-items: center; text-align: center; }
  .centered-content { justify-items: center; max-width: 300px; }
  .state-mark { width: 72px; height: 72px; border-radius: 22px; display: grid; place-items: center; background: var(--soft); color: var(--primary); font-size: 30px; font-weight: 800; }
  .state-mark.error { background: #fbe9e5; color: #a33b28; }
  .scrim { position: fixed; inset: 0; background: rgba(20, 24, 28, 0.5); }
  .dialog { position: fixed; left: 20px; right: 20px; top: 50%; transform: translateY(-50%); display: grid; gap: 14px; }
  .dialog-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
</style>
</head>
<body>
${bodyFor(template, title)}
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
  if (!SCREEN_TEMPLATES.includes(options.template as ScreenTemplate)) {
    throw new MocklensError(
      `unknown template: ${options.template} — available: ${SCREEN_TEMPLATES.join(', ')}`,
    );
  }

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
    screenHtml(name, device, formFactor, options.template as ScreenTemplate, cssHref),
    { encoding: 'utf8', flag: 'wx' },
  );

  const relative = path.relative(options.cwd, file);
  const screenName = relativeFile.slice(0, -'.html'.length);
  return `created ${relative}\n\nNext steps:\n  1. Edit ${relative}.\n  2. Run mocklens check --screen ${screenName} --device ${device.name}.`;
}
