---
name: mocklens-design
description: Design and iterate polished static UI mockups with the Mocklens CLI. Use when creating, redesigning, or reviewing product screens as plain HTML/CSS; turning a product brief into screen states; using mocklens init, new-screen, check, screenshots, or the local viewer; or preparing visually verified UI mockups for delivery.
---

# Mocklens design loop

Use this loop from the start and repeat the middle steps as needed:

**Frame → Inventory → Create → Compose → Sanity-check → Refine → Visually verify → Deliver**

The loop ends only when all delivery screens satisfy the brief, the final focused or full `mocklens check` passes, and the final screenshots have been visually inspected at every requested device. When `mocklens.ux.json` exists, every named UX requirement must also have concrete review evidence recorded with `mocklens checkpoint`. A passing check is necessary but not sufficient: it is a browser-rendered sanity check, not an aesthetic judgment.

## 1. Frame the design

Turn the request into a compact working brief before editing:

- Identify the users, primary jobs, content, required screens and visual states.
- Identify the primary device and any additional configured devices that must work.
- Define concrete completion criteria for information hierarchy, interactions represented, visual character, and content realism.
- List genuine product ambiguities. Make reversible design assumptions when they do not change scope; ask only when a choice materially changes the product.

For each distinct screen or state, plan one standalone HTML file. Represent loading, empty, error, confirmation, menu-open, or modal-open states as separate files when they matter. Do not build routing, persistence, a backend, or production application logic.

## 2. Inventory the workspace

Run commands from the project containing `mocklens.config.json` or pass `--config` explicitly.

```sh
mocklens init
mocklens list
```

`mocklens init` is idempotent. On a new workspace it creates only the complete config, shared stylesheet, screen directory, and screen README. On an initialized workspace it prints the effective config and changes nothing. Read its terminal output before deciding whether any config edit is needed.

Use `mocklens list` to understand existing screens and devices. Reuse the configured device names and shared design tokens. Inspect existing HTML/CSS only when it is needed to preserve or intentionally change the visual system.

If `mocklens.ux.json` exists beside the config, read its delivery goal, screen/device coverage, and named requirements before composing. Treat requirements as an evidence checklist, not an automated UX score.

## 3. Create the screen set atomically

Create all planned screens for the primary device in one command:

```sh
mocklens new-screen today add-expense monthly-summary --device iphone-14
```

The command validates the full batch before writing and prints the created paths, viewport, form factor, and a focused `check` command. Use lowercase kebab-case names; nested names such as `states/empty` are allowed. Keep the generated `mocklens:*` metadata aligned with the filename and configured device.

Create another device variant only when it represents intentionally different markup. A normal screen is checked against multiple viewports without duplicating its file.

## 4. Compose the mockups

Build the screens as static, screenshot-first HTML/CSS:

- Establish hierarchy with typography, spacing, grouping, contrast, and alignment before adding decoration.
- Use realistic labels, dates, amounts, categories, empty states, and status text. Avoid placeholder prose that obscures layout quality.
- Put shared tokens and reusable primitives in `shared.css`; keep genuinely screen-specific rules in the screen.
- Use local assets so rendering works offline. Do not depend on CDN fonts, remote images, or network data.
- Design controls as visible static states. Small scripts are acceptable only when necessary to render the intended state without errors; prefer separate state files.
- Reserve layout space for fixed or sticky navigation and actions. Add `data-mocklens-ignore="reason"` only for intentional, reviewed exceptions.

Work from the primary task and reading order outward: core content, key action, navigation, secondary information, then polish. Keep visual choices coherent across the screen set.

## 5. Run the browser sanity check

After a coherent edit, run the focused command printed by `new-screen`, for example:

```sh
mocklens check --screen today.iphone-14 --screen add-expense.iphone-14 --screen monthly-summary.iphone-14 --device iphone-14
```

Use a full `mocklens check` before delivery when the edits could affect shared styles or multiple devices.

Treat stdout as the complete agent-facing report. It states PASS or FAIL, full or filtered coverage, configured and checked combinations, requested filters, source and screenshot paths, rules checked, finding selectors and geometry, explanations, and suggestions. `report.json` is a durable artifact for other tooling; do not read it merely to recover information already printed by `check`.

The check covers document and element overflow, clipped text, broken images, page errors, external requests, and fixed/sticky overlays covering meaningful content. It explicitly does not judge composition, hierarchy, consistency, aesthetics, usability, or fidelity to the brief.

## 6. Refine from evidence

For each unsuppressed finding:

1. Locate the source path and selector from the report.
2. Use the element, covered-element, viewport, scroll, and overlap geometry to identify the smallest underlying layout cause.
3. Fix the layout rather than hiding document overflow or broadly suppressing findings.
4. Re-run the same focused `check` until it passes.

Warnings still deserve review even when they do not fail the command. If an exception is intentional, annotate the narrowest relevant element with a specific reason and confirm that the suppressed finding remains visible in output.

Once the focused run passes, check affected neighboring screens and devices when shared CSS, components, or responsive behavior changed.

## 7. Visually verify the final delivery

Visual verification is a final-delivery gate, not a rote next step after every command.

Open the final viewport screenshots printed by `mocklens check` and inspect every requested screen/device combination. Compare the set, not only individual screens. Verify:

- the primary task and action are immediately clear;
- hierarchy, spacing rhythm, alignment, typography, color, and density feel intentional;
- content is realistic and no state feels unfinished;
- shared components and navigation are consistent;
- fixed/sticky elements do not visually crowd content even when no rule fires;
- compact and large viewports remain balanced;
- the result matches the brief and looks presentation-ready.

If visual review exposes a problem, edit the source, re-run the relevant `mocklens check`, and inspect the regenerated screenshot. Repeat until the final screenshots are both visually satisfactory and sanity-check clean.

After review, record specific evidence. UX proof explains where a named requirement is demonstrated; visual proof covers the complete inspected screen/device batch:

```sh
mocklens checkpoint ux <requirement-id> --proof "<specific evidence>"
mocklens checkpoint visual --screen <name>... --device <name>... --proof "<specific evidence>"
```

Visual checkpointing requires current passing sanity results and viewport PNGs from `mocklens check`. If relevant HTML, imported CSS, requirement definitions, device dimensions, or screenshots change later, treat the associated proof as stale and review again.

## 8. Deliver

Report the completed screens, primary device, any important design decisions, the final check coverage and verdict, the screenshot paths, and recorded UX/visual checkpoints when requirements are present. Mention suppressed findings or known limitations explicitly. Do not claim completion while a requested screen/device remains unchecked, a final screenshot remains unreviewed, a named requirement lacks current evidence, or the brief is visibly unmet.
