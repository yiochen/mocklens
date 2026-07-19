#!/usr/bin/env node
import path from 'node:path';
import { loadConfig, MocklensError } from './config.js';
import { discoverScreens } from './screens.js';
import type { Screen } from './screens.js';
import { launchBrowser } from './browser.js';
import { runScreenshots } from './screenshot.js';
import { runValidation, writeReport } from './validate.js';
import { renderReport } from './report.js';
import { startViewer } from './viewer.js';
import { runInit } from './init.js';
import type { Device } from './types.js';

const USAGE = `mocklens — static mobile UI mockup tool

Usage: mocklens <command> [options]

Commands:
  init         Create mocklens.config.json and starter screens
  list         List discovered screens and configured devices
  screenshot   Render PNG screenshots for every screen × device
  validate     Check screens for layout problems in a real browser
  check        screenshot + validate in one run
  serve        Start the local phone-sized viewer (default port 4173)

Options:
  --config <path>   Path to mocklens.config.json
  --dir <path>      Screens directory for init (default screens)
  --force           Overwrite scaffold files during init
  --screen <name>   Limit to one screen (repeatable)
  --device <name>   Limit to one device (repeatable)
  --full-page       Also capture full-page screenshots
  --port <n>        Viewer port (default 4173)
  --help            Show this help
`;

interface ParsedArgs {
  command: string | undefined;
  configPath: string | undefined;
  screenNames: string[];
  deviceNames: string[];
  initDir: string;
  force: boolean;
  fullPage: boolean;
  port: number;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    command: undefined,
    configPath: undefined,
    screenNames: [],
    deviceNames: [],
    initDir: 'screens',
    force: false,
    fullPage: false,
    port: 4173,
    help: false,
  };
  let i = 0;
  const valueFor = (flag: string): string => {
    i += 1;
    const v = argv[i];
    if (v === undefined) throw new MocklensError(`flag ${flag} requires a value`);
    return v;
  };
  while (i < argv.length) {
    const arg = argv[i] as string;
    switch (arg) {
      case '--config':
        out.configPath = valueFor(arg);
        break;
      case '--dir':
        out.initDir = valueFor(arg);
        break;
      case '--force':
        out.force = true;
        break;
      case '--screen':
        out.screenNames.push(valueFor(arg));
        break;
      case '--device':
        out.deviceNames.push(valueFor(arg));
        break;
      case '--port': {
        const raw = valueFor(arg);
        const v = Number(raw);
        if (!Number.isInteger(v) || v <= 0 || v > 65535) {
          throw new MocklensError(`invalid --port value: ${raw}`);
        }
        out.port = v;
        break;
      }
      case '--full-page':
        out.fullPage = true;
        break;
      case '--help':
      case '-h':
        out.help = true;
        break;
      default:
        if (arg.startsWith('-')) throw new MocklensError(`unknown flag: ${arg}`);
        if (out.command !== undefined) throw new MocklensError(`unexpected argument: ${arg}`);
        out.command = arg;
    }
    i += 1;
  }
  return out;
}

function selectScreens(all: Screen[], names: string[]): Screen[] {
  if (names.length === 0) return all;
  const missing = names.filter((n) => !all.some((s) => s.name === n));
  if (missing.length > 0) {
    throw new MocklensError(
      `unknown screen(s): ${missing.join(', ')} — available: ${all.map((s) => s.name).join(', ') || '(none)'}`,
    );
  }
  return all.filter((s) => names.includes(s.name));
}

function selectDevices(all: Device[], names: string[]): Device[] {
  if (names.length === 0) return all;
  const missing = names.filter((n) => !all.some((d) => d.name === n));
  if (missing.length > 0) {
    throw new MocklensError(
      `unknown device(s): ${missing.join(', ')} — available: ${all.map((d) => d.name).join(', ')}`,
    );
  }
  return all.filter((d) => names.includes(d.name));
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (args.command === undefined) {
    console.error(USAGE);
    return 2;
  }

  const cwd = process.cwd();
  if (args.command === 'init') {
    console.log(
      runInit({
        cwd,
        configPath: args.configPath,
        screensDir: args.initDir,
        force: args.force,
      }),
    );
    return 0;
  }

  const config = loadConfig(args.configPath, cwd);

  switch (args.command) {
    case 'list': {
      const screens = discoverScreens(config.screensDir);
      console.log(`screens (${screens.length}) in ${path.relative(cwd, config.screensDir) || '.'}:`);
      for (const s of screens) console.log(`  ${s.name}`);
      console.log(`devices (${config.devices.length}):`);
      for (const d of config.devices) console.log(`  ${d.name} ${d.width}×${d.height}`);
      return 0;
    }
    case 'screenshot':
    case 'validate':
    case 'check': {
      const discovered = discoverScreens(config.screensDir);
      if (discovered.length === 0) {
        throw new MocklensError(`no screens found in ${config.screensDir}`);
      }
      const screens = selectScreens(discovered, args.screenNames);
      const devices = selectDevices(config.devices, args.deviceNames);
      const browser = await launchBrowser();
      try {
        if (args.command !== 'validate') {
          await runScreenshots(browser, config, screens, devices, args.fullPage || config.fullPage);
        }
        if (args.command !== 'screenshot') {
          const report = await runValidation(browser, config, screens, devices);
          const reportFile = writeReport(config, report);
          console.log(renderReport(report));
          console.log(`\nreport written to ${path.relative(cwd, reportFile)}`);
          return report.summary.ok ? 0 : 1;
        }
        return 0;
      } finally {
        await browser.close();
      }
    }
    case 'serve': {
      const screens = discoverScreens(config.screensDir);
      await startViewer(config, screens, args.port);
      return 0;
    }
    default:
      console.error(USAGE);
      throw new MocklensError(`unknown command: ${args.command}`);
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    if (err instanceof MocklensError) {
      console.error(`mocklens: ${err.message}`);
    } else {
      console.error(`mocklens: unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    }
    process.exitCode = 2;
  },
);
