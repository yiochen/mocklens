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

## Install

Requires Node >= 22.6. For one-off use from an existing project:

```sh
npx mocklens init
npx mocklens check

# if Chromium is missing:
npm exec playwright install chromium
```

Or add it as a dev dependency and call it from package scripts:

```sh
npm install --save-dev mocklens
npm exec mocklens -- init
npm exec mocklens -- check
npm exec playwright install chromium
```

`mocklens` depends on the Playwright package, but browser binaries are installed
separately. In CI, install Chromium before running screenshot, validate, or
check commands:

```sh
npm ci
npm exec playwright install --with-deps chromium
npm exec mocklens -- check
```

## Quick start

Initialize a mock workspace inside an existing project:

```sh
npx mocklens init              # writes mocklens.config.json and screens/
npx mocklens new-screen settings --device iphone-14
npx mocklens list              # confirms created screens and devices
npx mocklens check             # screenshots + validation
```

Use `mocklens init --dir mocks/mobile` if you want shared screen files under a
custom folder. `init` creates no HTML screens and is idempotent: when a valid
config already exists it prints the full effective config and changes nothing.
Pass `--force` to replace only init-owned config, CSS, and guidance files.

Try it against the bundled example project (a budgeting app, "Ledgerly"):

```sh
# 1. Browse the screens in the phone-sized viewer
npx mocklens serve --config example/mocklens.config.json
#    → open http://localhost:4173

# 2. Edit a screen, e.g. example/screens/today.iphone-14.html

# 3. Screenshots + validation in one run
npx mocklens check --config example/mocklens.config.json

# 4. Inspect: terminal report, example/.mocklens/report.json,
#    and example/.mocklens/screenshots/<device>/*.png

# 5. Review and record any missing UX or visual checkpoints
# 6. Re-run the full check until it prints DELIVERY READINESS — PASS (exit 0)
```

`--config` paths resolve **relative to the config file's location**, so the
commands above work from the repo root: screens come from `example/screens/`,
output lands in `example/.mocklens/`. Inside `example/` you can drop the flag —
`mocklens.config.json` is discovered from the cwd.

## Task-first design workflow

Use the project loop taught by [`skills/mocklens-design`](skills/mocklens-design):

**Intent → Model → Cover → Establish system → Compose → Stress → Check → Task-review → Visual-review → Deliver**

Start by identifying users, jobs, entities, relationships, mutable data, and
the complete create/view/edit/delete-or-archive/correction/confirmation/recovery
paths. Convert that reasoning into `mocklens.ux.json` before generating
screens. For each user-managed collection, either cover empty, one-item,
typical, dense, long-content, missing-optional, and nested/grouped states, or
record a concrete reason that a state is not applicable. Treat loading, error,
offline, permission, disabled, destructive confirmation, success, and recovery
the same way.

Establish shared tokens and components on one representative reference screen,
then design the hardest credible content state before polishing the typical
state. Above the fold, give space to task data and task entry points before
greetings, hero artwork, promotional copy, generic headlines, or decorative
summaries. Every large region should support a decision or advance a task.

Independent screen families can progress asynchronously. Keep one owner for
`shared.css`, assign all states of a family to one owner when possible, and
rejoin for cross-family task, action, consistency, and visual review. The
integration gate is always a full, unfiltered `mocklens check`.

The stopping condition is explicit: delivery is ready only when that full check
reports current sanity, UX proof, visual proof, and `DELIVERY READINESS — PASS`
for every required screen/device. A focused pass or attractive screenshot is
not sufficient.

## Concepts

- **Screen** — one `.html` file = one screen or visual state (home, empty
  state, dialog open…). Discovered recursively under `screensDir`; the screen
  name is the relative path without `.html` (`home`, `states/empty`). Files and
  directories starting with `_` or `.` are skipped (partials, drafts).
- **Screen variant** — generated files use `<screen>.<device>.html`, such as
  `settings.iphone-14.html`, so the target is visible without opening config.
  `mocklens:*` metadata in the document head records the form factor, primary
  device, target devices, and exact primary viewport.
- **Device** — a named viewport size from the config (`iphone-14 390×844`).
  Every command runs screen × device.
- **`screenshot`** — deterministic PNGs per screen × device at
  `deviceScaleFactor` 2, plus `manifest.json`.
- **`validate`** — loads each screen in headless Chromium and runs layout
  checks; writes `report.json`; fails (exit 1) on unsuppressed errors.
- **`check`** — `screenshot` + `validate` in one run; the usual iteration
  command.
- **UX requirement** — a named, source-controlled statement of evidence that
  must be demonstrated by one screen, a screen family, or a cross-screen flow.
