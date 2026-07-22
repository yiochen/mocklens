# Ledgerly — task-first Mocklens dogfood

Ledgerly is a static budgeting mockup used to exercise the full Mocklens design
loop. It contains no backend, persistence, routing, or production interaction
logic. Every screen is plain HTML/CSS and renders offline.

## Intent and model

The primary user is a budget owner who needs to record daily spending, decide
where the month is going, and correct mistakes quickly. The core entities are a
month, daily expense collections, individual mutable expenses, categories, and
category plans. Expenses belong to one day and one category; category totals
roll up into the month.

Applicable expense actions are create, view, edit, delete, confirm deletion,
correct invalid input, and undo deletion. The mock assumes one currency and one
budget owner because multi-currency conversion and sharing would materially
expand the product.

## Coverage

| Screen | State or task proved |
| --- | --- |
| `today.iphone-14` | Typical daily collection, first-viewport create action, edit/delete entry points. |
| `add-expense.iphone-14` | Creation form, retained invalid draft, correction guidance, disabled submit, cancel. |
| `monthly-summary.iphone-14` | Category grouping with nested expenses, large totals, negative adjustment, drill-in. |
| `states/empty.iphone-14` | Empty collection, first expense, and no-spend decision. |
| `states/one-item.iphone-14` | One-item collection with mutable actions. |
| `states/dense.iphone-14` | 25-item collection longer than one viewport. |
| `states/long-content.iphone-14` | Multi-line names, long localized labels, large/negative values, missing optional notes. |
| `states/delete-confirmation.iphone-14` | Destructive confirmation with the exact item, amount, consequence, and cancel path. |
| `states/deleted.iphone-14` | Successful deletion plus immediate undo recovery. |

Loading, remote error, and offline states are not applicable because this
mocked capture flow has no remote data. Permission is not applicable because
manual expense entry uses no protected device capability. The invalid form is
the relevant error/disabled state; the one-item and deleted screens represent
successful creation and destructive recovery. These decisions are explicit so
the state inventory cannot silently omit them.

## Value budget and stress order

Each first viewport starts with the current total, collection state, form,
decision, or recovery action. There are no greetings, hero images, promotional
headlines, oversized logos, or decorative summaries. The 25-item and long-copy
screens established wrapping, density, values, and row actions before the
typical four-item screen was finalized.

One reference owner should establish `today.iphone-14.html` and `shared.css`.
Independent owners can then take the daily collection family, create/correct
flow, and monthly summary family asynchronously. Each family keeps all of its
states together and rejoins for cross-screen task, action, consistency, and
visual review.

## Reproduce the dogfood run

The checked-in workspace was produced with this sequence from `example/` after
building the repository:

```sh
node ../dist/cli.js init
# Create mocklens.ux.json from the intent/model/coverage reasoning above.
node ../dist/cli.js new-screen today add-expense monthly-summary \
  states/empty states/one-item states/dense states/long-content \
  states/delete-confirmation states/deleted --device iphone-14

# Establish today + shared.css, compose the screen families, then stress them.
node ../dist/cli.js check
node ../dist/cli.js checkpoint ux <requirement-id> --proof "<specific evidence>"
node ../dist/cli.js checkpoint visual \
  --screen <all-nine-screen-names> \
  --device iphone-se --device iphone-14 --device pixel-7 \
  --proof "<specific evidence from all 27 inspected viewport PNGs>"
node ../dist/cli.js check
```

The full run covers 9 screens × 3 devices = 27 combinations with no sanity
findings. `mocklens.ux.json` and `mocklens.checkpoints.json` are source
controlled so the final command can verify all six UX requirements and all 27
visual targets.

The dogfood staleness drill changes a referenced screen and `shared.css`, runs
the full check to observe stale UX/visual proof, restores and re-reviews the
screens, and returns to `DELIVERY READINESS — PASS`. A temporary non-delivery
screen is also edited to confirm independent screen-family work does not stale
delivery proof. No CLI friction was found beyond the expected need to install
the lockfile dependencies before building a fresh checkout.

## Inspect the result

```sh
node ../dist/cli.js serve
node ../dist/cli.js check
```

The viewer opens at `http://localhost:4173`. Generated screenshots and reports
live under `example/.mocklens/` and remain ignored; the manifest and checkpoint
ledger are the durable review contract.
