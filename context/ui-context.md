# UI Context

> As of 2026-09-27. Source: the design handoff "Covibes V1 – Main screen" from Claude Design, stored in `context/design/main-screen/`.
> **The pixel-exact reference is the `README.md` there.** The prototype `Covibes Main Screen.dc.html` opens in the browser when `support.js` sits next to it. This file summarizes the rules that apply to **every** screen.

## Design principles
- **Color belongs to the agents.**
  - Every agent has exactly one color.
  - Humans always stay neutral (graphite and gray).
  - The main action is always graphite (`#151B24`), never an agent color.
- **Authorship is always visible.**
  - Every chat message shows avatar and name in the author's color.
  - Every canvas block has an author line at the bottom.
- **Humans and agents have different shapes.**
  - Humans have round avatars with initials.
  - Agents have rounded squares in their color with a white letter. In the chat they also carry the badge "Agent".
- **The style is cool, calm and precise.** No gradients, no emojis, no photos.
- **UI language:** German first, English via i18n. Texts are never hard-coded.

## Layout (desktop, reference 1440 × 900)
- The root element is a grid with `grid-template-rows: 52px 1fr` on `bg-app`.
- Header and main area share the columns `380px minmax(0,1fr) 300px`, with `gap: 8px`, `padding: 0 8px` and an additional `8px` at the bottom.
- The columns are chat, canvas and overview. Every panel is white with a `1px` border, radius 12, a panel shadow and its own 52 px header.

## Design tokens
In `apps/web` the tokens are a Tailwind v4 theme in `apps/web/src/styles/theme.css` (since spec 03). Tailwind's default palette is switched off there, so only these tokens exist.
- The code contains **no** raw color values (hex, `rgb()`, `hsl()`). `pnpm lint` checks this with `check:tokens`.
- A new color goes into this block first and then into `theme.css`.
- Spec 03 added values from the handoff (prototype and README) that had no name before:
  - the colors `bg-hover-app`, `bg-secondary-hover`, `border-soft`, `divider-strong`, `text-5`, `text-faint`, `text-upcoming`, `ring-upcoming`, `on-ink`, `human-avatar-bg-strong`, `link`, `link-hover` and `focus-soft`
  - the font sizes
  - the shadows for buttons and the active phase