- **Checkpoint** — specific review evidence tied to hashes of the requirement,
  relevant HTML/CSS, device dimensions, and (for visual review) the PNG. A
  checkpoint records review; it does not score or judge UX quality.
- **`list`** — prints discovered screens and configured devices.
- **`serve`** — the local viewer: sidebar of screens, device picker, each
  screen in an `<iframe>` sized exactly to the device in a CSS phone bezel.
  State lives in the URL hash (`#home/iphone-14`), so views are shareable.

## CLI reference

```
mocklens init      [--dir <path>] [--force]
mocklens new-screen <name>... --device <name> [--form-factor <name>]
mocklens list
mocklens screenshot [--full-page] [--screen <name>]... [--device <name>]...
mocklens validate   [--screen <name>]... [--device <name>]...
mocklens check      [--full-page] [--screen <name>]... [--device <name>]...
mocklens checkpoint ux <requirement-id> --proof "<specific evidence>"
mocklens checkpoint visual --screen <name>... --device <name>... --proof "<specific evidence>"
mocklens serve      [--port <n>]          # default 4173
mocklens --help
```

Global flags: `--config <path>` (default `./mocklens.config.json`),
`--screen`/`--device` (repeatable filters; unknown names are an error),
`--full-page` (also capture full-page PNGs), `--help`.

`init` also accepts `--dir <path>` for the generated screen folder (default
`screens`) and `--force` to replace existing scaffold files. With `--config`,
`init` writes the config at that path and resolves `--dir` relative to the
config file's directory.

`new-screen` creates one or more `<name>.<device>.html` files and never
overwrites an existing file. A batch is atomic: every name, device, shared
stylesheet, duplicate, and destination is validated before any file is written.
The device must be present in `mocklens.config.json`. It generates neutral blank
scaffolds for agents to design freely. `--form-factor` defaults to `phone`.
Names, devices, and form factors use lowercase kebab-case, and names may contain
nested path segments:

```sh
mocklens new-screen settings --device iphone-14
mocklens new-screen today add-expense monthly-summary --device iphone-14
```

Generated heads include metadata that both humans and agents can inspect:

```html
<meta name="mocklens:form-factor" content="phone">
<meta name="mocklens:primary-device" content="iphone-14">
<meta name="mocklens:target-devices" content="iphone-14">
<meta name="mocklens:viewport" content="390x844">
```

`list`, `screenshot`, `validate`, and `check` reject metadata that refers to an
unknown configured device and explain whether to update the config or the HTML.

Exit codes:

| Code | Meaning |
| --- | --- |
| 0 | Requested sanity checks pass and, for `check` with UX tracking, all requested proof is current |
| 1 | Unsuppressed sanity errors or required UX/visual proof is missing or stale |
| 2 | Usage error, malformed configuration/manifest/ledger, unknown target, or IO failure |

Expected errors print a single clear line (never a stack trace).

## Configuration

Run `mocklens init` to generate this complete config plus `shared.css` and
agent-facing notes. It deliberately creates zero HTML screens. Use
`new-screen` for every screen so filenames, `mocklens:*` metadata, and device
settings stay aligned.

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

## UX requirements and checkpoints

Projects may define `mocklens.ux.json` beside `mocklens.config.json`. The file
is optional: when it is absent, every existing Mocklens command behaves as it
did before. `mocklens init` deliberately remains config-only and never creates
UX requirements. Both the UX manifest and the resulting
`mocklens.checkpoints.json` ledger are intended for source control and PR
review.

The version 1 schema is:

```json
{
  "version": 1,
  "goal": "Help a budget owner record spending and correct mistakes quickly.",
  "delivery": {
    "screens": ["today", "add-expense", "states/empty"],
    "devices": ["iphone-14", "pixel-7"]
  },
  "requirements": [
    {
      "id": "discoverable-expense-actions",
      "kind": "screen",
      "description": "Daily spending exposes create, edit, and delete entry points.",
      "screens": ["today"]
    },
    {
      "id": "empty-to-created-flow",
      "kind": "flow",
      "description": "The empty state starts expense creation and the form supports correction.",
      "screens": ["states/empty", "add-expense"]
    },
    {
      "id": "task-first-hierarchy",
      "kind": "screen-family",
      "description": "Primary spending data and actions precede low-value decoration.",
      "screens": ["today", "add-expense"]
    }
  ]
}
```

Requirement IDs use stable lowercase kebab-case. `kind` is `screen`,
`screen-family`, or `flow`. Delivery screens, requirement screens, and delivery
devices must exist. Mocklens rejects malformed JSON, duplicate IDs, unsafe
paths, and unknown screens/devices before touching checkpoint state.
Use the exact name from `mocklens list`: generated variants include their
device suffix (for example `today.iphone-14`). Confirm `mocklens --help` lists
both checkpoint commands before relying on readiness enforcement; older
sanity-only releases cannot evaluate the manifest.

