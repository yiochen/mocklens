import fs from 'node:fs';
import path from 'node:path';
import type { Config, Device } from './types.js';

/** Expected, user-facing failure — the CLI prints the message and exits 2. */
export class MocklensError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MocklensError';
  }
}

export const DEFAULT_DEVICES: Device[] = [
  { name: 'iphone-se', width: 375, height: 667 },
  { name: 'iphone-14', width: 390, height: 844 },
  { name: 'pixel-7', width: 412, height: 915 },
];

/**
 * Load mocklens.config.json (or --config path). Missing file = all defaults.
 * Relative screensDir/outDir resolve against the config file's directory
 * (or cwd when there is no config file). Malformed config → MocklensError.
 */
export function loadConfig(configPath: string | undefined, cwd: string): Config {
  let baseDir = cwd;
  let raw: unknown = {};
  const file =
    configPath !== undefined ? path.resolve(cwd, configPath) : path.join(cwd, 'mocklens.config.json');

  if (fs.existsSync(file)) {
    baseDir = path.dirname(file);
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (err) {
      throw new MocklensError(`cannot read config file ${file}: ${(err as Error).message}`);
    }
    try {
      raw = JSON.parse(text);
    } catch (err) {
      throw new MocklensError(`invalid JSON in config file ${file}: ${(err as Error).message}`);
    }
  } else if (configPath !== undefined) {
    throw new MocklensError(`config file not found: ${file}`);
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new MocklensError(`malformed config in ${file}: expected a JSON object`);
  }
  const obj = raw as Record<string, unknown>;

  const screensDir = obj.screensDir ?? 'screens';
  if (typeof screensDir !== 'string' || screensDir === '') {
    throw new MocklensError(`malformed config in ${file}: "screensDir" must be a non-empty string`);
  }
  const outDir = obj.outDir ?? '.mocklens';
  if (typeof outDir !== 'string' || outDir === '') {
    throw new MocklensError(`malformed config in ${file}: "outDir" must be a non-empty string`);
  }
  const fullPage = obj.fullPage ?? false;
  if (typeof fullPage !== 'boolean') {
    throw new MocklensError(`malformed config in ${file}: "fullPage" must be a boolean`);
  }
  const devices = obj.devices ?? DEFAULT_DEVICES;
  if (!Array.isArray(devices) || devices.length === 0) {
    throw new MocklensError(`malformed config in ${file}: "devices" must be a non-empty array`);
  }
  for (const d of devices as unknown[]) {
    const dev = d as Record<string, unknown>;
    if (
      typeof dev !== 'object' ||
      dev === null ||
      typeof dev.name !== 'string' ||
      dev.name === '' ||
      typeof dev.width !== 'number' ||
      !(dev.width > 0) ||
      typeof dev.height !== 'number' ||
      !(dev.height > 0)
    ) {
      throw new MocklensError(
        `malformed config in ${file}: each device must be { "name": string, "width": number, "height": number }`,
      );
    }
  }
  const allowedExternalHosts = obj.allowedExternalHosts ?? [];
  if (
    !Array.isArray(allowedExternalHosts) ||
    !allowedExternalHosts.every((h) => typeof h === 'string')
  ) {
    throw new MocklensError(`malformed config in ${file}: "allowedExternalHosts" must be an array of strings`);
  }

  return {
    configFile: file,
    baseDir,
    screensDir: path.resolve(baseDir, screensDir),
    outDir: path.resolve(baseDir, outDir),
    fullPage,
    devices: devices as Device[],
    allowedExternalHosts: allowedExternalHosts as string[],
  };
}
