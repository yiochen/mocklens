import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Screen } from './screens.js';
import type { Config } from './types.js';

export type NoteStatus = 'open' | 'resolved';

export interface NoteRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MocklensNote {
  id: string;
  status: NoteStatus;
  screen: string;
  device: string;
  source: string;
  selector: string;
  element: { tag: string; text: string };
  viewport: { width: number; height: number };
  rect: NoteRect;
  message: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface NotesLedger {
  version: 1;
  notes: MocklensNote[];
}

export interface CreateNoteInput {
  screen: string;
  device: string;
  selector: string;
  element: { tag: string; text: string };
  viewport: { width: number; height: number };
  rect: NoteRect;
  message: string;
}

export interface UpdateNoteInput {
  message?: string;
  status?: NoteStatus;
}

export interface NotesRuntime {
  now?: () => string;
  id?: () => string;
}

export class NotesError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'NotesError';
    this.statusCode = statusCode;
  }
}

const MAX_MESSAGE = 4_000;
const MAX_SELECTOR = 2_000;
const MAX_ELEMENT_TEXT = 300;
const MAX_ELEMENT_TAG = 64;

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new NotesError(400, `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function fileObjectValue(value: unknown, label: string, file: string): Record<string, unknown> {
  try {
    return objectValue(value, label);
  } catch (error) {
    throw new NotesError(500, `malformed notes file ${file}: ${(error as Error).message}`);
  }
}

function requiredString(
  value: unknown,
  label: string,
  maxLength: number,
  options: { trim?: boolean } = {},
): string {
  if (typeof value !== 'string') throw new NotesError(400, `${label} must be a string`);
  const normalized = options.trim === false ? value : value.trim();
  if (normalized.length === 0) throw new NotesError(400, `${label} must not be empty`);
  if (normalized.length > maxLength) {
    throw new NotesError(400, `${label} must be at most ${maxLength} characters`);
  }
  return normalized;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new NotesError(400, `${label} must be a finite number`);
  }
  return value;
}

function parseViewport(value: unknown, label: string): { width: number; height: number } {
  const obj = objectValue(value, label);
  const width = finiteNumber(obj.width, `${label}.width`);
  const height = finiteNumber(obj.height, `${label}.height`);
  if (width <= 0 || height <= 0) throw new NotesError(400, `${label} dimensions must be greater than zero`);
  return { width, height };
}

function parseRect(value: unknown, label: string): NoteRect {
  const obj = objectValue(value, label);
  const rect = {
    x: finiteNumber(obj.x, `${label}.x`),
    y: finiteNumber(obj.y, `${label}.y`),
    width: finiteNumber(obj.width, `${label}.width`),
    height: finiteNumber(obj.height, `${label}.height`),
  };
  if (rect.width < 0 || rect.height < 0) {
    throw new NotesError(400, `${label} width and height must not be negative`);
  }
  return rect;
}

function parseElement(value: unknown, label: string): { tag: string; text: string } {
  const obj = objectValue(value, label);
  const tag = requiredString(obj.tag, `${label}.tag`, MAX_ELEMENT_TAG).toLowerCase();
  if (typeof obj.text !== 'string') throw new NotesError(400, `${label}.text must be a string`);
  const text = obj.text.replace(/\s+/g, ' ').trim();
  if (text.length > MAX_ELEMENT_TEXT) {
    throw new NotesError(400, `${label}.text must be at most ${MAX_ELEMENT_TEXT} characters`);
  }
  return { tag, text };
}

function timestamp(value: unknown, label: string): string {
  const text = requiredString(value, label, 100);
  if (Number.isNaN(Date.parse(text))) throw new NotesError(400, `${label} must be an ISO timestamp`);
  return text;
}

function statusValue(value: unknown, label: string): NoteStatus {
  if (value !== 'open' && value !== 'resolved') {
    throw new NotesError(400, `${label} must be "open" or "resolved"`);
  }
  return value;
}

function parseStoredNote(value: unknown, index: number, file: string): MocklensNote {
  const label = `notes[${index}]`;
  const obj = fileObjectValue(value, label, file);
  try {
    const status = statusValue(obj.status, `${label}.status`);
    const resolvedAt =
      obj.resolvedAt === null ? null : timestamp(obj.resolvedAt, `${label}.resolvedAt`);
    if (status === 'open' && resolvedAt !== null) {
      throw new NotesError(400, `${label}.resolvedAt must be null for an open note`);
    }
    if (status === 'resolved' && resolvedAt === null) {
      throw new NotesError(400, `${label}.resolvedAt is required for a resolved note`);
    }
    return {
      id: requiredString(obj.id, `${label}.id`, 200),
      status,
      screen: requiredString(obj.screen, `${label}.screen`, 1_000),
      device: requiredString(obj.device, `${label}.device`, 200),
      source: requiredString(obj.source, `${label}.source`, 2_000),
      selector: requiredString(obj.selector, `${label}.selector`, MAX_SELECTOR),
      element: parseElement(obj.element, `${label}.element`),
      viewport: parseViewport(obj.viewport, `${label}.viewport`),
      rect: parseRect(obj.rect, `${label}.rect`),
      message: requiredString(obj.message, `${label}.message`, MAX_MESSAGE),
      createdAt: timestamp(obj.createdAt, `${label}.createdAt`),
      updatedAt: timestamp(obj.updatedAt, `${label}.updatedAt`),
      resolvedAt,
    };
  } catch (error) {
    throw new NotesError(500, `malformed notes file ${file}: ${(error as Error).message}`);
  }
}

export function notesFile(config: Config): string {
  return path.join(config.baseDir, 'mocklens.notes.json');
}

export function loadNotes(config: Config): NotesLedger {
  const file = notesFile(config);
  if (!fs.existsSync(file)) return { version: 1, notes: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new NotesError(500, `invalid JSON in notes file ${file}: ${(error as Error).message}`);
  }
  const obj = fileObjectValue(raw, 'notes ledger', file);
  if (obj.version !== 1) throw new NotesError(500, `malformed notes file ${file}: version must be 1`);
  if (!Array.isArray(obj.notes)) {
    throw new NotesError(500, `malformed notes file ${file}: notes must be an array`);
  }
  const notes = obj.notes.map((item, index) => parseStoredNote(item, index, file));
  const ids = new Set<string>();
  for (const note of notes) {
    if (ids.has(note.id)) throw new NotesError(500, `malformed notes file ${file}: duplicate note id ${note.id}`);
    ids.add(note.id);
  }
  return { version: 1, notes };
}

function writeNotes(config: Config, ledger: NotesLedger): void {
  const file = notesFile(config);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(ledger, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

function createInput(value: unknown): CreateNoteInput {
  const obj = objectValue(value, 'note');
  return {
    screen: requiredString(obj.screen, 'note.screen', 1_000),
    device: requiredString(obj.device, 'note.device', 200),
    selector: requiredString(obj.selector, 'note.selector', MAX_SELECTOR),
    element: parseElement(obj.element, 'note.element'),
    viewport: parseViewport(obj.viewport, 'note.viewport'),
    rect: parseRect(obj.rect, 'note.rect'),
    message: requiredString(obj.message, 'note.message', MAX_MESSAGE),
  };
}

function posixRelative(from: string, to: string): string {
  return path.relative(from, to).split(path.sep).join('/');
}

export function createNote(
  config: Config,
  screens: Screen[],
  value: unknown,
  runtime: NotesRuntime = {},
): MocklensNote {
  const input = createInput(value);
  const screen = screens.find((candidate) => candidate.name === input.screen);
  if (screen === undefined) throw new NotesError(400, `unknown screen: ${input.screen}`);
  if (!config.devices.some((device) => device.name === input.device)) {
    throw new NotesError(400, `unknown device: ${input.device}`);
  }
  const now = (runtime.now ?? (() => new Date().toISOString()))();
  const note: MocklensNote = {
    id: (runtime.id ?? randomUUID)(),
    status: 'open',
    screen: input.screen,
    device: input.device,
    source: posixRelative(config.baseDir, screen.file),
    selector: input.selector,
    element: input.element,
    viewport: input.viewport,
    rect: input.rect,
    message: input.message,
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
  };
  const ledger = loadNotes(config);
  ledger.notes.push(note);
  writeNotes(config, ledger);
  return note;
}

function updateInput(value: unknown): UpdateNoteInput {
  const obj = objectValue(value, 'note update');
  const update: UpdateNoteInput = {};
  if (obj.message !== undefined) {
    update.message = requiredString(obj.message, 'note update.message', MAX_MESSAGE);
  }
  if (obj.status !== undefined) update.status = statusValue(obj.status, 'note update.status');
  if (update.message === undefined && update.status === undefined) {
    throw new NotesError(400, 'note update must include message or status');
  }
  return update;
}

function findNote(ledger: NotesLedger, id: string): MocklensNote {
  const note = ledger.notes.find((candidate) => candidate.id === id);
  if (note === undefined) throw new NotesError(404, `note not found: ${id}`);
  return note;
}

export function updateNote(
  config: Config,
  id: string,
  value: unknown,
  runtime: NotesRuntime = {},
): MocklensNote {
  const update = updateInput(value);
  const ledger = loadNotes(config);
  const note = findNote(ledger, id);
  const now = (runtime.now ?? (() => new Date().toISOString()))();
  if (update.message !== undefined) note.message = update.message;
  if (update.status !== undefined && update.status !== note.status) {
    note.status = update.status;
    note.resolvedAt = update.status === 'resolved' ? now : null;
  }
  note.updatedAt = now;
  writeNotes(config, ledger);
  return note;
}

export function deleteNote(config: Config, id: string): void {
  const ledger = loadNotes(config);
  const index = ledger.notes.findIndex((candidate) => candidate.id === id);
  if (index < 0) throw new NotesError(404, `note not found: ${id}`);
  ledger.notes.splice(index, 1);
  writeNotes(config, ledger);
}

function uniqueIds(value: unknown): string[] {
  const obj = objectValue(value, 'batch');
  if (!Array.isArray(obj.ids) || obj.ids.length === 0) {
    throw new NotesError(400, 'batch.ids must be a non-empty array');
  }
  const ids = obj.ids.map((id, index) => requiredString(id, `batch.ids[${index}]`, 200));
  if (new Set(ids).size !== ids.length) throw new NotesError(400, 'batch.ids must be unique');
  return ids;
}

export function batchNotes(
  config: Config,
  value: unknown,
  runtime: NotesRuntime = {},
): NotesLedger {
  const obj = objectValue(value, 'batch');
  const ids = uniqueIds(value);
  if (obj.action !== 'resolve' && obj.action !== 'delete') {
    throw new NotesError(400, 'batch.action must be "resolve" or "delete"');
  }
  const ledger = loadNotes(config);
  const byId = new Map(ledger.notes.map((note) => [note.id, note]));
  for (const id of ids) {
    if (!byId.has(id)) throw new NotesError(404, `note not found: ${id}`);
  }
  if (obj.action === 'delete') {
    const selected = new Set(ids);
    ledger.notes = ledger.notes.filter((note) => !selected.has(note.id));
  } else {
    const now = (runtime.now ?? (() => new Date().toISOString()))();
    for (const id of ids) {
      const note = byId.get(id)!;
      if (note.status === 'open') {
        note.status = 'resolved';
        note.updatedAt = now;
        note.resolvedAt = now;
      }
    }
  }
  writeNotes(config, ledger);
  return ledger;
}

export function selectedIds(value: unknown): string[] {
  return uniqueIds(value);
}

export function notesInQueueOrder(notes: MocklensNote[], screens: Screen[]): MocklensNote[] {
  const screenOrder = new Map(screens.map((screen, index) => [screen.name, index]));
  return notes
    .map((note, index) => ({ note, index }))
    .sort((a, b) => {
      if (a.note.status !== b.note.status) return a.note.status === 'open' ? -1 : 1;
      const aScreen = screenOrder.get(a.note.screen) ?? Number.MAX_SAFE_INTEGER;
      const bScreen = screenOrder.get(b.note.screen) ?? Number.MAX_SAFE_INTEGER;
      if (aScreen !== bScreen) return aScreen - bScreen;
      if (a.note.screen !== b.note.screen) return a.note.screen.localeCompare(b.note.screen);
      const time = a.note.createdAt.localeCompare(b.note.createdAt);
      return time !== 0 ? time : a.index - b.index;
    })
    .map(({ note }) => note);
}

function inlineCode(value: string): string {
  const ticks = value.match(/`+/g) ?? [];
  const fence = '`'.repeat(Math.max(1, ...ticks.map((tick) => tick.length + 1)));
  return `${fence}${value}${fence}`;
}

export function formatNotesMarkdown(ledger: NotesLedger, screens: Screen[], ids: string[]): string {
  const byId = new Map(ledger.notes.map((note) => [note.id, note]));
  for (const id of ids) {
    if (!byId.has(id)) throw new NotesError(404, `note not found: ${id}`);
  }
  const selected = new Set(ids);
  const notes = notesInQueueOrder(ledger.notes, screens).filter((note) => selected.has(note.id));
  const lines = [
    '# Mocklens review notes',
    '',
    'Please address these selected review notes, verify the affected screens, and resolve each note only after its design change is complete.',
    '',
  ];
  notes.forEach((note, index) => {
    const text = note.element.text === '' ? '' : ` — “${note.element.text.replace(/”/g, '"')}”`;
    lines.push(
      `## ${index + 1}. [${note.status.toUpperCase()}] ${note.screen} · ${note.device}`,
      '',
      `- Source: ${inlineCode(note.source)}`,
      `- Target: ${inlineCode(note.selector)}`,
      `- Element: ${inlineCode(`<${note.element.tag}>`)}${text}`,
      `- Feedback: ${note.message}`,
      '',
    );
  });
  return `${lines.join('\n').trimEnd()}\n`;
}
