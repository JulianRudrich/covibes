# 24 Phase Indicator and Next Step

## Goal
The phase bar at the top is true for the project: it shows where the team stands on the way brainstorming → decide → architecture → project plan, anyone who works on the project can jump to another phase, and the moderator says what the next step is, when asked and when it sees that a phase has done its work.

## Design decisions
- **A project has one current phase.** A new project starts in "Brainstorming". The phases before the current one show as done, the ones after it as upcoming, as in the handoff.
- **Phases are orientation, not a gate:** nothing is locked in any phase. Every tool, every board and the chat work the same everywhere.
- **Jumping:** a click on a phase opens a small card that says what the phase is for. Owners and editors change to it there with one more click, forward or back; viewers only read. Everyone sees the change at once, with a short note over the canvas.
- **The agents know the phase.** Every agent's context names it, and the shared rules say what fits each phase: collect and structure ideas while brainstorming, weigh options by the criteria while deciding, work on the diagrams in the architecture, on scope, milestones and tasks in the plan. Whatever someone asks for is still answered.
- **The moderator suggests the next step:**
  - Asked where the project stands or how to go on, it says what the current phase has achieved and what is still open, and suggests the next step: something inside the phase, or the change to the next one.
  - The card of the current phase has a button that asks exactly that in the chat, in the person's name.
  - After a pause in the chat the observer (spec 15) may let the moderator offer to move on, when the work of the phase looks done. This is a third kind of offer next to consensus and being stuck, with the same limits; accepting it lets the moderator change the phase and say how to start there.
- **The moderator changes the phase only when told:** on an instruction or an accepted offer it changes it with its tool `set_phase`. On a question, on its own initiative and in the proposals-only mode it changes nothing and suggests the change in words; the team jumps with a click.

## Implementation

### Database: migration `0021_phases.sql`
- `projects.phase`: the current phase, "brainstorming" by default.
- `set_project_phase(project, phase)`: owners and editors change the phase.
- A trigger announces a changed phase on the live channel, whoever changed it.
- `offers.kind` gets `next_step`.

### Shared: `packages/shared/src/`
- `phase` on the project details, the input for changing it, the offer kind `next_step`.

### Server
- **API:** the project details carry the phase; `PUT /api/projects/:projectId/phase` changes it.
- **Agents:** the phase in every agent's context; `prompts/common.md` and `prompts/moderator.md` say what the phases are for and how the moderator suggests the next step.
- **Tool `set_phase`** for the moderator, through the rule engine.
- **Observer:** knows the phase and may offer the next one.
- **Tests:** who changes the phase and who does not, the live announcement, the context of the agents, the tool for every intent, the observer's new offer.

### Web
- **Phase bar:** the phases as buttons with their card: what the phase is for, "Zu dieser Phase wechseln", and in the current phase "Moderator fragen".
- **Workspace:** the phase of the project instead of the sample data, and the note when it changes.
- **i18n:** `phases.*`.

## Out of scope
- progress inside a phase as a number or a bar
- what the phase "Projektplan" shows: the plan, its suggestions and versions (spec 25)
- the phase in the read-only view and on the project list
- a history of the phase changes, and phase changes in "Since you were away"
- phases of one's own, or other names for them

## Dependencies
- Spec 03 (the phase bar), spec 13 (rule engine), spec 15 (observer and offers), spec 16 (criteria and decisions, which tell the moderator how far a phase is)
- Packages: none new

## Checklist
- [x] A new project starts in "Brainstorming"; the phase bar shows the project's phase with done, current and upcoming phases.
- [x] Owners and editors jump to any phase from its card; everyone sees the change live with a note. Viewers cannot change it.
- [x] The agents' context names the phase; the moderator changes it on an instruction and only suggests it otherwise.
- [x] "Moderator fragen" asks for the next step in the chat, and the moderator answers with where the project stands and what comes next.
- [x] The observer can let the moderator offer the next phase; accepting changes the phase.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for the database, the API, the tool, the observer and the components pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-02)
- **The phase** is the column `projects.phase` with the four keys `brainstorming`, `decide`, `architecture` and `plan`; projects that existed before start in brainstorming.
  - The app role has no grant on the column: owners change a project's name and settings, but the phase is the team's. Owners and editors change it through `set_project_phase`, which `PUT /api/projects/:projectId/phase` calls; viewers get 403.
  - A trigger announces every change of the phase as a `project` event on the live channel, also when the worker changed it for the moderator. The web app reloads the project and shows the note "Das Projekt ist jetzt in der Phase „Architektur“." to everyone, the person who changed it included.