```css
@theme {
  /* Neutral */
  --color-bg-app: #EEF1F5;
  --color-bg-panel: #FFFFFF;
  --color-bg-canvas: #F6F7F9;
  --color-canvas-dot: #D3D9E1;
  --color-bg-subtle: #F1F4F7;
  --color-bg-muted: #F3F5F8;
  --color-bg-hover-app: #E3E8EE;       /* hover on bg-app, e.g. the project button */
  --color-bg-secondary-hover: #F5F7F9; /* hover of the secondary button */
  --color-track: #E2E7ED;
  --color-border-subtle: #EEF1F4;
  --color-border: #E1E6EC;
  --color-border-block: #DBE1E8;
  --color-border-strong: #D9DFE7;
  --color-border-soft: #E3E8EE;    /* chips */
  --color-frame-border: #CFD7E1;
  --color-border-float: #DFE4EA; /* toolbar, edge labels */
  --color-divider-strong: #CFD6DF; /* divider between humans and agents in the header */
  --color-divider-row: #F1F3F6;    /* between the rows of the decisions in the overview */
  --color-edge: #8792A2;
  --color-text: #0F1720;
  --color-text-body: #1E2733;
  --color-text-2: #3F4A5A;
  --color-text-2b: #4A5565;
  --color-text-3: #6B7686;   /* meta, subtitles: 4.6:1 on white */
  --color-text-4: #7A8595;   /* times, placeholders */
  --color-text-5: #9AA4B2;   /* chevrons of the phase bar, the ring of an open decision */
  --color-text-chip: #253041; /* criteria chips */
  --color-text-faint: #B4BDC8; /* divider "/" after the wordmark */
  --color-text-upcoming: #5B6676; /* upcoming phase */
  --color-ring-upcoming: #AAB3BF; /* ring of the upcoming phase */
  --color-ink: #151B24;      /* primary */
  --color-ink-hover: #2A3340;
  --color-on-ink: #FFFFFF;   /* text on graphite and agent colors */
  --color-human: #1E2733;    /* lock, live cursor */
  --color-bg-locked: #FAFBFC; /* block that a human is editing */
  --color-human-avatar-bg: #E6EAF0;
  --color-human-avatar-bg-strong: #DFE4EA; /* human avatars on bg-app (header) */
  --color-human-avatar-fg: #253041;
  --color-success: #1B7A43;
  --color-success-bg: #E5F4EA;
  --color-danger: #B42318;   /* error messages (spec 04): 6.5:1 on white */
  --color-danger-bg: #FEF3F2;
  --color-danger-border: #FECDCA;
  --color-overlay: rgba(15, 23, 32, 0.32); /* backdrop behind dialogs */
  --color-note: #FDF6D3;
  --color-note-border: #ECDD98;
  --color-note-text: #3A3312;
  --color-note-meta: #5E5424;   /* footer "Notiz · name" */
  --color-note-avatar: #F1E5AD; /* avatar in the note footer */
  --color-link: #2346B0;
  --color-link-hover: #16317F;
  --color-focus-soft: #D5DDE6; /* composer focus */

  /* Agents: base (avatar, border), dark (text), tint (background), border */
  --color-agent-moderator: #0F7F8A;
  --color-agent-moderator-dark: #0B5F68;
  --color-agent-moderator-tint: #DCF0F2;
  --color-agent-moderator-tint-2: #F4FAFB;
  --color-agent-moderator-border: #CDE6E9;
  --color-agent-moderator-border-2: #BFE3E6; /* edge labels, canvas references */
  --color-agent-moderator-divider: #D7ECEE; /* line above the confirmation in the moderator's card */
  --color-agent-backend: #3563E9;
  --color-agent-backend-dark: #2346B0;
  --color-agent-backend-tint: #EEF2FE;
  --color-agent-backend-border: #C9D6FB;
  --color-agent-critic: #C84A14;
  --color-agent-critic-dark: #9A360A;
  --color-agent-critic-tint: #FBE7DC;
  --color-agent-critic-tint-2: #FDF5F0;
  --color-agent-critic-border: #F3CFBB;
  --color-agent-critic-border-2: #E9B89D;
  --color-agent-data: #8B4FD6;
  --color-agent-data-dark: #6532A8;
  --color-agent-data-tint: #F3ECFC;
  --color-agent-data-border: #DCCAF5;
  /* Derived in spec 14 for the remaining catalog agents, same system; spec 36 revisits them. */
  --color-agent-product: #C2185B;
  --color-agent-product-dark: #8E1244;
  --color-agent-product-tint: #FCE4EE;
  --color-agent-product-border: #F5C6D9;
  --color-agent-frontend: #A02D95;
  --color-agent-frontend-dark: #7A2072;
  --color-agent-frontend-tint: #F7E6F5;
  --color-agent-frontend-border: #E9C6E4;
  --color-agent-devops: #9A5A00;
  --color-agent-devops-dark: #6F4100;
  --color-agent-devops-tint: #FBEFDC;
  --color-agent-devops-border: #EFD3A6;
  --color-agent-security: #4A5B7C;
  --color-agent-security-dark: #34415A;
  --color-agent-security-tint: #E9EDF4;
  --color-agent-security-border: #CBD3E2;
  --color-agent-ml: #5046C8;
  --color-agent-ml-dark: #3A3196;
  --color-agent-ml-tint: #ECEBFB;
  --color-agent-ml-border: #CFCBF3;
  --color-agent-content: #5D7A0F;
  --color-agent-content-dark: #43590A;
  --color-agent-content-tint: #EEF4DC;
  --color-agent-content-border: #D3E2A8;

  /* Fonts (served locally via @fontsource-variable, never from Google Fonts) */
  --font-sans: "Geist Variable", "Geist", system-ui, sans-serif;
  --font-mono: "Geist Mono Variable", "Geist Mono", ui-monospace, monospace;

  /* Font sizes, as classes text-badge … text-display */
  --text-badge: 11px;
  --text-meta: 11.5px;
  --text-status: 12px;
  --text-small: 12.5px;
  --text-ui: 13px;
  --text-body: 13.5px;
  --text-title: 14px;
  --text-display: 15px;

  /* Radii */
  --radius-xs: 5px;   /* badges, mini avatars */
  --radius-sm: 6px;   /* pills, edge labels, reference chip */
  --radius-btn-s: 7px;
  --radius-md: 8px;   /* buttons M, icon tiles, tabs */
  --radius-card: 10px;
  --radius-panel: 12px; /* panels, blocks, composer, toolbar */
  --radius-frame: 14px;

  /* Shadows */
  --shadow-panel: 0 1px 2px rgba(16,24,40,.04);
  --shadow-block: 0 1px 2px rgba(16,24,40,.05), 0 2px 8px rgba(16,24,40,.04);
  --shadow-float: 0 1px 2px rgba(16,24,40,.06), 0 8px 24px rgba(16,24,40,.08);
  --shadow-lock: 0 0 0 4px rgba(30,39,51,.07);
  --shadow-note: 0 1px 2px rgba(110,90,20,.08), 0 6px 14px rgba(110,90,20,.08);
  --shadow-button-primary: inset 0 1px 0 rgba(255,255,255,.12), 0 1px 2px rgba(16,24,40,.24);
  --shadow-button-secondary: 0 1px 2px rgba(16,24,40,.05);
  --shadow-phase-active: 0 1px 2px rgba(16,24,40,.10), 0 0 0 1px rgba(16,24,40,.05);
}
```

