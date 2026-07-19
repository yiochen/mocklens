import fs from 'node:fs';
import path from 'node:path';
import { MocklensError, DEFAULT_DEVICES } from './config.js';

export interface InitOptions {
  cwd: string;
  configPath: string | undefined;
  screensDir: string;
  force: boolean;
}

interface ScaffoldFile {
  path: string;
  contents: string;
}

function normalizeScreensDir(raw: string): string {
  if (raw.trim() === '') {
    throw new MocklensError('--dir must be a non-empty relative path');
  }
  if (path.isAbsolute(raw)) {
    throw new MocklensError('--dir must be relative to the config file directory');
  }
  const normalized = path.normalize(raw);
  if (normalized === '.' || normalized.startsWith('..') || path.isAbsolute(normalized)) {
    throw new MocklensError('--dir must stay inside the config file directory');
  }
  return normalized;
}

function configJson(screensDir: string): string {
  return `${JSON.stringify(
    {
      screensDir,
      outDir: '.mocklens',
      fullPage: false,
      devices: DEFAULT_DEVICES,
      allowedExternalHosts: [],
    },
    null,
    2,
  )}\n`;
}

const sharedCss = `* { box-sizing: border-box; }

:root {
  --bg: #f7f3ed;
  --surface: #ffffff;
  --ink: #202124;
  --muted: #6f7278;
  --line: #e5ded4;
  --primary: #256d5a;
  --primary-ink: #ffffff;
  --accent: #d86c38;
  --soft: #e7f0ec;
  --shadow: 0 1px 5px rgba(32, 33, 36, 0.08);
}

html,
body {
  margin: 0;
  padding: 0;
  overflow-x: hidden;
}

body {
  min-height: 100vh;
  background: var(--bg);
  color: var(--ink);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

.screen {
  min-height: 100vh;
  padding: 16px;
}

.stack { display: grid; gap: 14px; }
.muted { color: var(--muted); }

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0 14px;
}

.topbar h1 {
  margin: 0;
  font-size: 22px;
  line-height: 1.12;
}

.icon-button {
  width: 40px;
  height: 40px;
  border: 1px solid var(--line);
  border-radius: 8px;
  display: grid;
  place-items: center;
  background: var(--surface);
  color: var(--ink);
  box-shadow: var(--shadow);
}

.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 14px;
  box-shadow: var(--shadow);
}

.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  border-radius: 8px;
  padding: 0 16px;
  background: var(--primary);
  color: var(--primary-ink);
  font-weight: 700;
  text-decoration: none;
}

.button.secondary {
  background: var(--soft);
  color: var(--primary);
}

.bottom-nav {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  height: 64px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  background: var(--surface);
  border-top: 1px solid var(--line);
}

.bottom-nav span {
  display: grid;
  place-items: center;
  font-size: 12px;
  color: var(--muted);
}

.bottom-nav .active {
  color: var(--primary);
  font-weight: 800;
}

.with-bottom-nav {
  padding-bottom: 92px;
}
`;

const homeHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="mocklens:form-factor" content="phone">
<meta name="mocklens:primary-device" content="iphone-14">
<meta name="mocklens:target-devices" content="iphone-14">
<meta name="mocklens:viewport" content="390x844">
<title>Mocklens Starter - Home</title>
<link rel="stylesheet" href="./shared.css">
<style>
  .hero {
    background: linear-gradient(135deg, #256d5a, #1c5147);
    color: #fff;
    border-radius: 8px;
    padding: 18px;
  }
  .hero p { margin: 8px 0 0; color: rgba(255,255,255,0.78); }
  .metric-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .metric strong { display: block; font-size: 24px; margin-bottom: 4px; }
  .item { display: flex; align-items: center; gap: 12px; }
  .swatch { width: 44px; height: 44px; border-radius: 8px; flex: none; }
  .s1 { background: #f4b860; }
  .s2 { background: #86b6f6; }
  .s3 { background: #d98ba6; }
  .item h2 { margin: 0 0 3px; font-size: 15px; }
  .item p { margin: 0; font-size: 13px; }
</style>
</head>
<body>
<main class="screen with-bottom-nav stack">
  <header class="topbar">
    <h1>Launch Board</h1>
    <div class="icon-button" aria-label="Notifications">!</div>
  </header>

  <section class="hero">
    <strong>Today</strong>
    <p>Review the key states before handing this UI to an app builder.</p>
  </section>

  <section class="metric-row">
    <div class="card metric"><strong>12</strong><span class="muted">Open tasks</span></div>
    <div class="card metric"><strong>3</strong><span class="muted">Ready screens</span></div>
  </section>

  <section class="stack">
    <article class="card item">
      <div class="swatch s1"></div>
      <div><h2>Morning review</h2><p class="muted">Check spacing, empty states, and text fit.</p></div>
    </article>
    <article class="card item">
      <div class="swatch s2"></div>
      <div><h2>Detail handoff</h2><p class="muted">Keep each visual state in its own HTML file.</p></div>
    </article>
    <article class="card item">
      <div class="swatch s3"></div>
      <div><h2>Validation pass</h2><p class="muted">Run mocklens check after edits.</p></div>
    </article>
  </section>
</main>

<nav class="bottom-nav">
  <span class="active">Home</span><span>Details</span><span>Empty</span>
</nav>
</body>
</html>
`;

const detailHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="mocklens:form-factor" content="phone">
<meta name="mocklens:primary-device" content="iphone-14">
<meta name="mocklens:target-devices" content="iphone-14">
<meta name="mocklens:viewport" content="390x844">
<title>Mocklens Starter - Detail</title>
<link rel="stylesheet" href="./shared.css">
<style>
  .summary { display: grid; gap: 8px; }
  .summary h2 { margin: 0; font-size: 20px; }
  .summary p { margin: 0; line-height: 1.45; }
  .steps { display: grid; gap: 10px; }
  .step { display: grid; grid-template-columns: 28px 1fr; gap: 10px; align-items: start; }
  .num {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--soft);
    color: var(--primary);
    display: grid;
    place-items: center;
    font-weight: 800;
  }
  .step h3 { margin: 2px 0 3px; font-size: 15px; }
  .step p { margin: 0; font-size: 13px; line-height: 1.35; }
  .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
</style>
</head>
<body>
<main class="screen stack">
  <header class="topbar">
    <h1>Project Detail</h1>
    <div class="icon-button" aria-label="More options">...</div>
  </header>

  <section class="card summary">
    <h2>Static mock workflow</h2>
    <p class="muted">Use this screen for dense content, detail pages, and common action clusters.</p>
  </section>

  <section class="card steps">
    <div class="step">
      <div class="num">1</div>
      <div><h3>Duplicate a screen</h3><p class="muted">Create one file per visual state instead of adding app routing.</p></div>
    </div>
    <div class="step">
      <div class="num">2</div>
      <div><h3>Keep assets local</h3><p class="muted">Bundle images next to the screen so checks work offline.</p></div>
    </div>
    <div class="step">
      <div class="num">3</div>
      <div><h3>Validate frequently</h3><p class="muted">Fix overflow, broken images, and runtime errors before handoff.</p></div>
    </div>
  </section>

  <section class="actions">
    <a class="button" href="./home.iphone-14.html">Preview home</a>
    <a class="button secondary" href="./empty-state.iphone-14.html">Empty state</a>
  </section>
</main>
</body>
</html>
`;

const emptyStateHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="mocklens:form-factor" content="phone">
<meta name="mocklens:primary-device" content="iphone-14">
<meta name="mocklens:target-devices" content="iphone-14">
<meta name="mocklens:viewport" content="390x844">
<title>Mocklens Starter - Empty State</title>
<link rel="stylesheet" href="./shared.css">
<style>
  .empty {
    min-height: calc(100vh - 32px);
    display: grid;
    place-items: center;
    text-align: center;
  }
  .panel { display: grid; gap: 14px; justify-items: center; }
  .mark {
    width: 82px;
    height: 82px;
    border-radius: 24px;
    background: #e7f0ec;
    color: var(--primary);
    display: grid;
    place-items: center;
    font-size: 34px;
    font-weight: 900;
  }
  h1 { margin: 0; font-size: 22px; line-height: 1.15; }
  p { margin: 0; line-height: 1.45; }
</style>
</head>
<body>
<main class="screen empty">
  <section class="panel">
    <div class="mark">+</div>
    <h1>No mock screens yet</h1>
    <p class="muted">Add independent HTML files for loading, error, empty, and success states.</p>
    <a class="button" href="./home.iphone-14.html">Start from home</a>
  </section>
</main>
</body>
</html>
`;

const guidanceMd = `# Mocklens Screens

This folder contains static mobile UI mockups. Each HTML file is an independent screen or state.

- Keep screens plain HTML/CSS with local assets only.
- Link \`./shared.css\` for shared tokens and base components.
- Name variants \`<screen>.<device>.html\`; use \`mocklens new-screen <name> --device <device>\` instead of copying boilerplate.
- Keep the generated \`mocklens:*\` metadata in the document head accurate. Device names must exist in \`mocklens.config.json\`.
- Use \`--template blank|list|detail|empty|error|dialog-open\` to start from a common static state.
- Run \`mocklens list\` to confirm discovery and \`mocklens check\` before handoff.
- If overflow is intentional, add \`data-mocklens-ignore="short reason"\` to the element.
`;

function scaffoldFiles(configFile: string, screensDir: string): ScaffoldFile[] {
  const screenRoot = path.join(path.dirname(configFile), screensDir);
  return [
    { path: configFile, contents: configJson(screensDir) },
    { path: path.join(screenRoot, 'shared.css'), contents: sharedCss },
    { path: path.join(screenRoot, 'home.iphone-14.html'), contents: homeHtml },
    { path: path.join(screenRoot, 'detail.iphone-14.html'), contents: detailHtml },
    { path: path.join(screenRoot, 'empty-state.iphone-14.html'), contents: emptyStateHtml },
    { path: path.join(screenRoot, 'README.md'), contents: guidanceMd },
  ];
}

export function runInit(options: InitOptions): string {
  const configFile =
    options.configPath !== undefined
      ? path.resolve(options.cwd, options.configPath)
      : path.join(options.cwd, 'mocklens.config.json');
  const screensDir = normalizeScreensDir(options.screensDir);
  const files = scaffoldFiles(configFile, screensDir);
  const conflicts = files.filter((f) => fs.existsSync(f.path)).map((f) => path.relative(options.cwd, f.path));

  if (conflicts.length > 0 && !options.force) {
    throw new MocklensError(
      `init would overwrite existing file(s): ${conflicts.join(', ')}. Re-run with --force to replace them.`,
    );
  }

  for (const file of files) {
    fs.mkdirSync(path.dirname(file.path), { recursive: true });
    fs.writeFileSync(file.path, file.contents, 'utf8');
  }

  const relConfig = path.relative(options.cwd, configFile) || path.basename(configFile);
  const relScreens = path.relative(options.cwd, path.join(path.dirname(configFile), screensDir)) || '.';
  const created = files.map((f) => `  - ${path.relative(options.cwd, f.path)}`).join('\n');
  return `mocklens init ${options.force ? 'updated' : 'created'} a starter workspace

Files:
${created}

Next steps:
  1. Edit the device-aware starter screens in ${relScreens} for your product.
  2. Customize ${relConfig} if you want different devices, output, or screen folders.
  3. Run mocklens list to confirm discovery.
  4. Run mocklens check to capture screenshots and validate layout.
`;
}
