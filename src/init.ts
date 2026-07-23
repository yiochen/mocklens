import fs from 'node:fs';
import path from 'node:path';
import { MocklensError, DEFAULT_DEVICES, loadConfig } from './config.js';
import type { Config } from './types.js';

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

function effectiveConfigJson(configFile: string, config: Config): string {
  const baseDir = path.dirname(configFile);
  const relative = (value: string): string => path.relative(baseDir, value).split(path.sep).join('/') || '.';
  return `${JSON.stringify(
    {
      screensDir: relative(config.screensDir),
      outDir: relative(config.outDir),
      fullPage: config.fullPage,
      devices: config.devices,
      allowedExternalHosts: config.allowedExternalHosts,
    },
    null,
    2,
  )}\n`;
}

function resolvedWorkspace(cwd: string, config: Config): string {
  const rel = (value: string): string => path.relative(cwd, value) || '.';
  return `Resolved workspace:
  config: ${rel(config.configFile)}
  screensDir: ${rel(config.screensDir)}
  outDir: ${rel(config.outDir)}`;
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

const guidanceMd = `# Mocklens Screens

This folder contains static mobile UI mockups. Each HTML file is an independent screen or state.

- Start with Intent → Model → Cover, then create \`mocklens.ux.json\` before generating screens.
- Run \`mocklens --help\` and confirm both checkpoint commands exist before relying on readiness gates.
- Cover task entry, edit/correction/recovery paths, and empty, typical, dense, long, missing, nested, loading, error, destructive, and success states; require each relevant state or record why it is not applicable.
- Establish shared tokens, components, navigation, and density on one representative reference screen before composing other screen families.
- Put primary task data and the primary action before greetings, hero art, promotional copy, and decorative summaries.
- Design the hardest credible content state before polishing the typical state.
- Keep screens plain HTML/CSS with local assets only.
- Link \`shared.css\` with the correct relative path (\`./shared.css\` at the root; \`../shared.css\` one level down).
- Name variants \`<screen>.<device>.html\`; use \`mocklens new-screen <name> --device <device>\` instead of copying boilerplate.
- Use exact names from \`mocklens list\` in the UX manifest; generated names include the device suffix.
- Keep the generated \`mocklens:*\` metadata in the document head accurate. Device names must exist in \`mocklens.config.json\`.
- Add a natural-language \`data-mocklens-action\` attribute when an actionable element's trigger or result is not obvious in a static render. Describe the behavior and any accessible non-gesture path; no formal grammar is required.
- Use \`mocklens serve\` to review and annotate rendered elements. Project-wide feedback is saved in \`mocklens.notes.json\`; check notes before editing and resolve them only after the affected screens are verified.
- Review each UX requirement across its referenced screens, then record specific \`mocklens checkpoint ux\` evidence that cites relevant action annotations and outcome screens.
- Inspect every delivery screenshot together, then record \`mocklens checkpoint visual\` evidence.
- Deliver only when a full unfiltered \`mocklens check\` prints \`DELIVERY READINESS — PASS\`.
- If overflow is intentional, add \`data-mocklens-ignore="short reason"\` to the element.
`;

function scaffoldFiles(configFile: string, screensDir: string): ScaffoldFile[] {
  const screenRoot = path.join(path.dirname(configFile), screensDir);
  return [
    { path: configFile, contents: configJson(screensDir) },
    { path: path.join(screenRoot, 'shared.css'), contents: sharedCss },
    { path: path.join(screenRoot, 'README.md'), contents: guidanceMd },
  ];
}

export function runInit(options: InitOptions): string {
  const configFile =
    options.configPath !== undefined
      ? path.resolve(options.cwd, options.configPath)
      : path.join(options.cwd, 'mocklens.config.json');
  if (fs.existsSync(configFile) && !options.force) {
    const config = loadConfig(path.relative(options.cwd, configFile), options.cwd);
    const relConfig = path.relative(options.cwd, configFile) || path.basename(configFile);
    return `MOCKLENS ALREADY INITIALIZED

Config: ${relConfig}
${effectiveConfigJson(configFile, config)}
${resolvedWorkspace(options.cwd, config)}

No files changed.

Workspace: 0 screen files are required; create screens with mocklens new-screen <name>... --device <device>.`;
  }

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
  const config = loadConfig(path.relative(options.cwd, configFile), options.cwd);
  return `MOCKLENS INITIALIZED

${options.force ? 'Replaced' : 'Created'} init-owned files:
${created}

Config: ${relConfig}
${effectiveConfigJson(configFile, config)}
${resolvedWorkspace(options.cwd, config)}

Workspace: ${relScreens} contains shared.css and README.md; no HTML screens were created.

Next: mocklens new-screen <name>... --device iphone-14
`;
}
