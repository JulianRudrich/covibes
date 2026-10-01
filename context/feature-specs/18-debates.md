# 18 Debates

## Goal
On request two or three specialists debate a question visibly in the chat: they take turns for a limited number of rounds and answer each other. At the end the moderator sums up where they agree and where they differ, and the team decides.

## Design decisions
- **On request only** (`project-overview.md`: "usually the moderator collects the opinions and summarizes them. On request there is a visible debate between agents with a limited number of rounds"): a debate costs several agent answers, so nobody starts one unasked. The moderator opens it when someone asks for a debate or accepts its offer of one (spec 15); the observer may offer a debate when two fields pull in different directions.
- **Who debates:** two or three specialists of the team, named by the person who asks or chosen by the moderator for the question. The moderator leads the debate and does not argue in it. An agent outside the team has to be added first.
- **Rounds:** a round is one turn of every participant, in the order the debate names them. Two rounds by default, at most three; one debate at a time per project.
- **A job chain** (`architecture.md`, "Debates: a job chain with a fixed number of rounds. At the end the moderator summarizes"): every turn is an ordinary agent run with its own message, streamed like any answer. When a run of the debate ends, the database queues the next one: the next participant, or after the last turn the moderator's summary. No path can skip a turn or add one.
- **Turns only talk:** in a debate turn and in the summary the agent has no tools; it neither draws nor records anything. A turn is short (at most four sentences), argues by the project's criteria and answers what the others said; in the last round it concedes what the others got right. The summary follows the moderator's stance and decides nothing.
- **Visible in the chat** (derived look):
  - The moderator's message that opens the debate carries a debate card: the topic, the question, the participants and where the debate stands ("Runde 1 von 2 · Backend ist dran").
  - Every turn and the summary are marked "Debatte · Runde 1 von 2" or "Debatte · Zusammenfassung" above their text.
- **Ending early:** owners and editors end a running debate with "Debatte beenden" on the card. The turn that is being written is finished, then the moderator sums up what was said so far. A debate ended before its first turn ends without a summary.
- **When a turn fails for good** (e.g. the AI quota is used up, or the agent left the team), the debate is aborted without a summary, so a broken debate does not burn through further runs; the card says so.
- **People in between:** the chat stays open during a debate. What people write is part of the conversation the next turn reads; mentions are answered as usual, in the agent's queue.
- **Not tied to a decision:** a debate has a topic and a question but records nothing. After the summary the team decides the usual way (spec 16).

## Implementation

### Database: migration `0012_debates.sql`
- `debates`: project, the opening message, topic, question, participants, rounds, finished turns, status (`running`, `summarizing`, `done`, `failed`) and who ended it early. At most one debate per project that is not finished.
- `ai_runs.debate_id` and `ai_runs.debate_round` (the round of a turn; empty for the opening answer and the summary).
- A trigger on `ai_runs` advances the debate when one of its runs ends: it counts the turn and queues the next participant or the moderator's summary, ends the debate after the summary, and aborts it when a run failed. It announces the opening message, so the card updates live.
- Function `stop_debate(debate)` for owners and editors.

### Shared: `packages/shared/src/`
- `MessageDebate` (the card) and `MessageDebateTurn` (the mark on a turn or the summary) on `ChatMessage`; limits and the helper that tells round and speaker from the finished turns.

### Server
- **Tool of the moderator:** `start_debate` `{ topic, question, participants, rounds? }`. It checks the participants against the team, refuses a second debate and ties the debate to the moderator's answer; the chain starts when that answer is finished.
- **Agent turn:** a run of a debate answers the debate instead of a message: the prompt names the question, the participants, the round and what the turn is for; the summary run asks the moderator to sum up. Both run without tools.
- **Observer:** may offer a debate when the team is stuck between two fields.
- **API:** `POST /api/projects/:projectId/debates/:debateId/stop`; messages carry `debate` and `debateTurn`.
- **Tests:** the chain in the database (order, rounds, summary, failure, ending early, roles), the tool, the prompts of a turn and of the summary, the API.

### Web
- **Chat:** the debate card in the moderator's message with "Debatte beenden" for owners and editors; the mark above turns and the summary.
- **i18n:** `debates.*`.

## Out of scope
- debates with the moderator or with people as participants, and more than three participants or rounds
- pausing a debate, changing its participants or continuing it for more rounds
- recording a decision or drawing from within a debate
- a separate debate view; the design pass (spec 36) decides whether the chat needs one

## Dependencies
- Spec 16b
- Packages: none new

## Checklist
- [ ] On request the moderator opens a debate between two or three specialists of the team; its answer carries the debate card.
- [ ] The participants take turns for the given number of rounds, each turn as its own streamed message that is marked as part of the debate.
- [ ] After the last turn the moderator sums up; the card shows the debate as finished.
- [ ] Owners and editors end a debate early; the moderator then sums up what was said. Viewers see the debate but cannot end it.
- [ ] A turn that fails for good aborts the debate; a second debate cannot start while one runs.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the chain, the tool, the agent turn, the API and the components pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