- `aiRing(agent)` in `apps/web/src/lib/styles.ts` builds the AI ring from the agent color: `0 0 0 4px <base @16 %>, 0 6px 16px <base @14 %>`, via `color-mix()` on the token.
- The base line height is `normal`, as in the prototype. Multi-line text sets its own (messages 1.55).
- White text on every agent base color reaches at least about 4.5:1.

### Typography
Geist (400–700) for the UI, Geist Mono (400–500) for edge labels and repository names. Plus `-webkit-font-smoothing: antialiased`; numbers always with `tabular-nums`.

| Role | Size / weight |
|---|---|
| Wordmark | 15 / 600, −0.02em |
| Panel title | 14 / 600 |
| Note title | 15 / 600 |
| Block title / chat text | 13.5 / 600 or 400, lh 1.55 |
| UI base, buttons | 13 / 500 |
| Small buttons, chips | 12.5 / 500 |
| Status, meta | 12 / 400 |
| Subtitles, times, authors | 11.5 / 400–500 |
| Badges, edge labels | 11 / 500 (labels in mono) |

### Spacing
A 4 px grid with the values 2, 4, 6, 8, 10, 12, 14, 16, 18 and 24 px. Panels have 16 px padding inside and 8 px outside and between each other.

## Building blocks (quick reference; exact values are in the handoff README)
- **Buttons:**
  - Primary is graphite with white text (hover `#2A3340`).
  - Secondary is white with `border-strong`.
  - Ghost is transparent (hover `bg-subtle`).
  - Sizes: M = 30 px (radius 8), S = 28 px (radius 7).
  - Focus: `outline: 2px solid #151B24; outline-offset: 2px`.
- **Avatars:**
  - Human: round, 26/28 px, `human-avatar`.
  - Agent: square, 24 px with radius 7 or 28 px with radius 8.
  - Mini avatar: 16 px (radius 5 for agents).
- **Chat:**
  - Messages of humans and agents sit in the grid `28px 1fr`.
  - The moderator answers as a card in its tint, with the badge "Agent · neutral" and action buttons. After a click a confirmation line replaces the buttons.
  - Mentions are inline chips in backend blue.
  - **Canvas references** are inline buttons in the color of the block's author. A click highlights the block and centers it.
  - Streaming shows typing dots, the hint "is typing", the line "↳ reply to …" and a blinking caret.
- **Raised hand:** a card in the agent's tint with a hand icon and the button "Listen".
- **Composer:** 44 px input. Below it a tool row with "@" (opens the agent menu), "Attach", the hint "Enter to send" and a send button (primary, arrow-up).
- **Phase indicator:** a bar in `track`. Completed steps have a check circle, the active one is white with a shadow, upcoming ones show a ring with a number.
- **Canvas:**
  - The surface is `bg-canvas` with a dot grid at 20 px spacing.
  - Frames: radius 14, `frame-border`, semi-transparent white.
  - Arrows: cubic Béziers in `edge`, 1.5 px, with a filled head. The label pill is set in mono.
  - Sticky notes: yellow, slightly rotated, with the footer "Note · name".
  - Live cursors of humans are always graphite and carry a name pill.
  - The toolbar floats at the bottom center: block, note, frame, connect, auto-layout and zoom from 30 to 200 % in steps of 10.
- **Overview:**
  - "Waiting for you" shows cards with a meta line (agent, kind, time) and a live counter. Completed items appear as a green line.
  - Decisions have a status symbol: decided or open (dashed, with a chip). During a comparison the status reads "Comparison A/B in progress".
  - Criteria appear as chips.