After reviewing a requirement, record concrete evidence rather than a verdict:

When an interaction cannot be understood from a static render, add a
plain-language `data-mocklens-action` attribute to the actionable element. Name
the trigger and result, plus the accessible non-gesture path for gestures such
as swipe, long press, double tap, or drag. There is no required grammar: the
attribute documents intent. Checkpoint proof should quote or paraphrase that
behavior and name the screens that demonstrate material outcomes.

```sh
mocklens checkpoint ux discoverable-expense-actions \
  --proof "Expense rows declare that tap opens editing, swipe left reveals Delete, and long press opens the actions menu; the menu, confirmation, and deleted screens demonstrate removal and Undo."
```

The command adds or replaces that requirement in
`mocklens.checkpoints.json`, prints the affected screens, and suggests a focused
`mocklens check`. For visual review, first run a successful focused check and
inspect every resulting viewport PNG, then record the complete screen/device
batch:

```sh
mocklens check --screen today --screen add-expense --device iphone-14
mocklens checkpoint visual \
  --screen today --screen add-expense \
  --device iphone-14 \
  --proof "Both viewport PNGs keep task data and controls first, with consistent compact spacing."
```

Visual checkpointing is all-or-nothing. Every requested combination must have
a current successful sanity result and current viewport screenshot; one
missing, stale, or failing target refuses the entire batch.

The ledger is deterministic, human-readable JSON: stable key order, two-space
formatting, POSIX-relative paths, and no timestamps. SHA-256 inputs include the
screen HTML, recursively linked local stylesheets (including CSS `@import`),
the applicable device names/dimensions, and the canonical requirement. Visual
proof also records the viewport PNG hash. Consequently, relevant HTML, shared
CSS, requirement, device, or screenshot changes make proof stale while an
unrelated screen edit and an identical regenerated screenshot do not. Stale
reasons identify inputs such as `screens/shared.css changed`.

Recover from stale proof by re-running the focused check named in the report,
inspecting the current referenced screens or PNGs together, and replacing the
checkpoint with new concrete evidence. Do not mechanically replay old proof:
staleness means the reviewed artifact changed. Editing an unrelated screen
does not require lockstep re-review of independent families.

When a UX manifest is present, `mocklens check` enforces current UX and visual
proof in addition to mechanical sanity. A full check covers every delivery
screen, delivery device, requirement, and required screen/device visual pair;
only that unfiltered run can print project-level `DELIVERY READINESS — PASS`.
A filtered check evaluates intersecting requirements and selected delivery
screen/device pairs, prints `UX proof scope: FILTERED`, and explicitly says that
project delivery readiness was not evaluated.

Missing work includes the requirement kind, description, targets, and exact
`mocklens checkpoint` command to run after review. Stale work includes recorded
and current hashes, actionable causes, and replacement guidance. Mocklens
verifies evidence presence and freshness; it never claims to judge the truth or
quality of a subjective UX assertion. `validate` remains sanity-only, and a
project without `mocklens.ux.json` retains the existing sanity-only `check`
output and exit behavior.

Checkpoint writes take an exclusive bounded lock, reload the latest ledger,
write a temporary file, and atomically rename it. Parallel agents can therefore
record independent evidence without silently losing one another's entries.

## Agent design-loop skill

The repo includes [`skills/mocklens-design`](skills/mocklens-design), a reusable
skill that teaches the complete task-first, stress-first Mocklens loop:

**Intent → Model → Cover → Establish system → Compose → Stress → Check → Task-review → Visual-review → Deliver**

It requires complete action and state coverage, concrete UX evidence, visual
inspection of the complete requested set, and a full delivery-readiness pass.

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
| `fixed-bottom-cover` | error | A fixed/sticky bottom bar covers meaningful content at maximum scroll or on a short page. | Reserve bottom space at least equal to the bar height. |
| `fixed-overlay-cover` | error/warning | A fixed/sticky overlay covers meaningful text, amounts, controls, or images. Permanently inaccessible content is an error; initially crowded but scroll-reachable content is a warning. | Move/resize the overlay or reserve layout space. |

## Intentional exceptions

Some overflow is deliberate: decorative blobs, blurred shapes, peeking carousel
items. Annotate the element (or any ancestor) with a reason:

```html
<div class="blob" data-mocklens-ignore="decorative background blob"></div>
```

