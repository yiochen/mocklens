# Ledgerly dogfood mockup

Ledgerly is a task-first phone budgeting mockup for one household budget owner. It supports a complete signed-transaction loop: add an expense or refund, scan today, understand the month, correct either variant, delete with confirmation, and undo an expense deletion.

## Intent

The owner decides whether money is leaving or returning, what category it affects, whether a transaction is correct, how much of the daily guide and monthly budget remains, and which categories drive net spending. Delivery targets `iphone-se`, `iphone-14`, and `pixel-7`. The visual character is compact and ledger-like: warm paper, crisp white data surfaces, forest-green actions, restrained lime accents, credit-green refunds, and coral used only for errors or point-of-commit risk.

## Model and semantic contract

Core entities are a $2,500 July budget, six category allocations totaling $2,500, daily transaction collections, and two user-managed transaction variants: expenses and refunds. Both variants have merchant, category, local date/time, optional note, create, row-disclosed edit/correction, overflow removal, confirmation, and recovery paths.

The form amount is a positive USD magnitude greater than zero. `Expense` applies a positive sign to spending; `Refund` applies a negative sign. Refund screens state the resulting signed value before save. Lists label refunds and render their glyphs and values in credit green; coral never means refund. This rule allows a user to change type during correction without manually entering a minus sign.

Rows open correction via a consistent chevron. Their natural-language
`data-mocklens-action` annotations document that tap opens the prefilled
editor, swipe left reveals Delete, and long press opens the actions menu; tap
then More actions is the accessible non-gesture path. Category rows document
their drill-in behavior the same way. Edit screens use Back as their sole
dismissal and overflow for removal. Create and validation screens use Close as
their sole dismissal. Sheets use one contextual keep/close action. Delete
remains a neutral-surface text action in overflow and receives strong coral
fill only at final confirmation.

## Reconciled arithmetic

All values were recalculated from the displayed signed inputs with Node decimal sums:

- Today: $24.86 + $20.00 + $8.56 + $15.00 = $68.42; the $100 guide leaves $31.58.
- Post-delete: $68.42 − $24.86 = $43.56; the guide leaves $56.44; monthly remaining increases from $842.16 to $867.02.
- Dense: 25 displayed expenses sum to $456.32; the $100 guide is exceeded by $356.32.
- Long content: $9,875.00 + $128.67 − $14.99 = $9,988.68; that is $9,888.68 over the $100 guide and $7,488.68 over $2,500.
- Groceries: eight expenses totaling $368.57 plus one −$7.51 refund = $361.06; $138.94 remains of $500 and 72.21% is spent.
- July categories: $905.88 + $361.06 + $223.80 + $79.50 + $54.60 + $33.00 = $1,657.84; $842.16 remains of $2,500 and 66.31% is spent.
- Empty and one-item are alternate same-day snapshots with $910.58 remaining before today; a single $4.25 expense leaves $906.33.

## Coverage decisions

| State | Decision |
| --- | --- |
| Empty | Required; one dominant first-add action and zero daily total. |
| One item | Required; singular copy and visible missing optional note. |
| Typical | Required; four realistic expenses and recurring budget metrics. |
| Dense | Required; 25 valid rows, recurring metrics, count, and an honest scroll cue rather than an above-fold completeness claim. |
| Long content | Required; long merchant/note text, large values, and a labeled signed refund. |
| Nested | Required; Groceries states eight expenses plus one refund and cues scrolling to all nine contributors. |
| Canonical expense/refund forms | Required separately; valid prefilled states with one active Save action. |
| Expense/refund correction | Required separately; prefilled edit states allow changing type and saving. |
| Validation/disabled | Required separately; retained input, inline errors, disabled Save. |
| Destructive/recovery | Required; quiet menu delete, explicit confirmation, recalculated result, Undo. |
| Loading/offline/permission/server error | Not applicable; the scoped static local workflow has no remote dependency or account access. |

## Shell contract

Every collection screen keeps a 38px Ledgerly/month app bar, a 38px `Today`–`Month` control in that order, a data-first summary, recurring budget metrics, and then collection content. Dense rows compact internally but do not remove shell navigation or decision metrics. Full-screen forms deliberately replace the collection shell with the same 42px centered taskbar; sheets preserve a dimmed edit context.

Run from this directory with the repository CLI so UX and visual gates are available:

```sh
node ../dist/cli.js check
```

Current viewport screenshots, hashes, and the machine-readable report are under `.mocklens/`.
