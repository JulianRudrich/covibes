# UI Context

> As of 2026-10-24 (spec 36a). Source: the design handoff "Covibes Studio", stored in `context/design/studio/`, which the owner approved for the design pass. **The reference for looks is the `README.md` there;** the prototype `Covibes Studio.dc.html` opens in the browser with `support.js` next to it. The earlier handoff `context/design/main-screen/` stays the reference for behavior (states, interactions, contents). This file summarizes the rules that apply to **every** screen.

## Design principles
- **Color belongs to the agents.**
  - Every agent has exactly one color.
  - Humans always stay neutral (warm stone grays).
  - The main action is always ink, never an agent color.
- **Authorship is always visible.**
  - Every chat message shows avatar and name in the author's color.
  - Every canvas block has an author line at the bottom.
- **Humans and agents have different shapes.**
  - Humans have round avatars with initials.
  - Agents have rounded squares with their **mark**: a glyph in the agent's color on its tint with a fine inner line. Never letters (owner decision, 2026-10-24). In the chat they also carry the badge "Agent".
- **The style is soft, calm and precise:** rounded surfaces, pill buttons, a warm neutral palette, little color besides the agents. No gradients, no emojis, no photos.
- **Light and dark** are both part of V1 and equal in care (see "Themes").
- **UI language:** German first, English via i18n. Texts are never hard-coded.

## Layout (desktop, reference 1440 × 900)
The main screen (spec 36b): rows `64px 1fr` on `bg-app`, columns `372px minmax(0,1fr) 300px`, gap 12, padding `0 12px 12px`.
- **Top bar** on the app background, without panels: logo, wordmark and project menu on the left; the phase bar in the middle; "Im Raum", the bell, the theme button and "Teilen" on the right.
- **Phase bar:** a pill on the panel, 44 high: "Schritt 3 von 4", the phase name, four segments (done in `text`, the current one the track 60 % filled, upcoming in `track`), "Danach: …" (left out in the last phase). Name and segments stay buttons that open the card of a phase.
- **"Im Raum":** a pill with the people overlapping (the signed-in user first as "Du", a green dot on who has the open board open) and the agents of the team overlapping as their marks (the writing agent glows, a raised hand shows a hand badge).
- The main panels (chat, canvas, overview) use the `Panel` building block: `bg-panel`, radius `surface` (24), `shadow-panel`, **no border**; the overview has no panel title.

Other screens keep their structure until spec 36c.

## Themes
- The `@theme` block in `apps/web/src/styles/theme.css` holds the light values; `:root[data-theme='dark']` in the same file sets the dark values on the same variables. Components never branch on the theme; Tailwind's `dark:` variant is not used.
- `<html data-theme>` is set by `apps/web/public/theme.js` before the first paint (a file, not inline, because the CSP allows only own scripts) and by `apps/web/src/lib/theme.ts` afterwards.
- The theme follows the system until a person picks "Hell" or "Dunkel" in the account menu ("Design"). The choice is stored per device under `covibes.theme`, not in the account.
- `color-scheme` follows the theme, so scroll bars and native form controls match.

## Design tokens
The tokens are a Tailwind v4 theme in `apps/web/src/styles/theme.css`. Tailwind's default palette is switched off there, so only these tokens exist.
- The code contains **no** raw color values (hex, `rgb()`, `hsl()`). `pnpm lint` checks this with `check:tokens`.
- A new color gets a light **and** a dark value in `theme.css` and is listed here.
- Every text token reaches 4.5:1 on `bg-panel`, `bg-subtle`, `bg-app` and `bg-canvas` in both themes; the text on an agent base (`on-ink`) and an agent's `-dark` on its tint reach 4.5:1, the mark (base) on its tint at least 3:1. This was checked by computation for every pair (spec 36a).

