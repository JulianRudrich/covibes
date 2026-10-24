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
- [x] All colors come from tokens with a light and a dark value; `pnpm check:tokens` passes.
- [x] The theme follows the system until "Hell" or "Dunkel" is chosen in the account menu; the choice survives a reload, without a flash of the other theme.
- [x] Every agent shows its mark instead of letters, catalog and custom agents; a custom agent has the same mark everywhere.
- [x] Text reaches 4.5:1 on its background in both themes (meta text included); white or dark text on every agent base reaches 4.5:1.
- [x] The new fonts are served locally; no request leaves for a font service.
- [x] With reduced motion no animation runs.
- [x] The main screen, the project list, the login and the dialogs were checked from screenshots (main screen and project list in both themes, the login in dark, a dialog in light).
- [x] `ui-context.md` describes the new system.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm test`, `pnpm db:types:check` and `pnpm build` pass; `progress-tracker.md` is updated.

## Implementation notes (2026-10-24)
- **Tokens** (`apps/web/src/styles/theme.css`): the light values of the handoff in `@theme`, the dark values on the same variables under `:root[data-theme='dark']`, `color-scheme` per theme. New: `bg-frame`, `font-display`, `text-heading` (17), `radius-surface` (24) and the motion tokens `animate-rise`, `-pop`, `-ring`, `-twinkle`, `-glow`. The radius scale grew (xs 6, sm 8, md and btn-s 10, card 16, panel 18, frame 28); the button shadows are flat.
- **Agent colors:** the four agents of the prototype take the values of the handoff. The other six catalog agents and the six custom colors keep their light values; their dark values were computed in OKLCH by the rule of the handoff (the base lighter until dark text on it reaches 5:1, the dark text color 7.5:1 on the panel, the tint 13 % and the border 36 % of the base over the panel).
- **Contrast:** a script over `theme.css` checked every text token on panel, subtle surface, app background and canvas, the text on every agent base, every agent's dark color on its tint and on the panel, and every mark on its tint, in both themes. It found the meta and time colors of the light theme short of 4.5:1 on the app background; `text-3` and `text-4` were darkened until all pairs passed.
- **Theme:** `lib/theme.ts` keeps the choice under `covibes.theme` (`system` removes the key), applies it to `<html data-theme>` and follows the system while nothing is picked. `public/theme.js` does the same before the first paint; it is a file and not inline because the CSP allows only own scripts. The account menu has "Design" with "Wie das System", "Hell" and "Dunkel".
- **Fonts:** `@fontsource-variable/figtree`, `bricolage-grotesque` and `jetbrains-mono` (5.3.0, OFL-1.1) replace Geist. `h1`–`h3` use the display font in `base.css`, and so does the wordmark (18/700).
- **Agent marks** (`components/ui/agent-marks.ts`): the four glyphs of the handoff and six more for the catalog (flag, window, hexagonal nut, shield, a node with three around it, quotation mark), twelve plain shapes for custom agents, picked by a hash of the agent's id. `Avatar` takes a `mark` instead of initials for agents and draws it on the tint with the border as an inset ring; sizes 16 to 32. Letters no longer appear for agents anywhere; the tests that checked letters now check the marks.
- **Building blocks:** buttons and icon buttons fully round with the press motion, the primary button at 32 px; `Panel` and `Card` with the surface radius and no border; badge, pill and chip as round pills (the chip outlined); dialogs, menus and popovers without a border, with the larger radii and `animate-pop`; the dialog title in the display font; the backdrop blurred by 2 px; the logo as two circles.
- **Reduced motion:** `base.css` cuts every animation and transition to 0.01 ms under `prefers-reduced-motion: reduce`.
- **Verified** with `pnpm dev` and the browser as olga, without a model run: the login and the project list in the dark theme the pane started with; the project "Vereins-App" in dark and, after "Hell" in the account menu, in light; the choice survived a reload; the share dialog in light; the canvas with blocks and frames in dark. All fonts came from the app itself, no request left for another host, and the console showed no errors. The test choice was removed afterwards, so the browser follows the system again.
- **Not part of this unit:** the layout and the looks of chat, canvas and overview of the handoff (bubbles, phase bar, "Im Raum", block states, toolbar) come with spec 36b; until then the screens keep their structure in the new tokens.
