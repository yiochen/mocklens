import fs from 'node:fs';
import path from 'node:path';
import { MocklensError } from './config.js';

export interface Screen {
  /** Path relative to screensDir without ".html", posix separators (e.g. "states/empty"). */
  name: string;
  /** Absolute path to the .html file. */
  file: string;
  metadata: ScreenMetadata;
}

export interface ScreenMetadata {
  formFactor?: string;
  primaryDevice?: string;
  targetDevices: string[];
  viewport?: string;
}

function metadataFromHtml(file: string): ScreenMetadata {
  const html = fs.readFileSync(file, 'utf8');
  const values = new Map<string, string>();
  for (const match of html.matchAll(/<meta\s+([^>]+)>/gi)) {
    const attrs = new Map<string, string>();
    for (const attr of match[1]!.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)) {
      attrs.set(attr[1]!.toLowerCase(), attr[2]!);
    }
    const name = attrs.get('name')?.toLowerCase();
    const content = attrs.get('content');
    if (name?.startsWith('mocklens:') && content !== undefined) values.set(name, content);
  }
  return {
    formFactor: values.get('mocklens:form-factor'),
    primaryDevice: values.get('mocklens:primary-device'),
    targetDevices: (values.get('mocklens:target-devices') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    viewport: values.get('mocklens:viewport'),
  };
}

export function validateScreenDevices(screens: Screen[], configuredDeviceNames: string[]): void {
  const configured = new Set(configuredDeviceNames);
  for (const screen of screens) {
    const declared = new Set([
      ...(screen.metadata.primaryDevice === undefined ? [] : [screen.metadata.primaryDevice]),
      ...screen.metadata.targetDevices,
    ]);
    const unknown = [...declared].filter((name) => !configured.has(name));
    if (unknown.length > 0) {
      throw new MocklensError(
        `screen ${screen.name} references unknown device(s): ${unknown.join(', ')} — add them to mocklens.config.json or update the screen's mocklens metadata`,
      );
    }
  }
}

/**
 * Discover **\/*.html under screensDir. Files and directories whose name
 * starts with "_" or "." are skipped. Names are sorted alphabetically.
 */
export function discoverScreens(screensDir: string): Screen[] {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(screensDir);
  } catch {
    throw new MocklensError(
      `screens directory not found: ${screensDir} — create it or set "screensDir" in mocklens.config.json`,
    );
  }
  if (!stat.isDirectory()) {
    throw new MocklensError(`screens path is not a directory: ${screensDir}`);
  }

  const out: Screen[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.html')) {
        const rel = path.relative(screensDir, full);
        const name = rel.slice(0, -'.html'.length).split(path.sep).join('/');
        out.push({ name, file: full, metadata: metadataFromHtml(full) });
      }
    }
  };
  walk(screensDir);
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