### Neutral colors (light / dark)
| Token | Light | Dark | Use |
|---|---|---|---|
| `bg-app` | `#ECEAE6` | `#0F0E0D` | app background, top bar |
| `bg-panel` | `#FFFFFF` | `#1A1917` | panels, blocks, cards, menus, dialogs |
| `bg-canvas` | `#F8F7F4` | `#141312` | canvas surface |
| `canvas-dot` | `#D8D4CC` | `#2B2926` | dot grid |
| `bg-frame` | white @ 60 % | warm white @ 2.5 % | frames on the canvas |
| `bg-subtle` | `#F4F2EF` | `#24221F` | bubbles, composer, icon tiles, hover |
| `bg-muted` | `#F1EFEB` | `#22201D` | info boxes |
| `bg-hover-app` / `bg-secondary-hover` | `#E2DFD9` / `#F7F5F2` | `#24221F` / `#22201D` | hover on the app background / of the secondary button |
| `track` | `#E3E0DA` | `#34322E` | empty segments, tracks |
| `border-subtle` / `border` / `border-strong` | `#EFECE7` / `#E7E4DF` / `#D9D5CE` | `#262421` / `#2E2C29` / `#3D3B36` | dividers / lines / inputs, outlined chips |
| `edge` | `#A09A90` | `#716C64` | arrows on the canvas |
| `text` / `text-body` | `#1B1A18` / `#262421` | `#F2F0EC` / `#E6E2DB` | titles / body |
| `text-2` / `text-2b` | `#4A4741` / `#57534C` | `#C8C4BC` / `#B7B2A9` | secondary text |
| `text-3` / `text-4` | `#66625B` / `#69655E` | `#99948B` / `#8E897F` | meta, subtitles / times, placeholders |
| `text-5`, `text-faint` | decoration only | | chevrons, separators |
| `ink` / `ink-hover` / `on-ink` | `#1B1A18` / `#34322E` / `#FFFFFF` | `#F2F0EC` / `#FFFFFF` / `#141311` | primary action and the text on it; `on-ink` is also the text on every agent base |
| `human` | `#1B1A18` | `#F2F0EC` | locks and live cursors of people |
| `success`, `danger` (+ `-bg`, `danger-border`) | `#1F7A45`, `#B42318` | `#5BD08C`, `#FF8A7A` | states |
| `note` (+ `-border`, `-text`, `-meta`, `-avatar`) | `#FCEFB4` … | `#4A4120` … | sticky notes |
| `link` / `link-hover` | `#2A44A8` / `#1E3380` | `#B3C1FF` / `#D3DCFF` | links |
| `overlay` | stone @ 36 % | black @ 55 % | backdrop behind dialogs (with a 2 px blur) |

The remaining neutral tokens (`border-block`, `border-soft`, `frame-border`, `border-float`, `divider-*`, `text-chip`, `text-upcoming`, `ring-upcoming`, `bg-locked`, `human-avatar-*`, `focus-soft`, `chart`) keep their roles from spec 03 with values from the same palette.

### Agents
Every agent has five tokens: base (`agent-x`: mark, borders, pills), dark (`agent-x-dark`: text on tint and on the panel), tint (`agent-x-tint`: backgrounds, the mark's ground), border (`agent-x-border`: lines on tint, the mark's inner line). The moderator and the critic have a second, lighter tint and border (`-tint-2`, `-border-2`) for their cards and references.
- Moderator `#0E7C74` / dark `#3CC2B4`, backend `#3B5BDB` / `#7B95FF`, critic `#C9501B` / `#F0844E`, data `#8A4FD0` / `#B98BF5` (values of the handoff).
- Product, frontend, DevOps, security, ML and content keep their light colors of spec 14; the six custom colors of spec 19 keep theirs. Their dark values follow the rule of the handoff: the base gets lighter until dark text on it reaches 5:1, the dark text color reaches 7.5:1 on the panel, the tint is the base at 13 % over the panel, the border at 36 %.
- Custom agents use `agent-custom-*`; the class `agent-color-N` on the element picks one of the six colors.
- `aiRing(agent)` in `apps/web/src/lib/styles.ts` builds the ring of a block an agent just changed from the base color via `color-mix()`.

### Agent marks
`apps/web/src/components/ui/agent-marks.ts` holds the glyphs: filled paths on a 24 × 24 grid, drawn with `fill-rule: evenodd`.
| Agent | Glyph |
|---|---|
| Moderator | ring with a center dot |
| Backend | three stacked layers |
| Critic | lightning bolt |
| Data | three rising bars |
| Product | flag |
| Frontend | window |
| DevOps | hexagonal nut |
| Security | shield |
| ML | a node with three around it |
| Content | quotation mark |

Custom agents get one of twelve plain shapes (circle, diamond, triangle, framed square, plus, drop, leaf, crescent, star, two dots, wide ring, arrow up); until spec 36c lets the creator choose, the shape follows from the agent's id (`customMark`). The `Avatar` building block draws a mark at about half its size, in the base color on the tint with the border as inner line; its radius is about a third of its size.

