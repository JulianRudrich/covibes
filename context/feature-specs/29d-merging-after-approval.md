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
- [ ] The dialog lists the open merge requests of the repository with their branches, who opened them, and whether they are a draft or have conflicts.
- [ ] Owners and editors ask for merging; who may approve and has a GitLab account merges in one step; a draft cannot be asked for.
- [ ] An approved request merges with the approver's access, only if the merge request still ends with the commit it had when the request was made.
- [ ] A refusal of GitLab fails the request with the reason; a merge request that is merged already counts as done.
- [ ] One request waits at a time per merge request.
- [ ] The stand-in merges; afterwards the default branch holds the files.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the database, the writer, the job, the API and the dialog pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