- **The agents:**
  - Every agent's context has a section `<phase>` with the current phase, what it is for and the phase after it (`agents/phases.ts`). `prompts/common.md` says that the phase is orientation and how it guides what an agent adds on its own.
  - `set_phase` is a tool of the moderator only. It goes through the rule engine like every tool: on an instruction or an accepted offer the phase changes; on a question, on the moderator's own initiative and in the proposals-only mode nothing changes, and the result tells the moderator to suggest the change in words. There is no proposal for a phase: for the team it is one click.
  - `prompts/moderator.md` says how to answer "where do we stand": what the phase achieved, the two or three open points that matter most, one next step, no percentages.
  - The intent classifier (spec 13) now counts "weiter zur Architektur" and "wir gehen jetzt in die Phase …" as an instruction. The live test found that it took such a sentence as a question, so the moderator's tool changed nothing.
- **The observer** gets the same `<phase>` section and a third reason for an offer, `next_step`, with when a phase has done its work. The limits of offers stay: one open at a time and three messages by people in between. Accepting queues the moderator's run with the task to change the phase, which counts as an instruction.
- **Web:**
  - `PhaseIndicator`: every phase is a button that opens its card (a popover): the name, "Abgeschlossen", "Aktuelle Phase" or "Kommt noch", and what the phase is for. Another phase has the primary button "Zu dieser Phase wechseln"; the current one has "Moderator fragen" with a line that says what it does. Viewers get the cards without buttons.
  - Jumping shows at once and is taken back with a note if the server refuses.
  - "Moderator fragen" sends "@Moderator Wo stehen wir, und was ist der nächste Schritt?" as an ordinary chat message of the user, in the language of their app.
  - The sample phase of spec 03 (`demo-workspace.ts`) is gone.
- **Tests:** the database test of the live announcement counts only its own project, since other test files announce theirs at the same time. The web tests get 15 seconds per test (`vite.config.ts`): in a complete run next to `pnpm dev`, two tests of large dialogs that this spec does not touch ran into Vitest's five seconds once and passed in the next run.
- **Verified** with `pnpm dev` and the browser as olga in "Vereins-App":
  - The bar showed "Brainstorming" as current. The card of "Entscheiden" said "Kommt noch" with its description; "Zu dieser Phase wechseln" moved the bar, the server stored `decide`, and the note appeared.
  - "Moderator fragen" posted the question; the moderator answered with what is decided, what is open and a next step (to decide how the training times are loaded), and the phase stayed. The answer had three paragraphs; the prompt now asks for four or five sentences.
  - "@Moderator wir gehen jetzt weiter zur Architektur." changed nothing at first (see the classifier above). After the fix the moderator changed the phase, the bar followed without a reload, and it suggested how to start.
  - Back in "Entscheiden", two messages about a settled question made the observer offer to record it (accepted, recorded). Three more messages ("alle Entscheidungen festgehalten", "weitermachen") made it offer the next step: "Soll ich das Projekt jetzt in die Phase Architektur verschieben?" with the button "Ja, zur Architektur". The button in the chat changed the phase.
  - The card of an upcoming phase was checked from a screenshot; the card of the current phase only from the page's content, because the browser pane was hidden and gave no more screenshots.
  - What viewers see, a refused change and the note for a change by someone else are covered by the tests; they were not tried live with a second person.
- **Known limits:**
  - A project has one current phase: after a jump back, the phases after it show as upcoming again, although the team was there before.
  - The phase changes nothing but the bar, the note and what the agents are told. The plan itself comes with spec 25.
  - Phase changes are not recorded: there is no history, and "Seit du weg warst" does not list them.
  - The read-only view and the project list do not show the phase.
