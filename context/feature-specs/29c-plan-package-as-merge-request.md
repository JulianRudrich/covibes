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
- [x] The dialog of the package compares the package with the default branch and says which files are new, changed and unchanged.
- [x] Owners and editors make the request; who may approve and has a GitLab account opens the merge request in one step.
- [x] An approved request commits the new and changed files on a branch of its own and opens the merge request into the default branch, in the approver's name, with the note "via Covibes".
- [x] `context/progress-tracker.md` is only added when it is missing; nothing is deleted, and nothing on the default branch changes.
- [x] A second run creates no second commit and no second merge request.
- [x] One request for the package waits at a time; a package that is too large, and a repository without a default branch, take none.
- [x] The stand-in takes commits and merge requests, and agents that read see them.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for the database, the building of the actions, the writer, the job, the API and the dialog pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-09)
- **Shared:**
  - `git-requests.ts`: the request kind `merge_request`; the action kinds `commit` (a title for the list, the branch, the branch to start from, the message, and the files, each with `write` or `create`) and `merge_request` (title, description, source and target branch); the failure `blocked`; the limits of 600 files and 2 MB; `GitMergeRequestPlan` for the dialog. A file's path has parts with forward slashes, none of them empty, "." or "..".
  - `git-merge-request.ts`: `buildMergeRequestActions` gives the commit and the merge request for a package. The branch is `covibes/plan-<day>-<six hex digits>`. Title and first line of the commit read "Projektplan, Feature-Specs und Diagramme aus Covibes"; the description lists what the package holds, says how files that exist are treated, names earlier feature specs, and ends with the note "via Covibes". `gitFilesOf` marks `context/progress-tracker.md` as `create`.
- **Database** (`packages/db/migrations/0032_git_merge_requests.sql`): the new kinds and the failure `blocked` in the check constraints; `create_git_request` takes `merge_request` and refuses one while another waits, runs or failed in the project.
- **Server:**
  - `integrations/gitlab/blobs.ts`: `gitBlobId` is Git's id of a file's content (SHA-1 of `blob <bytes>` and the content). `listBlobs` lists the folders that hold the package's files, one call per folder and page, and gives the ids GitLab hands out; `fileStates` says for every file whether it is new, changed, the same, or kept. No file is fetched.
  - `integrations/git-host.ts` and `gitlab/writer.ts`: `commitFiles` compares the files with the branch (or, for a new branch, with the one it starts from) and sends one commit with what is new and what differs (`POST …/repository/commits` with `start_branch` for a new branch). Nothing left on a branch that exists is "nothing to do"; nothing to commit on a new branch is refused. `openMergeRequest` looks for an open merge request of the branch first (`GET …/merge_requests?source_branch=…&state=opened`), then opens one with `remove_source_branch`.
  - `tasks/git-request.ts`: the two new actions. A merge request whose commit is not done fails as `blocked`, without a call.
  - `api/git-requests.ts`: `GET /api/projects/:projectId/git/merge-request` builds the package (`gatherPackage` of the package's routes), compares it with the default branch through the project's reading access, and names feature specs the repository holds that the package does not (`context/feature-specs/NN-NN-….md`), whether a request waits, and the merge request that was opened last. `POST` makes the request from the package of that moment; it refuses a package the repository holds already.
  - `app.ts`: the stand-in takes bodies of up to 8 MB, since the worker sends it the commit like it would send it to GitLab; every other route of the API keeps its 64 KB.
- **Stand-in:** branches that commits created, with their files; `POST …/repository/commits` with GitLab's rules (a file to create must be missing, one to update must exist, the default branch is protected); merge requests by source branch, one open per branch, with the changed files as their changes; the tree hands out real ids; pages for a merge request, a commit and a file on a branch. The repository "Website" holds a progress tracker and a feature spec of an earlier package.
- **Web:**
  - `features/git/merge-request-section.tsx`: the section "Ins Repository" at the end of the package dialog, shown once the plan has content. The dialog stores what its fields show before the request is made, and loads the comparison again whenever a text was stored or the package changed.
  - The card and the log call the request "Merge Request mit dem Plan-Paket"; a merge request's number is written "!3".
- **Verified** with `pnpm dev` and the browser as olga in "Vereins-App", against the stand-in:
  - The section read "41 neu · 1 geändert"; the list named `context/project-overview.md` as changed, which the example repository holds in its own form.
  - "Merge Request anlegen": the stand-in got the branch `covibes/plan-2026-10-09-b7ccb9` with one commit and the merge request !3 with 42 files and the description of the package. `CLAUDE.md` was on the branch and not on `main`.
  - Afterwards the section linked "Merge Request !3", the overview said "Merge Request mit dem Plan-Paket in vereins-app angelegt", and the log listed the request with its commit and "!3".
  - No model run was needed. A real GitLab was not used.
- **The live test found** and fixed:
  - The first try failed: the worker's commit to the stand-in went through the API's limit of 64 KB per body, and a real package is larger. The stand-in has a limit of its own now, a test commits a package of more than 64 KB, and a refusal for size counts as "not taken" instead of "something went wrong". "Wiederholen" then ran the request that had failed.
- **Decided while building:**
  - The comparison uses Git's ids of the files' content, so opening the dialog reads four folders instead of forty files.
  - The commit decides at the time it runs what is new and what differs, against the branch as it is then; the request holds the files, not the changes.
  - A second request opens a second merge request; the section links the last one, so nobody opens one without seeing it.
  - Feature specs of an earlier package are named in the dialog and in the description, and removed by nobody.
- **Known limits:**
  - A file is compared and committed as text; the package has no other files.
  - A folder with more than 3000 files is not read to its end; files beyond count as new, and GitLab then refuses the commit with its reason.
  - Committing was checked against the stand-in and GitLab's documented API, not against a real GitLab.
  - After a restart of the development server the stand-in has forgotten the merge request, while Covibes still links it.
