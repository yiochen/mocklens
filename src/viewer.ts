import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { Config } from './types.js';
import type { Screen } from './screens.js';
import {
  batchNotes,
  createNote,
  deleteNote,
  formatNotesMarkdown,
  loadNotes,
  NotesError,
  selectedIds,
  updateNote,
} from './notes.js';
import { runViewer } from './viewer-client.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
};

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Serve an exact asset from screensDir, or resolve a screen name to "<path>.html". */
function serveStatic(urlPath: string, root: string, res: http.ServerResponse): void {
  let rel: string;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('bad request');
    return;
  }
  const candidate = path.resolve(root, rel.replace(/^\/+/, ''));
  if (candidate !== root && !candidate.startsWith(root + path.sep)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }
  let file = candidate;
  if (!isFile(file) && isFile(`${file}.html`)) {
    file = `${file}.html`;
  }
  if (!isFile(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(file).pipe(res);
}

function indexHtml(config: Config, screens: Screen[]): string {
  const data = JSON.stringify({
    screens: screens.map((s) => s.name),
    devices: config.devices,
  }).replace(/</g, '\\u003c');
  const client = runViewer.toString().replace(/<\/script/gi, '<\\/script');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>mocklens viewer</title>
<style>
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: flex; height: 100vh; background: #ececf1; color: #202124; }
  button, select, textarea { font: inherit; }
  button { cursor: pointer; }
  .screens-panel { width: 230px; flex: none; background: #fff; border-right: 1px solid #ddd; padding: 16px; overflow-y: auto; }
  .screens-panel h1 { font-size: 15px; margin: 0 0 12px; }
  .screens-panel a { display: block; padding: 6px 8px; margin-bottom: 2px; border-radius: 6px; color: #333; text-decoration: none; font-size: 14px; }
  .screens-panel a.active { background: #e8efff; color: #1246b8; font-weight: 600; }
  main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .viewer-toolbar { display: flex; align-items: center; gap: 10px; padding: 10px 16px; background: #fff; border-bottom: 1px solid #ddd; font-size: 14px; }
  #size { color: #666; font-variant-numeric: tabular-nums; }
  #raw { margin-left: auto; color: #3157a6; }
  #annotate { border: 1px solid #c8ccd4; border-radius: 7px; padding: 6px 10px; background: #fff; color: #333; }
  #annotate.active { background: #e11d48; border-color: #e11d48; color: #fff; font-weight: 650; }
  #stage { flex: 1; display: flex; align-items: flex-start; justify-content: center; padding: 28px; overflow: hidden; }
  #scaler { flex: none; }
  #bezel { background: #141414; border-radius: 40px; padding: 14px; box-shadow: 0 10px 34px rgba(0,0,0,.28); transform-origin: 0 0; }
  iframe { display: block; border: 0; border-radius: 26px; background: #fff; }
  .notes-panel { position: relative; width: 360px; flex: none; display: flex; flex-direction: column; min-width: 0; background: #fff; border-left: 1px solid #d9dce2; }
  .notes-header { padding: 14px 14px 10px; border-bottom: 1px solid #e4e6eb; }
  .notes-title-row, .selection-tools, .composer-actions, .note-actions, #batch-bar { display: flex; align-items: center; gap: 8px; }
  .notes-title-row { justify-content: space-between; }
  .notes-title-row h2 { margin: 0; font-size: 16px; }
  #notes-count { color: #6a6f78; font-size: 12px; }
  .selection-tools { margin-top: 10px; }
  .selection-tools button, .quiet { border: 0; padding: 3px 0; background: transparent; color: #3157a6; font-size: 12px; }
  .selection-tools button + button { margin-left: 4px; }
  .selection-tools button:disabled, .quiet:disabled { color: #a3a7ae; cursor: default; }
  .notice { margin: 10px 14px 0; padding: 9px 10px; border-radius: 7px; font-size: 12px; }
  .notice.error { background: #fff1f2; color: #9f1239; }
  .notice.info { background: #eff6ff; color: #1d4ed8; }
  #note-composer { margin: 10px 14px 0; padding: 12px; border: 1px solid #b9c8ed; border-radius: 9px; background: #f8faff; }
  #note-composer h3 { margin: 0 0 5px; font-size: 14px; }
  #composer-target { margin: 0 0 9px; color: #656b75; font-size: 11px; line-height: 1.35; overflow-wrap: anywhere; }
  #composer-message { display: block; width: 100%; min-height: 92px; resize: vertical; border: 1px solid #b9bec8; border-radius: 6px; padding: 8px; background: #fff; color: #202124; }
  .composer-actions { justify-content: flex-end; margin-top: 8px; }
  .composer-actions button, #batch-bar button { border: 1px solid #c8ccd4; border-radius: 6px; padding: 6px 9px; background: #fff; }
  #composer-save { background: #2457c5; border-color: #2457c5; color: #fff; }
  .notes-scroll { flex: 1; overflow-y: auto; min-height: 0; padding: 6px 14px 78px; }
  .section-label { margin: 10px 0 6px; color: #6a6f78; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
  .screen-group { position: sticky; top: -6px; z-index: 1; margin: 10px -2px 5px; padding: 6px 2px 4px; background: rgba(255,255,255,.96); color: #4d525b; font-size: 12px; overflow-wrap: anywhere; }
  .note-card { display: grid; grid-template-columns: 20px minmax(0,1fr); gap: 7px; margin-bottom: 7px; padding: 9px; border: 1px solid #e0e3e8; border-radius: 8px; background: #fff; cursor: pointer; }
  .note-card:hover { border-color: #a8b7db; background: #fafbff; }
  .note-card.active { border-color: #e11d48; box-shadow: 0 0 0 2px rgba(225,29,72,.1); }
  .note-card input { margin: 2px 0 0; }
  .note-content { min-width: 0; }
  .note-content p { margin: 0; }
  .note-content > p:first-child { font-size: 13px; line-height: 1.35; white-space: pre-wrap; }
  .note-meta { margin-top: 5px !important; color: #737983; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .note-actions { margin-top: 7px; }
  .note-actions .danger-text { color: #b42318; }
  .empty-notes { margin: 12px 2px; color: #7b8089; font-size: 12px; }
  #resolved-details { margin-top: 14px; border-top: 1px solid #e4e6eb; padding-top: 10px; }
  #resolved-details summary { cursor: pointer; color: #5d626b; font-size: 12px; font-weight: 650; }
  #batch-bar { position: absolute; right: 14px; bottom: 12px; width: 332px; z-index: 4; padding: 10px; border: 1px solid #c5cad3; border-radius: 9px; background: #fff; box-shadow: 0 8px 24px rgba(25,30,40,.18); }
  #batch-count { margin-right: auto; font-size: 12px; font-weight: 650; }
  #batch-bar button { padding: 5px 7px; font-size: 11px; }
  #batch-bar button:disabled { color: #a3a7ae; background: #f5f5f5; cursor: default; }
  #delete-selected { color: #b42318; }
  dialog { width: min(560px, calc(100vw - 32px)); border: 0; border-radius: 10px; padding: 18px; box-shadow: 0 18px 60px rgba(0,0,0,.25); }
  dialog::backdrop { background: rgba(24,28,36,.5); }
  dialog h2 { margin: 0 0 10px; font-size: 16px; }
  #copy-preview { width: 100%; min-height: 260px; padding: 10px; font: 12px/1.45 ui-monospace, monospace; }
  #copy-dialog-close { float: right; margin-top: 10px; padding: 6px 10px; }
  #toast { position: fixed; z-index: 10; left: 50%; bottom: 24px; transform: translateX(-50%); padding: 9px 13px; border-radius: 999px; background: #202124; color: #fff; font-size: 12px; box-shadow: 0 6px 18px rgba(0,0,0,.2); }
  @media (max-width: 1100px) {
    .screens-panel { width: 190px; }
    .notes-panel { width: 320px; }
    #batch-bar { width: 292px; }
  }
</style>
</head>
<body>
<aside class="screens-panel"><h1>mocklens</h1><nav id="screens"></nav></aside>
<main>
  <header class="viewer-toolbar">
    <select id="device"></select>
    <span id="size"></span>
    <button id="annotate" type="button" aria-pressed="false">Annotate</button>
    <a id="raw" href="#" target="_blank" rel="noopener">open raw</a>
  </header>
  <div id="stage"><div id="scaler"><div id="bezel"><iframe id="frame" title="screen"></iframe></div></div></div>
</main>
<aside class="notes-panel">
  <div class="notes-header">
    <div class="notes-title-row"><h2>Review notes</h2><span id="notes-count">0 open</span></div>
    <div class="selection-tools">
      <button id="select-all-open" type="button">Select all open</button>
      <button id="clear-selection" type="button" disabled>Clear selection</button>
    </div>
  </div>
  <div id="notes-notice" class="notice error" hidden></div>
  <section id="note-composer" hidden>
    <h3 id="composer-title">Add note</h3>
    <p id="composer-target"></p>
    <textarea id="composer-message" maxlength="4000" placeholder="Describe the design change…" aria-label="Review note"></textarea>
    <div class="composer-actions">
      <button id="composer-cancel" type="button">Cancel</button>
      <button id="composer-save" type="button">Save note</button>
    </div>
  </section>
  <div class="notes-scroll">
    <p class="section-label">Open</p>
    <div id="open-notes"></div>
    <details id="resolved-details">
      <summary id="resolved-summary">Resolved (0)</summary>
      <div id="resolved-notes"></div>
    </details>
  </div>
  <div id="batch-bar" hidden>
    <span id="batch-count">0 selected</span>
    <button id="copy-selected" type="button">Copy</button>
    <button id="resolve-selected" type="button">Resolve</button>
    <button id="delete-selected" type="button">Delete</button>
  </div>
</aside>
<dialog id="copy-dialog">
  <h2>Copy selected review notes</h2>
  <textarea id="copy-preview" readonly></textarea>
  <button id="copy-dialog-close" type="button">Close</button>
</dialog>
<div id="toast" hidden></div>
<script>
(${client})(${data});
</script>
</body>
</html>
`;
}

function sendJson(res: http.ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(`${JSON.stringify(value)}\n`);
}

function readJsonBody(req: http.IncomingMessage, maxBytes = 64 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        if (!failed) reject(new NotesError(413, `request body must be at most ${maxBytes} bytes`));
        failed = true;
        return;
      }
      if (!failed) chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text === '' ? {} : JSON.parse(text));
      } catch (error) {
        reject(new NotesError(400, `invalid JSON request body: ${(error as Error).message}`));
      }
    });
    req.on('error', reject);
  });
}

async function serveNotesApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  config: Config,
  screens: Screen[],
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/notes')) return false;
  try {
    if (url.pathname === '/api/notes' && req.method === 'GET') {
      sendJson(res, 200, loadNotes(config));
      return true;
    }
    if (url.pathname === '/api/notes' && req.method === 'POST') {
      const note = createNote(config, screens, await readJsonBody(req));
      sendJson(res, 201, note);
      return true;
    }
    if (url.pathname === '/api/notes/batch' && req.method === 'POST') {
      sendJson(res, 200, batchNotes(config, await readJsonBody(req)));
      return true;
    }
    if (url.pathname === '/api/notes/markdown' && req.method === 'POST') {
      const ids = selectedIds(await readJsonBody(req));
      const markdown = formatNotesMarkdown(loadNotes(config), screens, ids);
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
      res.end(markdown);
      return true;
    }
    const match = /^\/api\/notes\/([^/]+)$/.exec(url.pathname);
    if (match !== null) {
      let id: string;
      try {
        id = decodeURIComponent(match[1]!);
      } catch {
        throw new NotesError(400, 'invalid note id');
      }
      if (req.method === 'PATCH') {
        sendJson(res, 200, updateNote(config, id, await readJsonBody(req)));
        return true;
      }
      if (req.method === 'DELETE') {
        deleteNote(config, id);
        res.writeHead(204);
        res.end();
        return true;
      }
    }
    sendJson(res, 405, { error: 'method not allowed' });
    return true;
  } catch (error) {
    if (error instanceof NotesError) {
      sendJson(res, error.statusCode, { error: error.message });
    } else {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }
}

/**
 * Start the viewer: an index page with sidebar + device picker rendering each
 * screen in a phone-sized iframe, plus a traversal-safe static file route.
 */
export function startViewer(config: Config, screens: Screen[], port: number): Promise<http.Server> {
  const root = path.resolve(config.screensDir);
  const server = http.createServer((req, res) => {
    void (async () => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (await serveNotesApi(req, res, url, config, screens)) return;
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(indexHtml(config, screens));
      return;
    }
    if (url.pathname.startsWith('/screens/')) {
      serveStatic(url.pathname.slice('/screens'.length), root, res);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
    })().catch((error: unknown) => {
      if (!res.headersSent) sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
      else res.destroy(error instanceof Error ? error : new Error(String(error)));
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, 'localhost', () => {
      const address = server.address();
      const boundPort = typeof address === 'object' && address !== null ? address.port : port;
      console.log(`mocklens viewer → http://localhost:${boundPort}`);
      resolve(server);
    });
  });
}
