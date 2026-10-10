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
- [ ] Without a project, the project list welcomes with what Covibes is, the three steps and the button for the first project.
- [ ] The empty chat says what it is for and offers three first messages; a click fills the composer and sends nothing.
- [ ] The empty canvas says how to start, takes no clicks, and is gone with the first element, while placing, and in exports.
- [ ] The empty sections of the overview say how they fill.
- [ ] Viewers read what will appear, without steps they cannot take.
- [ ] The login page says what Covibes is.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the web parts pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
