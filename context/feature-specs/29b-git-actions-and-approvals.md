# 29b Git Actions and Approvals

## Goal
Everything that changes something in the repository arrives as a request, waits for approval and is logged (`project-overview.md`, "GitLab first, then GitHub"). This part brings the queue, the approval of one or several requests, the log of Git actions, and the first action: issues from the plan, one per task, grouped by milestones and linked to the feature spec. An approved request runs with the GitLab access of the person who approved it and carries the note "via Covibes".

Second part of spec 29.

## Design decisions
- **Owner decision (2026-10-09):** GitHub stays after V1. Then it gets everything the GitLab integration has, plus signing in with GitHub. From this part on, Git actions are worded without GitLab in them (their kinds and what they carry name issues and milestones), and one small module talks to GitLab. A second host is added next to it later, without changing the queue.
- **A request and its actions:** a request is what waits in the queue, e.g. "create 12 issues". Its actions are the single changes in the repository, e.g. one issue. People approve or reject a request as a whole. The actions with their outcomes are the log.
- **Tables of its own instead of `proposals`:** a Git request is made by a person (agents follow in part 29d), it is decided by who may approve Git actions and not by every editor, and it runs in the background with an outcome per action. So it gets its own tables, `git_requests` and `git_actions`.
- **Who does what:**
  - Owners and editors make a request. Who made it can take it back while it waits.
  - Who may approve Git actions (owners, and editors an owner gave the right) approves or rejects, also all waiting requests at once. Approving needs an own GitLab account (part 29a); without one the card says so and leads to connecting it.
  - Every member, viewers too, sees what waits and reads the log.
- **Running:** an approved request is a job of the worker, one at a time per project. It runs action by action with the approver's access.
  - An action GitLab refuses fails with its reason, and the others go on. If GitLab cannot be reached, the repository is gone or the approver has no account any more, the run stops and the rest waits.
  - A request with failed or waiting actions can be approved again. Only what is not done runs then, with the access of who approved this time.
  - An action that was started without a known outcome (the worker ended in between) first looks in GitLab for what it would create, by a mark in the description. So nothing is created twice.
- **Issues from the plan:** one issue per task.
  - Title: the task. Description, in the project's language: the task, its milestone with its goal, who took it, a link to its feature spec in the repository (`context/feature-specs/…` on the default branch), and the line "via Covibes" with the project's name.
  - Milestones: for every milestone of the plan with a chosen task, GitLab gets a milestone of the same name ("Meilenstein 2: Mitgliederverwaltung"). One that exists is used.
  - A task has one issue per repository. A task with an issue, or with one that waits, cannot be chosen again.
  - The spec a link leads to comes into the repository with the plan package (part 29c).
- **In one step for who may approve:** someone who may approve and has a GitLab account creates issues with one button: it makes the request and approves it. Everyone else lays the request before the approvers.
- **Where:**
  - "Issues anlegen …" in the plan's export menu opens the dialog "Issues aus dem Plan": the milestones with their tasks to tick, which of them have an issue already, and the button.
  - Requests wait in "Wartet auf dich" as cards "· Freigabe" (handoff, section 4): what is created in which repository, "Freigeben", "Ansehen" (the actions) and rejecting as an icon; above several of them "Alle freigeben". A running request shows how far it is, a failed one what went wrong, with "Erneut versuchen". A request that was done within the last hour is a line with a check.
  - "Git-Protokoll …" in the project's menu opens the log: every request, the newest first, with who asked, who approved or rejected and when, and its actions with links to what they created.
- **What waits counts:** requests that wait or failed count in "Wartet auf dich", in the project list and in the mail about what waits, for those who may approve.
- **When the repository changes:** requests that wait or failed are withdrawn when the project's repository is removed or replaced. What is done stays in the log.
- **The stand-in** creates milestones and issues and shows them to the agents that read (part 28b). It keeps them until the development server restarts. Its repository "Website" has issues switched off, so a refusal can be seen.

## Implementation

### Shared: `packages/shared/src/`
- `git-requests.ts`: a request and its actions as the API gives them, the inputs, and the limits.
- `git-issues.ts`: the actions for the chosen tasks of a roadmap, built without a model: the milestones and the issues with their descriptions.
- `coding-package.ts`: the path of a task's feature spec, as the package names it.

