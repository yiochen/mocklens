# GoodPlate — mocklens example project

A fictional recipe app mocked as five independent static screens in plain
HTML/CSS. This is the reference "good" project: every screen passes
`mocklens validate` on every configured device.

## Screens

| Screen | What it shows |
| --- | --- |
| `home.html` | Feed: header, search bar, peeking chip carousel (annotated `data-mocklens-ignore="carousel peek"`), recipe cards, fixed bottom nav. |
| `detail.html` | Long recipe detail (~1800px): hero, ingredients, steps, nutrition, fixed action bar with correct bottom padding. |
| `empty-state.html` | Favorites with zero items: CSS/emoji illustration + CTA. |
| `error-state.html` | Static load-failure state (an error *visual*, nothing actually throws). |
| `dialog-open.html` | Modal dialog statically open over dimmed content, pure CSS. |

All imagery is emoji + CSS gradients — no external files, no fonts, no JS.
`shared.css` holds the shared styles; each screen links it relatively.

## The iteration loop

Run everything from this directory (`example/`):

```sh
# 1. Browse the screens at exact phone dimensions
node ../dist/cli.js serve          # → http://localhost:4173

# 2. Edit any screens/*.html file in your editor

# 3. Regenerate screenshots and re-validate in one go
node ../dist/cli.js check

# 4. Read the terminal report, .mocklens/report.json, and the PNGs in
#    .mocklens/screenshots/<device>/

# 5. Fix whatever the report points at

# 6. Re-run check until it prints PASS (exit code 0)
```

Useful variations:

```sh
node ../dist/cli.js list                       # screens + devices
node ../dist/cli.js screenshot --full-page     # viewport + full-page PNGs
node ../dist/cli.js validate                   # checks only, no screenshots
node ../dist/cli.js validate --screen home     # one screen only
node ../dist/cli.js check --device iphone-se   # one device only
```

Output lands in `example/.mocklens/` (git-ignored): `screenshots/` +
`report.json`. The home screen intentionally reports a few *suppressed*
findings for the peeking carousel chips — that's the `data-mocklens-ignore`
idiom in a real-looking context; suppressed findings never fail the run.