### Typography
Fonts are served locally via `@fontsource-variable`, never from a font service; all three are OFL-1.1.
- **Figtree** (`font-sans`) for the interface, 400–700.
- **Bricolage Grotesque** (`font-display`) for the wordmark, panel titles, dialog titles and `h1`–`h3`.
- **JetBrains Mono** (`font-mono`) for edge labels, repository names, branches and code.
- `-webkit-font-smoothing: antialiased`; numbers in lists, counters and times with `tabular-nums`.

| Role | Size / weight |
|---|---|
| Wordmark | 18 / 700, −0.025em, display |
| Panel and dialog titles (`text-heading`) | 17 / 600, −0.01em, display |
| Section titles, phase name (`text-display`) | 15.5 / 600 |
| Block title (`text-title`) | 14 / 600 |
| Chat text (`text-body`) | 13.5 / 400, lh 1.5–1.55 |
| UI base, buttons (`text-ui`) | 13 / 500–600 |
| Small buttons, chips (`text-small`) | 12.5 / 500 |
| Status, meta (`text-status`, `text-meta`) | 12 / 11.5 |
| Badges, edge labels (`text-badge`) | 11 / 500–600 |

### Shapes
| Token | Radius | Use |
|---|---|---|
| `rounded-full` | round | buttons, icon buttons, chips, badges, pills, avatars of people |
| `rounded-surface` | 24 | main panels, dialogs, cards like the login card |
| `rounded-panel` | 18 | blocks, composer, menus, popovers |
| `rounded-card` | 16 | cards inside panels, info boxes |
| `rounded-md` / `rounded-btn-s` | 10 | inputs, menu items, tabs, icon tiles |
| `rounded-sm` / `rounded-xs` | 8 / 6 | small tiles, inline chips |
| `rounded-frame` | 28 | frames on the canvas |

### Shadows
`shadow-panel`, `shadow-block`, `shadow-float` (toolbar, menus, dialogs), `shadow-lock`, `shadow-note`, `shadow-button-primary`, `shadow-button-secondary`, `shadow-phase-active`; each has a light and a dark value (dark adds a faint warm outline, since shadows hardly show on dark surfaces).

### Spacing
A 4 px grid with the values 2, 4, 6, 8, 10, 12, 14, 16, 18 and 24 px. Panels have 16 px padding inside.

## Building blocks (`apps/web/src/components/ui/`)
- **Buttons:** fully round, 600. Primary in ink (hover `ink-hover`), secondary on the panel with `border-strong`, ghost transparent (hover `bg-subtle`), danger in `danger`. Sizes M = 32 px, S = 28 px. Pressed: 1 px down and 98 %. Focus: `outline: 2px solid ink; outline-offset: 2px`.
- **Icon buttons:** round, 28 px, ghost; pressed 95 %.
- **Avatars:** humans round with initials on `human-avatar-bg`; agents as their mark. Sizes 16, 20, 24, 26, 28, 30 and 32.
- **Badge** ("Agent"): a round 18 px label in the agent's tint and dark color. **Pill** (status): round, 28 px, `bg-subtle`. **Chip** (criteria): an outlined round pill, 28 px.
- **Panel:** see "Layout". **Card:** `rounded-surface`, `shadow-panel`, no border. **Notice:** `rounded-card`.
- **Dialog:** `rounded-surface`, `shadow-float`, padding 24, the title in the display font; the backdrop `overlay` with a 2 px blur; it appears with `animate-pop`.
- **Dropdown menu and popover:** `rounded-panel`, `shadow-float`, no border, items `rounded-md`; they appear with `animate-pop`.
- **Tooltip:** ink with `on-ink`, `rounded-md`.
- **Input:** 36 px, `rounded-md`, `border-strong`, the border turns ink on focus.
- **Logo:** two overlapping circles, the upper left one filled; a placeholder until there is a final logo.

