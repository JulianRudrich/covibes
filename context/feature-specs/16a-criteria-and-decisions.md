# 16a Criteria, Decisions and the Decision Log

## Goal
The project gets its criteria and its decision log. The moderator asks for the criteria on its first use and records them; it records decisions when the team confirms them, with reasoning and discarded alternatives. Both show in the overview, every change is traceable in the log, and a decision can be reopened with a reason.

Spec 16 is built in two parts. This part brings criteria, decisions and the log with the default decision process (consensus with confirmation). Part 16b adds the comparison card, voting, the other decision processes, the moderator's stance and the project settings.

## Design decisions
- **Criteria** (`project-overview.md`, "Project criteria" and "Detailed rules"):
  - Criteria are short free texts, shown as chips in the overview section "Kriterien" (handoff: "EU hosting · quality over cost · team: 3 devs"). At most 20 per project, each at most 80 characters.
  - **First use:** as long as the project has no criteria and the moderator has not asked yet, it answers what it was asked and then asks once for goals, budget, time, the team's know-how and priorities, and to answer with `@Moderator`. It records what the team states with the tool `update_criteria`; it never invents criteria.
  - Recording criteria is no change of the team's work, so it runs directly; like every change of the criteria it goes into the decision log.
  - Owners and editors add, change and remove criteria in the overview (derived look: a chip "+", editing a chip in place).
  - All agents see the criteria and assess by them.
- **Decisions** (`project-overview.md`, "Moderator", "Detailed rules"; handoff "Decisions"):
  - A decision has a topic ("Canvas"), a value ("React Flow"), the reasoning and the discarded alternatives. A topic exists once per project; it is open or decided.
  - **Deciding with confirmation** (the default process "The moderator recognizes consensus and briefly confirms it"): the moderator records a decision with the tool `record_decision`. The rule engine treats it like every change:
    - On an instruction ("halte fest: wir nehmen React Flow") or when someone accepts the moderator's offer to record a consensus (spec 15), the decision is recorded directly. The person who instructed or accepted is the one who confirmed it.
    - Otherwise, and in the proposals-only mode, it becomes a proposal of the kind `decision` under "Wartet auf dich" with "Bestätigen" and "Verwerfen". Owners and editors confirm (`project-overview.md`: editors confirm decisions).
  - The moderator may note an open topic without a value ("Hosting: noch nicht entschieden"); that runs directly.
  - A decided topic is not changed by the moderator: someone has to reopen it first.
  - **Reopening:** owners and editors reopen a decision with a reason. The decision is open again, the old one stays in the log as history, and the moderator starts a new round in the chat. Marking the plan as outdated comes with the plan (spec 25).
- **Decision log:** every decision, every reopening and every change of the criteria is an entry with who, when and why. It opens from the overview as a dialog (derived look), newest first.
- **Overview** (handoff, section 4): the sections "Entscheidungen" and "Kriterien" as in the handoff: decided with the green check circle, open with the dashed ring and the chip "offen"; criteria as chips. They show from the start, with a short hint while empty.
- **The observer** (spec 15) offers to record a consensus as a decision instead of only noting it on the canvas, and does not offer what is decided already.

## Implementation

### Database: migration `0009_decisions.sql`
- `criteria`: `id`, `project_id`, `text`, `created_by` (user) or `created_by_agent`, `created_at`. RLS: members read; owners and editors add, change and remove.
- `decisions`: `id`, `project_id`, `topic` (unique per project, case-insensitive), `status` (`open`, `decided`), `value`, `reasoning`, `alternatives` (name and note), `decided_by`, `decided_at`, `recorded_by_agent`, `reopen_reason`, timestamps. RLS: members read; clients never write directly.
- `decision_log`: `id`, `project_id`, `kind` (`decided`, `reopened`, `opened`, `criterion_added`, `criterion_changed`, `criterion_removed`), `decision_id`, `topic`, `value`, `details`, `actor_user`, `actor_agent`, `created_at`. Written by triggers on `decisions` and `criteria` only, so no path can skip the log. RLS: members read.
- Functions for owners and editors: `record_decision(project, topic, value, reasoning, alternatives, agent)` (confirming a proposal) and `reopen_decision(decision, reason)`, which also queues the moderator's new round.
- `proposals.kind` also allows `decision`; `ai_runs.decision_id` for the run of a reopened decision.

### Shared: `packages/shared/src/`
- `Criterion`, `Decision`, `DecisionLogEntry`; the proposal kind `decision` with its operation; inputs for criteria and reopening; live event `decisions`.

### Server
- **Tools of the moderator:** `update_criteria` `{ add, remove }` and `record_decision` `{ topic, value?, reasoning, alternatives }`, the second through the rule engine.
- **Agent turn:** every agent's context lists the criteria and the decisions. The moderator learns whether it still has to ask for the criteria; after its first answer the project remembers that it asked. A run of a reopened decision starts the new round.
- **API:**
  - `GET /api/projects/:projectId/criteria`, `POST`, `PATCH …/:criterionId`, `DELETE …/:criterionId` (owners and editors write).
  - `GET /api/projects/:projectId/decisions` and `GET …/decisions/log`; `POST …/decisions/:decisionId/reopen` `{ reason }`.
  - Applying a `decision` proposal records the decision in the name of the person who confirms.
  - Every change announces `decisions` on the live channel.
