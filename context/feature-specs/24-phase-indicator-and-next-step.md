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
- [ ] A new project starts in "Brainstorming"; the phase bar shows the project's phase with done, current and upcoming phases.
- [ ] Owners and editors jump to any phase from its card; everyone sees the change live with a note. Viewers cannot change it.
- [ ] The agents' context names the phase; the moderator changes it on an instruction and only suggests it otherwise.
- [ ] "Moderator fragen" asks for the next step in the chat, and the moderator answers with where the project stands and what comes next.
- [ ] The observer can let the moderator offer the next phase; accepting changes the phase.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the database, the API, the tool, the observer and the components pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
