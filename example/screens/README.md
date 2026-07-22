# Mocklens Screens

This folder contains static mobile UI mockups. Each HTML file is an independent screen or state.

- Start with Intent → Model → Cover, then create `mocklens.ux.json` before generating screens.
- Run `mocklens --help` and confirm both checkpoint commands exist before relying on readiness gates.
- Cover task entry, edit/correction/recovery paths, and empty, typical, dense, long, missing, nested, loading, error, destructive, and success states; require each relevant state or record why it is not applicable.
- Establish shared tokens, components, navigation, and density on one representative reference screen before composing other screen families.
- Put primary task data and the primary action before greetings, hero art, promotional copy, and decorative summaries.
- Design the hardest credible content state before polishing the typical state.
- Keep screens plain HTML/CSS with local assets only.
- Link `shared.css` with the correct relative path (`./shared.css` at the root; `../shared.css` one level down).
- Name variants `<screen>.<device>.html`; use `mocklens new-screen <name> --device <device>` instead of copying boilerplate.
- Use exact names from `mocklens list` in the UX manifest; generated names include the device suffix.
- Keep the generated `mocklens:*` metadata in the document head accurate. Device names must exist in `mocklens.config.json`.
- Review each UX requirement across its referenced screens, then record specific `mocklens checkpoint ux` evidence.
- Inspect every delivery screenshot together, then record `mocklens checkpoint visual` evidence.
- Deliver only when a full unfiltered `mocklens check` prints `DELIVERY READINESS — PASS`.
- If overflow is intentional, add `data-mocklens-ignore="short reason"` to the element.
