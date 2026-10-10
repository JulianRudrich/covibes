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
  - On the roadmap and in the plan a task with an issue shows its number as a link; a closed one shows a check. A milestone of the roadmap that has issues says how many of its tasks are done.
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
- [x] The job reads the state of the issues Covibes created and stores it; a failure is recorded and shown.
- [x] Opening the project, the interval, "Jetzt abgleichen" and the webhook start the job, not more often than the limits allow.
- [x] The webhook takes only a call with the project's secret, reads nothing of it, and answers a wrong secret like an unknown project.
- [x] Owners see the webhook's address and secret and replace the secret; nobody else does.
- [x] The roadmap, the plan and the dialog of the issues show a task's issue and whether it is closed; the roadmap counts what is done per milestone; the read-only link shows none of it.
- [x] The stand-in closes and reopens issues.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for the database, the job, the API, the webhook and the web parts pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-10)
- **Database** (`packages/db/migrations/0035_git_sync.sql`):
  - `git_issue_states` holds per project, repository and issue number whether the issue is open or closed. `git_sync` holds per project when the state was last asked for and last read, and whether the last reading failed. Members read both; only the worker writes.
  - `git_webhooks` holds the sealed secret per project. The app role has no access at all; the server reads it with the admin connection.
  - `private.queue_git_sync` queues the job `git_sync` for a project with a repository, with a job key, so a burst of calls becomes one job that runs two seconds later. `public.request_git_sync` is what members call: not more often than every two minutes, and with a click every ten seconds.
  - A trigger on `git_connections` forgets `git_sync` when the project gets another repository or loses its repository, so nothing reads as "synced" that was read elsewhere, and the next reading may run at once.
- **Job** (`tasks/git-sync.ts`): reads the issues that done actions of this repository created, with the project's reading access, in calls of up to a hundred numbers (`integrations/gitlab/issues.ts`, `iids[]`). It stores the states, records the reading in `git_sync` and announces `git` on the live channel. If GitLab does not answer, the states of before stay and the reading is recorded as failed; the next one that works clears that. An issue GitLab does not answer for is left as it was.
- **A new issue** counts as open: the job of a Git request stores that when it created the issue.
- **API:**
  - `POST /api/projects/:projectId/git/sync` (members; `force` for a click) answers whether a reading was queued.
  - `GET /git/webhook` gives owners the address and the secret, which is made on the first call; `POST /git/webhook/renew` replaces it. Without the server's key for tokens there is no webhook; a secret the server can no longer open (its key changed) matches no call and is replaced when an owner asks.
  - `POST /api/git/webhook/:projectId` takes GitLab's header `X-Gitlab-Token`, compares in constant time, queues the job and answers 204. A wrong or missing secret, an unknown project and a project without a webhook all answer 404. 60 calls per project and minute; the body may be 2 MB and is not read.
  - `GET /git` carries `sync` (null before the first reading). The roadmap and `GET /git/issues` name the issue of a task with `closed`; issues of a repository the project had before do not count. The read-only link carries none of it.
- **Stand-in:** the list of issues takes `iids[]`; the page of an issue says "offen" or "geschlossen" and has a button that closes it or opens it again.
- **Web:**
  - `useGitSync` asks for a reading when a project with a repository opens, every five minutes, at once for another repository, and when the person comes back to a tab that rested for longer; a hidden tab asks nothing. The live channel reloads the roadmap on `git`.
  - Roadmap: a task with an issue shows "#4" as a link before the assignee; a closed one has a green check and its text struck through. A milestone with issues shows "2/10 erledigt" at the right of its time, green once all its tasks are done.
  - Plan: the issue stands as a small link at the end of the task's line, before the assignee, with a check and in green once it is closed.
  - "Issues aus dem Plan": the link of a closed issue has a green check.
  - "Repository": a section "Stand aus GitLab" with when the state was last read or that reading failed, "Jetzt abgleichen" for every member (it rests until the reading arrived, 15 seconds at most), and for owners "Webhook einrichten …", which shows the address and the secret (as dots until asked for) with "Kopieren" and "Secret-Token neu erzeugen" in two steps.
- **Verified** with `pnpm dev` and the browser as olga in "Vereins-App", against the stand-in:
  - Two new issues (#4, #5) were created from the plan. "Issue schließen" on the stand-in's page of #4, then "Jetzt abgleichen": the dialog read "Wird abgeglichen …" with the button resting, then "Zuletzt abgeglichen: jetzt."; the roadmap showed #4 as closed.
  - The webhook's address and its secret as dots showed for the owner. A call without a secret and one with a wrong secret answered 404. After #5 was closed in the stand-in, a call with the secret answered 204, and the roadmap showed #5 as closed a few seconds later without a click.
  - The plan showed "#4" in green with a check at its task.
  - Not tried live: the reading on opening and by the interval, since the dev browser's pane counts as a hidden tab (tests cover both); a real GitLab was not used.
- **Decided while building:**
  - The count of a milestone is "done of all its tasks", and shows only where the milestone has an issue. Counting only the tasks with an issue read "2/2 erledigt" for a milestone with ten tasks.
  - What the webhook call carries is not read at all, so nothing in it can steer Covibes; the call only saves the wait until the next reading.
  - The secret is shown to owners every time, not only once: they need it again when they set the webhook up anew in GitLab, and it opens nothing but a reading.
  - Every reading announces `git`, also one that changed nothing, so "Zuletzt abgeglichen" is right in an open dialog.
- **Fixed on the way:** the database test of the Yjs documents created a user with the same id as the test of the projects' row level security. Whichever of the two files ran second could fail; it has an id of its own now. The app test of the phase change read the note about the new phase without waiting for it; it waits now. Both showed once in the full runs of this part.
- **Known limits:**
  - The stand-in forgets what was created when the server restarts and then gives the numbers out again. Tasks of earlier runs that carry the same number then show the state of the new issue. A real GitLab never reuses a number.
  - An issue that was deleted or moved in GitLab keeps its last state.
  - Covibes does not check that the webhook is entered in GitLab, or which events it sends.
  - Calls without the secret count toward the 60 calls a project's webhook takes per minute. Someone who knows the address can use them up; the reading by itself goes on, so only the speed-up is lost.
