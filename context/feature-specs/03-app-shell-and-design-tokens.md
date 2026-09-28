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
  - `kind="agent"`: a square in the agent color; `agent` for now only `moderator`, `backend`, `kritiker` or `daten`

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
- [ ] Compared with the prototype (`context/design/main-screen/`) at 1440 × 900, `/p/demo` looks the same: grid, header, spacing, radii, shadows, font.
- [ ] The fonts are loaded locally. The network tab shows no request to `fonts.googleapis.com` or `fonts.gstatic.com`.
- [ ] `check:tokens` passes, and there is no hex color outside `theme.css`.
- [ ] All visible texts come from `de.json`, and `en.json` has the same keys. A test compares the key sets.
- [ ] The tests for `Button` and `Avatar` cover the variants. Icon buttons without `aria-label` fail the type check.
- [ ] Keyboard navigation reaches all buttons in the header, and the focus is visible.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