## The four block states (core requirement)
Every block is 180 × 96, has radius 12, a 30 px icon tile, title and subtitle and an author line at the bottom.

| State | Border | Background / shadow | Extra |
|---|---|---|---|
| Normal | `1px solid border-block` | white, `shadow-block` | – |
| Just changed by AI | `1.5px solid <agent base>` | white, AI ring | pill "Just drawn" with sparkle icon above the block. After 4–6 s the block returns to normal (200 ms transition). |
| Proposal | `1.5px dashed <agent base>` | agent tint | header "Proposal · agent", plus "Apply" and "Reject". The edge is dashed (`5 4`) and has no head. |
| Locked (a human is editing) | `1.5px solid human` | `#FAFBFC`, `shadow-lock`, `cursor: not-allowed` | pill with a lock icon and "name is editing", plus a blinking caret in the title |

## Motion and states
- **Typing dots:** `cvdot` runs 1.2 s with a 0.16 s offset per dot. The caret uses `cvblink` with 1 s.
- **Hover colors:** primary `#151B24 → #2A3340`, secondary `#FFF → #F5F7F9`, ghost `→ #F1F4F7`.
- **Composer focus:** `box-shadow: 0 0 0 3px #D5DDE6`.

## Icons and assets
- Icons come from **Lucide** (`lucide-react`) with a stroke width of 1.8–2. The list of icons in use is in the handoff README.
- The **sparkle** (marker for AI) is a custom four-pointed star with the SVG path `M12 3c.5 4.8 3.2 7.5 8 8-4.8.5-7.5 3.2-8 8-.5-4.8-3.2-7.5-8-8 4.8-.5 7.5-3.2 8-8z`, filled.
- **Logo:** two overlapping squares, a placeholder until there is a final logo.

## Deviations from the handoff (`architecture.md` is binding)
- **Locks and live cursors** run through the **Yjs awareness** of Hocuspocus. The look stays the same.
- **The variant comparison A/B** is already part of V1 according to `project-overview.md`; the handoff says "V2". It still needs to be designed, see below.
- The contents of the prototype (chat, blocks, decisions) become seed data and test fixtures.
- **Interactions and looks the handoff does not show** are derived from these tokens and building blocks (owner decisions, 2026-09-29 and 2026-09-30); the coding agent decides them, checks them from screenshots and lists them under "Derived looks" for the design pass (spec 36).
- **Toolbar:** the prototype shows "Block" as the active tool; the app starts without an active tool, so a click on the canvas never creates something by accident (spec 10).
- **The proposal state** of blocks and dashed proposal edges are built with spec 13, together with the proposals themselves and the proposal cards of "Waiting for you".

