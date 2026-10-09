# 29e Agents Propose Git Actions

## Goal
The moderator hands the plan over when the team asks for it: it proposes the issues from the plan, the plan package as a merge request, and the merging of a merge request (`project-overview.md`, "Humans decide"; `dry-run.md`, step 6). What it proposes is a Git request like everyone's: it waits under "Wartet auf dich", and nothing happens in the repository before someone who may approve Git actions approves it.

Fifth and last part of spec 29.

## Design decisions
- **Always a request:** the rule engine sends every changing Git action of an agent to the approval queue, whether the agent was told to, was asked a question or acts on its own. No instruction of an agent and no setting of the project changes that; an agent never approves.
- **The moderator hands over.** It gets three tools, when the project has a repository and outside of a debate:
  - `propose_issues`: issues for the plan's tasks that have none yet, for the whole plan or one milestone.
  - `propose_plan_merge_request`: the plan package as a merge request, as it is at that moment.
  - `propose_merge`: the merging of an open merge request, by its number.

  The specialists get no Git tools; the handover is the moderator's part.
- **The same requests as people's:** the tools build what the dialogs build, with the same rules: a task has one issue, one request for the package waits at a time, a draft is not merged, a merge holds the merge request's last commit. What cannot be asked for comes back to the moderator as a sentence to pass on.
- **Whose request it is:** the request names the agent that made it. Its card shows the agent like a proposal's does. Nobody takes it back; who may approve rejects it.
- **What the moderator says:** after a tool made a request, the moderator says what it asked for and that it waits for approval. It does not claim that something was created or merged.
- **The context** of the moderator names the repository's Git tools and that each only makes a request.

## Implementation

### Shared: `packages/shared/src/`
- `git-requests.ts`: a request names the agent that made it.

### Database
- Migration `0034`: `git_requests.agent_key`; the rules of a request move into one function that the people's function and the worker both use.

### Server
- `rules/decide.ts`: the outcome for a changing Git action.
- `git/agent-requests.ts`: what the three tools ask for, built in the worker from the plan, the package and the repository.
- `tools/git-tools.ts`: the three tools. `agents/catalog.ts` gives them to the moderator; `tasks/agent-turn.ts` adds them when the project has a repository.
- `agents/prompts/moderator.md` and the context of a run say how to use them.

### Web
- The card and the log show the agent that made a request.
- **i18n:** `git.*`.

## Out of scope
- Git tools for specialists and custom agents
- issues that are no task of the plan, comments on merge requests (spec 30)
- agents that approve, and approving by answering in the chat
- a card of the request inside the moderator's chat message

## Dependencies
- Spec 29d, spec 13 (the rule engine), spec 27 (the package)

## Checklist
- [x] With a repository, and outside of a debate, the moderator has the three tools; specialists have none.
- [x] Each tool makes a request that waits for approval, whatever the run's intent; nothing in the repository changes before the approval.
- [x] The request names the moderator; the card and the log show it; who may approve approves or rejects it like any other.
- [x] What cannot be asked for (no task without an issue, a package the repository holds, a draft, a request that waits already) comes back as a sentence for the moderator.
- [x] The moderator's context names the tools and that each only makes a request.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for the database, the rule, the tools, the agent turn and the card pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-09)
- **Database** (`packages/db/migrations/0034_git_agent_requests.sql`): `git_requests.agent_key`. The rules of a request are `private.insert_git_request` now, which takes who asks (a person or nobody) and the agent; `create_git_request` checks the role and calls it for the current user. The app role cannot call the private function; the worker calls it for an agent.
- **Rule** (`rules/decide.ts`): `decideGit` gives "approval" for every agent that may use the tool, and "reject" otherwise. It takes no intent and no setting of the project, so neither can change the outcome.
- **What is asked for** (`git/agent-requests.ts`): `agentGitRequests` gives, for a project with a repository, what an agent can propose. It reads the plan as it was last stored and the boards through the collaboration server, like the other jobs of the worker.
  - `issues`: the tasks of the plan (or of one milestone) that have no action in this repository, 100 at most. It answers "none", "no tasks" or "no such milestone" instead of making an empty request.
  - `planMergeRequest`: the package of that moment, compared with the default branch (`git/package-compare.ts`, which the API uses too). It answers when the plan is empty, the package is too large, the repository has no default branch or cannot be read, holds the package already, or a request waits.
  - `merge`: reads the merge request, refuses a draft and one that is not open, and holds its last commit.
  - A refusal of the database for something that is asked for already is an answer too, not a failure.
- **Tools** (`tools/git-tools.ts`): `propose_issues` (with an optional milestone), `propose_plan_merge_request`, `propose_merge` (with the number). Each asks the rule first, and words the answer as a sentence: what was requested and that it waits for approval and nothing was created, or why nothing was requested.
- **Agent turn** (`tasks/agent-turn.ts`): an agent whose definition lists the tools gets them when the project has a repository, not in a debate. The section `<repository>` of its context then names the three tools and that each only makes a request; for everyone else it says "You can only read it." The moderator's prompt has a part "Handing the plan over to the repository"; the common rules no longer say that nothing can be changed there, but that a person approves what changes.
- **Catalog:** the three tools are the moderator's.
- **Package:** `gatherPackageInput` gives the package's input to the worker; the API's `gatherPackage` builds on the same two functions.
- **Web:** the card of a request an agent made shows the agent's avatar and name in its color, like a proposal; the log reads "Vorgelegt von Moderator". Such a request has no "Zurückziehen".
- **Verified** with `pnpm dev` and the browser as olga in "Vereins-App", with one real run:
  - Asked "@Moderator Leg bitte die Issues für Meilenstein 4 im Repository an. Bitte kurz.", the moderator called `propose_issues` for milestone 4. A request for six issues and the milestone waited within seconds, named for the moderator.
  - It answered: "Ich habe sechs Issues für Meilenstein 4 "Prüfung und Start" beantragt, eines je Aufgabe. Der Antrag wartet unter "Wartet auf dich" auf die Freigabe durch jemanden, der Git-Aktionen freigeben darf; vorher gibt es die Issues im Repository noch nicht."
  - The card read "Moderator · Freigabe", "6 Issues in vereins-app anlegen". "Freigeben" as olga created the milestone and the issues #4 to #9 in the stand-in; the log lists the request as the moderator's, approved by olga.
  - Not tried live, to spare the quota: the package and the merging through the moderator, and the answers for what cannot be asked for; all are covered by tests. A real GitLab was not used.
- **Decided while building:**
  - Only the moderator proposes Git actions; the handover is its part, and one agent that does it keeps the queue readable.
  - A request of an agent names no person. Who told the moderator stands in the chat.
  - The tools take no intent: a request is the proposal, whatever led to it. The prompt keeps the moderator from proposing unasked.
  - The order of a whole handover is the moderator's: the package first, then the issues.
- **Known limits:**
  - The chat shows no card for the request; the moderator's answer points to "Wartet auf dich".
  - A task the server has not given an id yet gets no issue from the moderator; it has one once someone opened the plan or the roadmap.
  - The worker reads the plan as it was last stored, which is a few seconds behind what people type.
