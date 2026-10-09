# 29d Merging after Approval

## Goal
A merge request is merged from Covibes (`project-overview.md`, "merge after approval"): the one that carries the plan package, and the ones coding agents open. Merging is a Git request like the others: someone asks for it, who may approve Git actions approves, and it runs with the approver's GitLab access and is logged.

Fourth part of spec 29.

## Design decisions
- **Split (2026-10-09):** the former part 29d is built in two parts. This one brings merging; part 29e lets agents propose Git actions.
- **Which merge requests:** every open merge request of the project's repository, read with the project's reading access (part 28b). Covibes lists them with their branches, who opened them, and whether they are a draft or have conflicts.
- **What is approved is what is merged:** the request remembers the last commit of the merge request as it is when the request is made. GitLab only merges if that is still the last commit; a merge request that got new commits since takes a new request.
- **GitLab decides whether it can be merged:** a draft is not offered for merging. Everything else (conflicts, a pipeline that must pass, missing rights on a protected branch) is GitLab's answer at the moment of merging; a refusal fails the request with GitLab's reason.
- **Nothing twice:** a merge request that is merged already counts as done. One request waits at a time per merge request.
- **After merging** the branch is removed, as GitLab does when asked to.
- **Where:** "Merge Requests …" in the project's menu opens the list. Who may approve and has a GitLab account merges with one click; everyone else lays the request before the approvers. The card under "Wartet auf dich" and the log show it like the other requests.
- **The stand-in** merges: the default branch takes the files of the branch, the merge request is merged. A draft, and a merge request whose last commit is another one, are refused as GitLab refuses them.

## Implementation

### Shared: `packages/shared/src/`
- `git-requests.ts`: the request kind and the action kind `merge` with what it carries; the list of open merge requests for the dialog.

### Database
- Migration `0033`: the new kinds; one request per merge request at a time.

### Server
- `integrations/git-host.ts` and `integrations/gitlab/writer.ts`: merging a merge request.
- Reading the open merge requests with what merging needs.
- `tasks/git-request.ts`: the new action.
- `/api/projects/:projectId/git/merge-requests`: the list, and making the request for one of them.
- The stand-in merges.

### Web
- `features/git/`: the dialog "Merge Requests"; the card and the log name the merge.
- **i18n:** `git.*`, `workspace.*`.

## Out of scope
- agents that propose Git actions (part 29e)
- reviewing a merge request against the architecture (spec 30)
- squashing, merging when the pipeline succeeds, and resolving conflicts
- closing a merge request, and merge requests that are closed or merged

## Dependencies
- Spec 29c, spec 28

## Checklist
- [x] The dialog lists the open merge requests of the repository with their branches, who opened them, and whether they are a draft or have conflicts.
- [x] Owners and editors ask for merging; who may approve and has a GitLab account merges in one step; a draft cannot be asked for.
- [x] An approved request merges with the approver's access, only if the merge request still ends with the commit it had when the request was made.
- [x] A refusal of GitLab fails the request with the reason; a merge request that is merged already counts as done.
- [x] One request waits at a time per merge request.
- [x] The stand-in merges; afterwards the default branch holds the files.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for the database, the writer, the job, the API and the dialog pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-09)
- **Shared** (`git-requests.ts`): the request kind and the action kind `merge`; a merge carries the merge request's number, its title for the list ("!7 Login per Link") and its last commit; `GitMergeRequests` for the dialog.
- **Database** (`packages/db/migrations/0033_git_merges.sql`): the new kinds; `create_git_request` takes `merge` and refuses a request for a merge request while another one for it waits, runs or failed in the same repository.
- **Server:**
  - `integrations/gitlab/merge-requests.ts`: the open merge requests of a repository (the latest changed first, 50 at most) and one by its number, each with its branches, who opened it, whether it is a draft or has conflicts, and its last commit.
  - `integrations/git-host.ts` and `gitlab/writer.ts`: `mergeMergeRequest` reads the merge request first: one that is merged counts as done, one that is closed is refused. Then `PUT …/merge_requests/:iid/merge` with `sha` and `should_remove_source_branch`. GitLab's 405 and 406 (it cannot be merged as it is) and 409 (another last commit) fail the action as "not taken", with GitLab's words.
  - `tasks/git-request.ts`: the action `merge`.
  - `api/git-requests.ts`: `GET /api/projects/:projectId/git/merge-requests` lists what is open, read with the project's reading access, and marks the ones a request waits for. `POST …/merge-requests/:number/merge` reads the merge request, refuses a draft and one that is not open, and makes the request with its last commit.
- **Stand-in:** `PUT …/merge` merges a merge request that commits created: the target branch takes the files of the source branch, the source branch goes if asked. It refuses a draft (405) and another last commit (409). Merge requests answer with their address, their last commit and `has_conflicts`.
- **Web:** `features/git/merge-requests-dialog.tsx`, opened by "Merge Requests …" in the project's menu. The card and the log read "!3 Projektplan, … in vereins-app mergen".
- **Verified** with `pnpm dev` and the browser as olga in "Vereins-App", against the stand-in:
  - The dialog listed "!3 Projektplan, Feature-Specs und Diagramme aus Covibes" with its branches and "Mergen", and the example's "!1 Login per E-Mail-Link" as "Entwurf" without a button.
  - "Mergen": the request was made, approved and done within a second; the list then held only the draft, and the overview said "!3 … in vereins-app gemergt".
  - Afterwards `CLAUDE.md` was on `main`, and the package's comparison found 41 files unchanged and the progress tracker kept: the repository holds the package.
  - No model run was needed. A real GitLab was not used.
- **The tests found:** the link of a merge request read "!7Login" to a screen reader; number and title have a space between them now.
- **Decided while building:**
  - The request holds the merge request's last commit, and GitLab is asked to merge only that; this is what "approved" means for something that can still change.
  - Whether a merge request can be merged is GitLab's answer; Covibes only keeps drafts out, since GitLab refuses them for sure.
  - The source branch is removed after merging.
- **Known limits:**
  - No squash, no "merge when the pipeline succeeds": a pipeline that still runs fails the request, and it is asked for again.
  - The list shows 50 merge requests at most.
  - Merging was checked against the stand-in and GitLab's documented API, not against a real GitLab.