## Derived looks
Since 2026-09-30 the app is built with the prototype design; design changes, improvements and new designs come together in the design pass at the end (spec 36, owner decision). Until then, looks the handoff does not show are derived from these tokens and building blocks and listed here, so the design pass knows what to confirm or replace:
- selection, editing in place, the block type menu and connection points (spec 08, 09)
- the tool modes of the toolbar, the placement cursor and the connect mode (spec 10)
- inactive board tabs, the tab menu, renaming in place, the delete dialog with the `danger` button and the note pill over the canvas (spec 11)
- proposals (spec 13): proposed notes and frames with the dashed agent border and tint, the dashed outline and the pill "Vorschlag" on blocks that a proposal changes or moves, the completed lines under "Wartet auf dich" for rejected proposals, and the project menu with "Nur Vorschläge"
- agents (spec 14): the colors of product, frontend, DevOps, security, ML and content (base, dark, tint, border, derived from the system of the four handoff agents), the avatar letters of all agents, and the team popover of the header
- read-only link (spec 21b): the section "Nur-Lese-Link" in the share dialog (a status line, "Link erstellen" or "Neu erstellen" with a link icon, the ghost button "Abschalten", and the new link in the same soft box as an invitation link), and the read-only view (a header with logo, project name, the badge "Nur lesen" and "Stand 15:19" on the right; two panels, the canvas with plain board tabs and the zoom-only toolbar, and the overview with decisions and criteria; people on blocks as "Teammitglied" with a dot as initials; the card "Dieser Link zeigt nichts mehr")
- sharing (spec 21a): the share dialog behind "Teilen" (the row to invite with address field, role select, the primary "Einladen" and "Link erstellen" with a link icon; the new link in a soft box with a mono field and "Kopieren"; open invitations as rows like file chips with a mail or link icon, the role and "gültig bis", and ghost buttons "Erneut senden" and "Widerrufen"; members as rows with avatar, name, the small checkbox "darf Git-Aktionen freigeben" under an editor, a role select and "×", which becomes "Entfernen" and "Abbrechen"; "Projekt verlassen" in the danger color with its second step), the invitation page as a centered card with "Nicht jetzt" and the primary "Beitreten", the cards for invitations that no longer work, the note on the login page, and the card "Du bist nicht mehr in diesem Projekt"
- web and knowledge (spec 20b): web addresses in chat messages as underlined links in the text color (the underline in the strong border color, darker on hover), the checkbox "Web-Zugriff" in the project settings, and in the agent editor the section "Wissen" (the title with a counter "2 / 10", a hint line, the entries as rows like file chips with a file or link icon, name or address, size or note and "×", the small button "Datei hinzufügen" with the hint on kinds and size, and a row with the address field, the note field and "Link hinzufügen")
- uploads (spec 20a): the chips of the files being attached above the text of the composer (icon or spinner, name, size, "×"), and under a message the image thumbnails (at most 220 × 160, in a soft border) and the file chips (icon, name, size)
- custom agents (spec 19): the six custom agent colors (green, red, brown, steel, graphite, wine; base, dark, tint, border as tokens `agent-custom-N`), avatars with two letters, the agent editor dialog (template, name with the mention hint, role, instructions with a counter, color swatches, model, the switch for drawing, the visibility, deleting with a second click), and in the team popover the line "Persönlich" or "Geteilt" under a custom agent, the pencil to edit and the dashed row "Eigenen Agenten erstellen"
- debates (spec 18): the debate card in the moderator's message (the title "Debatte · topic", a white box with the question and the participants as avatar and name in their agent color, the line with round and speaker, "Debatte beenden", and the closing line with a check, or in the danger color when the debate was aborted), and the mark "Debatte · Runde 1 von 2" or "Debatte · Zusammenfassung" with an icon above the text of a turn
- variants A/B (spec 17): the dashed diagrams of the variants side by side, the heading "Variante A · Monolith" with the moderator's avatar above a variant's frame and "Übernehmen" in its top right corner, the marker "Variante A" on its blocks, the variants card under "Wartet auf dich" with a thumbnail per variant and the buttons "A übernehmen", "B übernehmen" and "Verwerfen", the line "Vergleich A/B läuft" on an open topic, and the snapshot of the variants in the decision's dialog and under "Varianten ansehen" in the log
- comparison, voting and settings (spec 16b): the comparison card (options as columns, a rating icon and a note per criterion, the recommendation line), the vote card (option rows with the voters' mini avatars and the count, the own vote in graphite, the winner in green, "Abstimmung beenden"), the project settings dialog with radio buttons and checkboxes, and the line "Der Owner entscheidet." on a decision card
- decisions and criteria (spec 16a): the link "Protokoll" and the decision log dialog, the dialog of a decision with "Wieder öffnen" and its reason, the hints while a section is empty, editing a criterion in place, the "×" on a chip and the dashed chip "+", and decision cards under "Wartet auf dich" with "Bestätigen"
- observer (spec 15): raised hands of agents other than the critic (their tint and border instead of a second tint), the icon button "Nicht jetzt" on a raised hand, the line "Angenommen von …" / "Verschoben von …" under an offer, and "Agents melden sich" in the project menu
- diagram types (spec 12): the type icon and name in the frame header and its menu, the block types of mind map, data model, flow and sitemap as block cards with their own icons, entity cards with fields in Geist Mono, arrows from the right to the left edge in mind maps and data models

## Still to be designed
To be designed in Claude Design in spec 36; until then derived from the tokens and building blocks as above:
- **Agent colors:** a final design of the six colors derived in spec 14 and of the six custom colors derived in spec 19. The system stays the same: base, dark, tint and border, white text with at least 4.5:1.
- own shapes per diagram type (e.g. decisions, mind map nodes)
- the building block overview (design system page)
- the variant comparison A/B on the canvas
- the "project plan" phase with plan editor, suggestions per section, versions and roadmap
- further screens:
  - login and project list
  - project settings: moderator stance, decision process, proposals-only mode, Git approval rights
  - agent editor for custom agents
  - invitations and roles
  - "Since you were away" and notifications
  - the read-only view
  - the mobile view (reading and chatting)
- dark mode: not decided yet
