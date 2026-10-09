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
- [ ] With a repository, and outside of a debate, the moderator has the three tools; specialists have none.
- [ ] Each tool makes a request that waits for approval, whatever the run's intent; nothing in the repository changes before the approval.
- [ ] The request names the moderator; the card and the log show it; who may approve approves or rejects it like any other.
- [ ] What cannot be asked for (no task without an issue, a package the repository holds, a draft, a request that waits already) comes back as a sentence for the moderator.
- [ ] The moderator's context names the tools and that each only makes a request.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the database, the rule, the tools, the agent turn and the card pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
