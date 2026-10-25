# 36e Mobile View

## Goal
On a phone, Covibes is for reading and chatting (`project-overview.md`, "Platform"): the workspace shows one area at a time, chat, canvas or overview, under a compact header and above tabs at the bottom, in the design "Covibes Studio" in light and dark. Someone who opens a project on the way reads what happened, answers in the chat, decides what waits for them and looks at the canvas. The desktop stays as it is.

Fifth and last part of spec 36 (the design pass); with it the design pass is complete.

## Design decisions
- **Reference draft:** artboard H-Mobile (390 × 844) on the owner's design canvas, approved as a direction on 2026-10-24. What it leaves out is derived from the studio handoff by the coding agent (owner decision, 2026-10-24).
- **When:** below 768 px of width (Tailwind's `md`) the workspace and the read-only view take the phone layout; from 768 px on the desktop layout stays exactly as before, including its minimum width and scrolling on narrow windows. The layout follows the width as it changes (turning the phone, resizing a window).
- **Header** on the app background, padding `14px 12px 12px`: a 44 px round back button (chevron, "Zur Projektliste") to the project list; the project name in the display font (18 / 600, −0.015em, truncated); below it the phase line, 12.5 px in `text-3`: the four phase segments at 16 × 4 px with 3 px gap (the shared phase segment, the current one 60 % filled), then "Architektur · Schritt 3 von 4". On the right the team as overlapping 28 px marks (radius 9, a 2 px ring in the app color, −6 px overlap), at most two as in the draft, then a square "+N" on the panel color with an inner line (the draft's human gray hardly stands off the app background); the writing agent glows and an agent with a raised hand carries the hand badge, as in "Im Raum", and both come first. The header only shows; phases are changed and the team is edited on the desktop.
- **Tabs at the bottom** (`nav` "Bereiche"): three equal columns on the panel color with a 1 px `border` line on top, padding `6px 12px` and at least 10 px (or the safe area) below; each tab 52 px high with a 19 px Lucide icon in a 52 × 28 pill and the label 12 px below it. The chosen tab: the pill on `bg-subtle`, the label in `text` and semibold, `aria-current="page"`; the others in `text-3` and medium. "Chat" (message square), "Canvas" (two linked squares, the canvas icon of the draft) and "Überblick" (a checked box) with the count of what waits for the user as a 16 px ink badge on the icon. The tab is named "Überblick" as the overview panel is everywhere else in the app; the draft's "Übersicht" was a working label.
- **Chat:** the chat panel fills the area on the panel color without a panel title or radius (the tab names it); the bubbles, the moderator card, the raised hand card, the status pill and the composer keep their looks of 36b. Bubbles may grow to 80 % of the width. The buttons of the moderator card are 44 px pills on the phone, the raised hand's "Anhören" 36 px with a 44 px target.
- **Composer** on the phone: the pill 52 px high (radius 26) with 44 px round buttons for @, attach and send; the text 16 px, so iOS does not zoom when it gets the focus.
- **Canvas** on the phone: for reading and moving around. The board tabs, panning, pinching and the zoom buttons work; blocks, notes, frames and arrows cannot be moved, edited or created, the tools are hidden and proposals are decided under "Überblick". This is the read-only canvas of spec 05 for viewers, used for everyone on a phone; the plan opens read-only as well. Editing on a phone is out of V1 ("mobile optimization" comes after V1).
- **Overview:** the sections of the desktop ("Seit du weg warst", "Wartet auf dich", decisions, criteria) in one scrolling column on the panel color, padding 16, gap 22.
- **Notes** (the short messages that otherwise stand over the canvas) show as the same pill above the tabs while chat or overview is open, so a failed action is never silent.
- **Touch targets** on the phone: every button and icon button gets a target of at least 44 × 44 px, drawn larger only where the draft shows it (header, composer, moderator card, tabs) and for the items of menus (44 px high); smaller ones keep their look and get an invisible hit area of 44 px around their center. References and mention chips inside a sentence keep their size, as WCAG 2.5.8 allows for targets inside text. Every input, textarea and select has 16 px text on the phone.
- **Read-only view** on the phone: the header with logo, project name and the badge "Nur lesen" (the time and the language switch move into the overview tab), and the two tabs "Canvas" and "Überblick" at the bottom.
- **Project list:** on a phone the search and "Projekt anlegen" share the full width (they ran off the screen before).
- **What stays the same:** every text, action and state of the desktop, the routes and the address (the tab is not part of it); dialogs open as on the desktop and are already limited to the width of the screen.

## Implementation

### Web
- `apps/web/src/lib/use-media-query.ts`: `useMediaQuery(query)` with `useSyncExternalStore` and `matchMedia` (false where it does not exist, e.g. in tests), and `usePhone()` for `(width < 48rem)`.
- `apps/web/src/components/ui/mobile-tabs.tsx`: the tab bar (`MobileTabs`) with its count badge; shared by the workspace and the read-only view.
- `features/workspace/mobile-workspace.tsx`: the phone layout with header, the open area and the tabs; `workspace-shell.tsx` renders it below 768 px. Chat and overview stay mounted while another tab is open (draft and scroll position stay); the canvas is mounted while its tab is open. Opening an element, a board or the plan (a reference in a message, a link under "Wartet auf dich" or "Seit du weg warst") switches to the canvas tab.
- `features/workspace/workspace-page.tsx`: the canvas and the plan read-only on a phone; the count of what waits and the note handed to the shell.
- `features/share/share-view-page.tsx`: the phone layout of the read-only view.
- `components/ui/button-variants.ts`, `icon-button.tsx`: the 44 px hit area below 768 px.
- `features/chat/composer.tsx`, `chat-message.tsx`, `message-list.tsx`, `features/hands/raised-hands.tsx`: the phone sizes named above.
- `styles/base.css`: 16 px text in fields below 768 px.
- `features/canvas/board-tabs.tsx`, `features/account/language-switch.tsx`: the 44 px hit area; `components/ui/dropdown-menu.tsx`: 44 px items on a phone; `features/projects/project-list-page.tsx`: the search row on a phone.

### i18n
- New texts in German and English: the label of the tab bar ("Bereiche"), the team in the header ("Team: …"), the count on the tab ("{{count}} warten auf dich" exists already).

### Docs
- `ui-context.md`: a section "Mobile view" with the layout as built; "Still to be designed" is empty.

## Out of scope
- editing the canvas or the plan on a phone, the project menu, sharing, settings and the Git dialogs from the phone layout (they need the desktop; dialogs that open still work)
- a layout of its own for tablets
- an installable app, push notifications

## Dependencies
- Specs 36a to 36d; specs 05, 06, 21b and 24 for the areas the phone shows

## Checklist
- [x] Below 768 px the workspace shows header, one area and the three tabs as in the draft H-Mobile, in light and dark at 390 × 844; the count of what waits stands on "Überblick".
- [x] Chatting works on the phone: reading, writing with 16 px text, mentioning with @, raised hands and the moderator's buttons; the canvas tab pans and zooms and changes nothing.
- [x] Every touch target in the phone layout is at least 44 × 44 px.
- [x] The read-only view has its phone layout.
- [x] At 1440 × 900 the workspace looks and works as before.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm test`, `pnpm db:types:check` and `pnpm build` pass; `progress-tracker.md` and `ui-context.md` are updated, and the tracker says the design pass is complete.

## Implementation notes (2026-10-25)
- **Switching:** `usePhone()` follows `(width < 48rem)` with `useSyncExternalStore`, the same edge as Tailwind's `max-md:`, so the layout chosen in script and the sizes chosen in CSS never disagree. The desktop shell and its 1100 px minimum width are untouched from 768 px on.
- **Areas:** chat and overview stay mounted with `hidden` while another area is open; the canvas mounts only on its tab (React Flow needs a size, and the board's connection and presence belong to someone looking at it). The page counts every way the chat or the overview opens the canvas (a reference, a board or the plan from "Wartet auf dich" or "Seit du weg warst"), and the phone layout switches to the canvas on each; an address that names a board, the plan or an element starts there.
- **Read-only on a phone:** the workspace passes `readOnly` to the canvas, the board tabs and the plan below 768 px (and takes "Im Chat fragen", generating and deciding in the plan away), so the read-only canvas of viewers serves everyone; on the overview every proposal's board counts as "elsewhere" and is a link.
- **Touch targets:** `TOUCH_TARGET` (an `::after` area of at least 44 × 44 px around the center, below 768 px only) is part of every button and icon button and of the board tabs and the language switch; a script over the open workspace at 390 × 844 found no smaller target except the references inside messages; the items of the @ menu were 34 px and became 44 px on a phone.
- **Verified** with the running `pnpm dev` as olga at 390 × 844: chat, canvas (reference from the chat to its element, panning, no tools) and overview in light and dark; a raised hand and a moderator offer written into the dev database by hand and removed again (the count "1" on "Überblick", the 44 px offer buttons, the hand card); the read-only view with a link made and switched off again (canvas light, overview dark); the project list; and the workspace at 1440 × 900 unchanged (372 / 720 / 300 px columns, 14 px composer text, no enlarged targets).
- **Contrast:** only token pairs that spec 36a checked; the "+N" uses `text-2` on the panel.
