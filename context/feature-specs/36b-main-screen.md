# 36b The Main Screen in the New Layout

## Goal
The main screen takes on the layout and the looks of the approved design "Covibes Studio" (`context/design/studio/`): the top bar with the phase bar and "Im Raum", the chat with bubbles, the canvas with floating tabs and toolbar and the four block states of the handoff, and the overview with its cards. What the screen does stays as it is.

Second part of spec 36 (the design pass).

## Design decisions
- **Owner decisions (2026-10-24):** see spec 36a. The coding agent carries out the design pass and derives what the handoff does not show; every derived look is listed in `ui-context.md` under "Derived looks" and confirmed or replaced in 36c.
- **Behavior and texts stay.** Every action, state and i18n text of the main screen keeps working; new texts are only added where the handoff has a label the app did not have yet.
- **The top bar** stands on the app background without panels around it, in three columns: logo, wordmark and the project menu on the left; the phase bar in the middle; "Im Raum", the bell, the theme button and "Teilen" on the right.
- **The phase bar** shows the step, the phase's name, four segments and what comes next. The segments and the name stay buttons that open the card of their phase (spec 24). The current segment shows the track 60 % filled, as in the handoff: Covibes does not measure progress inside a phase, so the fill only marks "running". In the last phase "Danach" is left out.
- **"Im Raum"** shows the members and the team:
  - the people overlapping, the signed-in user first as "Du" (it opens the account menu as before); a green dot on everyone else who has the open board open right now, read from the board's awareness (no new server state)
  - the agents of the team overlapping as their marks (they open the team popover as before); the agent that is writing in the chat glows (`animate-glow`), an agent with a raised hand carries the hand badge in its base color
- **The theme button** switches between light and dark with `chooseTheme`; the choice "Wie das System" stays in the account menu.
- **Chat:**
  - Messages of others are bubbles on the left with a 30 px avatar; own messages are ink bubbles on the right without an avatar; agents write into bubbles in their tint. Name and time stand above the bubble; "Antwort an", the debate mark, attachments, errors and "Erneut senden" keep their place around it.
  - The moderator writes a card (its tint, a 1 px inner line, radius 20) with its mark on the panel color, the chip "neutral" (or "Agent"), pill buttons and the line with a check after a choice. Comparison, vote and debate cards sit inside it as before.
  - References to the canvas are pills in the base color of the element's author with `on-ink` text; for an element a person made the base is `human`. Inside the own ink bubble, references and mention chips turn to the panel color, so they stay readable.
  - The raised hand is a card in the agent's tint with its mark and the hand badge, "Anhören" as a pill on the panel color and the X to dismiss.
  - The composer is a 52 px pill on the subtle surface: @, the text, attach, send. It still grows to six lines; then it keeps its radius of 26 and the buttons stay at the bottom. "Enter sendet" is read to screen readers only.
  - Messages appear with `animate-rise`; on the first load the last ones rise one after the other, 80 ms apart.
- **Canvas:**
  - The board tabs float over the canvas as pills (the open one on the panel with the block shadow), the "+" as a round icon button; "Verlauf" and "Projektplan" stand at the right end as ghost pills. In the plan the same row heads the plan.
  - The toolbar is a floating pill at the bottom center with 40 px round icon tools; the tool's name is its tooltip and accessible name. "Auswählen" comes first and is pressed while no other tool is, which is the state the canvas starts in (spec 10).
  - Blocks: radius 18 without a border, a round 32 px icon tile, the author line at the bottom without a divider; hover lifts them by 2 px. The four states as in the handoff: "just drawn" with a 2 px ring in the agent's base, its glow, the widening outline (`animate-ring`) and the pill "Gerade gezeichnet" with the twinkling sparkle; "proposal" with a 2 px dashed base on the tint, radius 20; "locked" with a 2 px ring in `human`, the lock ring, the pill "<Name> bearbeitet" and the caret.
  - Arrows 2 px with round caps and an open chevron head, an agent's arrow 2.25 px in its base right after its change; labels are mono pills on the panel.
  - Frames `rounded-frame` on `bg-frame` with a 1 px inner line, the title in the display font and the count as a pill; notes with the radius `6 6 22 6`, tilted by 2° unless they are being edited.
- **Overview:** no panel title; "Wartet auf dich" in the panel title style with the count pill, its cards on the subtle surface (radius 18) with pill buttons, completed items as lines with a green check in a circle; "Entscheidungen" as one row per topic with a status circle and the value or an "offen" pill; "Kriterien" as outlined pills. "Seit du weg warst" takes the same section look.
- **Hover and press:** ghost buttons get a neutral wash, solid buttons brighten, blocks lift; everything stops under reduced motion (spec 36a).

## Implementation

### Web: tokens and building blocks
- `theme.css`: the lock ring as `shadow-lock` (`0 0 0 2px human` plus the soft ring), a hover wash token for ghost buttons on the app background if the existing ones do not fit.
- `panel.tsx`: the panel no longer forces a header row; `PanelHeader` 58 px without a divider, `PanelTitle` in the display font.
- `button.tsx`: a variant for buttons on a tinted or subtle card (the panel color without a border).

### Web: top bar (`features/workspace/`)
- `workspace-shell.tsx`: rows `64px 1fr`, columns `372px minmax(0,1fr) 300px`, gap 12, padding `0 12px 12px`; the overview without a header.
- `workspace-header.tsx`, `phase-indicator.tsx`: the top bar and the phase bar; `room.tsx` for "Im Raum"; `theme-button.tsx`.
- `team-menu.tsx`: the trigger as overlapping 30 px marks with glow and hand badge.
- The open board reports who is on it (`use-live-cursors.ts`), the workspace passes it to "Im Raum".

