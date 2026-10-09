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
  - An action GitLab refuses fails with its reason, and the others go on. If GitLab cannot be reached, the run stops and the rest waits.
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
  - Requests wait in "Wartet auf dich" as cards "· Freigabe" (handoff, section 4): what is created in which repository, "Freigeben", "Ansehen" (the actions), "Ablehnen"; above several of them "Alle freigeben". A running request shows how far it is, a failed one what went wrong, with "Erneut versuchen". A request that was done within the last hour is a line with a check.
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
- [ ] Owners and editors make a request for issues from the plan's tasks; a task with an issue, or with one that waits, cannot be chosen again.
- [ ] Who may approve approves one or all waiting requests, with an own GitLab account; others cannot, and the card says what is missing.
- [ ] An approved request runs in the worker with the approver's access: milestones are found or created, issues are created with task, milestone, link to the spec and "via Covibes".
- [ ] A refused action fails with its reason while the others go on; an unreachable GitLab stops the run; approving again runs only what is not done, and nothing is created twice.
- [ ] Rejecting and taking back end a request; a changed repository withdraws what waits.
- [ ] The log shows every request with who asked, who decided and when, and its actions with their outcomes and links; every member reads it.
- [ ] Requests count in "Wartet auf dich", in the project list and in the mail for those who may approve.
- [ ] The stand-in creates milestones and issues, and agents that read see them.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the database, the building of issues, the writer, the job, the API and the web parts pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
