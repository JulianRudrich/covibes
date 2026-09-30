# 15 Observer: Offering Help and Raised Hands

## Goal
Agents take part without being called, but never act unasked. After a pause in the chat an observer looks at the conversation: when the team agrees or is stuck, the moderator offers help; when a specialist of the team sees an important risk, it raises a hand and only speaks after a click.

## Design decisions
- **Observer** (`architecture.md`, "Observer job" and "Chat and live answers"):
  - Every human message schedules the job `observe` 15 seconds later with the job key `observer:{projectId}`; a newer message replaces it, so the observer only looks after a pause.
  - While an agent of the project waits or works, the observer postpones itself by 10 seconds, at most for 5 minutes, so it sees the answers too.
  - It only looks when there are human messages since its last look.
  - **Model** (owner decision, 2026-09-30): Claude Sonnet 5.5, with fixed instructions (`prompts/observer.md`) and the chat as data. It answers in JSON, which the worker validates; anything invalid counts as "nothing to do".
  - Every look is metered as a run of the kind `observe` for the moderator; it does not show in the chat status.
  - What the observer starts counts as own initiative (`architecture.md`, "Intent").
  - It is restrained: most looks end with nothing to do. The prompt lists earlier offers and raised hands with their outcome, so it does not repeat itself.
- **Offering help** (`project-overview.md`: "It also notices when the team agrees or is stuck and then offers help. It never starts on its own."):
  - On consensus or when the team is stuck, the moderator posts a short offer in the language of the conversation. Its card (handoff: moderator message with action buttons) has two buttons: the offer's action, e.g. "Ja, zusammenfassen" (primary), and "Später" (secondary).
  - A click by an owner or editor replaces the buttons for everyone with a line with a check (handoff: "Postponed"): "Angenommen von Sam" or "Verschoben von Sam".
  - Accepting starts a moderator run with the offer's task. The person accepted it, so it counts as an instruction and the moderator draws directly.
  - At most one offer is open at a time; a new one needs at least three new human messages since the previous one.
  - Until the decision log exists (spec 16), a consensus offer proposes to sum up the agreement and note it on the canvas; spec 16 turns it into recording the decision.
- **Raised hands** (`project-overview.md`, "Specialists" and "Detailed rules"):
  - A specialist of the team raises a hand on an important risk, contradiction or gap in its field that nobody has named yet. The moderator never raises a hand.
  - The card sits above the composer as in the handoff: agent tint, a 28 px square in the agent color with a hand icon, "**Kritiker meldet sich** – Einwand zu den Kosten" and the button "Anhören". Other agents than the critic use their tint and border (derived look).
  - At most two raised hands are open per project, and one per agent. They stay until someone listens to them or dismisses them ("Nicht jetzt", an icon button on the card; derived look).
  - "Anhören" (owners and editors) removes the card for everyone, and the agent posts its objection. Its canvas changes are proposals (own initiative).
  - Viewers see the cards but cannot act on them.
  - The chat status counts open raised hands as waiting, as in the handoff ("1 wartet").
  - "Waiting for you" and notifications list raised hands with spec 22.
- **Switch:** owners switch the observer off and on in the project menu ("Agents melden sich", on by default); switched off, no observer jobs are scheduled, and open raised hands stay. Project settings get their own screen with spec 16.

## Implementation

### Database: migration `0008_observer.sql`
- `hand_raises`: `id`, `project_id`, `agent_key`, `reason` (at most 300 characters), `status` (`open`, `heard`, `dismissed`), `created_at`, `decided_at`, `decided_by`, `run_id`. At most one open raised hand per agent (partial unique index). RLS: members read; clients never write directly.
- `offers`: `id`, `project_id`, `message_id` (the moderator's message), `kind` (`consensus`, `stuck`), `action` (the button text), `task` (what the moderator does when accepted), `status` (`open`, `accepted`, `declined`), `created_at`, `decided_at`, `decided_by`, `run_id`. RLS: members read.
- `ai_runs`: `kind` (`reply` or `observe`), `hand_raise_id` and `offer_id` for runs that a raised hand or an accepted offer started.
- Functions for owners and editors, which create the run and its job in one step, like the mention trigger: `listen_to_hand(hand_id)`, `dismiss_hand(hand_id)` and `decide_offer(offer_id, accept)`.
- A trigger on human messages schedules the observer, unless the project switched it off (`settings.observer = false`).

### Shared: `packages/shared/src/`
- `HandRaise` (`id`, `agentKey`, `reason`, `createdAt`); `ChatMessage.offer` (`id`, `kind`, `action`, `status`, `decidedBy` name) or null.
- Live event `hands`; `ProjectDetails.observer` and `UpdateProjectInput.observer`.

### Server
- **Observer task** (`tasks/observe.ts`): postpones itself while agents work, loads the latest 30 messages, the team with its roles, open and recent raised hands and offers, asks the model and applies its answer under the limits above: an offer as a moderator message with its `offers` row, raised hands as `hand_raises` rows. Both are announced live.
- **Agent turn:** a run of a raised hand answers the hand ("You raised your hand because …; state your point now") with the intent own initiative; a run of an accepted offer does the offer's task as an instruction and answers the offer message.
- **API:**
  - `GET /api/projects/:projectId/hands` lists the open raised hands; `POST …/hands/:handId/listen` and `POST …/hands/:handId/dismiss` for owners and editors.
  - `POST /api/projects/:projectId/offers/:offerId/accept` and `…/decline` for owners and editors; everyone gets the changed message live.
  - Messages carry their offer; `GET …/runs` and the live events only show runs of the kind `reply`.
  - `PATCH /api/projects/:projectId` takes `observer` (owners).
- **Tests:** the observer's limits and when it does not look, the task with a scripted model, the functions and routes with roles, the trigger, and agent turns from a raised hand and from an offer.

### Web
- **Chat:** the raised hands above the composer; the buttons of an open offer in the moderator's card and the line after the decision; the status pill counts open raised hands.
- **Project menu:** "Agents melden sich" for owners.
- **i18n:** `hands.*`, `offers.*`, `workspace.observer`.

## Out of scope
- raised hands in "Waiting for you" and notifications (spec 22)
- recording decisions and the criteria question on first use (spec 16)
- debates between agents (spec 18) and "Since you were away" (spec 23)
- the project settings screen (spec 16)

## Dependencies
- Spec 14
- Packages: none new

## Checklist
- [ ] After a pause in the chat the observer looks once; while an agent answers, it waits for the answer.
- [ ] When the team agrees or is stuck, the moderator offers help with its action and "Später"; accepting makes it act, declining shows "Verschoben"; everyone sees the decision live.
- [ ] A specialist of the team raises a hand on a risk; at most two are open; "Anhören" lets it speak, "Nicht jetzt" removes it; viewers only see the cards.
- [ ] Owners switch the observer off and on in the project menu.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the observer, the functions and routes, the trigger and the agent turns from raised hands and offers pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
