# 22b Notifications by Email

## Goal
Someone who is not in Covibes still learns what concerns them: a mail sums up mentions, changes of their access and what waits for them. Someone who is active in the app gets no mail, and nobody gets a flood of mails.

Second part of spec 22; part 22a brought the mentions of people, the notifications in the app and the complete "Waiting for you".

## Design decisions
- **One mail sums things up.** It lists, grouped by project:
  - mentions that are still unread, each with who wrote and how the message starts
  - a role someone else changed, and a removal from a project
  - how much waits for the person in a project (proposals, raised hands, votes), if something of it appeared since they last had the project open
  - That someone joined an own project stays in the app: it needs no reaction.
- **Only what the person has not seen.** A mail goes out ten minutes after the first event, so whoever is in the app reads it there and gets no mail. A notification that was read meanwhile and a project that was open meanwhile are left out; if nothing is left, no mail is sent.
- **At most one mail per person in 30 minutes.** What happens in between waits for the next mail. Everything is mailed once.
- **A switch per person:** "E-Mail-Benachrichtigungen" in the account menu, on by default. Without a mailer (production without SMTP) nothing is sent and the switch is not shown.
- **Language:** the person's language of the app; plain text like every mail of Covibes, with links to the projects.
- **Having a project open counts as seeing it:** while a member has a project open in a visible tab, the server notes when they were last there. "Since you were away" (spec 23) builds on the same.
- **The worker sends** (`architecture.md`: mails are jobs). Locally its mails land in the development mailbox of the server.

## Implementation

### Database: migration `0019_notification_mails.sql`
- `notifications.mailed_at`.
- Table `member_activity`: per member when they last had the project open (`last_seen_at`) and when a mail last told them that something waits (`waiting_mailed_at`). Nobody reads it directly.
- Table `notification_settings`: per person the switch for mails and when the last mail went out. RLS: everyone reads and changes their own switch.
- `touch_project_seen(project)`: notes that the current user has the project open.
- Triggers schedule the job `notification_mail` for a person, ten minutes ahead and once per person: for a notification that is mailed, and for every owner and editor when a proposal, a raised hand or a vote appears.
- `waiting_for_user(user)`: per project how much waits for a person and when the newest of it appeared.

### Shared: `packages/shared/src/`
- `NotificationSettings` and the input for changing them.

### Server
- **Worker task `notification_mail`:** collects what to mail for one person, sends one mail and marks everything as mailed; too early after the last mail, it runs again later.
- **Mail:** the digest in German and English.
- **Mailer of the worker:** SMTP in production; locally it hands its mails to the server's development mailbox through an endpoint only the worker may call.
- **API:** `GET/PATCH /api/notifications/settings`, and `POST /api/projects/:projectId/seen`, with which the web app reports an open, visible project.
- **Tests:** what the mail contains and what it leaves out, the pause between mails, the switch, everything mailed once, the triggers, the settings, the development mailbox endpoint, the noted visits.

### Web
- **Account menu:** the switch "E-Mail-Benachrichtigungen".
- **Workspace:** reports the open project as seen.
- **i18n:** `account.*`.

## Out of scope
- mails per event without bundling, and settings per kind or per project
- a daily or weekly summary; "Since you were away" in the app (spec 23)
- unsubscribing through a link in the mail without signing in
- HTML mails, push notifications
- mails about Git approvals (they come with the GitLab specs)

## Dependencies
- Spec 22a
- Packages: none new

## Checklist
- [x] Someone who is mentioned and does not read it in the app gets a mail with who wrote what in which project; someone who reads it in the app gets none.
- [x] The mail also lists a changed role, a removal and how much waits in a project the person has not opened since.
- [x] A person gets at most one mail in 30 minutes, and nothing is mailed twice.
- [x] The switch in the account menu turns the mails off and on.
- [x] Locally the mails land in the development mailbox.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for the database, the task, the API and the components pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-02)
- **The job:** triggers call `graphile_worker.add_job('notification_mail', …)` with a key per person, ten minutes ahead and with `preserve_run_at`, so later events join the job that waits. It is scheduled for a notification of the kinds `mention`, `role_changed` and `removed`, and for every owner and editor of a project when a proposal, a raised hand or a vote appears.
- **What a run does** (`tasks/notification-mails.ts`):
  - Nothing without a mailer, for an account that is gone, or with the switch off.
  - Within 30 minutes of the person's last mail it schedules itself for the end of the pause.
  - It collects up to 20 unread notifications that were not mailed, and the projects where something waits that is newer than the person's last visit and than the last mail about it (`waiting_for_user`).
  - With nothing left it ends; else it sends one mail and then notes in one transaction: `mailed_at` on the notifications, `waiting_mailed_at` per project, `last_mail_at` for the person. A mail that cannot be sent fails the job before anything is noted, so the worker tries again.
- **The mail** is plain text in the person's language (`users.locale`), grouped by project in the order things happened. A project gets its link only if the person is a member of it now. The subject names the mention when that is all there is, else the project, or the number of projects.
- **Seen:** `member_activity` holds per member when they last had a project open and when a mail last told them that something waits. It is a table of its own, since a change of `project_members` is announced to everyone. The web app reports an open project as seen on opening it, when the tab comes to the front, and every two minutes while it is visible; a tab in the background reports nothing.
- **The switch:** `notification_settings` with one row per person who changed it; without a row mails are on. RLS lets everyone read and change their own switch; when the last mail went out is for the worker only. The account menu shows the switch as a checkbox item that keeps the menu open; a server that cannot send mail offers none.
- **The worker's mailer:** SMTP in production, with `SMTP_URL` and `MAIL_FROM` now also in the worker's environment (and in `deploy/compose.yaml`); without SMTP nothing is mailed. Locally the worker posts its mails to `POST /api/dev/mails` of the server, which exists in development only and checks the shared secret in a header, so the mails show in the development mailbox.
- **Verified** with `pnpm dev`, the browser as olga and a second local test account (sam) through a script:
  - The account menu showed "E-Mail-Benachrichtigungen" with a check; turning it off and on changed the setting on the server.
  - Sam joined "Vereins-App" and mentioned olga while she was on the project list; a raised hand was inserted for the test. With the waiting jobs set to run at once, the worker sent olga one mail to the development mailbox: "Neues für dich in „Vereins-App“" with the link of the project, sam's mention with the start of the message, and "1 Sache wartet auf dich".
  - Sam's mail listed what sam had not read since the test of spec 22a: the mention, the removal and the hand. It had no link to the project although sam was a member again; since then the link follows the current membership, and a test covers it.
  - The pause of 30 minutes, what is left out after reading or seeing, the language and a failing mailer are covered by the tests of the task; they were not tried live.
- **Known limits:**
  - A person with more than 20 unread notifications gets the rest with the next mail, after the pause.
  - "Seen" is per project, not per item: whoever had a project open is told nothing about what waited there at that time, also if they did not look at the overview.
  - There is no link in the mail that turns the mails off without signing in, and no setting per kind or per project.
  - The ten minutes and the 30 minutes are fixed.
