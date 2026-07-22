---
name: mocklens-design
description: Design, redesign, stress-test, and review task-complete static product mockups with the Mocklens CLI. Use when turning a product brief into plain HTML/CSS screen families and edge states; defining interaction hierarchy and stable navigation shells; creating a mocklens.ux.json manifest; using mocklens init, new-screen, check, screenshots, or checkpoints; coordinating parallel mockup work; or preparing UX- and visually-verified screens for delivery.
---

# Mocklens task-first design loop

Use this loop from the start:

**Intent → Model → Cover → Establish system → Compose → Stress → Check → Task-review → Visual-review → Deliver**

Define the stages before doing them:

- **Intent** identifies the users, jobs, decisions, devices, and genuine product ambiguities.
- **Model** maps entities, relationships, mutations, domain rules, action priority, and complete task paths.
- **Cover** converts that model into screen families, states, and source-controlled UX requirements.
- **Establish system** uses one representative screen to lock shared tokens, shell behavior, interaction hierarchy, components, and density.
- **Compose** makes task data and task entry points visible before decoration.
- **Stress** designs the hardest credible content and state combinations before polishing the ideal state.
- **Check** renders screens and fixes browser-detectable failures.
- **Task-review** inspects each UX requirement across its referenced screens and records concrete evidence.
- **Visual-review** compares the complete requested screen/device set and records current screenshot evidence.
- **Deliver** reports the artifacts and readiness result only after every gate passes.

The stopping condition is strict: a design is ready only when a full, unfiltered `mocklens check` reports current sanity, UX proof, visual proof, and `DELIVERY READINESS — PASS` for every required screen/device. A focused check, attractive screenshot, or sanity pass alone is not completion.

## 1. Intent

Write a compact working brief before generating screens. Identify:

- primary users and jobs;
- decisions the UI must support;
- primary and additional configured devices;
- required visual character and realistic content;
- genuine ambiguities that materially affect the product.

Make reversible assumptions when they do not change scope. Ask only when a choice materially changes the product.

## 2. Model

Map the core entities and their relationships. Mark every mutable entity and trace all applicable create, view, edit, delete or archive, correction, confirmation, and recovery paths. A static mock needs no persistence, but it must visibly represent how a user starts each task, changes a decision, handles failure, and corrects a mistake.

Define the semantic contract before inventing stress data: field meaning, valid
ranges, sign conventions, units, allowed transaction types, and relationships.
Keep normal-state stress data valid for that contract. Put invalid data only in
an explicitly named validation or error state.

Build a variant-operation matrix for every normal entity type or subtype shown
in the interface. Check whether each can be created, viewed, edited, corrected,
and removed through the modeled paths. A list must not display a normal variant
that its forms cannot capture or correct. If a variant is imported, computed,
or read-only, state that constraint visibly and provide the applicable
correction path. Re-check form labels, validation, controls, and helper copy
against this matrix; do not let a generic form silently contradict the data
model.

Define every derived value and invariant: totals, balances, remaining amounts,
percentages, counts, status labels, and signed aggregation. Recalculate them
from the displayed source values with a reliable tool. Never use plausible but
unreconciled summary numbers, especially in financial, health, or operational
interfaces.

Classify each action by frequency, importance, risk, reversibility, and context.
Decide whether it belongs as the screen primary action, the row's primary
behavior, a detail action, an overflow-menu action, a gesture shortcut, or the
final destructive confirmation.

Do not build routing, backend services, production state management, or application logic. Use independent HTML files for screens and visual states.

## 3. Cover

Run commands from the directory containing `mocklens.config.json`, or pass `--config` explicitly:

```sh
mocklens init
mocklens list
mocklens --help
```

Confirm the help output includes both `checkpoint ux` and `checkpoint visual`.
If it does not, use the current project CLI or upgrade Mocklens before relying
on readiness gates; an older sanity-only CLI cannot enforce this loop.

For every user-managed collection, explicitly classify each state as required or not applicable, with a product-specific reason:

- empty;
- one item;
- typical;
- dense or longer than one viewport;
- long user-provided content;
- missing optional content;
- nested, grouped, or multiple sub-items when the model supports them.

Also decide whether the flow needs loading, error, offline, permission, disabled, validation, destructive confirmation, success, and recovery states. “When it matters” is not a decision: require the state or record why it is not applicable.

Create `mocklens.ux.json` from this reasoning before screens. Put every delivery screen/device and every reviewable task, action, correction path, stress state, and value-hierarchy claim into a named requirement. Treat the manifest as an evidence contract, not an automated UX score.

