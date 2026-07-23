import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  batchNotes,
  createNote,
  deleteNote,
  formatNotesMarkdown,
  loadNotes,
  notesFile,
  NotesError,
  updateNote,
} from '../src/notes.js';
import { discoverScreens } from '../src/screens.js';
import type { Config } from '../src/types.js';

const temporaryProjects: string[] = [];

function project(): { config: Config; screens: ReturnType<typeof discoverScreens> } {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mocklens-notes-'));
  temporaryProjects.push(baseDir);
  const screensDir = path.join(baseDir, 'screens');
  fs.mkdirSync(path.join(screensDir, 'states'), { recursive: true });
  fs.writeFileSync(path.join(screensDir, 'alpha.iphone-14.html'), '<main>Alpha</main>', 'utf8');
  fs.writeFileSync(path.join(screensDir, 'states', 'beta.iphone-14.html'), '<main>Beta</main>', 'utf8');
  const config: Config = {
    configFile: path.join(baseDir, 'mocklens.config.json'),
    baseDir,
    screensDir,
    outDir: path.join(baseDir, '.mocklens'),
    fullPage: false,
    devices: [{ name: 'iphone-14', width: 390, height: 844 }],
    allowedExternalHosts: [],
  };
  return { config, screens: discoverScreens(screensDir) };
}

function input(screen: string, message: string): Record<string, unknown> {
  return {
    screen,
    device: 'iphone-14',
    selector: 'main > button.primary',
    element: { tag: 'button', text: 'Save changes' },
    viewport: { width: 390, height: 844 },
    rect: { x: 20, y: 30, width: 200, height: 44 },
    message,
  };
}

afterEach(() => {
  for (const dir of temporaryProjects.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('annotation notes ledger', () => {
  it('is absent until the first valid note is created', () => {
    const { config, screens } = project();
    expect(loadNotes(config)).toEqual({ version: 1, notes: [] });
    expect(fs.existsSync(notesFile(config))).toBe(false);

    const note = createNote(config, screens, input('alpha.iphone-14', 'Reduce the emphasis.'), {
      id: () => 'note-1',
      now: () => '2026-07-23T01:00:00.000Z',
    });

    expect(note).toMatchObject({
      id: 'note-1',
      status: 'open',
      source: 'screens/alpha.iphone-14.html',
      message: 'Reduce the emphasis.',
      resolvedAt: null,
    });
    expect(loadNotes(config).notes).toEqual([note]);
  });

  it('edits, resolves, reopens, and deletes a note', () => {
    const { config, screens } = project();
    createNote(config, screens, input('alpha.iphone-14', 'Original'), {
      id: () => 'note-1',
      now: () => '2026-07-23T01:00:00.000Z',
    });
    const resolved = updateNote(config, 'note-1', { message: 'Updated', status: 'resolved' }, {
      now: () => '2026-07-23T02:00:00.000Z',
    });
    expect(resolved).toMatchObject({
      message: 'Updated',
      status: 'resolved',
      resolvedAt: '2026-07-23T02:00:00.000Z',
      updatedAt: '2026-07-23T02:00:00.000Z',
    });

    const reopened = updateNote(config, 'note-1', { status: 'open' }, {
      now: () => '2026-07-23T03:00:00.000Z',
    });
    expect(reopened.status).toBe('open');
    expect(reopened.resolvedAt).toBeNull();

    deleteNote(config, 'note-1');
    expect(loadNotes(config).notes).toEqual([]);
  });

  it('validates every batch ID before an atomic resolve or delete', () => {
    const { config, screens } = project();
    createNote(config, screens, input('alpha.iphone-14', 'First'), {
      id: () => 'note-1',
      now: () => '2026-07-23T01:00:00.000Z',
    });
    createNote(config, screens, input('states/beta.iphone-14', 'Second'), {
      id: () => 'note-2',
      now: () => '2026-07-23T02:00:00.000Z',
    });
    updateNote(config, 'note-2', { status: 'resolved' }, {
      now: () => '2026-07-23T03:00:00.000Z',
    });
    const before = fs.readFileSync(notesFile(config), 'utf8');

    expect(() => batchNotes(config, { ids: ['note-1', 'missing'], action: 'delete' })).toThrow(
      new NotesError(404, 'note not found: missing'),
    );
    expect(fs.readFileSync(notesFile(config), 'utf8')).toBe(before);

    const resolved = batchNotes(config, { ids: ['note-1', 'note-2'], action: 'resolve' }, {
      now: () => '2026-07-23T04:00:00.000Z',
    });
    expect(resolved.notes.find((note) => note.id === 'note-1')).toMatchObject({
      status: 'resolved',
      updatedAt: '2026-07-23T04:00:00.000Z',
    });
    expect(resolved.notes.find((note) => note.id === 'note-2')).toMatchObject({
      status: 'resolved',
      updatedAt: '2026-07-23T03:00:00.000Z',
    });

    expect(batchNotes(config, { ids: ['note-1', 'note-2'], action: 'delete' }).notes).toEqual([]);
  });

  it('formats selected notes in displayed queue order, not request order', () => {
    const { config, screens } = project();
    createNote(config, screens, input('states/beta.iphone-14', 'Beta open'), {
      id: () => 'beta',
      now: () => '2026-07-23T01:00:00.000Z',
    });
    createNote(config, screens, input('alpha.iphone-14', 'Alpha resolved'), {
      id: () => 'alpha',
      now: () => '2026-07-23T02:00:00.000Z',
    });
    updateNote(config, 'alpha', { status: 'resolved' }, {
      now: () => '2026-07-23T03:00:00.000Z',
    });

    const markdown = formatNotesMarkdown(loadNotes(config), screens, ['alpha', 'beta']);
    expect(markdown.indexOf('[OPEN] states/beta.iphone-14')).toBeLessThan(
      markdown.indexOf('[RESOLVED] alpha.iphone-14'),
    );
    expect(markdown).toContain('`screens/states/beta.iphone-14.html`');
    expect(markdown).toContain('Feedback: Alpha resolved');
  });

  it('never overwrites malformed JSON or malformed stored records', () => {
    const { config, screens } = project();
    fs.writeFileSync(notesFile(config), '{bad json', 'utf8');
    expect(() => loadNotes(config)).toThrow(/invalid JSON in notes file/);
    expect(() => createNote(config, screens, input('alpha.iphone-14', 'New note'))).toThrow(
      /invalid JSON in notes file/,
    );
    expect(fs.readFileSync(notesFile(config), 'utf8')).toBe('{bad json');

    fs.writeFileSync(notesFile(config), '{"version":1,"notes":[{"id":"broken"}]}\n', 'utf8');
    expect(() => loadNotes(config)).toThrow(/malformed notes file/);
    expect(fs.readFileSync(notesFile(config), 'utf8')).toContain('"id":"broken"');
  });

  it('rejects invalid creation and mutation input without creating a ledger', () => {
    const { config, screens } = project();
    expect(() => createNote(config, screens, input('missing', 'Unknown screen'))).toThrow(/unknown screen/);
    expect(() => createNote(config, screens, { ...input('alpha.iphone-14', '  '), message: '  ' })).toThrow(
      /must not be empty/,
    );
    expect(() => updateNote(config, 'missing', {})).toThrow(/must include message or status/);
    expect(fs.existsSync(notesFile(config))).toBe(false);
  });
});
