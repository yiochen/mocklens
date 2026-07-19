import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { Config } from './types.js';
import type { Screen } from './screens.js';

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

/** Serve a file from screensDir. Extensionless paths try "<path>.html". */
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
  if (!isFile(file) && path.extname(file) === '') {
    file += '.html';
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
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>mocklens viewer</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: flex; height: 100vh; background: #ececf1; color: #222; }
  aside { width: 230px; flex: none; background: #fff; border-right: 1px solid #ddd; padding: 16px; overflow-y: auto; }
  aside h1 { font-size: 15px; margin: 0 0 12px; }
  aside a { display: block; padding: 6px 8px; margin-bottom: 2px; border-radius: 6px; color: #333; text-decoration: none; font-size: 14px; }
  aside a.active { background: #e8efff; color: #1246b8; font-weight: 600; }
  main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  header { display: flex; align-items: center; gap: 12px; padding: 10px 16px; background: #fff; border-bottom: 1px solid #ddd; font-size: 14px; }
  #size { color: #666; font-variant-numeric: tabular-nums; }
  #raw { margin-left: auto; }
  #stage { flex: 1; display: flex; align-items: flex-start; justify-content: center; padding: 28px; overflow: hidden; }
  /* The bezel renders at true device px and is visually scaled down via
     transform to fit the available space; #scaler reserves the scaled size
     so the layout never scrolls. */
  #scaler { flex: none; }
  #bezel { background: #141414; border-radius: 40px; padding: 14px; box-shadow: 0 10px 34px rgba(0,0,0,.28); transform-origin: 0 0; }
  iframe { display: block; border: 0; border-radius: 26px; background: #fff; }
</style>
</head>
<body>
<aside><h1>mocklens</h1><nav id="screens"></nav></aside>
<main>
  <header>
    <select id="device"></select>
    <span id="size"></span>
    <a id="raw" href="#" target="_blank" rel="noopener">open raw</a>
  </header>
  <div id="stage"><div id="scaler"><div id="bezel"><iframe id="frame" title="screen"></iframe></div></div></div>
</main>
<script>
var DATA = ${data};
var screens = DATA.screens;
var devices = DATA.devices;
var nav = document.getElementById('screens');
var frame = document.getElementById('frame');
var sizeLabel = document.getElementById('size');
var rawLink = document.getElementById('raw');
var deviceSel = document.getElementById('device');
var stage = document.getElementById('stage');
var scaler = document.getElementById('scaler');
var bezel = document.getElementById('bezel');
var STAGE_PAD = 28;  // matches #stage padding in the CSS above
var BEZEL_PAD = 14;  // matches #bezel padding in the CSS above
var devW = 0, devH = 0;  // current device size in real px

/* Scale the bezel down (never up) so the whole phone fits without scrolling.
   The iframe keeps its true device-pixel size; only the visual box shrinks. */
function fit() {
  if (!devW || !devH) return;
  var bezelW = devW + BEZEL_PAD * 2;
  var bezelH = devH + BEZEL_PAD * 2;
  /* Size the bezel explicitly (border-box, so the iframe's devW×devH content
     box fits exactly inside) — never let it derive from the scaled #scaler,
     or the iframe spills out of the bezel. */
  bezel.style.width = bezelW + 'px';
  bezel.style.height = bezelH + 'px';
  var availW = stage.clientWidth - STAGE_PAD * 2;
  var availH = stage.clientHeight - STAGE_PAD * 2;
  var s = Math.min(availW / bezelW, availH / bezelH, 1);
  if (!(s > 0)) s = 1;
  bezel.style.transform = s === 1 ? '' : 'scale(' + s + ')';
  scaler.style.width = Math.round(bezelW * s) + 'px';
  scaler.style.height = Math.round(bezelH * s) + 'px';
  sizeLabel.textContent = devW + ' \\u00d7 ' + devH + (s < 0.995 ? ' \\u00b7 ' + Math.round(s * 100) + '%' : '');
}

devices.forEach(function (d) {
  var o = document.createElement('option');
  o.value = d.name;
  o.textContent = d.name + ' (' + d.width + '\\u00d7' + d.height + ')';
  deviceSel.appendChild(o);
});

if (screens.length === 0) {
  nav.textContent = 'no screens found';
}
screens.forEach(function (name) {
  var a = document.createElement('a');
  a.textContent = name;
  a.setAttribute('data-screen', name);
  nav.appendChild(a);
});

function hashFor(screen, device) {
  return '#' + encodeURIComponent(screen) + '/' + encodeURIComponent(device);
}

function encPath(name) {
  return name.split('/').map(encodeURIComponent).join('/');
}

function current() {
  var screen = screens[0] || '';
  var device = devices.length ? devices[0].name : '';
  var raw = location.hash.slice(1);
  if (raw) {
    var i = raw.lastIndexOf('/');
    var s = raw, d = '';
    if (i >= 0) { s = raw.slice(0, i); d = raw.slice(i + 1); }
    try { s = decodeURIComponent(s); d = decodeURIComponent(d); } catch (e) {}
    if (screens.indexOf(s) >= 0) screen = s;
    for (var k = 0; k < devices.length; k++) {
      if (devices[k].name === d) device = d;
    }
  }
  return { screen: screen, device: device };
}

function render() {
  var c = current();
  var d = devices[0];
  for (var k = 0; k < devices.length; k++) {
    if (devices[k].name === c.device) d = devices[k];
  }
  if (!c.screen || !d) return;
  frame.src = '/screens/' + encPath(c.screen);
  frame.style.width = d.width + 'px';
  frame.style.height = d.height + 'px';
  devW = d.width;
  devH = d.height;
  fit();
  rawLink.href = '/screens/' + encPath(c.screen);
  deviceSel.value = d.name;
  var links = nav.querySelectorAll('a');
  for (var i = 0; i < links.length; i++) {
    var a = links[i];
    var name = a.getAttribute('data-screen');
    a.className = name === c.screen ? 'active' : '';
    a.href = hashFor(name, d.name);
  }
  if (location.hash !== hashFor(c.screen, d.name)) {
    history.replaceState(null, '', hashFor(c.screen, d.name));
  }
}

deviceSel.addEventListener('change', function () {
  var c = current();
  location.hash = hashFor(c.screen, deviceSel.value);
});
window.addEventListener('hashchange', render);
window.addEventListener('resize', fit);
render();
</script>
</body>
</html>
`;
}

/**
 * Start the viewer: an index page with sidebar + device picker rendering each
 * screen in a phone-sized iframe, plus a traversal-safe static file route.
 */
export function startViewer(config: Config, screens: Screen[], port: number): Promise<http.Server> {
  const root = path.resolve(config.screensDir);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
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
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, 'localhost', () => {
      console.log(`mocklens viewer → http://localhost:${port}`);
      resolve(server);
    });
  });
}
