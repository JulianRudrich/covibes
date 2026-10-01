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
- [x] On request the moderator compares options by the criteria in a card; the decision on that topic shows the comparison.
- [x] The stance changes how the moderator assesses: with "Strikt neutral" comparisons carry no recommendation.
- [x] With "Abstimmung" a vote card collects the votes of owners and editors, ends when all voted or an owner ends it, and records the winner; a tie records nothing.
- [x] With "Owner entscheidet" only owners confirm decisions; with "Formlos im Chat" the moderator records without confirmation.
- [x] Owners change stance, decision process and the two switches in the project settings; everyone else only sees them; changes appear live.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for functions, tools, API and the agent turn pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-01)
- **Cards belong to the answer:** a comparison and a vote are rows that point to the moderator's reply message; the chat loads a message together with them (and the ballots). A second comparison in the same answer replaces the first; an answer has at most one vote.
- **Comparison:** the model gives one rating per option and criterion by the option's name; the tool puts them into the order of the options and refuses rows that leave an option out. Strictly neutral, the tool drops a recommendation and tells the moderator not to recommend in its text either.
- **Votes in the database:** `cast_vote` stores or changes the ballot and ends the vote once every owner and editor has voted; `close_vote` lets an owner end it with the ballots cast so far. Ending counts the ballots, stores the tally and the winner, and records the winner through `decide` with the other options as discarded alternatives. A tie or no ballot ends the vote without a decision. If the topic was decided another way in the meantime, the vote keeps its result and the decision stays as it is. Both functions announce the changed message, so every card updates live.
- **Who voted for what is visible:** the ballots are part of the message; the card shows the voters' mini avatars per option. Secret votes are out of scope.
- **Decision processes in `record_decision`:**
  - vote: nothing is recorded; the tool tells the moderator to start a vote. Open topics can still be noted.
  - the owner decides: a decision that would be recorded directly becomes a proposal with the reason `owner_decides` unless an owner asked for it; confirming is refused for everyone else, in the API and in the database function.
  - informally: a question counts like an instruction, so the decision is recorded right away; the proposals-only mode still makes it a proposal.
- **Stance and process in the context:** only the moderator gets the section `<moderation>` with one sentence each; specialists are not neutral and do not need it. The observer learns the process, so it offers a vote where the project votes.
- **`decide` takes more along:** the latest comparison of the topic and the vote that decided are stored on the decision and in the log entry (`comparisonId`, `votes`). Reopening lets go of both; the log keeps them.
- **Web:**
  - The comparison card and the vote card render inside the moderator's chat card; the decision's dialog shows the comparison and, for a vote, "Per Abstimmung entschieden (React 1 · Vue 0)".
  - The own vote shows at once and is taken back with a note if the server refuses.
  - The project menu has "Einstellungen" instead of the two switches; the dialog applies every change at once and is read-only for everyone but owners.
  - While the owner decides, editors see "Der Owner entscheidet." on a decision card instead of the buttons.
  - The moderator's badge reads "Agent" instead of "Agent · neutral" with its own opinion.
- **Verified** with `pnpm dev` in the project "Vereins-App":
  - "Vergleiche bitte React und Vue für unser Frontend nach unseren Kriterien" produced a card with all seven criteria, a rating and a note per option, and a recommendation by the criteria; the text summed it up instead of repeating it.
  - In the settings the decision process was switched to "Abstimmung". "Lass uns über das Frontend abstimmen: React oder Vue" produced the vote card; one vote (the only member) ended it with "Entschieden: React".
  - "Frontend: React" then showed as decided; its dialog said "Per Abstimmung entschieden (React 1 · Vue 0)", showed the comparison and Vue as discarded, and the log entry carried the result.
  - The other processes, the stances, a tie and several voters are covered by the tests of the database, the tools, the API and the components; they were not tried live.
- **Known limits:** a vote has no deadline and cannot be reopened; a tie means discussing and voting again. Ballots are visible to the team.
