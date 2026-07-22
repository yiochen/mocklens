import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MocklensError } from './config.js';
import type { Screen } from './screens.js';
import type {
  Config,
  Device,
  ProofCounts,
  ReadinessReport,
  Report,
  StaleReason,
  UxReadinessItem,
  VisualReadinessItem,
} from './types.js';

const UX_FILE = 'mocklens.ux.json';
const LEDGER_FILE = 'mocklens.checkpoints.json';
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REQUIREMENT_KINDS = new Set(['screen', 'screen-family', 'flow']);

export interface UxRequirement {
  id: string;
  kind: 'screen' | 'screen-family' | 'flow';
  description: string;
  screens: string[];
}

export interface UxManifest {
  version: 1;
  goal: string;
  delivery: { screens: string[]; devices: string[] };
  requirements: UxRequirement[];
}

export interface InputSet {
  hash: string;
  inputs: Record<string, string>;
}

interface UxProof {
  proof: string;
  screens: string[];
  inputHash: string;
  inputs: Record<string, string>;
}

interface VisualProof extends UxProof {
  screen: string;
  device: string;
  screenshot: string;
  screenshotSha256: string;
}

export interface CheckpointLedger {
  version: 1;
  ux: Record<string, UxProof>;
  visual: Record<string, VisualProof>;
}

interface SanityResult {
  screen: string;
  device: string;
  inputHash: string;
  ok: boolean;
}

interface SanityState {
  version: 1;
  results: Record<string, SanityResult>;
}

interface ScreenshotManifest {
  version: number;
  screenshots: Array<{
    screen: string;
    device: string;
    fullPage: boolean;
    path: string;
  }>;
}

interface ScreenshotState {
  version: 1;
  screenshots: Record<string, {
    screen: string;
    device: string;
    path: string;
    inputHash: string;
    screenshotSha256: string;
  }>;
}

