# 30a Task Status from the Repository

## Goal
After the handover GitLab owns the status of a task (`project-overview.md`, "Plan and export"): Covibes reads which issues are closed and shows the progress in the plan and on the roadmap. This part also brings the way Covibes learns of changes in the repository at all, which the review of merge requests (part 30b) builds on.

First part of spec 30.

## Design decisions
- **Owner decisions (2026-10-10):**
  - Covibes reads the state itself: when someone opens the project, regularly while someone has it open, and on a click. In addition there is a webhook address with a secret that starts the same reading at once; an owner enters it in GitLab if they want that. So it works locally and without an address GitLab can reach.
  - A merge request that belongs to an issue Covibes created is reviewed once per state of its commits, others on a click (part 30b).
- **Split (2026-10-10):** spec 30 is built in three parts:
  - 30a the reading of the repository's state and the status of tasks (this part)
  - 30b the review of merge requests against the architecture
  - 30c the review as a comment in GitLab, after approval
- **One job reads:** "syncing" is a job of the worker per project. It reads the issues Covibes created, with the project's reading access (part 28b), and stores whether each is open or closed. Part 30b lets the same job look at the merge requests.
- **What starts it:**
  - opening the project, and every five minutes while a member has it open in a visible tab; not more often than every two minutes per project
  - "Jetzt abgleichen" in the dialog "Repository", for every member
  - the webhook
  - an issue Covibes just created counts as open without asking
- **The webhook only says "something changed":** `POST /api/git/webhook/:projectId` with GitLab's header `X-Gitlab-Token`. A call with the project's secret queues the job; what the call carries is not read. A wrong secret and an unknown project get the same answer. The secret is made by the server, stored sealed like the tokens, shown to owners in the dialog "Repository" and replaced on a click. Covibes does not enter the webhook in GitLab itself.
- **What people see:**
  - On the roadmap and in the plan a task with an issue shows its number as a link; a closed one shows a check. A milestone of the roadmap says how many of its tasks are done.
  - The dialog "Issues aus dem Plan" marks closed issues.
  - The dialog "Repository" says when the state was last read, and whether that worked.
  - The read-only link shows nothing of it, as before.
- **Done means closed:** a task is done when its issue is closed in GitLab. A task without an issue has no status; Covibes sets none itself.
- **The stand-in** answers for several issues at once, and its page of an issue closes and reopens it, so the status can be tried without a GitLab.

## Implementation

### Shared: `packages/shared/src/`
- The issue of a task on the roadmap (number, address, closed), the state of the sync in the project's Git state, and the webhook for owners.

### Database
- Migration `0035`: `git_issue_states` (the issues with their state), `git_sync` (when the state was asked for and read, and whether that worked), `git_webhooks` (the sealed secret; no request of a user reads it), and the functions that queue the job.

### Server
- `tasks/git-sync.ts`: the job. `integrations/gitlab/issues.ts`: reading the state of issues by their numbers.
- `/api/projects/:projectId/git/sync` (asking for a sync), `/git/webhook` (the address and the secret for owners, and replacing the secret) and `/api/git/webhook/:projectId` (the webhook).
- The roadmap and the list of tasks for issues name the issue of a task and whether it is closed.

### Web
- The roadmap, the plan and the dialog "Issues aus dem Plan" show the status; the workspace asks for a sync; the dialog "Repository" shows the sync and the webhook.
- **i18n:** `git.*`, `roadmap.*`, `plan.*`.

## Out of scope
- the review of merge requests (parts 30b and 30c)
- entering the webhook in GitLab from Covibes
- setting a status in Covibes, and closing issues from Covibes
- labels, assignees and comments of an issue

## Dependencies
- Spec 29 (issues from the plan), spec 28 (reading the repository), spec 26 (roadmap and tasks)

## Checklist
- [ ] The job reads the state of the issues Covibes created and stores it; a failure is recorded and shown.
- [ ] Opening the project, the interval, "Jetzt abgleichen" and the webhook start the job, not more often than the limits allow.
- [ ] The webhook takes only a call with the project's secret, reads nothing of it, and answers a wrong secret like an unknown project.
- [ ] Owners see the webhook's address and secret and replace the secret; nobody else does.
- [ ] The roadmap, the plan and the dialog of the issues show a task's issue and whether it is closed; the roadmap counts what is done per milestone; the read-only link shows none of it.
- [ ] The stand-in closes and reopens issues.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the database, the job, the API, the webhook and the web parts pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