### Chat, canvas and overview (spec 36b)
- **Bubbles:** others on the left with a 30 px avatar and the corner at the author (`rounded-bl-[6px]`) on `bg-subtle`; own messages on the right in ink without an avatar (the name stays for screen readers); agents in their tint. Name and time stand above the bubble.
- **Moderator card:** its tint, a 1 px inner line, radius 20, its mark on the panel color, the chip "neutral" (or "Agent" when it has its own opinion), pill buttons; after a choice a line with a check.
- **References** to the canvas: pills in the base color of the element's author with `on-ink` text; for a person's element the base is `human`. Inside the own ink bubble references and mention chips turn to the panel color.
- **Raised hand:** a card in the agent's tint with its mark and hand badge, "Anhören" as a pill on the panel color.
- **Composer:** a pill (radius 26) on `bg-subtle` with a fine inner line: @, the text, attach, send; it grows to six lines and keeps its radius.
- **Canvas:** board tabs as pills floating over the canvas, "Verlauf" and "Projektplan" as ghost pills on the right; the toolbar a floating pill at the bottom center with 40 px round tools, "Auswählen" first.
- **Blocks** radius 18 without a border, a round 32 px icon tile, the author line without a divider, hover lifts by 2 px. **Arrows** 2 px with round caps and an open chevron head, labels as mono pills. **Frames** `rounded-frame` on `bg-frame` with a 1 px inner line, the title in the display font, the count as a pill. **Notes** radius `6 6 22 6`, tilted by 2°.
- **Overview:** "Wartet auf dich" with a count pill and cards on `bg-subtle` (radius 18); "Entscheidungen" one row per topic with a status circle and the value or an "offen" pill (moderator tint while variants are compared); "Kriterien" as outlined pills.

## The four block states (core requirement)
Behavior as in the main-screen handoff, looks as in the studio handoff (spec 36b).

| State | Look (studio handoff) |
|---|---|
| Normal | panel, `shadow-block`, no border |
| Just changed by AI | a 2 px ring in the agent's base plus its glow, a pulsing outline (`animate-ring`), the pill "Gerade gezeichnet" with a twinkling sparkle above it; back to normal after 4–6 s |
| Proposal | 2 px dashed base on the tint, header "Vorschlag vom <Agent>", "Übernehmen" and "Ablehnen"; the edge dotted without a head |
| Locked (a human is editing) | a 2 px ring in `human` plus `shadow-lock`, the pill "<Name> bearbeitet" with a lock, a blinking caret in the title, `cursor: not-allowed` |

