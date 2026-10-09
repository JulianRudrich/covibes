# 29c The Plan Package as a Merge Request

## Goal
The package for coding agents reaches the repository: plan, context files, feature specs and diagrams come as one commit on a branch of their own, with a merge request into the default branch (`project-overview.md`, "GitLab first, then GitHub"). It is a Git request like the issues of part 29b: it waits for approval, runs with the approver's GitLab access, carries the note "via Covibes" and is logged. Nothing changes on the default branch before someone merges.

Third part of spec 29.

## Design decisions
- **Owner decisions (2026-10-09):**
  - The files go to fixed places: `CLAUDE.md` and `AGENTS.md` at the top, the context files and feature specs in `context/`, the diagrams in `docs/diagrams/`. The package's files and the issues link to each other by these paths. Folders that can be set per project follow as a step of their own when they are needed.
  - A file the repository already holds in another form appears as a change in the merge request, where people review it. The one exception is `context/progress-tracker.md`: it is only added when it is missing, since it belongs to the coding agent after the handover.
- **What the request holds:** the package as it is when the request is made, with the team's texts and the written-out specs. What is approved is what was shown; a plan that changes afterwards takes a new request.
- **Two actions:**
  1. A commit on a new branch `covibes/plan-<day>-<mark>`, started from the default branch: files the branch does not hold are added, files that differ are changed, files that are the same are left out. Covibes deletes nothing.
  2. A merge request from that branch into the default branch. Its description says what the package holds, names feature specs of an earlier package that are no longer part of it, and ends with "via Covibes".
- **Nothing twice:** both actions look first. The commit compares the files with the branch if it exists already, so a second run after a lost answer finds nothing left to do. The merge request is looked up by its branch before it is opened.
- **A new merge request each time.** An earlier one that is still open stays as it is; people close it in GitLab when it is outdated. One request for the package waits at a time per project.
- **Seeing it first:** before the request, the dialog compares the package with the default branch: how many files are new, changed and unchanged, and which. The comparison reads with the project's reading access (part 28b) and needs no file's content: Git's own mark of a file's content is enough.
- **Where:** the dialog of the package (part 27b) gets a section "Ins Repository" when the project has a repository: the comparison, the list of files to unfold, and the button. Who may approve and has a GitLab account opens the merge request with one click; everyone else lays the request before the approvers. The card under "Wartet auf dich" and the log show it like the issues.
- **Limits:** a package of more than 600 files or 2 MB goes into no request; the dialog says so. A repository without a default branch (it is empty) takes no merge request.
- **The stand-in** takes commits on new branches and opens merge requests, shows them to the agents that read (part 28b), and has a page for each. Like the issues, it keeps them until the development server restarts.

## Implementation

### Shared: `packages/shared/src/`
- `git-requests.ts`: the request kind `merge_request` and the action kinds `commit` and `merge_request`, with what they carry.
- `git-merge-request.ts`: the two actions for a package, built without a model: the branch, the commit's message, the files with how each is written, and the merge request's title and description.

### Database
- Migration `0032`: the new kinds; one request for the package at a time per project.

### Server
- `integrations/git-host.ts` and `integrations/gitlab/writer.ts`: committing files to a branch and opening a merge request.
- Comparing files with a branch by Git's mark of their content, for the dialog and for the commit.
- `tasks/git-request.ts`: the two new actions.
- `/api/projects/:projectId/git/merge-request`: the comparison, and making the request.
- The stand-in: branches, commits and merge requests.

### Web
- The section "Ins Repository" in the package dialog; the card and the log name a merge request.
- **i18n:** `git.*`, `export.package.*`.

## Out of scope
- merging, and agents that propose Git actions (part 29d)
- folders that can be set per project
- deleting files from the repository, and choosing single files for a request
- adding commits to a merge request that is open; closing one from Covibes
- a repository without a default branch

## Dependencies
- Spec 29b, spec 27 (the package), spec 28 (reading the repository)

## Checklist
- [ ] The dialog of the package compares the package with the default branch and says which files are new, changed and unchanged.
- [ ] Owners and editors make the request; who may approve and has a GitLab account opens the merge request in one step.
- [ ] An approved request commits the new and changed files on a branch of its own and opens the merge request into the default branch, in the approver's name, with the note "via Covibes".
- [ ] `context/progress-tracker.md` is only added when it is missing; nothing is deleted, and nothing on the default branch changes.
- [ ] A second run creates no second commit and no second merge request.
- [ ] One request for the package waits at a time; a package that is too large, and a repository without a default branch, take none.
- [ ] The stand-in takes commits and merge requests, and agents that read see them.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the database, the building of the actions, the writer, the job, the API and the dialog pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
