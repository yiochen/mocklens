# mocklens

A CLI tool for building **static mobile UI mockups** in plain HTML/CSS. Screens
are visual artifacts — like Figma frames, but inspectable code — and mocklens
closes the visual feedback loop for AI coding agents: it renders each screen at
real phone dimensions, takes deterministic screenshots, and validates the
rendered pages in a real browser for layout problems (above all: horizontal
overflow).

mocklens is a **mockup tool, not an app framework**. Mockups need no routing,
no application state, no backend, no build step. Plain HTML and CSS are
first-class and sufficient; everything renders offline from `file://`.

## Install & build

Requires Node ≥ 22.6 and Playwright's Chromium.

```sh
npm install
npm run build          # compiles src/ → dist/ (TypeScript, strict)

# only if Chromium is missing (it is verified by the first CLI run):
npx playwright install chromium
```

The CLI entry point is `dist/cli.js` (`node dist/cli.js …`). `npm link` puts a
`mocklens` binary on your PATH if you prefer.

## Quick start

Try it against the bundled example project (a recipe app, "GoodPlate"):

```sh
# 1. Browse the screens in the phone-sized viewer
node dist/cli.js serve --config example/mocklens.config.json
#    → open http://localhost:4173

# 2. Edit a screen, e.g. example/screens/home.html

# 3. Screenshots + validation in one run
node dist/cli.js check --config example/mocklens.config.json

# 4. Inspect: terminal report, example/.mocklens/report.json,
#    and example/.mocklens/screenshots/<device>/*.png

# 5. Fix whatever the report points at
# 6. Re-run check until it prints PASS (exit 0)
```

`--config` paths resolve **relative to the config file's location**, so the
commands above work from the repo root: screens come from `example/screens/`,
output lands in `example/.mocklens/`. Inside `example/` you can drop the flag —
`mocklens.config.json` is discovered from the cwd.

## Concepts

- **Screen** — one `.html` file = one screen or visual state (home, empty
  state, dialog open…). Discovered recursively under `screensDir`; the screen
  name is the relative path without `.html` (`home`, `states/empty`). Files and
  directories starting with `_` or `.` are skipped (partials, drafts).
- **Device** — a named viewport size from the config (`iphone-14 390×844`).
  Every command runs screen × device.
- **`screenshot`** — deterministic PNGs per screen × device at
  `deviceScaleFactor` 2, plus `manifest.json`.
- **`validate`** — loads each screen in headless Chromium and runs layout
  checks; writes `report.json`; fails (exit 1) on unsuppressed errors.
- **`check`** — `screenshot` + `validate` in one run; the usual iteration
  command.
- **`list`** — prints discovered screens and configured devices.
- **`serve`** — the local viewer: sidebar of screens, device picker, each
  screen in an `<iframe>` sized exactly to the device in a CSS phone bezel.
  State lives in the URL hash (`#home/iphone-14`), so views are shareable.

## CLI reference

```
mocklens list
mocklens screenshot [--full-page] [--screen <name>]... [--device <name>]...
mocklens validate   [--screen <name>]... [--device <name>]...
mocklens check      [--full-page] [--screen <name>]... [--device <name>]...
mocklens serve      [--port <n>]          # default 4173
mocklens --help
```

Global flags: `--config <path>` (default `./mocklens.config.json`),
`--screen`/`--device` (repeatable filters; unknown names are an error),
`--full-page` (also capture full-page PNGs), `--help`.

Exit codes:

| Code | Meaning |
| --- | --- |
| 0 | Success (`validate`/`check`: no unsuppressed error findings) |
| 1 | Validation found unsuppressed **error** findings |
| 2 | Usage error, malformed/missing config, missing screens dir, IO failures |

Expected errors print a single clear line (never a stack trace).

## Configuration

`mocklens.config.json` (all keys optional; shown with defaults):

```json
{
  "screensDir": "screens",
  "outDir": ".mocklens",
  "fullPage": false,
  "devices": [
    { "name": "iphone-se", "width": 375, "height": 667 },
    { "name": "iphone-14", "width": 390, "height": 844 },
    { "name": "pixel-7", "width": 412, "height": 915 }
  ],
  "allowedExternalHosts": []
}
```