## Motion
Tokens in `theme.css` (`animate-*`), all switched off by `prefers-reduced-motion: reduce` in `base.css` together with every transition.
| Token | What | Timing |
|---|---|---|
| `animate-typing-dot` | typing dots | 1.2 s, 0.16 s offset per dot |
| `animate-caret-blink` | streaming and editing caret | 1 s, hard on/off |
| `animate-rise` | a message or card appears from 8 px below | 0.45 s ease-out |
| `animate-pop` | dialogs, menus, confirmations, badges appear from 96 % | 0.3 s ease-out |
| `animate-ring` | the outline of a block just drawn widens and fades | 2 s, repeating |
| `animate-twinkle` | the sparkle of "Gerade gezeichnet" | 1.6 s |
| `animate-glow` | the mark of an agent that is writing (`--glow` is the agent's color) | 1.6 s |

Hover: buttons and icon buttons change their background in 150 ms; blocks lift by 2 px (spec 36b).

## Icons and assets
- Icons come from **Lucide** (`lucide-react`) with a stroke width of 1.8–2.
- The **sparkle** (marker for AI) is a custom four-pointed star with the SVG path `M12 3c.5 4.8 3.2 7.5 8 8-4.8.5-7.5 3.2-8 8-.5-4.8-3.2-7.5-8-8 4.8-.5 7.5-3.2 8-8z`, filled.
- Agent marks: see "Agent marks".

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
- the history of a board (spec 38a): in the header of the canvas, left of "Projektplan", a 30 px icon button with the history icon (15 px), like the header's other quiet buttons. The dialog "Verlauf", 560 px wide, in the look of the Git log: per entry a 24 px avatar, then the name in semibold, a dot and what happened in numbers ("3 hinzugefügt, 1 entfernt") a little lighter, the time small and gray at the right ("vor 5 Minuten"); below it a line per kind of change with a small gray label of 76 px ("Hinzugefügt", "Entfernt", "Verschoben", "Geändert") and the elements as chips: 22 px high, radius 6, a 12 px icon of the kind (square, note, frame, arrow) and the name, on the panel color with the stronger border; a removed one on the muted background, gray and struck through; one that leads to its element darkens on hover. Entries are separated by a hairline; "3 weitere Elemente zeigen" is a small ghost button
- taking an entry of the history back (spec 38b): under the elements of an entry the small ghost button "Zurücknehmen" with a 13 px undo icon, pulled left to the edge of the text like "weitere Elemente zeigen"; next to it, in the small gray style, what came of a try that changed nothing, or the error in the danger color. An entry that takes one back carries the word "Zurücknahme" between the name and the numbers, as a small tag on the muted background (meta size, medium weight, gray, radius 6). An entry that was taken back has, below its first line, a 12 px undo icon and "Zurückgenommen von Olga · vor 2 Minuten" in the small gray style, with "· 2 von 3 Elementen, der Rest wurde seitdem geändert" when a part stayed; taken back as a whole, its lines of elements stand at 60 % opacity
- asking about an element (spec 37b): the pill "Im Chat fragen" 6 px above the top left corner of the one selected element, 22 px high like the lock pill, on the panel color with the stronger border and the small button shadow, a 12 px message icon and the text small, medium and a little lighter than body; hover like a secondary button
- references in messages (spec 37a): the inline button itself is the handoff's ("Canvas reference"). Derived: the same button for an element another agent made, in that agent's dark color on its tint with its border and the base color as border on hover; for an element a person made, neutral (the stronger border, the subtle background, text a little lighter than body). The highlight of an element that was brought into view: a 2 px ring 6 px around the element with the frame's radius, in the color of the agent that made it with the soft glow of "just drawn", in ink for a person's element, pulsing for 2.5 seconds. The note "Dieses Element gibt es auf dem Canvas nicht mehr." is the canvas's usual note pill
- onboarding and empty states (spec 33):
  - the welcome on the project list: a card with a centered heading of 20 px ("Willkommen bei Covibes"), one sentence below it a little darker than gray, three columns with a 24 px circle holding the number on the subtle background, a title in semibold and a small gray line each, left-aligned, and the primary button "Erstes Projekt anlegen" centered below; the page's own button "Projekt anlegen" is secondary meanwhile
  - the empty chat: centered in the panel, a 24 px gray icon of two speech bubbles, the title in semibold, one gray line, then a small gray line "Der Moderator hilft beim Einstieg:" and three small secondary buttons below each other
  - the empty board: in the middle of the canvas a title in semibold and a little lighter than text, and one gray line, at most 340 px wide, without a box
  - the empty sections of the overview: one small gray sentence, in two lines; under the criteria's the button for the first criterion
  - the login page: one gray line under the wordmark
- the language of a project (spec 32b): in the dialog "Neues Projekt", below the name, a group "Sprache des Projekts" with its label in medium weight, two radio buttons in one row ("Deutsch", "English", 14 px, ink when chosen) and a small gray line that says what the language is for. In the project settings a fourth group "Sprache des Projekts" like the others: a radio button per language with its name in medium weight and one small gray line each, and a small gray note below the group that what is written stays as it is
- the language of the interface (spec 32a): the switch "Deutsch · English" on the pages someone sees signed out, small and centered 16 px under the card (login, the messages of the invitation and of the read-only view) and at the right end of the read-only view's header: two text buttons with a faint dot between them, the language shown in semibold and the text color, the other in gray, darker on hover. In the account menu a group under the small gray label "Sprache", between two hairlines above "Abmelden": two rows like the menu's other rows, with a 14 px check in front of the language shown
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
- **Derived in spec 36b** (main screen in the studio layout):
  - the green dot in "Im Raum" marks who has the open board open, read from the board's awareness; people elsewhere in the project show without it
  - the phase bar leaves out "Danach" in the last phase; the 60 % of the current segment marks "running", since Covibes does not measure progress inside a phase
  - the overview drops its panel title; "Seit du weg warst" takes the look of its sections
  - "Auswählen" as the first tool of the toolbar, pressed while no other tool is
  - references of a person's element in `human`; references and mention chips on the panel color inside the own ink bubble
  - a note stands straight while it is written in; a frame shows no widening outline (too large), its ring and pill say enough
  - an open topic shows only the "offen" pill instead of "Noch nicht entschieden"
  - the theme button in the top bar switches between light and dark; "Wie das System" stays in the account menu

## Still to be designed
Derived by the coding agent from the studio handoff in spec 36b and 36c (owner decision, 2026-10-24):
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
