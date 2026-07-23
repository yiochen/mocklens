import { describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import type { Server } from 'node:http';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { discoverScreens } from '../src/screens.js';
import type { Config } from '../src/types.js';
import { startViewer } from '../src/viewer.js';

interface ViewerProject {
  baseDir: string;
  config: Config;
  screens: ReturnType<typeof discoverScreens>;
}

function viewerProject(): ViewerProject {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mocklens-viewer-'));
  const screensDir = path.join(baseDir, 'screens');
  fs.mkdirSync(path.join(screensDir, 'states'), { recursive: true });
  fs.writeFileSync(
    path.join(screensDir, 'alpha.iphone-14.html'),
    `<!doctype html>
<html><head><meta charset="utf-8"><title>Alpha screen</title></head>
<body>
  <button id="normal" onclick="document.body.dataset.clicked='yes'">Normal action</button>
  <section id="primary-section">
    <button id="save" data-mocklens-action="Save the design"><span id="save-label">Save changes</span></button>
  </section>
</body></html>`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(screensDir, 'states', 'beta.iphone-14.html'),
    '<!doctype html><html><head><meta charset="utf-8"><title>Beta screen</title></head><body><article id="beta-target">Beta target</article></body></html>',
    'utf8',
  );
  fs.writeFileSync(path.join(screensDir, 'theme.dark.css'), 'body { color: navy; }', 'utf8');
  const config: Config = {
    configFile: path.join(baseDir, 'mocklens.config.json'),
    baseDir,
    screensDir,
    outDir: path.join(baseDir, '.mocklens'),
    fullPage: false,
    devices: [{ name: 'iphone-14', width: 390, height: 844 }],
    allowedExternalHosts: [],
  };
  return { baseDir, config, screens: discoverScreens(screensDir) };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function originOf(server: Server): string {
  return `http://localhost:${(server.address() as AddressInfo).port}`;
}

function notePayload(
  screen: string,
  selector: string,
  message: string,
  element: { tag: string; text: string } = { tag: 'button', text: 'Save changes' },
): Record<string, unknown> {
  return {
    screen,
    device: 'iphone-14',
    selector,
    element,
    viewport: { width: 390, height: 844 },
    rect: { x: 20, y: 30, width: 180, height: 44 },
    message,
  };
}

async function jsonRequest(origin: string, route: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  return fetch(`${origin}${route}`, { ...init, headers });
}

describe('viewer', () => {
  it('serves dotted screen names as HTML while preserving exact asset paths', async () => {
    const project = viewerProject();
    const server = await startViewer(project.config, project.screens, 0);
    const origin = originOf(server);
    try {
      const screen = await fetch(`${origin}/screens/states/beta.iphone-14`);
      expect(screen.status).toBe(200);
      expect(screen.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(await screen.text()).toContain('<title>Beta screen</title>');

      const asset = await fetch(`${origin}/screens/theme.dark.css`);
      expect(asset.status).toBe(200);
      expect(asset.headers.get('content-type')).toBe('text/css; charset=utf-8');
      expect(await asset.text()).toBe('body { color: navy; }');

      expect((await fetch(`${origin}/screens/missing.iphone-14`)).status).toBe(404);
    } finally {
      await closeServer(server);
      fs.rmSync(project.baseDir, { recursive: true, force: true });
    }
  });

  it('supports validated CRUD, selected Markdown, and atomic batch APIs', async () => {
    const project = viewerProject();
    const server = await startViewer(project.config, project.screens, 0);
    const origin = originOf(server);
    try {
      const empty = await jsonRequest(origin, '/api/notes');
      expect(await empty.json()).toEqual({ version: 1, notes: [] });
      expect(fs.existsSync(path.join(project.baseDir, 'mocklens.notes.json'))).toBe(false);

      const invalid = await jsonRequest(origin, '/api/notes', {
        method: 'POST',
        body: JSON.stringify(notePayload('missing', '#target', 'Invalid')),
      });
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toEqual({ error: 'unknown screen: missing' });

      const betaResponse = await jsonRequest(origin, '/api/notes', {
        method: 'POST',
        body: JSON.stringify(notePayload('states/beta.iphone-14', '#beta-target', 'Beta feedback', { tag: 'article', text: 'Beta target' })),
      });
      const beta = (await betaResponse.json()) as { id: string };
      expect(betaResponse.status).toBe(201);
      const alphaResponse = await jsonRequest(origin, '/api/notes', {
        method: 'POST',
        body: JSON.stringify(notePayload('alpha.iphone-14', '#save', 'Alpha feedback')),
      });
      const alpha = (await alphaResponse.json()) as { id: string };

      const resolved = await jsonRequest(origin, `/api/notes/${encodeURIComponent(alpha.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'resolved', message: 'Alpha updated' }),
      });
      expect(await resolved.json()).toMatchObject({ status: 'resolved', message: 'Alpha updated' });

      const markdown = await jsonRequest(origin, '/api/notes/markdown', {
        method: 'POST',
        body: JSON.stringify({ ids: [alpha.id, beta.id] }),
      });
      const text = await markdown.text();
      expect(markdown.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
      expect(text.indexOf('[OPEN] states/beta.iphone-14')).toBeLessThan(
        text.indexOf('[RESOLVED] alpha.iphone-14'),
      );

      const beforeFailedBatch = fs.readFileSync(path.join(project.baseDir, 'mocklens.notes.json'), 'utf8');
      const failedBatch = await jsonRequest(origin, '/api/notes/batch', {
        method: 'POST',
        body: JSON.stringify({ ids: [beta.id, 'missing'], action: 'delete' }),
      });
      expect(failedBatch.status).toBe(404);
      expect(fs.readFileSync(path.join(project.baseDir, 'mocklens.notes.json'), 'utf8')).toBe(beforeFailedBatch);

      const batch = await jsonRequest(origin, '/api/notes/batch', {
        method: 'POST',
        body: JSON.stringify({ ids: [beta.id, alpha.id], action: 'resolve' }),
      });
      const batchLedger = (await batch.json()) as { notes: Array<{ status: string }> };
      expect(batchLedger.notes.every((note) => note.status === 'resolved')).toBe(true);

      expect((await jsonRequest(origin, `/api/notes/${encodeURIComponent(beta.id)}`, { method: 'DELETE' })).status).toBe(204);
      const remaining = (await (await jsonRequest(origin, '/api/notes')).json()) as { notes: Array<{ id: string }> };
      expect(remaining.notes.map((note) => note.id)).toEqual([alpha.id]);

      fs.writeFileSync(path.join(project.baseDir, 'mocklens.notes.json'), '{bad json', 'utf8');
      const malformed = await jsonRequest(origin, '/api/notes');
      expect(malformed.status).toBe(500);
      expect((await malformed.json()) as { error: string }).toMatchObject({
        error: expect.stringContaining('invalid JSON in notes file'),
      });
      expect(fs.readFileSync(path.join(project.baseDir, 'mocklens.notes.json'), 'utf8')).toBe('{bad json');
    } finally {
      await closeServer(server);
      fs.rmSync(project.baseDir, { recursive: true, force: true });
    }
  });

  it('picks semantic elements and drives the aggregated review queue', async () => {
    const project = viewerProject();
    const server = await startViewer(project.config, project.screens, 0);
    const origin = originOf(server);
    const browser = await chromium.launch({ headless: true });
    const pageErrors: string[] = [];
    try {
      await jsonRequest(origin, '/api/notes', {
        method: 'POST',
        body: JSON.stringify(notePayload('states/beta.iphone-14', '#beta-target', 'Beta feedback', { tag: 'article', text: 'Beta target' })),
      });
      const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
      const page = await context.newPage();
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await page.goto(origin, { waitUntil: 'load' });
      const mock = page.frameLocator('#frame');

      await mock.locator('#normal').click();
      expect(await mock.locator('body').getAttribute('data-clicked')).toBe('yes');

      await page.locator('#annotate').click();
      expect(await page.locator('#annotate').getAttribute('aria-pressed')).toBe('true');
      await mock.locator('#save-label').hover();
      await mock.locator('.mocklens-review-box:not(.focus):not([hidden])').waitFor();
      await mock.locator('#save-label').click();
      await page.locator('#note-composer').waitFor({ state: 'visible' });
      expect(await page.locator('#composer-target').textContent()).toContain('button');
      await page.locator('#composer-message').fill('Alpha feedback');
      await page.locator('#composer-save').click();
      await page.locator('.note-card').filter({ hasText: 'Alpha feedback' }).waitFor();

      expect(await page.locator('.note-card input:checked').count()).toBe(1);
      expect(await page.locator('.note-card input:checked').locator('..').textContent()).toContain('Alpha feedback');
      expect(await page.locator('.screen-group').allTextContents()).toEqual([
        'alpha.iphone-14',
        'states/beta.iphone-14',
      ]);
      const stored = JSON.parse(
        fs.readFileSync(path.join(project.baseDir, 'mocklens.notes.json'), 'utf8'),
      ) as { notes: Array<{ message: string; selector: string }> };
      expect(stored.notes.find((note) => note.message === 'Alpha feedback')?.selector).toBe('#save');

      const alphaCard = page.locator('.note-card').filter({ hasText: 'Alpha feedback' });
      await alphaCard.getByRole('button', { name: 'Edit' }).click();
      await page.locator('#composer-message').fill('Alpha feedback updated');
      await page.locator('#composer-save').click();
      await page.locator('.note-card').filter({ hasText: 'Alpha feedback updated' }).waitFor();

      const betaCard = page.locator('.note-card').filter({ hasText: 'Beta feedback' });
      await page.locator('#annotate').click();
      expect(await page.locator('#annotate').getAttribute('aria-pressed')).toBe('false');
      await betaCard.locator('.note-content > p').first().click();
      await page.waitForFunction(() => decodeURIComponent(location.hash).includes('states/beta.iphone-14'));
      expect(await page.locator('#annotate').getAttribute('aria-pressed')).toBe('true');
      await mock.locator('.mocklens-review-box.focus:not([hidden])').waitFor();

      await alphaCard.locator('.note-content > p').first().click();
      await page.waitForFunction(() => decodeURIComponent(location.hash).includes('alpha.iphone-14'));
      const hashBeforeCheckbox = await page.evaluate(() => location.hash);
      await betaCard.locator('input[type="checkbox"]').check();
      expect(await page.evaluate(() => location.hash)).toBe(hashBeforeCheckbox);

      await page.locator('#select-all-open').click();
      await page.locator('#copy-selected').click();
      await page.locator('#toast').waitFor({ state: 'visible' });
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied).toContain('Alpha feedback updated');
      expect(copied).toContain('Beta feedback');

      await page.locator('#resolve-selected').click();
      await page.locator('#open-notes .note-card').first().waitFor({ state: 'detached' });
      expect(await page.locator('#resolved-summary').textContent()).toBe('Resolved (2)');
      await page.locator('#resolved-summary').click();
      const resolvedCheckboxes = page.locator('#resolved-notes input[type="checkbox"]');
      await resolvedCheckboxes.nth(0).check();
      await resolvedCheckboxes.nth(1).check();
      page.once('dialog', (dialog) => void dialog.accept());
      await page.locator('#delete-selected').click();
      await page.locator('#resolved-notes .note-card').first().waitFor({ state: 'detached' });

      await jsonRequest(origin, '/api/notes', {
        method: 'POST',
        body: JSON.stringify(notePayload('alpha.iphone-14', '#removed-target', 'Orphaned feedback')),
      });
      await page.reload({ waitUntil: 'load' });
      await page.locator('.note-card').filter({ hasText: 'Orphaned feedback' }).locator('.note-content > p').first().click();
      await page.locator('#notes-notice').waitFor({ state: 'visible' });
      expect(await page.locator('#notes-notice').textContent()).toContain('Target no longer found');
      expect(await page.locator('#annotate').getAttribute('aria-pressed')).toBe('true');

      expect(pageErrors).toEqual([]);
      await context.close();
    } finally {
      await browser.close();
      await closeServer(server);
      fs.rmSync(project.baseDir, { recursive: true, force: true });
    }
  }, 120_000);
});
