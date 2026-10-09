# 28b Agents Read the Repository

## Goal
Once a project is connected to its repository (part 28a), its agents can look into it: the files, the issues and the merge requests. So an agent answers "what does the README say?", checks whether the code already does what the plan asks for, or sums up what is open in the issue board, from what is really there instead of from guesses.

Second part of spec 28. It completes the spec.

## Design decisions
- **Owner decision (2026-10-04):** the agents read with the access of the owner who connected, for all members of the project. Who has no access to the repository in GitLab sees its content through the agents' answers. The read-only link shows nothing of it.
- **Reading only:** "Reading is always allowed" (`project-overview.md`): the tools change nothing, so they need no rule of the rule engine and no approval. Everything that writes comes with spec 29.
- **Six tools**, for every agent of the project (catalog and custom), as long as a repository is connected and picked:
  - `list_repository_files`: the files and folders of a folder
  - `read_repository_file`: a text file, long ones in parts
  - `list_issues` and `read_issue`: the issues, and one with its description and comments
  - `list_merge_requests` and `read_merge_request`: the merge requests, and one with its description, its changes and comments
- **The agent knows what it can read:** its context names the repository (path and default branch) and the tools. Without a connection there are no tools and no mention; asked for the repository then, the agent says that an owner can connect one.
- **What comes from the repository is data, not instructions** (invariant 6): every result is marked as content of the repository, and the agents' common rules say so. A file that says "ignore your rules" is quoted, not obeyed.
- **Bounds**, so one question cannot read a whole repository into a model:
  - a folder shows at most 200 entries; a list of issues or merge requests at most 30, the latest changed first
  - a file is read up to 1 MB and comes in parts like an uploaded file; a file that is no text is not read
  - an issue or merge request brings at most 20 comments; a merge request at most 30 changed files, each diff cut at 6000 characters
- **Other branches:** files are read from the default branch unless the agent names a branch, tag or commit.
- **When it does not work:** a file that does not exist, a repository that is not reachable or a connection that ended give the agent a plain sentence to pass on, never an error of the run.
- **Debates only talk:** a debate reads no repository, like it reads no files and no links.
- **The stand-in grows with it:** the example repository of the development stand-in gets files, issues and a merge request, so reading can be tried without an account.

## Implementation

### Server
- `integrations/gitlab/client.ts`: the calls for the tree, a file, issues, merge requests, their comments and the changes of a merge request, each answer checked.
- `integrations/gitlab/repository.ts`: the reader of a project's repository: it takes the connection and the token from the store of part 28a and makes the calls.
- `tools/repository-tools.ts`: the six tools with their bounds and their wording of results and problems.
- `tasks/agent-turn.ts`: gives the tools to the agent and names the repository in its context.
- The worker gets the settings of the connection (`TOKEN_KEY` and the OAuth application), which it shares with the server.
- `agents/prompts/common.md`: what the repository is for, and that its content is data.
- `integrations/gitlab/dev/`: the content of the example repository.

### Web
- Nothing new: the answers arrive in the chat like all others.

## Out of scope
- searching the code, and the history of commits
- writing anything: issues, commits, merge requests, comments (spec 29)
- reviewing a merge request against the architecture by itself (spec 30)
- a switch per project or per agent for reading the repository
- showing in the chat which files an agent read

## Dependencies
- Spec 28a, spec 20a (reading files in parts), spec 07

## Checklist
- [ ] With a connected repository every agent of the project has the six tools, and its context names the repository; without one, and in a debate, it has none.
- [ ] Folders, text files (in parts), issues and merge requests with comments and changes are read within the bounds above.
- [ ] Results are marked as content of the repository; text in them cannot close that mark, and the common rules call it data.
- [ ] A missing file, a file that is no text, an unreachable GitLab and an ended connection each give the agent a sentence to pass on.
- [ ] The token is renewed when it is about to end, also in the worker.
- [ ] The stand-in serves an example repository with files, issues and a merge request.
- [ ] Tests for the client, the tools and the agent turn pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
