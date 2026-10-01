# 16b Comparison, Voting and Project Settings

## Goal
The moderator compares options with a card that assesses them by the project criteria. A project chooses how it decides: by consensus with confirmation, by vote, by its owner, or informally in the chat. It also chooses the moderator's stance. Both, with the existing switches, are set in the project settings.

This is the second part of spec 16; part 16a brought criteria, decisions and the log with the default process.

## Design decisions
- **Comparison** (`project-overview.md`, "Detailed rules": "a comparison appears as a card in the chat and is attached to the log entry"):
  - The moderator compares two to four options with the tool `compare_options`: one row per criterion, and per option a rating (fits, partly, does not fit) with a short note. The card belongs to the moderator's answer and shows in its chat card (derived look).
  - Showing a comparison changes nothing, so it runs directly, on a request ("vergleiche …") and after an accepted offer.
  - A decision on the same topic takes the latest comparison along: it shows in the decision's dialog, and the log entry refers to it.
  - Whether the card ends with a recommendation depends on the stance.
- **Stance of the moderator** (`project-overview.md`, "Stance, configurable per project"):
  - "Neutral nach euren Kriterien" (default): it assesses by the criteria and says which option they favor, without preferences of its own.
  - "Mit eigener Meinung": it also says what it would choose and why.
  - "Strikt neutral": it lays out options and arguments and never recommends; comparisons carry no recommendation.
  - The chat badge of the moderator reads "Agent · neutral" except with its own opinion.
- **Decision processes** (`project-overview.md`, "Decision process, configurable per project"):
  - **Consensus with confirmation** (default): as in 16a.
  - **Vote by card:** decisions are made by a vote. The moderator starts one with the tool `start_vote` (topic and two to five options); the card shows in its chat card. Every owner and editor has one vote and may change it while the vote is open; who voted for what is visible. The vote ends when all of them have voted or when an owner ends it. The option with the most votes is recorded as the decision, with the result; a tie ends the vote without a decision, and the topic stays open. In this process the moderator does not record decisions any other way. A vote can also be started on request in the other processes.
  - **The owner decides:** a decision the moderator records waits for the owner; only owners confirm it. It is recorded directly only when an owner gave the instruction or accepted the offer.
  - **Informally in the chat:** the moderator records what the team decided right away whenever it is called, without a confirmation step. Unasked it still only offers (spec 15).
  - The proposals-only mode keeps its precedence: there, decisions always wait for confirmation.
- **Project settings** (derived look): the project menu opens "Einstellungen", a dialog with the stance, the decision process, "Nur Vorschläge" and "Agents melden sich". Owners change them; everyone else sees them. The two switches leave the menu.
- **The observer** knows the decision process: in a project that votes, it offers a vote on consensus instead of recording.

## Implementation

### Database: migration `0010_comparisons_and_votes.sql`
- `comparisons`: `id`, `project_id`, `message_id` (the moderator's message), `topic`, `data` (options, rows, recommendation), `created_at`. RLS: members read.
- `votes`: `id`, `project_id`, `message_id`, `topic`, `options`, `status` (`open`, `closed`), `winner`, `tally`, `closed_at`, `closed_by`; one open vote per topic. `vote_ballots`: `vote_id`, `user_id`, `option`. RLS: members read.
- `decisions`: `comparison_id` and `vote_id`; `decide` attaches the latest comparison of the topic, and the log entry carries it and the vote's result.
- Functions: `cast_vote(vote, option)` for owners and editors, which ends the vote once everyone has voted, and `close_vote(vote)` for owners. Ending records the decision of the winner.
- `record_decision` lets only owners confirm while the owner decides; `proposals.reason` also allows `owner_decides`.

### Shared: `packages/shared/src/`
- `Comparison`, `MessageVote`; `ChatMessage.comparison` and `ChatMessage.vote`; `Decision.comparison` and `Decision.tally`.
- Project settings `stance` and `decisionProcess` in `ProjectDetails` and `UpdateProjectInput`.

### Server
- **Tools of the moderator:** `compare_options` and `start_vote`; `record_decision` follows the decision process.
- **Agent turn:** the context states the stance and the decision process.
- **API:** `POST /api/projects/:projectId/votes/:voteId/cast` `{ option }` and `…/close`; messages carry their comparison and vote; `PATCH /api/projects/:projectId` takes `stance` and `decisionProcess`; applying a decision proposal respects the process.
- **Observer:** its context states the decision process.
- **Tests:** the functions with roles and the ways a vote ends, the tools per process and stance, the API, and the agent turn's context.

### Web
- **Chat:** the comparison card and the vote card in the moderator's card; the badge follows the stance.
- **Decision dialog:** the comparison and the result of a vote.
- **Waiting for you:** while the owner decides, only owners get "Bestätigen".
- **Project settings:** the dialog, opened from the project menu.
- **i18n:** `comparison.*`, `votes.*`, `settings.*`.

## Out of scope
- variants A/B on the canvas (spec 17) and debates (spec 18)
- secret votes, deadlines for votes and weighted votes
- settings beyond the four named here (Git approval rights come with spec 29)

## Dependencies
- Spec 16a
- Packages: none new

## Checklist
- [ ] On request the moderator compares options by the criteria in a card; the decision on that topic shows the comparison.
- [ ] The stance changes how the moderator assesses: with "Strikt neutral" comparisons carry no recommendation.
- [ ] With "Abstimmung" a vote card collects the votes of owners and editors, ends when all voted or an owner ends it, and records the winner; a tie records nothing.
- [ ] With "Owner entscheidet" only owners confirm decisions; with "Formlos im Chat" the moderator records without confirmation.
- [ ] Owners change stance, decision process and the two switches in the project settings; everyone else only sees them; changes appear live.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for functions, tools, API and the agent turn pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