The finding is still reported — marked `suppressed`, with your reason — but it
never affects the exit code. This applies to `element-overflow-*`,
`clipped-text`, `fixed-bottom-cover`, and `fixed-overlay-cover`. It does **not** apply to
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
`fixtures/screens/carousel-peek.html` for a peeking carousel and
`fixtures/screens/decorative-intentional.html` for the blob pattern.

Deliberate external resources (e.g. a font CDN you're mocking against) can be
allowed per host via `allowedExternalHosts` — prefer bundling locally.

## Reports

Terminal output from `check` is the complete agent-facing delivery report. It
includes PASS/FAIL, FULL/FILTERED coverage, unique screen/device/combination
counts, requested filters, every rule checked, source and screenshot paths,
findings with both overlay and victim geometry where relevant, suggestions,
and the scope disclaimer. Agents do not need to read `report.json` to recover
information omitted from stdout.

```
MOCKLENS SANITY CHECK — FAIL
Coverage: FILTERED
Rules checked (9): document-overflow, element-overflow-left, element-overflow-right, clipped-text, broken-image, page-error, external-request, fixed-bottom-cover, fixed-overlay-cover

document-overflow (iphone-14 390×844)
  source: screens/document-overflow.html
  screenshot: .mocklens/screenshots/iphone-14/document-overflow.png
  ERROR document-overflow — page scrolls horizontally — document is 516px wide in a 390px viewport — likely offenders: div.screen > div.wide-banner:nth-of-type(1)
    → Find and fix the elements wider than the viewport (fixed widths, 100vw plus padding, absolutely positioned elements). Only clamp overflow-x at the root when the overflow is purely decorative.
  ERROR element-overflow-right  div.screen > div.wide-banner:nth-of-type(1) — extends 126px past the right edge of a 390px viewport
    → Element extends 126px past the right edge of a 390px viewport — check fixed widths, vw units plus padding, or missing overflow clipping.

SANITY CHECK FAIL: 1 unique screens × 1 devices = 1 combinations; 2 errors, 0 warnings, 0 suppressed.
```

With UX tracking, the terminal then renders separate verdicts and the actual
next unmet gates:

```
MOCKLENS SANITY CHECK — PASS
UX PROOF — FAIL
VISUAL PROOF — FAIL
DELIVERY READINESS — FAIL
```

When no gates remain, a full check prints:

```
DELIVERY READINESS — PASS
All required delivery screens and devices have current sanity, UX, and visual proof.
```

`<outDir>/report.json` is the machine-readable form (2-space indent,
deterministic key order, no timestamps — diffs are stable within `version: 3`):

```
{ version: 3, tool: "mocklens", scope, screens: ScreenReport[], readiness, summary }
scope        = { command, coverage, config, requested, configured, covered }
ScreenReport = { name, source, screenshot, device, viewport: {width,height}, ok, findings: Finding[],
                 counts: { error, warning, suppressed } }
Finding      = { type, severity: "error"|"warning", suppressed, message, suggestion,
                 element?: { selector, tag, id, classes, text, rect: {x,y,width,height} },
                 coveredElement?: ElementInfo, overlap?: {width,height,area,scrollX,scrollY},
                 detail?: string }
summary      = { uniqueScreens, devices, combinations, errors, warnings, suppressed, ok }
readiness    = { evaluated, uxTrackingConfigured, proofScope, coverage, counts, requirements,
                 visual, remainingProject, sanityOk, uxProofOk, visualProofOk, ready }
```

Each readiness requirement records its ID, kind, description, status, proof,
recorded/current input hashes, screen/device targets, and stale reasons. Each
visual entry records the required screen/device pair, the same proof and hash
state, and recorded/current screenshot hashes. Terminal and JSON are built from
the same readiness object, so their counts and verdicts agree.

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
- **Overlay coverage** uses computed positioning, visibility, semantic content,
  overlap geometry, and browser hit-testing at initial and maximum scroll.
  Dialogs, hidden/transient elements, decorative fixed elements, and correctly
  padded bottom bars are ignored. Short pages are checked too.
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
fixtures/   the main test project plus focused overlay-coverage fixtures
fixture_results/ checked-in CLI transcripts generated from named fixture tests
example/    the Ledgerly budgeting dogfood project (all readiness gates pass)
tests/      vitest end-to-end suite driving the real CLI
skills/     the repo-local Mocklens design-loop skill
```

```sh
npm install
npm run build   # compiles src/ to dist/ (TypeScript, strict)
npm test        # builds dist/ via a vitest globalSetup, then runs the suite
                # (~60s, 31 tests — real Chromium launches)
npm pack --dry-run
```

`npm pack` runs `npm run build` first through the `prepack` lifecycle. The
published package intentionally contains the compiled `dist/` files plus
package metadata, README, and license; fixtures, tests, examples, and source
files stay out of the tarball.

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
