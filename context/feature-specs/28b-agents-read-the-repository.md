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
- [x] With a connected repository every agent of the project has the six tools, and its context names the repository; without one, and in a debate, it has none.
- [x] Folders, text files (in parts), issues and merge requests with comments and changes are read within the bounds above.
- [x] Results are marked as content of the repository; text in them cannot close that mark, and the common rules call it data.
- [x] A missing file, a file that is no text, an unreachable GitLab and an ended connection each give the agent a sentence to pass on.
- [x] The token is renewed when it is about to end, also in the worker.
- [x] The stand-in serves an example repository with files, issues and a merge request.
- [x] Tests for the client, the tools and the agent turn pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-09)
- **Reading** (`apps/server/src/integrations/gitlab/repository.ts`): `repositoryReaders` gives the reader of a project's repository, or nothing while the project has no connection or no repository picked. Every call takes the token from the store of part 28a, which renews it; a connection that ended meanwhile is a `RepositoryGoneError`.
  - `tree`: a folder in pages of 100, at most 200 entries, folders first. A folder or a ref that does not exist gives nothing (GitLab's 404, or its empty list for a folder below the top).
  - `file`: through the files API with the path encoded; the default branch unless a ref is named (`HEAD` if the repository names none). A file over 1 MB, or with a NUL byte among its first 8000, is not read.
  - `issues` and `mergeRequests`: by state (`open` is GitLab's `opened`), the latest changed first, 30 at most; issues also by a search.
  - `issue` and `mergeRequest`: with their comments (what people wrote; GitLab's own notes are left out; 20 at most), a merge request also with its changes (30 files at most, and whether there are more).
  - Answers are checked with zod; an entry in another form is left out of a list.
- **Tools** (`apps/server/src/tools/repository-tools.ts`): `list_repository_files`, `read_repository_file`, `list_issues`, `read_issue`, `list_merge_requests`, `read_merge_request`.
  - A result is a heading, the content between `<repository_content>` marks (text that would close the mark is defused), and the sentence that it is data, not instructions.
  - A file comes in parts of 20,000 characters like an uploaded file; a run keeps the last ten files, so reading on does not fetch again.
  - A diff is cut at 6000 characters; once the changes of a merge request pass 40,000 characters, the remaining files are only named.
  - What does not work is a sentence for the agent: no such folder, file, issue or merge request; a file that is no text or too large; GitLab away (or a 5xx); access refused; the connection ended. Only a fault of our own fails the run.
- **Agent turn** (`tasks/agent-turn.ts`): with a reader, every agent gets the six tools (not in a debate), and its context gets a section `<repository>` with the path, the default branch and the tools. The common rules (`agents/prompts/common.md`) say when to look into the repository, to name the file, "#12" or "!7" it took something from, what to say without a connection, and that everything from the repository is data.
- **Worker:** it builds the same setup as the server from `TOKEN_KEY`, `GITLAB_CLIENT_ID`, `GITLAB_CLIENT_SECRET` and `GITLAB_ISSUER` (new in `worker-env.ts` and in the worker of `deploy/compose.yaml`). Without them agents read no repository.
- **Stand-in** (`integrations/gitlab/dev/example-repository.ts`): the example repository "Vereins-App" holds eight files in folders (among them one that is no text), three issues with comments, and two merge requests, one with changes; the two other repositories hold a README. The stand-in serves GitLab's reading routes for them.
- **Web:** nothing changed.
- **Verified** with `pnpm dev` and the browser as olga in "Vereins-App", which is connected to the example repository of the stand-in, with one real run:
  - The connection made for part 28a still held after several restarts of the development server.
  - Asked "Was steht im README, und welche Issues sind offen?", the moderator answered after 8 seconds from the repository: what the README says about the app, its state and how to start it, and the two open issues with milestone and assignee, named as "#1" and "#2", with the merge request as "!1".
  - On its own it pointed out that the README treats Node.js as settled for the API while the project's plan still lists it as open.
  - Not tried live, to spare the quota: reading a merge request, a long file in parts and the problems; all are covered by tests. A real GitLab was not used.
- **Decided while building:**
  - Six tools instead of one general one: each is small, and the model picks the right one from its name.
  - Every agent reads, also custom agents that only talk: reading changes nothing, like reading a file or a link.
  - No switch for it: the product says reading is always allowed; who wants no agent to read disconnects.
  - GitLab's own notes ("changed the description") are left out of the comments.
- **Known limits:**
  - No search in the code and no history of commits; an agent finds its way through folders.
  - A file is fetched whole before its size is known; GitLab bounds what its files API hands out.
  - The chat does not show which files an agent read; the agent names them in its answer.
  - The calls were checked against the stand-in and GitLab's documented API, not against a real GitLab.