Phrase evidence requirements so a static viewport can actually prove them. If
a requirement claims an exact visible item count or complete set, ensure the
requested screenshot shows that set; otherwise require a clear scroll cue and
evidence of reachability rather than claiming everything is above the fold.

Require one canonical usable state for every primary task. Create a separate
file for a materially distinct or mutually exclusive state, such as a ready
form versus validation error. One screen may prove several compatible
conditions, but do not combine conditions that hide the normal completion path.
Preserve distinct task decisions and failure/recovery moments rather than
multiplying every data permutation mechanically.

Batch-create the planned screens for the primary device:

```sh
mocklens new-screen today add-expense monthly-summary states/empty states/dense --device iphone-14
```

The batch validates atomically. Use lowercase kebab-case paths and keep generated `mocklens:*` metadata aligned. Create device-specific variants only for intentionally different markup; ordinary screens can be checked at multiple viewports.
Use the exact names printed by `mocklens list` in the UX manifest and checkpoint
commands. Generated names include their suffix, such as `today.iphone-14`.

## 4. Establish the system

Choose one representative screen that contains primary data, navigation, and the primary action. Use it to establish shared tokens, components, responsive behavior, and density before expanding to other families. Put shared rules in `shared.css`; keep only genuinely local rules in each screen.

Write a shell contract before expanding. Fix the location and order of primary
navigation, selected-state treatment, header behavior, content start, safe-area
spacing, and rules for full-screen forms or dialogs. Empty, typical, dense, and
long states in the same family must not move primary navigation. Record and
justify any deliberate shell exception. Density may compact spacing, but it
must not silently remove recurring controls, labels, or decision-supporting
metrics that define the family.

Write an interaction contract for list rows and forms. Apply this hierarchy:

1. Use at most one filled primary action in a task region.
2. Let tapping the row or a clear row affordance open its primary view/edit task.
3. Put infrequent secondary actions in a detail view or trailing overflow menu.
4. Use swipe or long-press only as a shortcut with a discoverable accessible alternative.
5. Reveal destructive actions progressively; reserve strong destructive fill for the point-of-commit confirmation, not every repeated row.

Give each overlay, form, or task step one unambiguous dismissal path for its
context. Avoid redundant pairs such as close plus Cancel or Back plus Cancel
unless they have visibly different outcomes. In an overflow menu, keep
destructive options text-led and visually subordinate until confirmation.

Make tappable rows visibly tappable with consistent disclosure, selection, or
copy cues. An ambiguous icon is not enough. Apply the repetition test to quiet
overflow controls too; in very dense lists, prefer row navigation plus one
representative revealed-action state over 25 identical menu buttons.

For a static mock, prove a hidden path with a representative menu-open,
detail, or swipe-revealed state. Do not expose every action on every item merely
to make checkpoint evidence easy to write.

Use local assets so the mock works offline. Prefer separate files for visible states. Use small scripts only when necessary to render a static state without errors.

## 5. Compose with a value budget

For every large, persistent, repeated, or above-fold region, answer:

- Which user decision does this support?
- Which task does this advance?
- Why does it deserve this amount of space?
- What more useful content or action does it displace?

Put primary task data and the primary action before low-value decoration, especially on compact devices. Default against greetings, static hero artwork, motivational or promotional copy, generic headlines, oversized logos, and decorative summaries unless the brief gives them a concrete product purpose.

Apply the same budget to headers, navigation, toolbars, row chrome, badges, and
secondary actions. On the smallest device, compare how much of the first
viewport is chrome versus task data. Compact or remove repeated branding on
subscreens and dense task views when it displaces useful content.

Make every applicable entity action reachable through a discoverable,
accessible path. Match its persistent visibility to frequency and importance;
discoverable does not mean always visible.

Do not duplicate the same primary action within one viewport. Empty states need
one dominant next step; supporting illustration or copy must not repeat it as a
second competing CTA.

Make form mechanics recognizable: distinguish picker/select controls from text
entry, keep labels and formats explicit, and make CTA styling agree with state.
The canonical valid form must show an active primary completion action; an
invalid form may disable it and must show correction guidance. On the smallest
device, keep completion controls visible or predictably reachable without being
obscured by fixed chrome or an on-screen keyboard.

Apply semantic color consistently across badges, labels, icons, and values for
the same concept. Do not mix success and error colors on one normal-state item
unless the interface explicitly explains two different meanings.

## 6. Stress first

