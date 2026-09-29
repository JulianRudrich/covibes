# 03 App Shell and Design Tokens

## Goal
The web app gets its visual foundation:
- the tokens from `ui-context.md` as a Tailwind theme
- the fonts, served locally
- the basic building blocks
- i18n and routing
- the empty layout of the main screen, looking like the handoff

## Design decisions
- **Authoritative:** `ui-context.md` and `context/design/main-screen/README.md`, sections layout and header. Values are taken from the handoff, not estimated.
- **Tailwind v4** via `@tailwindcss/vite`. The `@theme` block from `ui-context.md` goes 1:1 into `apps/web/src/styles/theme.css`.
- **Local fonts:** Geist and Geist Mono come as npm packages (e.g. `@fontsource-variable/geist` and `@fontsource-variable/geist-mono`, or `geist`), **not** from Google Fonts. Fetching from Google's servers transmits IP addresses and is a GDPR risk under German case law.
- **shadcn/ui** is the basis for accessible primitives. Its CSS variables (`--background`, `--primary` etc.) are mapped to our tokens. Only the components needed here are adopted: `button`, `tooltip`, `dropdown-menu`. The look follows the handoff, not shadcn's default.
- **Icons:** `lucide-react` with a stroke width of 1.8–2.
- **Routing:** TanStack Router. **i18n:** react-i18next with `de` as default and `en` as prepared keys.

## Implementation

### Styles
- `src/styles/theme.css` holds the tokens, `src/styles/base.css` the base rules:
  - `body`: `bg-app`, Geist 13 px, `text`, `-webkit-font-smoothing: antialiased`
  - `tabular-nums` as a helper class
  - focus style
- The helper `aiRing(agentColor)` in `src/lib/styles.ts` provides the AI ring; it builds the shadow from the base color (16 % and 14 %).

### Building blocks in `src/components/ui/`
All values come from `ui-context.md`:
- **`Button`** with the variants `primary`, `secondary` and `ghost` and the sizes `m` (30 px) and `s` (28 px). Hover, focus and disabled states are covered.
- **`IconButton`** is a 28 px ghost button with a mandatory `aria-label`.
- **`Avatar`** comes in two kinds:
  - `kind="human"`: round
  - `kind="agent"`: a square in the agent color; `agent` for now only `moderator`, `backend`, `critic` or `data`

  Sizes: 16, 24, 26 and 28 px.
- **`Badge`**, **`Chip`** and **`Pill`** as used in the handoff.
- **`Panel`** and **`PanelHeader`**: white, 1 px border, radius 12, panel shadow, 52 px header with a divider.

### Layout in `src/features/workspace/`
- **`WorkspaceShell`** uses a grid with the rows `52px 1fr` and the columns `380px minmax(0,1fr) 300px`, `gap` 8 and `padding` 0 8 8.
- **Header** (`WorkspaceHeader`) with:
  - logo mark (two squares, as the component `Logo`), wordmark "covibes", divider
  - project button with chevron (no function yet)
  - **`PhaseIndicator`** with the states done, active and upcoming (static data for now: architecture is active)
  - avatar group: humans on the left, divider, agents on the right. Names appear as tooltips.
  - button "Share" (primary, no function yet)
- **Three panels** with header and empty content: chat, canvas with the tab "Main canvas", overview. The empty areas show a discreet placeholder text via i18n.

### Routing and i18n
- **Routes:**
  - `/` redirects to `/p/demo`. From spec 04 on, the project list lives here.
  - `/p/$projectId` shows `WorkspaceShell`.
- **i18n:** the files `src/i18n/de.json` and `en.json` are organized by area: `common`, `workspace`, `phases` etc. No visible text is hard-coded.

### Token guard
- The script `pnpm --filter @covibes/web check:tokens` searches `apps/web/src` for hex colors (`#rgb`, `#rrggbb`) outside `theme.css` and fails if it finds any. It runs as part of `pnpm lint`.

## Out of scope
- login, project data (spec 04)
- canvas content, React Flow (spec 05), chat content (spec 06)
- function of project button, share and phase changes

## Dependencies
- Spec 01
- Packages, each in the current version (check first):
  - `tailwindcss`, `@tailwindcss/vite`
  - the font packages for Geist and Geist Mono
  - `lucide-react`
  - `@tanstack/react-router`
  - `i18next`, `react-i18next`
  - shadcn/ui (via CLI) with the required Radix packages

## Checklist
- [x] Compared with the prototype (`context/design/main-screen/`) at 1440 × 900, `/p/demo` looks the same: grid, header, spacing, radii, shadows, font.
- [x] The fonts are loaded locally. The network tab shows no request to `fonts.googleapis.com` or `fonts.gstatic.com`.
- [x] `check:tokens` passes, and there is no hex color outside `theme.css`.
- [x] All visible texts come from `de.json`, and `en.json` has the same keys. A test compares the key sets.
- [x] The tests for `Button` and `Avatar` cover the variants. Icon buttons without `aria-label` fail the type check.
- [x] Keyboard navigation reaches all buttons in the header, and the focus is visible.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-09-28)
- **Comparison with the prototype:** both pages ran side by side at 1440 × 900, and positions and sizes were measured by script. Header, phase bar, avatars, dividers, "Share", panel grid, borders, radii and shadows match to a tenth of a pixel. The server `design` from `.claude/launch.json` serves the prototype at `http://localhost:5180/main-screen/`.
- **Additional tokens:** the handoff uses colors that had no name in `ui-context.md` yet, e.g. the hover on `bg-app`, the upcoming phase or the divider in the header. They are now tokens instead of exceptions in the code; the list is in `ui-context.md`. Font size tokens (`text-badge` to `text-display`) were added too, and `cn()` knows them through `tailwind-merge`.
- **Token guard:** besides hex values it also finds `rgb()`, `rgba()`, `hsl()` and `hsla()`. A line with the comment `tokens-ignore` is exempt, meant only for justified single cases.
- **shadcn:** the building blocks are hand-written in the shadcn style (cva, `cn()`, Radix via the package `radix-ui`), because the look comes entirely from the handoff anyway. `components.json` is ready so that later components can come via the CLI. The shadcn variables (`background`, `primary` etc.) point to our tokens in `theme.css`.
- **`dropdown-menu`** is not adopted yet, because nothing in this spec opens a menu. It comes with the avatar and project menu in spec 04.
- **Line height:** the prototype uses `line-height: normal`, Tailwind sets 1.5. `base.css` sets `normal`; multi-line text sets its own height.
- **`tabular-nums`** already is a Tailwind class and needs no helper class.
- **Wordmark:** "covibes" in lowercase, as in the handoff. It lives in i18n as `common.wordmark`.
- **Routing:** code-based with TanStack Router. `createAppRouter(history)` allows tests with a memory history. `/` redirects via `redirect(..., throw: true)`, which fits the ESLint rule `only-throw-error`.
- **Tests:** Vitest runs without globals, so `test-setup.ts` cleans up Testing Library after each test.
- **Build:** the JS bundle is 504 kB (160 kB gzip); Vite warns from 500 kB. Code splitting per route pays off once canvas (spec 05) and chat (spec 06) arrive.
- **Versions:**

  | Package | Version |
  |---|---|
  | Tailwind CSS | 4.3.3 |
  | TanStack Router | 1.170.39 (1.170.40 was newer than pnpm's minimum release age) |
  | i18next / react-i18next | 26.4 / 17.0 |
  | radix-ui | 1.6.7 |
  | lucide-react | 1.48 |
  | Geist (Fontsource Variable) | 5.3.0 |