export interface CheckpointStatus {
  status: 'current' | 'missing' | 'stale';
  reasons: string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJson(file: string, label: string): unknown {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new MocklensError(`cannot read ${label} ${file}: ${(err as Error).message}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new MocklensError(`invalid JSON in ${label} ${file}: ${(err as Error).message}`);
  }
}

function requireString(value: unknown, field: string, file: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new MocklensError(`malformed UX manifest in ${file}: ${field} must be a non-empty string`);
  }
  return value;
}

function safeName(value: string, field: string, file: string): void {
  if (
    value.includes('\\') ||
    value.startsWith('/') ||
    value === '.' ||
    value === '..' ||
    value.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new MocklensError(`malformed UX manifest in ${file}: ${field} contains unsafe path ${JSON.stringify(value)}`);
  }
}

function stringArray(value: unknown, field: string, file: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === 'string' && item.trim() !== '')) {
    throw new MocklensError(`malformed UX manifest in ${file}: ${field} must be a non-empty array of strings`);
  }
  const result = value as string[];
  for (const item of result) safeName(item, field, file);
  if (new Set(result).size !== result.length) {
    throw new MocklensError(`malformed UX manifest in ${file}: ${field} contains duplicate values`);
  }
  return result;
}

/** Load and fully validate the optional source-controlled UX requirements. */
export function loadUxManifest(config: Config, screens: Screen[]): UxManifest | null {
  const file = path.join(config.baseDir, UX_FILE);
  if (!fs.existsSync(file)) return null;
  const raw = readJson(file, 'UX manifest');
  if (!isObject(raw)) throw new MocklensError(`malformed UX manifest in ${file}: expected a JSON object`);
  if (raw.version !== 1) throw new MocklensError(`malformed UX manifest in ${file}: version must be 1`);
  const goal = requireString(raw.goal, 'goal', file);
  if (!isObject(raw.delivery)) {
    throw new MocklensError(`malformed UX manifest in ${file}: delivery must be an object`);
  }
  const deliveryScreens = stringArray(raw.delivery.screens, 'delivery.screens', file);
  const deliveryDevices = stringArray(raw.delivery.devices, 'delivery.devices', file);
  if (!Array.isArray(raw.requirements) || raw.requirements.length === 0) {
    throw new MocklensError(`malformed UX manifest in ${file}: requirements must be a non-empty array`);
  }

  const knownScreens = new Set(screens.map((screen) => screen.name));
  const knownDevices = new Set(config.devices.map((device) => device.name));
  const unknownScreens = deliveryScreens.filter((name) => !knownScreens.has(name));
  if (unknownScreens.length > 0) {
    throw new MocklensError(`UX manifest references unknown screen(s): ${unknownScreens.join(', ')}`);
  }
  const unknownDevices = deliveryDevices.filter((name) => !knownDevices.has(name));
  if (unknownDevices.length > 0) {
    throw new MocklensError(`UX manifest references unknown configured device(s): ${unknownDevices.join(', ')}`);
  }

  const requirements: UxRequirement[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < raw.requirements.length; index += 1) {
    const item = raw.requirements[index];
    const prefix = `requirements[${index}]`;
    if (!isObject(item)) throw new MocklensError(`malformed UX manifest in ${file}: ${prefix} must be an object`);
    const id = requireString(item.id, `${prefix}.id`, file);
    if (!ID_PATTERN.test(id)) {
      throw new MocklensError(`malformed UX manifest in ${file}: requirement ID ${JSON.stringify(id)} must be kebab-case`);
    }
    if (ids.has(id)) throw new MocklensError(`duplicate UX requirement ID: ${id}`);
    ids.add(id);
    const kind = requireString(item.kind, `${prefix}.kind`, file);
    if (!REQUIREMENT_KINDS.has(kind)) {
      throw new MocklensError(`malformed UX manifest in ${file}: ${prefix}.kind must be screen, screen-family, or flow`);
    }
    const description = requireString(item.description, `${prefix}.description`, file);
    const requirementScreens = stringArray(item.screens, `${prefix}.screens`, file);
    const unknown = requirementScreens.filter((name) => !knownScreens.has(name));
    if (unknown.length > 0) {
      throw new MocklensError(`UX requirement ${id} references unknown screen(s): ${unknown.join(', ')}`);
    }
    requirements.push({ id, kind: kind as UxRequirement['kind'], description, screens: requirementScreens });
  }
  return { version: 1, goal, delivery: { screens: deliveryScreens, devices: deliveryDevices }, requirements };
}

function sha256(value: crypto.BinaryLike): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sortedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedValue(value[key])]));
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortedValue(value));
}

function posixRelative(baseDir: string, file: string): string {
  const relative = path.relative(baseDir, file);
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new MocklensError(`unsafe checkpoint input path: ${file} must stay inside ${baseDir}`);
  }
  return relative.split(path.sep).join('/');
}

function localReference(raw: string): string | null {
  const value = raw.trim();
  if (/^(?:[a-z]+:|\/\/)/i.test(value)) return null;
  return value.split(/[?#]/, 1)[0] ?? '';
}

function stylesheetReferences(file: string, contents: string): string[] {
  const imports = (css: string): string[] => {
    const refs: string[] = [];
    for (const match of css.matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?/gi)) refs.push(match[1]!);
    for (const match of css.matchAll(/@import\s+url\(\s*([^)'"\s]+)\s*\)/gi)) refs.push(match[1]!);
    return refs;
  };
  if (file.endsWith('.html')) {
    const refs = [...contents.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].flatMap((match) => imports(match[1]!));
    for (const match of contents.matchAll(/<link\b([^>]*)>/gi)) {
      const attrs = new Map<string, string>();
      for (const attr of match[1]!.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
        attrs.set(attr[1]!.toLowerCase(), attr[2] ?? attr[3] ?? attr[4] ?? '');
      }
      if ((attrs.get('rel') ?? '').toLowerCase().split(/\s+/).includes('stylesheet') && attrs.has('href')) {
        refs.push(attrs.get('href')!);
      }
    }
    return refs;
  }
  return imports(contents);
}

function addFileAndStylesheets(config: Config, file: string, inputs: Record<string, string>, seen: Set<string>): void {
  const resolved = path.resolve(file);
  if (seen.has(resolved)) return;
  seen.add(resolved);
  const rel = posixRelative(config.baseDir, resolved);
  let contents: Buffer;
  try {
    posixRelative(fs.realpathSync(config.baseDir), fs.realpathSync(resolved));
    contents = fs.readFileSync(resolved);
  } catch (err) {
    throw new MocklensError(`cannot read checkpoint input ${rel}: ${(err as Error).message}`);
  }
  inputs[rel] = sha256(contents);
  const text = contents.toString('utf8');
  for (const rawRef of stylesheetReferences(resolved, text)) {
    const ref = localReference(rawRef);
    if (ref === null || ref === '') continue;
    if (path.isAbsolute(ref) || ref.includes('\\')) {
      throw new MocklensError(`unsafe stylesheet path ${JSON.stringify(rawRef)} in ${rel}`);
    }
    const dependency = path.resolve(path.dirname(resolved), ref);
    posixRelative(config.baseDir, dependency);
    addFileAndStylesheets(config, dependency, inputs, seen);
  }
}

function finalizeInputs(inputs: Record<string, string>): InputSet {
  const sorted = sortedValue(inputs) as Record<string, string>;
  return { inputs: sorted, hash: sha256(stableJson(sorted)) };
}

function screenMap(screens: Screen[]): Map<string, Screen> {
  return new Map(screens.map((screen) => [screen.name, screen]));
}

export function buildVisualInputs(config: Config, screen: Screen, device: Device): InputSet {
  const inputs: Record<string, string> = {};
  addFileAndStylesheets(config, screen.file, inputs, new Set());
  inputs[`device:${device.name}`] = sha256(stableJson({ name: device.name, width: device.width, height: device.height }));
  return finalizeInputs(inputs);
}

export function buildRequirementInputs(
  config: Config,
  manifest: UxManifest,
  requirement: UxRequirement,
  screens: Screen[],
): InputSet {
  const inputs: Record<string, string> = {
    [`requirement:${requirement.id}`]: sha256(stableJson(requirement)),
  };
  const byName = screenMap(screens);
  const seen = new Set<string>();
  for (const name of requirement.screens) addFileAndStylesheets(config, byName.get(name)!.file, inputs, seen);
  const devices = new Map(config.devices.map((device) => [device.name, device]));
  for (const name of manifest.delivery.devices) {
    const device = devices.get(name)!;
    inputs[`device:${name}`] = sha256(stableJson({ name, width: device.width, height: device.height }));
  }
  return finalizeInputs(inputs);
}

function emptyLedger(): CheckpointLedger {
  return { version: 1, ux: {}, visual: {} };
}

export function loadCheckpointLedger(config: Config): CheckpointLedger {
  const file = path.join(config.baseDir, LEDGER_FILE);
  if (!fs.existsSync(file)) return emptyLedger();
  const raw = readJson(file, 'checkpoint ledger');
  if (!isObject(raw) || raw.version !== 1 || !isObject(raw.ux) || !isObject(raw.visual)) {
    throw new MocklensError(`malformed checkpoint ledger in ${file}`);
  }
  return raw as unknown as CheckpointLedger;
}

function lockLedger<T>(config: Config, update: (ledger: CheckpointLedger) => T): T {
  const file = path.join(config.baseDir, LEDGER_FILE);
  const lock = `${file}.lock`;
  const deadline = Date.now() + 2_000;
  let fd: number | undefined;
  while (fd === undefined) {
    try {
      fd = fs.openSync(lock, 'wx');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw new MocklensError(`cannot acquire checkpoint lock ${lock}: ${(err as Error).message}`);
      }
      if (Date.now() >= deadline) {
        throw new MocklensError(`checkpoint ledger is busy after 2 seconds; wait for the other mocklens process or remove stale lock ${path.basename(lock)}`);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  const temp = path.join(config.baseDir, `.${LEDGER_FILE}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    const ledger = loadCheckpointLedger(config);
    const result = update(ledger);
    fs.writeFileSync(temp, `${JSON.stringify(sortedValue(ledger), null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temp, file);
    return result;
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}

function focusedCheck(screens: string[], devices: string[]): string {
  return `mocklens check ${screens.map((name) => `--screen ${name}`).join(' ')} ${devices.map((name) => `--device ${name}`).join(' ')}`.trim();
}

export function checkpointUx(
  config: Config,
  manifest: UxManifest,
  screens: Screen[],
  requirementId: string,
  proofValue: string | undefined,
): string {
  const proof = proofValue?.trim() ?? '';
  if (proof === '') throw new MocklensError('checkpoint ux requires non-empty --proof <specific evidence>');
  const requirement = manifest.requirements.find((item) => item.id === requirementId);
  if (requirement === undefined) {
    throw new MocklensError(`unknown UX requirement: ${requirementId} — available: ${manifest.requirements.map((item) => item.id).join(', ')}`);
  }
  const current = buildRequirementInputs(config, manifest, requirement, screens);
  const replaced = lockLedger(config, (ledger) => {
    const existed = ledger.ux[requirement.id] !== undefined;
    ledger.ux[requirement.id] = { proof, screens: requirement.screens, inputHash: current.hash, inputs: current.inputs };
    return existed;
  });
  return `MOCKLENS UX CHECKPOINT ${replaced ? 'REPLACED' : 'RECORDED'}\n\nRequirement: ${requirement.id}\nScreens: ${requirement.screens.join(', ')}\nProof: ${proof}\nNext: ${focusedCheck(requirement.screens, manifest.delivery.devices)}`;
}

function visualKey(screen: string, device: string): string {
  return `${screen}@${device}`;
}

function readOptionalJson<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  return readJson(file, path.basename(file)) as T;
}

export function checkpointVisual(
  config: Config,
  screens: Screen[],
  devices: Device[],
  proofValue: string | undefined,
): string {
  const proof = proofValue?.trim() ?? '';
  if (proof === '') throw new MocklensError('checkpoint visual requires non-empty --proof <specific evidence>');
  if (screens.length === 0) throw new MocklensError('checkpoint visual requires at least one --screen <name>');
  if (devices.length === 0) throw new MocklensError('checkpoint visual requires at least one --device <name>');

  const sanityFile = path.join(config.outDir, 'sanity-state.json');
  const manifestFile = path.join(config.outDir, 'screenshots', 'manifest.json');
  const screenshotStateFile = path.join(config.outDir, 'screenshots', 'state.json');
  const sanity = readOptionalJson<SanityState>(sanityFile);
  const screenshots = readOptionalJson<ScreenshotManifest>(manifestFile);
  const screenshotState = readOptionalJson<ScreenshotState>(screenshotStateFile);
  if (sanity === null) throw new MocklensError('no sanity results found; run the focused mocklens check command first');
  if (screenshots === null) throw new MocklensError('no screenshot manifest found; run the focused mocklens check command first');
  if (screenshotState === null) throw new MocklensError('no screenshot hash state found; run the focused mocklens check command first');

  const candidates: VisualProof[] = [];
  const errors: string[] = [];
  for (const screen of screens) {
    for (const device of devices) {
      const key = visualKey(screen.name, device.name);
      const current = buildVisualInputs(config, screen, device);
      const sanityEntry = sanity.results[key];
      if (sanityEntry === undefined) errors.push(`${key}: missing sanity result`);
      else if (!sanityEntry.ok) errors.push(`${key}: sanity check failed`);
      else if (sanityEntry.inputHash !== current.hash) errors.push(`${key}: sanity result is stale`);
      const screenshotEntry = screenshots.screenshots.find(
        (entry) => entry.screen === screen.name && entry.device === device.name && !entry.fullPage,
      );
      if (screenshotEntry === undefined) {
        errors.push(`${key}: missing viewport screenshot`);
        continue;
      }
      const generated = screenshotState.screenshots[key];
      if (generated === undefined || generated.path !== screenshotEntry.path) {
        errors.push(`${key}: missing viewport screenshot hash state`);
        continue;
      }
      if (generated.inputHash !== current.hash) errors.push(`${key}: viewport screenshot is stale`);
      const screenshotFile = path.resolve(config.outDir, 'screenshots', screenshotEntry.path);
      const expectedRoot = path.resolve(config.outDir, 'screenshots');
      if (!screenshotFile.startsWith(`${expectedRoot}${path.sep}`)) {
        errors.push(`${key}: screenshot path is unsafe`);
        continue;
      }
      if (!fs.existsSync(screenshotFile)) {
        errors.push(`${key}: viewport screenshot file is missing`);
        continue;
      }
      const currentScreenshotHash = sha256(fs.readFileSync(screenshotFile));
      if (generated.screenshotSha256 !== currentScreenshotHash) {
        errors.push(`${key}: viewport screenshot file does not match its manifest`);
      }
      const screenshot = posixRelative(config.baseDir, screenshotFile);
      candidates.push({
        screen: screen.name,
        device: device.name,
        proof,
        screens: [screen.name],
        inputHash: current.hash,
        inputs: current.inputs,
        screenshot,
        screenshotSha256: currentScreenshotHash,
      });
    }
  }
  if (errors.length > 0) {
    throw new MocklensError(`visual checkpoint batch refused; no checkpoints written:\n  ${errors.join('\n  ')}\nRun: ${focusedCheck(screens.map((item) => item.name), devices.map((item) => item.name))}`);
  }
  const replaced = lockLedger(config, (ledger) => {
    let count = 0;
    for (const candidate of candidates) {
      const key = visualKey(candidate.screen, candidate.device);
      if (ledger.visual[key] !== undefined) count += 1;
      ledger.visual[key] = candidate;
    }
    return count;
  });
  return `MOCKLENS VISUAL CHECKPOINTS RECORDED\n\nScreens: ${screens.map((item) => item.name).join(', ')}\nDevices: ${devices.map((item) => item.name).join(', ')}\nProof: ${proof}\nRecorded: ${candidates.length}${replaced > 0 ? ` (${replaced} replaced)` : ''}`;
}

function staleReasons(previous: Record<string, string>, current: Record<string, string>): string[] {
  const reasons: string[] = [];
  for (const key of [...new Set([...Object.keys(previous), ...Object.keys(current)])].sort()) {
    if (previous[key] === current[key]) continue;
    const action = previous[key] === undefined ? 'added' : current[key] === undefined ? 'removed' : 'changed';
    const label = key.startsWith('requirement:') ? `requirement ${key.slice('requirement:'.length)}` : key.startsWith('device:') ? `device ${key.slice('device:'.length)}` : key;
    reasons.push(`${label} ${action}`);
  }
  return reasons;
}

export function uxCheckpointStatus(
  config: Config,
  manifest: UxManifest,
  requirement: UxRequirement,
  screens: Screen[],
  ledger = loadCheckpointLedger(config),
): CheckpointStatus {
  const proof = ledger.ux[requirement.id];
  if (proof === undefined) return { status: 'missing', reasons: [] };
  const current = buildRequirementInputs(config, manifest, requirement, screens);
  const reasons = staleReasons(proof.inputs, current.inputs);
  if (reasons.length === 0 && proof.inputHash !== current.hash) reasons.push('input hash mismatch');
  return reasons.length === 0 && proof.inputHash === current.hash ? { status: 'current', reasons: [] } : { status: 'stale', reasons };
}

export function visualCheckpointStatus(
  config: Config,
  screen: Screen,
  device: Device,
  ledger = loadCheckpointLedger(config),
): CheckpointStatus {
  const proof = ledger.visual[visualKey(screen.name, device.name)];
  if (proof === undefined) return { status: 'missing', reasons: [] };
  const current = buildVisualInputs(config, screen, device);
  const reasons = staleReasons(proof.inputs, current.inputs);
  const screenshotFile = path.resolve(config.baseDir, proof.screenshot);
  posixRelative(config.baseDir, screenshotFile);
  if (!fs.existsSync(screenshotFile)) reasons.push(`${proof.screenshot} removed`);
  else if (sha256(fs.readFileSync(screenshotFile)) !== proof.screenshotSha256) reasons.push(`${proof.screenshot} changed`);
  if (reasons.length === 0 && proof.inputHash !== current.hash) reasons.push('input hash mismatch');
  return reasons.length === 0 && proof.inputHash === current.hash ? { status: 'current', reasons: [] } : { status: 'stale', reasons };
}

function proofCounts(statuses: Array<'current' | 'missing' | 'stale'>): ProofCounts {
  return {
    current: statuses.filter((status) => status === 'current').length,
    missing: statuses.filter((status) => status === 'missing').length,
    stale: statuses.filter((status) => status === 'stale').length,
    total: statuses.length,
  };
}

function currentScreenshot(config: Config, screen: string, device: string): { path: string; hash: string | null } {
  const file = path.join(config.outDir, 'screenshots', device, `${screen}.png`);
  return {
    path: path.relative(config.baseDir, file).split(path.sep).join('/'),
    hash: fs.existsSync(file) ? sha256(fs.readFileSync(file)) : null,
  };
}

function structuredReasons(reasons: string[]): StaleReason[] {
  return reasons.map((reason) => {
    if (reason === 'input hash mismatch') return { kind: 'input', target: 'input hash', change: 'mismatch' };
    const match = /^(.*) (added|removed|changed)$/.exec(reason);
    const target = match?.[1] ?? reason;
    const change = (match?.[2] ?? 'changed') as StaleReason['change'];
    const kind: StaleReason['kind'] = target.startsWith('requirement ')
      ? 'requirement'
      : target.startsWith('device ')
        ? 'device'
        : target.endsWith('.css')
          ? 'stylesheet'
          : target.endsWith('.html')
            ? 'screen'
            : target.endsWith('.png')
              ? 'screenshot'
              : 'input';
    return { kind, target, change };
  });
}

function readinessItems(
  config: Config,
  manifest: UxManifest,
  screens: Screen[],
  selectedScreens: Set<string>,
  selectedDevices: Set<string>,
  ledger: CheckpointLedger,
): { requirements: UxReadinessItem[]; visual: VisualReadinessItem[] } {
  const requirements = manifest.requirements
    .filter((requirement) => requirement.screens.some((screen) => selectedScreens.has(screen)))
    .map((requirement): UxReadinessItem => {
      const current = buildRequirementInputs(config, manifest, requirement, screens);
      const recorded = ledger.ux[requirement.id];
      const result = uxCheckpointStatus(config, manifest, requirement, screens, ledger);
      return {
        id: requirement.id,
        kind: requirement.kind,
        description: requirement.description,
        status: result.status,
        proof: recorded?.proof ?? null,
        recordedHash: recorded?.inputHash ?? null,
        currentHash: current.hash,
        targets: {
          screens: [...requirement.screens].sort(),
          devices: [...manifest.delivery.devices].sort(),
        },
        staleReasons: structuredReasons(result.reasons),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const byScreen = screenMap(screens);
  const byDevice = new Map(config.devices.map((device) => [device.name, device]));
  const visual: VisualReadinessItem[] = [];
  for (const screenName of [...manifest.delivery.screens].sort()) {
    if (!selectedScreens.has(screenName)) continue;
    for (const deviceName of [...manifest.delivery.devices].sort()) {
      if (!selectedDevices.has(deviceName)) continue;
      const screen = byScreen.get(screenName)!;
      const device = byDevice.get(deviceName)!;
      const current = buildVisualInputs(config, screen, device);
      const recorded = ledger.visual[visualKey(screenName, deviceName)];
      const result = visualCheckpointStatus(config, screen, device, ledger);
      const screenshot = currentScreenshot(config, screenName, deviceName);
      visual.push({
        screen: screenName,
        device: deviceName,
        status: result.status,
        proof: recorded?.proof ?? null,
        recordedHash: recorded?.inputHash ?? null,
        currentHash: current.hash,
        screenshot: {
          path: recorded?.screenshot ?? screenshot.path,
          recordedHash: recorded?.screenshotSha256 ?? null,
          currentHash: screenshot.hash,
        },
        staleReasons: structuredReasons(result.reasons),
      });
    }
  }
  return { requirements, visual };
}

/** Build the deterministic proof/readiness portion of report schema v3. */
export function buildReadinessReport(
  config: Config,
  manifest: UxManifest,
  screens: Screen[],
  selectedScreens: Screen[],
  selectedDevices: Device[],
  proofScope: 'FULL' | 'FILTERED',
  sanityOk: boolean,
): ReadinessReport {
  const ledger = loadCheckpointLedger(config);
  const selected = readinessItems(
    config,
    manifest,
    screens,
    new Set(selectedScreens.map((screen) => screen.name)),
    new Set(selectedDevices.map((device) => device.name)),
    ledger,
  );
  const uxCounts = proofCounts(selected.requirements.map((item) => item.status));
  const visualCounts = proofCounts(selected.visual.map((item) => item.status));
  const uxProofOk = uxCounts.missing === 0 && uxCounts.stale === 0;
  const visualProofOk = visualCounts.missing === 0 && visualCounts.stale === 0;
  const evaluatedScreens = new Set(selected.visual.map((item) => item.screen)).size;
  const evaluatedDevices = new Set(selected.visual.map((item) => item.device)).size;
  let remainingProject: ReadinessReport['remainingProject'] = null;
  if (proofScope === 'FILTERED') {
    const project = readinessItems(
      config,
      manifest,
      screens,
      new Set(screens.map((screen) => screen.name)),
      new Set(manifest.delivery.devices),
      ledger,
    );
    remainingProject = {
      ux: project.requirements.filter((item) => item.status !== 'current').length,
      visual: project.visual.filter((item) => item.status !== 'current').length,
    };
  }
  return {
    evaluated: true,
    uxTrackingConfigured: true,
    proofScope,
    coverage: {
      configured: {
        screens: manifest.delivery.screens.length,
        devices: manifest.delivery.devices.length,
        combinations: manifest.delivery.screens.length * manifest.delivery.devices.length,
      },
      evaluated: {
        screens: evaluatedScreens,
        devices: evaluatedDevices,
        combinations: selected.visual.length,
      },
    },
    counts: { ux: uxCounts, visual: visualCounts },
    requirements: selected.requirements,
    visual: selected.visual,
    remainingProject,
    sanityOk,
    uxProofOk,
    visualProofOk,
    ready: proofScope === 'FULL' && sanityOk && uxProofOk && visualProofOk,
  };
}

function uxCheckpointCommand(id: string): string {
  return `mocklens checkpoint ux ${id} --proof "<specific evidence after review>"`;
}

function visualCheckpointCommand(screen: string, device: string): string {
  return `mocklens checkpoint visual --screen ${screen} --device ${device} --proof "<specific evidence after review>"`;
}

/** Render all unmet proof gates; Mocklens verifies evidence, never subjective quality. */
export function renderReadinessReport(readiness: ReadinessReport): string {
  const lines = [
    'Mocklens verifies proof presence and freshness; it does not judge the truth or quality of subjective UX claims.',
    '',
    `UX PROOF — ${readiness.uxProofOk ? 'PASS' : 'FAIL'}`,
    `UX proof scope: ${readiness.proofScope}`,
    `Current: ${readiness.counts.ux.current}; missing: ${readiness.counts.ux.missing}; stale: ${readiness.counts.ux.stale}; total: ${readiness.counts.ux.total}.`,
  ];
  for (const item of readiness.requirements.filter((candidate) => candidate.status !== 'current')) {
    lines.push(`  ${item.status.toUpperCase()} ${item.id} [${item.kind}] — ${item.description}`);
    lines.push(`    screens: ${item.targets.screens.join(', ')}`);
    lines.push(`    devices: ${item.targets.devices.join(', ')}`);
    if (item.status === 'stale') {
      lines.push(`    recorded hash: ${item.recordedHash}`);
      lines.push(`    current hash: ${item.currentHash}`);
      for (const reason of item.staleReasons) lines.push(`    cause: ${reason.kind} ${reason.target} ${reason.change}`);
      lines.push('    Re-review the affected targets and replace this checkpoint.');
    }
    lines.push(`    Run after review: ${uxCheckpointCommand(item.id)}`);
  }
  lines.push('');
  lines.push(`VISUAL PROOF — ${readiness.visualProofOk ? 'PASS' : 'FAIL'}`);
  lines.push(
    `Delivery coverage: ${readiness.coverage.evaluated.screens} screens × ${readiness.coverage.evaluated.devices} devices = ${readiness.coverage.evaluated.combinations} visual targets ` +
      `(project: ${readiness.coverage.configured.screens} × ${readiness.coverage.configured.devices} = ${readiness.coverage.configured.combinations}).`,
  );
  lines.push(`Current: ${readiness.counts.visual.current}; missing: ${readiness.counts.visual.missing}; stale: ${readiness.counts.visual.stale}; total: ${readiness.counts.visual.total}.`);
  for (const item of readiness.visual.filter((candidate) => candidate.status !== 'current')) {
    lines.push(`  ${item.status.toUpperCase()} ${visualKey(item.screen, item.device)}`);
    lines.push(`    screen: ${item.screen}`);
    lines.push(`    device: ${item.device}`);
    if (item.status === 'stale') {
      lines.push(`    recorded hash: ${item.recordedHash}`);
      lines.push(`    current hash: ${item.currentHash}`);
      if (item.screenshot.recordedHash !== item.screenshot.currentHash) {
        lines.push(`    recorded screenshot hash: ${item.screenshot.recordedHash}`);
        lines.push(`    current screenshot hash: ${item.screenshot.currentHash}`);
      }
      for (const reason of item.staleReasons) lines.push(`    cause: ${reason.kind} ${reason.target} ${reason.change}`);
      lines.push('    Re-review the current screenshot and replace this checkpoint.');
    }
    lines.push(`    Run after review: ${visualCheckpointCommand(item.screen, item.device)}`);
  }
  lines.push('');
  if (readiness.proofScope === 'FILTERED') {
    lines.push('DELIVERY READINESS — NOT EVALUATED');
    lines.push('Project delivery readiness was not evaluated.');
    if (readiness.remainingProject !== null) {
      lines.push(`Remaining project proof: ${readiness.remainingProject.ux} UX requirements; ${readiness.remainingProject.visual} visual targets.`);
    }
  } else {
    lines.push(`DELIVERY READINESS — ${readiness.ready ? 'PASS' : 'FAIL'}`);
    if (readiness.ready) {
      lines.push('All required delivery screens and devices have current sanity, UX, and visual proof.');
    }
  }
  return lines.join('\n');
}

/** Render proof freshness for check stdout without affecting check's report or exit status. */
export function renderCheckpointSummary(
  config: Config,
  manifest: UxManifest,
  screens: Screen[],
): string {
  const ledger = loadCheckpointLedger(config);
  const lines = ['MOCKLENS CHECKPOINT STATUS — evidence only; no UX quality score', 'UX requirements:'];
  for (const requirement of manifest.requirements) {
    const result = uxCheckpointStatus(config, manifest, requirement, screens, ledger);
    lines.push(`  ${result.status.toUpperCase()} ${requirement.id}`);
    for (const reason of result.reasons) lines.push(`    - ${reason}`);
  }
  lines.push('Visual review:');
  const byScreen = screenMap(screens);
  const byDevice = new Map(config.devices.map((device) => [device.name, device]));
  for (const screenName of manifest.delivery.screens) {
    for (const deviceName of manifest.delivery.devices) {
      const result = visualCheckpointStatus(config, byScreen.get(screenName)!, byDevice.get(deviceName)!, ledger);
      lines.push(`  ${result.status.toUpperCase()} ${visualKey(screenName, deviceName)}`);
      for (const reason of result.reasons) lines.push(`    - ${reason}`);
    }
  }
  return lines.join('\n');
}

/** Persist hash-addressed sanity outcomes without changing report.json's schema. */
export function recordSanityState(config: Config, report: Report, screens: Screen[], devices: Device[]): void {
  const file = path.join(config.outDir, 'sanity-state.json');
  const existing = readOptionalJson<SanityState>(file);
  const state: SanityState = existing?.version === 1 && isObject(existing.results) ? existing : { version: 1, results: {} };
  const screenByName = screenMap(screens);
  const deviceByName = new Map(devices.map((device) => [device.name, device]));
  for (const result of report.screens) {
    const screen = screenByName.get(result.name);
    const device = deviceByName.get(result.device);
    if (screen === undefined || device === undefined) continue;
    state.results[visualKey(result.name, result.device)] = {
      screen: result.name,
      device: result.device,
      inputHash: buildVisualInputs(config, screen, device).hash,
      ok: result.ok,
    };
  }
  fs.mkdirSync(config.outDir, { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(sortedValue(state), null, 2)}\n`);
  fs.renameSync(temp, file);
}
