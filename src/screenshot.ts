import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import type { Browser } from 'playwright';
import type { Config, Device } from './types.js';
import { round1 } from './types.js';
import type { Screen } from './screens.js';
import { openScreenPage } from './browser.js';
import { buildVisualInputs } from './checkpoint.js';

export interface ManifestEntry {
  screen: string;
  device: string;
  viewport: { width: number; height: number };
  fullPage: boolean;
  /** Path relative to the screenshots dir, posix separators. */
  path: string;
}

interface ScreenshotStateEntry {
  screen: string;
  device: string;
  path: string;
  inputHash: string;
  screenshotSha256: string;
}

/**
 * Render every screen × device to <outDir>/screenshots/<device>/<screen>.png
 * (plus <screen>.full.png when fullPage is on) and write a manifest.json.
 */
export async function runScreenshots(
  browser: Browser,
  config: Config,
  screens: Screen[],
  devices: Device[],
  fullPage: boolean,
): Promise<ManifestEntry[]> {
  const shotsDir = path.join(config.outDir, 'screenshots');
  fs.mkdirSync(shotsDir, { recursive: true });
  const manifest: ManifestEntry[] = [];
  const state: Record<string, ScreenshotStateEntry> = {};
  const cwd = process.cwd();

  for (const screen of screens) {
    for (const device of devices) {
      const inputHash = buildVisualInputs(config, screen, device).hash;
      const { page, context } = await openScreenPage(browser, screen.file, device, 2);
      try {
        const rel = `${device.name}/${screen.name}.png`;
        const file = path.join(shotsDir, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        await page.screenshot({ path: file });
        console.log(`wrote ${path.relative(cwd, file)}`);
        manifest.push({
          screen: screen.name,
          device: device.name,
          viewport: { width: round1(device.width), height: round1(device.height) },
          fullPage: false,
          path: rel,
        });
        state[`${screen.name}@${device.name}`] = {
          screen: screen.name,
          device: device.name,
          path: rel,
          inputHash,
          screenshotSha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
        };
        if (fullPage) {
          const fullRel = `${device.name}/${screen.name}.full.png`;
          const fullFile = path.join(shotsDir, fullRel);
          await page.screenshot({ path: fullFile, fullPage: true });
          console.log(`wrote ${path.relative(cwd, fullFile)}`);
          manifest.push({
            screen: screen.name,
            device: device.name,
            viewport: { width: round1(device.width), height: round1(device.height) },
            fullPage: true,
            path: fullRel,
          });
        }
      } finally {
        await context.close();
      }
    }
  }

  const manifestFile = path.join(shotsDir, 'manifest.json');
  fs.writeFileSync(manifestFile, JSON.stringify({ version: 1, screenshots: manifest }, null, 2) + '\n');
  fs.writeFileSync(path.join(shotsDir, 'state.json'), JSON.stringify({ version: 1, screenshots: state }, null, 2) + '\n');
  console.log(`wrote ${path.relative(cwd, manifestFile)}`);
  return manifest;
}
