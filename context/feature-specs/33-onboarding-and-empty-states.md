# 33 Onboarding and Empty States

## Goal
Someone who signs in for the first time, or opens a new project, sees what Covibes is for and what to do first (`project-overview.md`, core flow "Start": "sign in, then create an empty project"; `dry-run.md`, part 1: "The new project starts empty, with chat, canvas and the phase 'Brainstorming'"). Until now an empty place said only that it is empty.

## Design decisions
- **Owner decision (2026-10-10):** this spec is built with looks derived from the prototype. The final design of login and project list comes with the design pass (spec 36), like every other derived look.
- **The introduction is where the work starts, not in front of it.** There is no tour and no dialog to click away: every empty place says what it is for and offers its first step, and it is gone with the first content. The guided onboarding with follow-up questions stays after V1 (`project-overview.md`, "After V1").
- **The project list without projects** is the welcome: what Covibes is in one sentence, how a project runs in three steps (collect, decide, hand over), and the button for the first project.
- **The empty chat** says who is reached here, and offers three first messages to the moderator: presenting the project, setting the criteria, getting to know the team. A click puts the message into the composer; the person completes and sends it. Nothing is sent by itself, since a message to an agent costs a run.
- **The empty canvas** says what goes on it and how: with the tools below, or by asking an agent in the chat. The hint lies behind everything else: it takes no clicks, is gone while something is being placed, and is no part of an export.
- **The overview** says for each empty section how it fills: decisions through the team and the moderator, criteria through the moderator's first question or by hand.
- **Viewers** read what will appear, without the steps they cannot take.
- **The login page** says in one line what Covibes is.
- Everything is there in German and English.

## Implementation

### Web
- `features/projects/project-list-page.tsx`: the welcome in place of "Noch keine Projekte".
- `features/chat/`: the empty chat with its starters; the composer takes a text to start from.
- `features/canvas/`: the hint on an empty board.
- `features/decisions/`: the texts of the empty sections.
- `features/auth/login-page.tsx`: the line under the wordmark.
- **i18n:** `welcome.*`, `empty.*`, `decisions.empty`, `criteria.empty`, `auth.tagline`.

## Out of scope
- a tour, checklists of progress, and anything that remembers what a person has seen
- the guided onboarding with follow-up questions (after V1)
- sample projects and templates for projects
- the final design of login and project list (spec 36)

## Dependencies
- Spec 21 (projects, invitations), spec 32 (both languages)

## Checklist
- [x] Without a project, the project list welcomes with what Covibes is, the three steps and the button for the first project.
- [x] The empty chat says what it is for and offers three first messages; a click fills the composer and sends nothing.
- [x] The empty canvas says how to start, takes no clicks, and is gone with the first element, while placing, and in exports.
- [x] The empty sections of the overview say how they fill.
- [x] Viewers read what will appear, without steps they cannot take.
- [x] The login page says what Covibes is.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for the web parts pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-10)
- **Project list** (`features/projects/project-list-page.tsx`): without a project the list is the welcome: "Willkommen bei Covibes", one sentence on what Covibes is, the three steps "Sammeln", "Entscheiden" and "Übergeben" with a line each, and the button "Erstes Projekt anlegen". It opens the same dialog as the page's own button, which steps back to the secondary look meanwhile, so the page has one main button.
- **Chat** (`features/chat/chat-start.tsx`): before the first message the chat shows "Hier beginnt das Gespräch", who is reached here, and under "Der Moderator hilft beim Einstieg:" three starters: "Projekt vorstellen", "Kriterien festlegen", "Team kennenlernen". A starter puts its message to the moderator into the composer, with the caret behind it; nothing is sent. The composer takes such a message through a new property `start`; a second click, also on the same starter, puts it there again. Without a moderator in the team there are no starters. Viewers read "Noch keine Nachrichten. Sobald das Team schreibt, liest du hier mit."
- **Canvas** (`features/canvas/empty-board-hint.tsx`): a board without elements shows "Dieses Board ist noch leer" and how to start, in the middle of the canvas. It takes no pointer events, is marked as no part of an export, and is not shown while a block, a note or a frame is being placed or while a proposal draws on the board. Viewers read that the board will fill.
- **Overview:** the empty sections say how they fill: "Noch keine Entscheidungen. Was ihr entscheidet, hält der Moderator hier fest." and "Noch keine Kriterien. An ihnen misst das Team Lösungen; der Moderator fragt beim ersten Mal danach." The criteria now say it to owners and editors too, above the button for the first criterion; before, they saw the button alone.
- **Login:** the line "Gemeinsam planen mit Chat, Canvas und KI-Agents." under the wordmark.
- All texts are there in German and English (`welcome.*`, `empty.chat.*`, `empty.canvas.*`, `auth.tagline`); "Noch keine Projekte" and its text are gone.
- **Verified** with `pnpm dev` and the browser as olga, without a model run:
  - In the empty test project "d": the start of the chat with its three starters, the hint on the board, and both empty sections of the overview.
  - "Projekt vorstellen" put "@Moderator Wir planen Folgendes: " into the composer with the caret at its end; no request was sent.
  - The hint on the board was gone while the note tool was active and back when it was put down. Nothing was placed, so the project stays empty.
  - The welcome was checked from a screenshot with the list of projects emptied in the browser only, since the test account has projects.
  - The login page with its line, signed out on another origin.
  - Not tried live: the views of a viewer, the English texts on screen, an export of an empty board, and the hint next to a proposal on an empty board. Tests cover the views of a viewer and that the hint carries the mark exports leave out. The English texts are only checked for being there in both languages, and the conditions in the canvas (no element, no proposal, nothing being placed) are reached by no test.
- **Decided while building:**
  - The introduction is the empty states themselves. A tour would stand between a new person and the work, and would need a place to remember who has seen it.
  - A starter fills the composer instead of sending: the person sees what is asked in their name, can change it, and decides when a run is spent. The first starter ends open ("Wir planen Folgendes: ") because only the person knows the project.
  - The hint on the canvas has no buttons. The tools are right below it, and a hint that takes clicks would be in the way of the first click on the board.
  - The welcome shows whenever the list is empty, not only at the first sign-in: someone who left all their projects is in the same place as someone new.
- **Known limits:**
  - Someone who joins through an invitation lands in a project that already has content and sees none of this; the project then explains itself through what is in it.
  - The starters are the same for every project and every phase.
  - The looks are derived; the final design of login and project list comes with spec 36.