### Database
- Migration `0031`: `git_requests` and `git_actions`, read by members.
- Functions for making a request, approving (several at once; it queues the job), rejecting and taking back. They check the role, the right to approve and the own GitLab account.
- Triggers: every change is announced on the live channel (`git`); a new request schedules the mail for those who may approve; a changed repository withdraws what waits.
- `project_waiting_count` and `waiting_for_user` count the requests.

### Server
- `integrations/git-host.ts`: what writing to a repository needs, without naming a host. `integrations/gitlab/writer.ts` does it for GitLab.
- `tasks/git-request.ts`: the job that runs an approved request.
- `/api/projects/:projectId/git/requests` (what waits, approving, rejecting, taking back), `/git/issues` (the plan's tasks with their issues; making the request) and `/git/log`.
- The stand-in writes milestones and issues.

### Web
- `features/git/`: the dialog "Issues aus dem Plan", the cards in "Wartet auf dich" and the dialog "Git-Protokoll".
- **i18n:** `git.*`.

## Out of scope
- the plan package as a merge request (part 29c), merging and agents that propose Git actions (part 29d)
- assigning an issue in GitLab to who took the task, labels and due dates
- changing or closing issues from Covibes, and an issue's state in the plan (spec 30)
- changing a request before it is approved (it is rejected and made again)
- pages in the log (it shows the latest 100 requests)

## Dependencies
- Spec 29a, spec 28, spec 27b (the paths of the feature specs), spec 26 (tasks), spec 22 ("Wartet auf dich" and its mails)

## Checklist
- [x] Owners and editors make a request for issues from the plan's tasks; a task with an issue, or with one that waits, cannot be chosen again.
- [x] Who may approve approves one or all waiting requests, with an own GitLab account; others cannot, and the card says what is missing.
- [x] An approved request runs in the worker with the approver's access: milestones are found or created, issues are created with task, milestone, link to the spec and "via Covibes".
- [x] A refused action fails with its reason while the others go on; an unreachable GitLab stops the run; approving again runs only what is not done, and nothing is created twice.
- [x] Rejecting and taking back end a request; a changed repository withdraws what waits.
- [x] The log shows every request with who asked, who decided and when, and its actions with their outcomes and links; every member reads it.
- [x] Requests count in "Wartet auf dich", in the project list and in the mail for those who may approve.
- [x] The stand-in creates milestones and issues, and agents that read see them.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for the database, the building of issues, the writer, the job, the API and the web parts pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-09)
- **Database** (`packages/db/migrations/0031_git_requests.sql`):
  - `git_requests`: the kind (`issues`), the status (`waiting`, `approved`, `done`, `failed`, `rejected`, `withdrawn`), the repository it was made for, who asked and who decided (with their names as they were, so the log still names someone whose account is gone), and when.
  - `git_actions`: the actions of a request in their order, each with its kind (`milestone`, `issue`), title, payload, the plan's task of an issue, its status (`waiting`, `started`, `done`, `failed`, `dropped`), what it made (the host's id, the number, the address, whether it was there already), why it failed, how often it was tried and with whose access it ran.
  - Members read both tables; nobody writes them but the functions and the worker.
  - `create_git_request` (owners and editors, a project with a repository, 1 to 150 actions; a task with an action that is not dropped in the same repository is refused), `approve_git_requests` (who may approve, with a row in `git_accounts`; what waits or failed; failed actions wait anew; one job `git_request` per request in the queue `git:<project>`), `reject_git_request` and `withdraw_git_request` (actions that are not done are dropped).
  - A trigger on `git_connections` withdraws what waits or failed when the repository is removed or replaced; picking the same repository again changes nothing.
  - Every new request, every decision and every action that ends is announced as `git`. A new request schedules the mail for owners and editors with the right to approve. `project_waiting_count` and `waiting_for_user` count what waits or failed for them.
- **Shared:**
  - `git-requests.ts`: the types, the inputs and the limit of 100 issues per request.
  - `git-issues.ts`: `buildIssueActions` gives, per milestone with a chosen task, the milestone and then its issues, in the order of the plan. An issue's description: the task, then milestone, goal, who took it and the link to the spec on the default branch (`…/-/blob/<branch>/context/feature-specs/…`), a line, and "Angelegt via Covibes aus dem Projektplan von …" in the project's language. The milestone is named as the package names it ("Meilenstein 2: Mitgliederverwaltung").
  - `coding-package.ts`: `packageSpecRefs` gives the path of every task's spec.