Design the hardest credible state before polishing the typical state. Keep
normal-state data semantically valid, and use realistic stress data such as:

- 20–30 list items;
- two- or three-line names;
- large, negative, or unusually formatted values;
- multiple tags, categories, or nested sub-items;
- missing optional values;
- long localized labels;
- destructive, disabled, and validation states in their own named variants when they conflict with the canonical state.

Derive the typical state from the resilient dense and long-content system, not the reverse. Run a repetition test: mentally or visually repeat each row 25 times and demote any border, label, color, badge, or control that overwhelms scanning. Reserve space for fixed or sticky UI. Add `data-mocklens-ignore="specific reason"` only for an intentional, reviewed exception.

## 7. Check browser evidence

Run the focused command printed by `new-screen` after coherent edits, then run affected neighboring screens whenever shared CSS or components change:

```sh
mocklens check --screen today.iphone-14 --screen states/dense.iphone-14 --device iphone-14
```

Treat stdout as the complete agent-facing report. It covers overflow, clipped text, broken images, page errors, external requests, and fixed/sticky coverage; it does not judge hierarchy, usability, aesthetics, consistency, or fidelity.

For each finding, use its selector and geometry to fix the smallest underlying layout cause. Re-run the same check until it passes. Review warnings and keep suppressions narrow and specific.

## 8. Task-review and UX checkpoints

For each UX requirement:

1. Inspect all referenced screens together.
2. Verify task entry points, edit/correction/recovery paths, canonical completion, state coverage, semantic validity, stress resilience, and value hierarchy.
3. Cross-check the variant-operation matrix: every normal type shown has a compatible create/capture and edit/correction path, or an explicit external/read-only explanation and recovery path.
4. Verify action prominence matches frequency and risk, repeated rows remain scannable, dismissal controls are not redundant, and shell/navigation invariants hold across the family.
5. Recalculate every displayed count, total, balance, remainder, percentage, and status from its visible inputs; correct both the value and dependent copy when they disagree.
6. Record concrete evidence that names visible controls, screens, states, or decisions:

```sh
mocklens checkpoint ux <requirement-id> --proof "<specific evidence>"
```

Never use vague proof such as “looks good” or “UX reviewed.” If review causes an edit, rerun the relevant `mocklens check`, re-inspect the affected screens, and replace the stale checkpoint.

## 9. Visual-review and visual checkpoints

Use visual review as a final-delivery gate. Open every requested viewport PNG and compare the complete set for:

- hierarchy and first-viewport usefulness;
- spacing, typography, density, and component consistency;
- action discoverability;
- action hierarchy and repeated-control noise;
- dense and long-content resilience;
- fixed/sticky crowding;
- stable navigation, header, and content-start positions across related states;
- canonical CTA emphasis versus disabled, validation, and destructive variants;
- form completion reachability and recognizable picker/select mechanics;
- parity between every displayed normal entity variant and its form/correction mechanics;
- one clear dismissal path per form, overlay, or task step;
- one dominant CTA per viewport and clear row-disclosure cues;
- consistent semantic color within each item or status;
- persistent chrome cost on the smallest viewport;
- consistency between typical and edge states;
- fidelity to the brief.

After review, record proof for the exact current screenshots:

```sh
mocklens checkpoint visual --screen <name>... --device <name>... --proof "<specific evidence>"
```

Relevant HTML, imported stylesheet, requirement, device, or screenshot changes make proof stale. Re-run the affected check, re-review current outputs, and replace the checkpoint. An unrelated screen edit should not invalidate independent proof.

## Parallel scheduling

Do not force all screens through the same step at once:

1. Complete project-wide intent, model, coverage, and `mocklens.ux.json` first.
2. Assign one owner to the representative reference screen and `shared.css`.
3. Parallelize by independent screen family or user flow, not individual screenshots.
4. Give one owner all typical, empty, dense, long, and nested states for a family when possible.
5. Let independent families progress asynchronously through compose, stress, check, and task review.
6. Rejoin for project-wide task, action, consistency, and visual comparisons.
7. Use a final full `mocklens check` as the integration gate.

Checkpoint writes are lock-protected, but shared CSS and cross-family UX decisions still need a single owner and an integration review.

## 10. Deliver

Run the full unfiltered command:

```sh
mocklens check
```

Deliver only when it exits 0 and prints `DELIVERY READINESS — PASS`. Report the completed screen families and devices, important product assumptions, check coverage, screenshot paths, UX/visual checkpoints, and any intentional suppressions or known limitations. Do not claim completion while evidence is missing or stale.
