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
  --color-chart: #4A5565; /* derived (spec 31b): marks of a chart, a step lighter than ink */

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
- the usage overview (spec 31b): the dialog "Verbrauch" of the project's menu, 580 px wide. At the top a switch between two months in the look of the phase indicator (the track with the active month as a white pill). Then the amount as one figure, 24 px and semibold, with "von 100,00 $" small and gray beside it and the share at the right; below it a meter, 8 px high and fully rounded, ink on the track color, and a small gray line "Der Monat zählt neu ab 1. November." At the limit the meter is full in the danger color and the line reads "Limit erreicht. Die Agents antworten wieder ab 1. November." in the danger color and medium weight with a 14 px alert circle. Under a hairline three figures with their labels small and gray above them: "Läufe", "Eingabe-Tokens", "Ausgabe-Tokens". "Je Agent" and "Je Person" are rows of a 16 px avatar (or a 14 px gray icon for "Automatisch" and "Nicht mehr im Projekt"), the name, a bar 6 px high with a square start and a round end in the chart color, the amount right-aligned and the runs small and gray. "Je Tag" is a row of columns in the chart color with round tops on a baseline, 96 px high, with the days 1, 5, 10 … small and gray below; the day under the pointer or the keyboard is ink on a subtle band, and a small line below names it ("12. September: 1,66 $ · 11 Läufe") or else the highest day. A small gray note closes the dialog. New token: `chart`
- usage and limits (spec 31a): while a limit of the AI is reached, a note above the composer (and above the hint viewers see instead of it): a box on the muted background with the stronger border and the panel's radius, a 14 px gauge icon in gray at the left, and the sentence small and a little darker: "Das KI-Limit dieses Projekts für diesen Monat ist erreicht. Die Agents antworten wieder ab 1. November; alles andere geht weiter." The reply of a mentioned agent is its usual message with the sentence about the limit, marked as failed like a reply at a used-up quota
- the review as a comment (spec 30c): under "Wartet auf dich" the request is a card like every Git request's, with the moderator's avatar and name before "· Freigabe" when the moderator made it, the sentence "Review von !3: 2 Abweichungen als Kommentar in vereins-app posten" with the review's name in semibold and the repository as a mono chip, and the row "Freigeben", "Ansehen" (it opens the review) and the X; a posted one is the line with a green check "… in vereins-app kommentiert". In the review, above the closing note: "In GitLab kommentieren" (or "Als Kommentar vorlegen") as a small secondary button with a speech-bubble icon and a small gray hint next to it; instead of it, once asked for, a small line "Der Kommentar wartet auf Freigabe." (pulsing while it is posted, red when it failed) or "In GitLab kommentiert" with the speech bubble as a link with an external-link icon. The card of a review that deviates shows "In GitLab kommentiert" small and gray with the speech bubble next to "Ansehen". The log names the result of the action "Kommentar" as the link
- review of merge requests (spec 30b): in the dialog "Merge Requests" a line below the branches of a merge request, small: the state of its review as a text button ("Passt zur Architektur" in green with a 13 px check circle, "2 Abweichungen von der Architektur" in red with a warning triangle, "Älterer Stand:" in gray before it when the commits changed), "Review läuft …" pulsing, or "Das Review hat nicht geklappt." in red; next to it "Prüfen" or "Erneut prüfen" as a small dark-gray text button with a scan icon. The review takes the place of the list, in a dialog titled "Review" with a gray hint: "Alle Merge Requests" as a small ghost button with an arrow, the merge request as a link like in the list, a small gray line "Stand 58ec1e2e · automatisch geprüft · vor 3 Minuten · gehört zu Issue #4", the verdict as a banner (green on the light green, red on the light red with its border, gray while it runs), the summary in the text size, the findings as bordered cards with the title in semibold, the detail below it and a small two-column list "Architektur" and "Datei" (the path in the mono font), and a small gray note at the end; at most about 460 px high, then it scrolls. Under "Wartet auf dich" a card like a proposal's: the moderator's 16 px avatar and name in its dark color, "· Review" and the time at the right, a sentence with "!3" and the title in semibold, the first two findings as small lines with a red 12 px warning triangle, "+ 1 weitere" in gray, and "Ansehen" as a small secondary button
- task status from the repository (spec 30a): on the roadmap a task with an issue shows "#4" small and gray as a link between its text and the assignee; a closed one has a 14 px green check circle in front and its text gray and struck through; a milestone with issues shows "2/10 erledigt" small and gray at the right end of the line with its time, in green and medium weight once all its tasks are done, with the long form as a tooltip. In the plan the issue is a small gray link "#4" at the end of the task's line before the assignee, green with a small check once it is closed. In "Issues aus dem Plan" the link of a closed issue has a 13 px green check circle in front. The dialog "Repository" has a section "Stand aus GitLab" below the line about who picked the repository, set off by a thin soft line: a small gray heading, a small gray hint, then "Zuletzt abgeglichen: vor 3 Minuten." small (or a red line when reading failed) with "Jetzt abgleichen" as a small secondary button with a refresh icon at the right; for owners "Webhook einrichten …" as a small ghost button, which unfolds a soft box like the share dialog's link box: a small gray heading and hint, "Adresse" and "Secret-Token" as small gray labels over mono fields with "Kopieren" at the right, the secret as dots with an eye icon button to show it, and "Secret-Token neu erzeugen" as a small ghost button that turns into a small red button "Wirklich neu erzeugen" with a gray hint next to it
- agents propose Git actions (spec 29e): the card of a request an agent made starts like a proposal's, with the agent's 16 px avatar and its name in its dark color before "· Freigabe"; the rest of the card is the same, without "Zurückziehen"; the log reads "Vorgelegt von Moderator"
- merging after approval (spec 29d): the project's menu has an entry "Merge Requests …" above "Git-Protokoll …"; its dialog is 600 px wide with title and a gray hint, and lists the open merge requests separated by thin soft lines: "!3" in gray and the title in medium weight as one link with an external-link icon, below it small and gray the two branches in the mono font with an arrow, who opened it and when, then "Entwurf" or "Konflikte mit dem Zielbranch" small and a little darker; at the right "Mergen" (or "Vorlegen") as a small secondary button with a merge icon, "wartet auf Freigabe" small and gray while a request waits, and nothing for a draft; what a click led to is a small line below the entry, red if it failed. Under "Wartet auf dich" and in the log the request reads "!3 Projektplan, … in vereins-app mergen" with number and title in semibold
- the plan package as a merge request (spec 29c): the dialog of the package ends with a section "Ins Repository" below the list of files: a small gray heading, a small gray hint that names the repository as a mono chip, the comparison in the text size ("41 neu · 1 geändert", or a sentence when nothing differs or something is missing), "Dateien anzeigen" as a line that unfolds the paths in the mono font on a subtle background, each with its state at the right in the UI font ("neu" in green, "geändert" dark, "unverändert" and "bleibt" light gray), at most about ten lines high, then it scrolls; below it, small and gray, earlier feature specs as mono lines and "Zuletzt angelegt: Merge Request !3" with the link in a darker gray and an external-link icon; a small gray, dark or red line that says what happened; and "Merge Request anlegen" (or "Zur Freigabe vorlegen") as a secondary button with a merge-request icon, so the download stays the dialog's primary button. Under "Wartet auf dich" and in the log the request reads "Merge Request mit dem Plan-Paket in vereins-app anlegen" with "Merge Request" in semibold; its two actions show "angelegt" as the link to the commit and "!3" as the link to the merge request
- Git actions and approvals (spec 29b): the plan's export menu has a fourth entry "Issues anlegen …"; the dialog "Issues aus dem Plan" in the look of the package dialog, 560 px wide, with title and a gray hint, a line that names the repository as a mono chip on a subtle background, and the milestones in a list that scrolls: per milestone a small gray heading with a checkbox in front and "2 von 8 angelegt" small and gray at the right over a thin line, below it the tasks as rows with a checkbox, separated by thin soft lines; a task with an issue is gray and shows "#4" as a small gray link with an external-link icon at the right, one that waits shows "wartet" small and gray; below the list a small gray or red line that says what happened; at the foot "Schließen" as a ghost button and "2 Issues anlegen" (or "2 Issues zur Freigabe vorlegen") as the primary button. Under "Wartet auf dich" a request is a card like a proposal's: a 16 px avatar of the person with their name in medium weight, "· Freigabe" and the time at the right; "2 Issues in vereins-app anlegen" with the count in semibold and the repository as a mono chip; a small gray line when something is missing ("Zum Freigeben brauchst du dein GitLab-Konto."), a pulsing one while it runs ("Wird ausgeführt … 2 von 3"), a red one when it failed; a row with "Freigeben" as a small primary button, "Ansehen" as a small secondary button (it reads "Schließen" while the actions show) and an X icon button with a tooltip at the right end for rejecting; the actions as a list of small lines, each with an icon in front (a dashed circle, a spinner, a green check, a red X, a gray dash) and at the right "#4" as a link; above several waiting cards a small gray line "2 Freigaben warten." with "Alle freigeben" as a small primary button at the right; a request that is done is a line with a green check like a decided proposal. The project's menu has a fourth entry "Git-Protokoll …"; its dialog is 600 px wide with title and a gray hint, and lists the requests separated by thin soft lines: the summary in the text size with the status at the right in small medium weight (green for done, red for failed, gray otherwise), below it "Vorgelegt von olga, 09.10.2026, 17:44 · Freigegeben von olga, 09.10.2026, 17:46 · via Covibes" small and gray, and "3 Aktionen ansehen" as a small ghost button that unfolds the same list of actions
- GitLab access per person (spec 29a): the account menu has an entry "GitLab-Konto …" with a branch icon above "Abmelden"; the dialog in the look of the share dialog, 520 px wide, with title and a gray hint; not connected: three lines of text and the primary button "Mit GitLab verbinden" with a branch icon; connected: the account as a card on a subtle background with a branch icon, the name in semibold and below it "@olga.beispiel · gitlab.example.com" small and gray; "Konto trennen" as a red ghost button that turns into a red button "Wirklich trennen" with the gray hint "Projekte, deren Repository du gewählt hast, verlieren es." next to it; "Schließen" as a ghost button at the foot. The dialog "Repository" changed with it: an owner with an account sees the line "Dein GitLab-Konto: Olga Beispiel (@olga.beispiel)." above the list to pick from; below the card of a picked repository a small gray line "Gewählt von olga. Die Agents lesen mit dem Zugriff von Olga Beispiel (@olga.beispiel)."; the red ghost button reads "Repository entfernen"
- connecting GitLab (spec 28a): the project's menu has a third entry "Repository …"; the dialog in the look of the share dialog, 520 px wide, with title and a gray hint; not connected: two lines of text and the primary button "Mit GitLab verbinden" with a branch icon; connected: a line "Verbunden als Olga Beispiel (@olga.beispiel), von Olga.", then the repository as a card on a subtle background with a branch icon, its name in semibold, below it its path as a small gray link with an external-link icon, and "Ändern" as a small ghost button at the right; the list to pick from: a small gray heading, a search field with a magnifier icon, and the repositories as bordered rows with name and gray path (the current one with a dark border), at most about four rows high, then it scrolls; "Verbindung trennen" as a red ghost button that turns into a red button "Wirklich trennen" with a gray hint next to it; problems as red lines of text; "Schließen" as a ghost button at the foot
- written-out feature specs (spec 27d): in the export dialog below the two texts the section "Feature-Specs" with a small gray heading and a gray hint; a line per milestone, separated by thin soft lines, with the name in the text size and below it "3 von 10 ausgearbeitet" small and gray; at the right a small secondary button "Ausarbeiten", a small ghost button "Neu ausarbeiten" when none is missing, or, while a run is on its way, the moderator's 16 px avatar with the pulsing gray text "Der Moderator schreibt …"; a failed run as a red line of text below its milestone; under "Im Paket" the line of the specs ends with "· 6 ausgearbeitet"
- suggestions for the package's texts (spec 27c): to the right of a field's label a small ghost button with a sparkles icon, "Vorschlag vom Moderator"; below the field, while the moderator writes, a note on a subtle background with its 16 px avatar, the pulsing text "Der Moderator schreibt einen Vorschlag …" and "Abbrechen" as a gray text button at the right; the suggestion as a card with a dashed border in the moderator's color on its tint (the proposal look), with the avatar, "Moderator" in its dark color and "· Vorschlag", the text in the small size (at most 12 lines high, then it scrolls), "Übernehmen" as a small primary button, "Verwerfen" as a small ghost button and, if the field holds a text, "Ersetzt den Text im Feld." small and gray at the right; a failed run as a red line of text with "Ausblenden" as a gray text button
- the package for coding agents (spec 27b): in the plan's export menu a third entry "Paket für Coding-Agents …" below a thin line; the dialog in the look of the share dialog, 560 px wide, with title and a gray hint; "Im Paket" as a small gray heading over six lines, each with a green check (there) or an empty gray circle and gray text (missing); "Was der Plan nicht sagt" with a gray hint and two labeled text areas of four rows in the look of the fields (a subtle background while read-only), to the right of a label a small gray "Gespeichert" or a red "Nicht gespeichert"; "42 Dateien anzeigen" as a line that unfolds the paths in the mono font on a subtle background; at the foot "Schließen" as a ghost button and "Paket herunterladen" as the primary button with a download icon
- exports (spec 27a): at the right end of the canvas toolbar, after a divider, an icon button with a download icon in the size of the zoom buttons; in the plan's toolbar the same icon as a small icon button between "Roadmap" and "Plan erzeugen"; both open a menu in the look of the dropdown menus with the formats ("Als Bild (PNG)", "Als Vektorgrafik (SVG)", "Als Diagramm-Code (Mermaid)"; "Als Markdown", "Als PDF"), and the icon pulses while a file is made; the PDF of the plan: A4 with margins of 56 pt, "Projektplan" small and gray above the project's name in 22 pt, "Stand: 3. Oktober 2026" in gray, sections in 15 pt and milestones in 12 pt in the medium weight, text in 10.5 pt Roboto in the text color, bullet and numbered lists with nested lists indented, the assignee in italics in parentheses after a task, and "Seite 1 von 3" small, gray and centered at the foot
- assigning tasks (spec 26b): on the roadmap every task card has its text on the left and at its right end the round avatar of its assignee (24 px, the human colors, initials), or for owners and editors a round dashed button with a small person-plus icon; the menu in the look of the dropdown menus with the label "Zuweisen an", the members (a 16 px avatar, the name, a check at the current assignee) and "Niemand"; in the plan at the end of a task's line a small chip with a 16 px round avatar and the name in the meta style (a subtle background on hover), or for owners and editors the dashed chip "Zuweisen", faint until the pointer is on the line; in the read-only view the avatar with a dot instead of initials; and in the bell the row with a clipboard icon, "Sam hat dir in Vereins-App eine Aufgabe zugewiesen" and the task below it
- the roadmap (spec 26a): a frame like every frame with a Gantt icon and "Roadmap · 4 Meilensteine · 13 Wochen" in its header; below it, when every milestone has a time, a scale of weeks ("W1", "W2", … in the meta style, a thin line at each week and below the scale); then the milestones as columns side by side in one white box with the border of a card, divided by dashed lines, each as wide as its weeks (or 240 px when a time is missing): the number in a small ink square with white text, the name in semibold, "3 Wochen · W1–3" (or "ohne Zeitangabe") in the meta style, the goal in two lines in the small style, and the tasks as small white cards with a border and up to two lines each, at most twelve, then "+ 3 weitere"; without milestones "Der Plan hat noch keine Meilensteine." with a line on where they come from and the small secondary button "Plan öffnen"; and the ghost button "Roadmap" with a Gantt icon in the plan's toolbar after "Versionen"
- plan updates and versions (spec 25c): above the document the note of an outdated plan (a white box with the strong border, "Der Plan ist nicht mehr aktuell" in semibold, below it what changed in the small style, and the small primary button "Aktualisieren" on the right), the note that an update found nothing to change (the subtle box of the other notes), and a small ink dot behind "Projektplan" while the plan is outdated; on the card of a suggestion the word "Aktualisierung" in place of "Vorschlag", a line in the small style when the section was changed by hand, the comparison in place of the text (one line per paragraph or list item in the small style: lines that go on the danger tint and struck through, lines that come on the success tint, unchanged lines in gray, and long unchanged stretches folded into a gray line "… 17 unveränderte Zeilen anzeigen" that opens on a click), and the ghost button "Ganzen Text anzeigen" or "Änderungen anzeigen" next to "Verwerfen"; the ghost button "Versionen" with a history icon in the plan's toolbar before "Plan erzeugen"; the dialog "Versionen des Plans" (880 px wide: on the left the versions as rows with "Version 2" in semibold, why it was kept and "vor 3 Minuten · olga" in the meta style, the chosen row on the subtle background; on the right three small buttons "Änderungen seit dieser Version", "Änderungen gegenüber Version 1" and "Inhalt", the chosen one as secondary, and below them a bordered box that scrolls with the comparison or the text in the look of the plan); and in "Seit du weg warst" a row with a document icon and the underlined link "2 neue Versionen des Projektplans"
- generating the plan (spec 25b): the small secondary button "Plan erzeugen" with the AI sparkle at the right end of the plan's toolbar and next to "Mit Vorlage beginnen" in the empty plan; above the document the note "Der Moderator schreibt den Plan …" (subtle box, moderator avatar, pulsing text), the note after a failure in the same box, and the suggestions: a line with the moderator's avatar and name, "5 Vorschläge für den Plan" and "Alle übernehmen" on the right, then one card per section with the dashed moderator border and tint of a proposal (the section title, "Vorschlag" in the moderator's dark color, the text in the look of the plan one size smaller, "Übernehmen" primary and "Verwerfen" secondary); and under "Wartet auf dich" the card of a proposal with "Moderator · Projektplan", one line and "Plan öffnen"
- project plan (spec 25a): the button "Projektplan" with a document icon at the right end of the board tabs (the look of an active tab while the plan is open); the plan in the canvas panel on white: a toolbar row of icon buttons (two headings, bold, italic, two lists, undo, redo, with thin dividers, the active format on the subtle background), below it the document in a column of at most 760 px (section headings 19 px semibold, subheadings in the display size, text in the title size with a line height of 1.6, the hint of an empty section in the placeholder color), the card "Der Plan ist noch leer" on the subtle background with the small primary button "Mit Vorlage beginnen", and another person's caret as a line in the human color with the name in a small dark label above it
- phases (spec 24): every step of the phase bar is a button (the text darkens on hover), and its card below the bar (280 px wide, the look of a popover: the phase name in the title style with "Abgeschlossen", "Aktuelle Phase" or "Kommt noch" in the meta style on the right, one or two sentences on what the phase is for, then the small primary button "Zu dieser Phase wechseln", or in the current phase a hint line in the small style and the small secondary button "Moderator fragen"), and the note over the canvas when the phase changes
- since you were away (spec 23): the section "Seit du weg warst" at the top of the overview (the title with "zuletzt hier gestern" in the meta style on the right; the moderator's words in the card of a proposal with avatar, name and "· Zusammenfassung", while they are written the pulsing line "Fasst die Unterhaltung für dich zusammen …"; below one row per fact with a small gray icon: decisions and boards as underlined links with the topic or title in bold, criteria, messages, mentions and what waits as plain text; the small button "Verstanden")
- notification mails (spec 22b): the checkbox item "E-Mail-Benachrichtigungen" in the account menu (a check in front while on), and the mail itself as plain text (greeting, one block per project with its link and a line per event, a closing line on how often Covibes writes and where to turn it off)
- mentions, bell and waiting (spec 22a): the chip of a mentioned person (subtle background and text color; the reader's own mention in ink with white text), "Mitglieder" with round avatars below the agents in the `@` menu, the bell in both headers with the small ink counter, the notification popover (title, "Alle als gelesen markieren", rows with a round icon per kind, a bold name and project, the start of the message, the time and an ink dot while unread), the cards for raised hands and votes under "Wartet auf dich" (the same card as a proposal, with "Anhören" and "Nicht jetzt", or a button per option and "1 von 3 haben abgestimmt"), and the ink pill "2 warten auf dich" in a row of the project list
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
