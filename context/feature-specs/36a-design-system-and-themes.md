# 36a Design System and Themes

## Goal
The whole app takes on the look of the approved design "Covibes Studio" (`context/design/studio/`): new colors, fonts, shapes and motion, agent marks instead of letters, and a dark theme next to the light one. The layout of the screens stays as it is; it follows in 36b and 36c.

First part of spec 36 (the design pass).

## Design decisions
- **Owner decisions (2026-10-24):**
  - The design "Covibes Studio" is approved: chat left, canvas center, overview right; rounded, soft surfaces; chat bubbles; the phase bar with segments; the live state of agents.
  - Dark mode is part of V1.
  - Agents get marks (glyphs) instead of letters.
  - The coding agent carries out the whole design pass and derives what the handoff does not show.
- **Spec 36 is built in three parts** (coding agent, 2026-10-24):
  - **36a** the design system: tokens light and dark, fonts, shapes, motion, agent marks, the building blocks, choosing the theme
  - **36b** the main screen in the new layout: top bar with phase bar and "Im Raum", chat, canvas, overview, and their motion
  - **36c** every other screen and dialog, choosing a custom agent's mark in the agent editor, and the mobile view; with it every entry under "Derived looks" is confirmed or replaced
- **Themes work through the tokens.** The `@theme` block holds the light values; `:root[data-theme='dark']` sets the dark ones on the same variables. Components never branch on the theme, and Tailwind's `dark:` variant is not used.
- **The theme follows the system** until a person picks "Hell" or "Dunkel". The choice is kept per device (local storage), not per account: the same person may want different themes on different screens. A small script in `index.html` sets the theme before the first paint, so nothing flashes.
- **Token names stay where their role stays,** so the screens keep working while their look changes; names that no longer fit their role are renamed. New roles get new tokens (tint solid, agent line, glow, surface radius).
- **Agent marks:**
  - the four marks of the handoff for moderator, backend, critic and data
  - six more for the other catalog agents in the same style: product a flag, frontend a window, DevOps a hexagonal nut, security a shield, ML three linked nodes, content a quotation mark
  - twelve for custom agents. Until 36c lets the creator choose, a custom agent's mark follows from its id, so it stays the same everywhere and for everyone.
- **Colors of the other agents in dark** follow the rule of the handoff: the base gets lighter until dark text on it reaches 4.5:1, ink reaches 4.5:1 on the panel, the tint is the base at 13 % over the panel.
- **Fonts:** Bricolage Grotesque for display, Figtree for the interface, JetBrains Mono for code, all OFL-1.1 via `@fontsource-variable`. Geist and Geist Mono leave.

## Implementation

### Web: tokens (`apps/web/src/styles/theme.css`)
- Light values of all neutral, agent and custom colors from the handoff; new tokens for tint solid, agent line and glow; dark values for every color token under `:root[data-theme='dark']`.
- Radii: a new `surface` radius (24) for the main panels; the scale of blocks, cards, menus and inputs grows as in the handoff.
- Shadows of the handoff for light and dark; the button shadows become flat.
- Motion: the keyframes of the handoff (`cvrise`, `cvpop`, `cvring`, `cvtwinkle`, `cvglow` next to typing dots and caret) as `--animate-*` tokens; `prefers-reduced-motion` switches all of them and every transition off.
- `color-scheme` follows the theme, so scroll bars and form controls match.

### Web: fonts (`apps/web/src/styles/index.css`, `package.json`)
- `@fontsource-variable/bricolage-grotesque`, `@fontsource-variable/figtree` and `@fontsource-variable/jetbrains-mono` (5.3.0, OFL-1.1) instead of the Geist packages; `--font-sans`, `--font-display` and `--font-mono`.

### Web: theme
- `lib/theme.ts`: reads and stores the choice (`system`, `light`, `dark`), applies it to `<html>`, follows changes of the system setting while the choice is `system`.
- `index.html`: the script that applies the stored choice before the first paint.
- The account menu gets "Design" with "System", "Hell" and "Dunkel".
- **i18n:** `theme.*`.

### Web: building blocks (`apps/web/src/components/ui/`)
- `agent-marks.ts`: the glyphs of the catalog and the custom set, and the mark of a custom agent by its id.
- `avatar.tsx`: agents as a mark on their tint with the inner line; humans round with initials as before. Sizes 16 to 32.
- `button.tsx`, `icon-button.tsx`: fully round; primary in ink without a highlight; the hover and press motion of the handoff.
- `panel.tsx`: the main panels with the surface radius and the panel shadow, without a border.
- Badge, chip, card, dialog, dropdown menu, popover, tooltip and input in the new shapes.

### Docs
- `ui-context.md` is rewritten for the new system: principles, tokens light and dark, type, shapes, motion, building blocks; the main-screen handoff stays as the reference for behavior.

## Out of scope
- the new layout of the main screen and its parts (36b)
- the other screens and dialogs beyond what new tokens and building blocks change by themselves, the choice of a mark in the agent editor, and the mobile view (36c)
- storing the theme in the account

## Dependencies
- `context/design/studio/` (the handoff), spec 03 (tokens and building blocks), spec 14 and 19 (agents and custom agents)

## Checklist
- [ ] All colors come from tokens with a light and a dark value; `pnpm check:tokens` passes.
- [ ] The theme follows the system until "Hell" or "Dunkel" is chosen in the account menu; the choice survives a reload, without a flash of the other theme.
- [ ] Every agent shows its mark instead of letters, catalog and custom agents; a custom agent has the same mark everywhere.
- [ ] Text reaches 4.5:1 on its background in both themes (meta text included); white or dark text on every agent base reaches 4.5:1.
- [ ] The new fonts are served locally; no request leaves for a font service.
- [ ] With reduced motion no animation runs.
- [ ] The main screen, the project list, the login and the dialogs were checked from screenshots in both themes.
- [ ] `ui-context.md` describes the new system.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm test`, `pnpm db:types:check` and `pnpm build` pass; `progress-tracker.md` is updated.