- `screensDir` / `outDir`: relative paths resolve against the directory
  containing the config file (or the cwd when no config file exists).
- `fullPage`: when true, `screenshot`/`check` always capture `.full.png` too
  (the `--full-page` flag overrides per run).
- `devices`: non-empty list of `{ name, width, height }`.
- `allowedExternalHosts`: hostnames that may be requested without an
  `external-request` error (see below).

Malformed config (bad JSON, wrong shapes) exits 2 with a specific message.

## What `validate` checks

All checks run on the rendered page in headless Chromium (bounding boxes,
computed styles, scroll dimensions, network events) with a 1px tolerance.

| Finding | Severity | Triggers when | Typical fix |
| --- | --- | --- | --- |
| `document-overflow` | error | The document itself can scroll horizontally (`scrollWidth > innerWidth`, and root `overflow-x` isn't `hidden`/`clip`). Message names the likely offending elements. | Fix the listed elements; only clamp `overflow-x` at the root for purely decorative bleed. |
| `element-overflow-right` / `element-overflow-left` | error | A visible element's rect extends past the viewport edge. Only the outermost offender per direction is reported (descendants are deduped). | Fixed widths, `100vw` + padding, absolute positioning, missing `overflow` clipping. |
| `clipped-text` | warning | Element with `overflow: hidden/clip` whose text is cut off vertically, or horizontally under `white-space: nowrap/pre`. | More room, less text, or annotate intentional truncation. |
| `broken-image` | error | An `<img>` finished loading with `naturalWidth === 0`. Detail has the resolved src. | Fix the path; bundle the asset next to the screen. |
| `page-error` | error | Uncaught exceptions or console errors (resource-load noise is deduped against broken-image/external-request). | Fix or remove the failing script — mocks should render error-free. |
| `external-request` | error | Any `http(s)` request to a non-localhost host not in `allowedExternalHosts` — the *attempt* counts, even offline. | Bundle the resource locally; mocks must render offline. |
| `fixed-bottom-cover` | warning | A fixed/sticky bottom bar hides text-bearing content when scrolled to the very end. | Add `padding-bottom` ≥ the bar's height to the scroll container. |

## Intentional exceptions

Some overflow is deliberate: decorative blobs, blurred shapes, peeking carousel
items. Annotate the element (or any ancestor) with a reason:

```html
<div class="blob" data-mocklens-ignore="decorative background blob"></div>
```

The finding is still reported — marked `suppressed`, with your reason — but it
never affects the exit code. This applies to `element-overflow-*`,
`clipped-text`, and `fixed-bottom-cover`. It does **not** apply to
`document-overflow`, `broken-image`, `page-error`, or `external-request`.

Document-level scrolling is never suppressible on purpose: an annotation must
not be able to hide a genuinely sideways-scrolling page. The canonical pattern
for decorative bleed is to **clip at the root and annotate the element**:

```css
html, body { overflow-x: hidden; }
.blob { position: absolute; right: -90px; width: 240px; height: 240px; border-radius: 50%; }
```

With the root clamp, `document-overflow` stays silent while the (suppressed)
element finding documents the intentional bleed. See
`example/screens/home.html` for a peeking carousel and
`fixtures/screens/decorative-intentional.html` for the blob pattern.

Deliberate external resources (e.g. a font CDN you're mocking against) can be
allowed per host via `allowedExternalHosts` — prefer bundling locally.

## Reports

Terminal report — per screen × device, findings with offender and a fix hint,
suppressed findings listed with their reason, and a one-line verdict:

```
document-overflow (iphone-14 390×844)
  ERROR document-overflow — page scrolls horizontally — document is 516px wide in a 390px viewport — likely offenders: div.screen > div.wide-banner:nth-of-type(1)
    → Find and fix the elements wider than the viewport (fixed widths, 100vw plus padding, absolutely positioned elements). Only clamp overflow-x at the root when the overflow is purely decorative.
  ERROR element-overflow-right  div.screen > div.wide-banner:nth-of-type(1) — extends 126px past the right edge of a 390px viewport
    → Element extends 126px past the right edge of a 390px viewport — check fixed widths, vw units plus padding, or missing overflow clipping.

1 screens × 1 devices: 2 errors, 0 warnings, 0 suppressed — FAIL
```

`<outDir>/report.json` is the machine-readable form (2-space indent,
deterministic key order, no timestamps — diffs are stable within `version: 1`):

```
{ version: 1, tool: "mocklens", screens: ScreenReport[], summary }
ScreenReport = { name, device, viewport: {width,height}, ok, findings: Finding[],
                 counts: { error, warning, suppressed } }
Finding      = { type, severity: "error"|"warning", suppressed, message, suggestion,
                 element?: { selector, tag, id, classes, text, rect: {x,y,width,height} },
                 detail?: string }
summary      = { screens, errors, warnings, suppressed, ok }
```

Findings are sorted (type, then selector); rect/viewport numbers are rounded to
0.1px. `screenshots/manifest.json` lists every PNG:

```
{ version: 1, screenshots: [{ screen, device, viewport: {width,height}, fullPage, path }] }
```

with `path` relative to the screenshots dir (`iphone-14/home.png`,
`iphone-14/home.full.png`).

## Heuristics & known limitations

- **Bounding-box truth**: detection uses rendered boxes, not paint. Content
  that is visually clipped by an ancestor can still be flagged — annotate it.
- **Outermost-offender dedupe** reports the widest offending ancestor, which is
  usually but not always the exact culprit; treat the selector as a strong hint.
- **`fixed-bottom-cover`** only fires when the page actually scrolls
  (`scrollHeight > innerHeight + 50`) and a text-bearing element ends up >4px
  behind the bar at max scroll. Short pages and well-padded pages are silent.
- **`clipped-text`** is deliberately conservative: only elements with direct
  text or known text tags are candidates, so wrapper divs don't false-positive —
  at the cost of missing some deeply-nested clips.
- Generated **selectors** are compact CSS paths with `:nth-of-type` segments —
  verbose, stable enough to locate elements, but not a contractual API.
- **`file://` rendering**: no server features — no `fetch` of relative JSON, no
  service workers, no cookies. That's the point (offline mocks), and a limit.
- **Headless Chromium is the single source of truth**; other browsers may
  differ in scrollbars and sub-pixel rounding. The 1px tolerance absorbs most
  of it.
- **Full-page screenshots** render `position: fixed` elements at their original
  viewport spot (Playwright/Chromium behavior) — e.g. the detail screen's
  action bar appears mid-page in `detail.full.png`. Viewport PNGs are correct.
- Validation loads pages one at a time; expect ~0.5s per screen × device.

## Development

```
src/        the tool (types, config, screens, browser, screenshot, validate,
            report, viewer, cli — plain TypeScript, strict, ESM)
fixtures/   the test project: 14 screens, each demonstrating one finding,
            plus fixtures/mocklens.config.json
example/    the GoodPlate demo project (all screens pass)
tests/      vitest end-to-end suite driving the real CLI
```

```sh
npm test        # builds dist/ via a vitest globalSetup, then runs the suite
                # (~60s, 31 tests — real Chromium launches)
npm run build   # tsc
```

Fixture philosophy: one fixture per finding, minimal and readable, with a
header comment stating what it demonstrates and what it expects. To add one:
drop a screen in `fixtures/screens/`, add its name to `SCREENS` in
`tests/cli.test.ts`, and assert its expected findings (keep selector
assertions loose — `toContain('class-name')`).

## Design decisions & tradeoffs

- **Zero runtime dependencies except Playwright** — everything else is Node
  builtins (`node:http` for the viewer) and hand-rolled arg parsing.
- **Determinism over speed**: a fresh browser context per screen × device,
  pinned `deviceScaleFactor` (2 screenshots, 1 validation), sorted findings,
  rounded numbers, no timestamps in reports. Repeated runs diff cleanly.
- **`document-overflow` is never suppressible**: annotations exist to silence
  noise, not to hide a broken page; decorative bleed should be root-clipped.
- **`file://` instead of a local server** for screenshot/validate: simpler,
  hermetic, and forces mocks to be truly offline (external requests surface as
  findings instead of silently succeeding).
- **Checks read browser truth** (layout, computed style, network) rather than
  parsing CSS — heuristics, but grounded in what actually renders.

## License

MIT
