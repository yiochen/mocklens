import fs from 'node:fs';
import path from 'node:path';
import { MocklensError } from './config.js';

export interface Screen {
  /** Path relative to screensDir without ".html", posix separators (e.g. "states/empty"). */
  name: string;
  /** Absolute path to the .html file. */
  file: string;
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
        out.push({ name, file: full });
      }
    }
  };
  walk(screensDir);
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