- **Server:**
  - `integrations/git-host.ts`: `RepositoryWriter` (`ensureMilestone`, `createIssue`, `findIssue`) and `RepositoryWriteError` with a kind of failure; no word of GitLab in it.
  - `integrations/gitlab/writer.ts`: the writer for GitLab. A milestone is looked up by its title, also among those of the group; an address in an answer counts only if it is one of the web.
  - `tasks/git-request.ts`: the job. It takes the approver's access from the store of part 29a, marks an action as started before its call, and writes the outcome. `forbidden` and `invalid` fail the one action; `unreachable`, `not_found` and no account (also a token GitLab no longer takes) stop the run. An issue whose milestone failed fails without a call. An action that was started before looks for its issue by the comment `<!-- covibes-action:<id> -->` at the end of the description. A fault of our own fails the job, which is tried three times.
  - `api/git-requests.ts`, below `/api/projects/:projectId/git`: `GET /requests` (what waits, runs or failed, and what was done within the last hour), `POST /requests/approve`, `POST /requests/:id/reject` and `/withdraw`, `GET` and `POST /issues`, `GET /log` (the latest 100 requests).
  - The worker runs the job when the server is set up for GitLab.
- **Stand-in:** it creates milestones and issues (`POST …/milestones`, `POST …/issues`), finds a milestone by its title and an issue by a text in its description, and shows a page for each. The repository "Website" refuses issues with a 403.
- **Web:**
  - `features/git/issues-dialog.tsx`, opened by "Issues anlegen …" in the plan's export menu: the tasks by milestone with checkboxes (all free ones are ticked at first, a milestone's checkbox ticks its tasks), "#12" as a link for a task with an issue, "wartet" for one that waits.
  - `features/git/git-request-view.tsx`: the card of a request and the list of its actions. In `waiting-for-you.tsx` the cards stand after the proposals; requests that are done are lines with a check.
  - `features/git/git-log-dialog.tsx`, opened by "Git-Protokoll …" in the project's menu.
  - The live channel loads the requests again on `git`, and what an open dialog shows.
- **Verified** with `pnpm dev` and the browser as olga in "Vereins-App", against the stand-in:
  - The dialog listed the 31 tasks of the plan's four milestones. Two tasks of milestone 2 were created in one step: within a second the stand-in had the milestone and the issues #4 and #5, the overview showed "2 Issues in vereins-app angelegt", and the dialog showed the two tasks with their links.
  - The page of issue #5 in the stand-in shows the task, the milestone with its goal, the link to `context/feature-specs/02-03-…md` and the note "via Covibes".
  - Two requests made through the API waited as cards with "2 Freigaben warten." and "Alle freigeben". "Ansehen" unfolded the actions; one request was rejected, the other approved and done. A second request for a task that had one was refused.
  - With the repository "Website" picked, a request failed: the milestone was created, the issue was refused, the card said "1 von 2 nicht ausgeführt. GitLab hat den Zugriff abgelehnt." with "Wiederholen". It was discarded, and the log lists all four requests.
  - No model run was needed. A real GitLab was not used.
- **The live test found** and fixed:
  - Three buttons did not fit the narrow card in one row: rejecting is an icon at its end now, "Erneut versuchen" reads "Wiederholen" and "GitLab-Konto verbinden" reads "Verbinden".
  - The list of actions read "Meilenstein: Meilenstein 3: …"; the kind in front is gone.
- **Decided while building:**
  - Requests and actions in tables of their own instead of a kind of `proposals` (see above); `architecture.md` says so now.
  - The action that makes sure of a milestone is part of the request and of the log; a milestone that was there is used and logged as such.
  - The names of who asked and who decided are stored with the request.
  - The server words the issues at the time of the request, from the plan as it stands then; what is approved is what was shown.
  - A request keeps running in the repository it was approved for when the project's repository changes meanwhile.
  - Rejecting an approved request is not possible; it ends by itself.
- **Known limits:**
  - An issue's link to its spec leads nowhere until the plan package is in the repository (part 29c). The path follows the task's place in the plan; a task that moves has another path afterwards.
  - A task whose issue was created keeps it when the task is reworded; the issue is not changed.
  - The stand-in forgets what it created when the development server restarts, while Covibes still names the issues.
  - Looking for an issue by its mark relies on GitLab's search in descriptions; this was checked against the stand-in and GitLab's documented API, not against a real GitLab.
  - The log has no pages; it shows the latest 100 requests.