- **Observer:** its context lists the decisions; a consensus offer's task is to record the decision.
- **Tests:** triggers and functions with roles, the tools in both modes, the API, the agent turn (criteria question once, reopened round), applying decision proposals.

### Web
- **Overview:** the sections "Entscheidungen" and "Kriterien" as in the handoff; adding, editing and removing criteria; "Wieder öffnen" with a reason; the decision log dialog.
- **Waiting for you:** decision proposals with "Bestätigen" and "Verwerfen".
- **i18n:** `decisions.*`, `criteria.*`.

## Out of scope
- the comparison card, voting, the processes "the owner decides" and "informally in the chat", the moderator's stance and the project settings (spec 16b)
- recording a decision by hand without the moderator
- variants A/B (spec 17), marking the plan as outdated (spec 25), "Since you were away" (spec 23)

## Dependencies
- Spec 15
- Packages: none new

## Checklist
- [x] On its first use the moderator asks for the criteria once; what the team states appears as chips in "Kriterien"; owners and editors change them there.
- [x] On an instruction or an accepted consensus offer the moderator records the decision directly; otherwise it waits under "Wartet auf dich" until someone confirms it.
- [x] Decisions show in the overview as in the handoff; the log lists decisions, reopenings and changes of the criteria with who and when.
- [x] Reopening with a reason opens the decision again, keeps the old one in the log and makes the moderator start a new round.
- [x] Viewers see everything but change nothing; changes appear live for everyone.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for triggers, functions, tools, API and the agent turn pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-01)
- **The log is written by the database:** triggers on `criteria` and `decisions` insert the entries of `decision_log` and the trigger on the log announces `decisions` on the live channel. The API, the worker and the functions therefore neither log nor announce themselves. The log's time is the wall clock, so the entries of one transaction keep their order.
- **Who acted:** a criterion carries who added it (a person or an agent). For changes and removals by the worker the transaction names the agent (`app.agent_key`); a decision carries who confirmed it and which agent recorded it.
- **Deciding:** `private.decide` is the one place that records a decision. The worker calls it for an instruction with the author of the message (or the person who accepted the offer); `record_decision` calls it for an owner or editor who confirms a proposal. A decided topic raises an error there, so it can only change after reopening.
- **Decision proposals:** one proposal per decision, so each is confirmed on its own. If the topic was decided in the meantime, confirming answers "already decided" and the proposal stays open to be rejected.
- **First use:** the project remembers in its settings (`criteriaAsked`) that the moderator asked for the criteria, so it asks once even when the question has left the conversation window. As long as criteria exist it does not ask at all.
- **Reopening:** `reopen_decision` clears value, reasoning and alternatives (the log keeps them), stores the reason on the decision and queues a moderator run with `decision_id`. That run counts as a question, so the moderator asks for arguments and anything it draws is a proposal.
- **Criteria of the moderator** are inserted one after the other, so they keep the order the team stated them in.
- **Web:**
  - The overview always shows "Entscheidungen" and "Kriterien"; the hint for an empty overview is gone. Both sections load with the project and reload on the live event `decisions`; the log loads when its dialog opens.
  - A row opens the decision with reasoning, alternatives and who confirmed it; owners and editors reopen it there. "Protokoll" opens the log.
  - Criteria: a click on a chip edits it in place (Enter or leaving saves, Escape cancels, an emptied chip is removed), the "×" appears over the chip's end on hover, and the dashed chip "+" adds one.
  - Decision proposals say "Entscheidung" and "Bestätigen", and their completed line reads "… bestätigt".
- **Verified** with `pnpm dev` in a new project "Vereins-App":
  - The first answer of the moderator ended with the question for goals, budget, time, know-how and priorities and asked to answer with `@Moderator`. The answer became six chips, e.g. "MVP in 3 Monaten", "EU-Hosting" and "Wenig Wartung".
  - "Ich denke, wir nehmen PostgreSQL statt SQLite … Siehst du das auch so?" made the moderator weigh both by the criteria and propose "Datenbank: PostgreSQL"; "Bestätigen" put it into "Entscheidungen".
  - "Halte bitte fest: Das Frontend bauen wir mit React, Vue haben wir verworfen …" was recorded directly, with Vue as the discarded alternative.
  - Reopening "Frontend" with a reason showed it as open with the chip "offen"; the moderator named what was decided and why it is open again and asked for arguments by the criteria.
  - The log listed all of it, newest first, and a criterion added by hand.
  - The live test showed the criteria in a random order, because they had been inserted in one statement; fixed.
  - Viewers and the limits are covered by the tests of the database, the API and the components.
- **Known limits:** decisions cannot be recorded by hand without the moderator. The log shows its latest 200 entries. The other decision processes, the comparison card and the moderator's stance come with spec 16b.