### Web: chat (`features/chat/`, `features/hands/`)
- `chat-panel.tsx`, `message-list.tsx`, `chat-message.tsx`, `mention-text.tsx`, `reference-chip.tsx`, `status-pill.tsx`, `composer.tsx`, `raised-hands.tsx`.

### Web: canvas (`features/canvas/`, `features/proposals/`, `features/plan/`)
- `canvas-panel.tsx`, `board-tabs.tsx`, `canvas-toolbar.tsx`, `block-node.tsx`, `node-chrome.tsx`, `canvas-arrow.tsx`, `frame-node.tsx`, `note-node.tsx`, `live-cursor.tsx`, `proposal-layer.tsx`, `plan-panel.tsx`.

### Web: overview (`features/proposals/`, `features/decisions/`, `features/away/`, `features/git/`)
- `waiting-for-you.tsx`, `decisions-section.tsx`, `criteria-section.tsx`, `since-you-were-away.tsx`, the cards of Git requests and reviews.

### i18n
- `workspace.step`, `workspace.next`, `workspace.inRoom`, `theme.toLight`, `theme.toDark`, `canvas.tools.select`, `history.button` (German and English).

### Docs
- `ui-context.md`: layout, the building blocks of chat, canvas and overview, the block states as built, and the derived looks of this part.

## Out of scope
- every other screen and dialog, the read-only view, the choice of a custom agent's mark, and the mobile view (36c); shared building blocks they use change with this part where the main screen needs it
- measuring progress inside a phase
- presence of people beyond the open board

## Dependencies
- Spec 36a (design system and themes), `context/design/studio/`, and the specs of the parts that change their looks: 06, 08–11, 13–16, 22–24, 37, 38

## Checklist
- [x] The main screen matches the handoff at 1440 × 900 in light and dark: top bar, phase bar, "Im Raum", chat, canvas, overview.
- [x] The phase bar opens the card of every phase as before; the theme button switches the theme and keeps the choice.
- [x] "Im Raum" shows who is on the open board, which agent is writing and which one raises its hand.
- [x] Bubbles, the moderator card, references, the raised hand and the composer look as in the handoff, and every chat action still works (sending, retry, mentions, attachments, offers, votes, debates, references).
- [x] The four block states, arrows, frames, notes, tabs and toolbar look as in the handoff, and every canvas action still works.
- [x] The overview cards, decisions and criteria look as in the handoff, and every action still works.
- [x] Text reaches 4.5:1 on its background in both themes, also inside bubbles and pills.
- [x] With reduced motion nothing moves.
- [x] The derived looks are listed in `ui-context.md`.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm test`, `pnpm db:types:check` and `pnpm build` pass; `progress-tracker.md` is updated.

## Implementation notes (2026-10-24)
- **Built in two sessions:** the first worked out the spec and built the screen, then ended at its usage limit before testing; the second updated the tests, checked everything and finished the docs.
- **Top bar** (`workspace-header.tsx`, `phase-indicator.tsx`, `room.tsx`, `theme-button.tsx`, `team-menu.tsx`): the three columns on the app background; the phase bar with step, name, segments and "Danach"; "Im Raum" with the people and the team's marks (glow while writing via `animate-glow`, the hand badge from `hand-badge.tsx`); the theme button calls `chooseTheme`.
- **Presence:** `use-live-cursors.ts` reports who is on the open board from the awareness the board already shares; `@covibes/shared` got a helper for it in `canvas/awareness.ts`. No new server state.
- **Chat** (`chat-message.tsx`, `message-list.tsx`, `mention-text.tsx`, `reference-chip.tsx`, `composer.tsx`, `raised-hands.tsx`, `status-pill.tsx`): bubbles, the moderator card with the chip "neutral", references as pills in the author's base, the raised hand card, the composer pill; messages rise with `animate-rise`. The i18n key `chat.agentNeutral` became `chat.neutral`; the placeholder follows the handoff ("Schreib dem Team, @ ruft einen Agenten").
- **Canvas** (`canvas-panel.tsx`, `board-tabs.tsx`, `canvas-toolbar.tsx`, `block-node.tsx`, `node-chrome.tsx`, `canvas-arrow.tsx`, `frame-node.tsx`, `note-node.tsx`, `proposal-layer.tsx`, `plan-panel.tsx`): the block states as rings instead of borders (`aiRing` is now a 2 px ring in the base plus the glow, `JustDrawnOutline` adds the widening outline), arrows with open chevron heads, frames and notes in the new shapes, floating tabs and toolbar.
- **Overview** (`waiting-for-you.tsx`, `decisions-section.tsx`, `criteria-section.tsx`, `since-you-were-away.tsx`, Git cards): cards on the subtle surface, decision rows with pills, criteria as outlined pills. `AGENT_HAND`, `AGENT_HAND_BUTTON` and `AGENT_REFERENCE` were removed, since the new looks need them no more.
- **Tests:** 46 web tests checked the looks of before (borders, square chips, "Agent · neutral", the old placeholder); they check the new looks now, and a few gained checks of the new parts (the widening outline, bubble sides and corners). All 2404 tests pass.
- **Verified** with `pnpm dev` and the browser as olga at 1440 × 900 in the project "Vereins-App", in dark (the theme stored on the device) and, with the theme button, in light; the layout measured 372 / 720 / 300 px under a 64 px top bar; the session request answered 200 once the server was up. The theme was set back to dark afterwards. Not tried live: a running agent answer, a raised hand and proposals on the canvas; tests cover them.
