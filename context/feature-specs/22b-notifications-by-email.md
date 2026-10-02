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
- **Having a project open counts as seeing it:** while a member has a project open, the server notes when they were last there. "Since you were away" (spec 23) builds on the same.
- **The worker sends** (`architecture.md`: mails are jobs). Locally its mails land in the development mailbox of the server.

## Implementation

### Database: migration `0019_notification_mails.sql`
- `notifications.mailed_at`; `project_members.last_seen_at` and `waiting_mailed_at`.
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
- **Live channel:** notes when a member has a project open (on connect, every two minutes, on close).
- **API:** `GET/PATCH /api/notifications/settings`.
- **Tests:** what the mail contains and what it leaves out, the pause between mails, the switch, everything mailed once, the triggers, the settings, the development mailbox endpoint, the noted visits.

### Web
- **Account menu:** the switch "E-Mail-Benachrichtigungen".
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
- [ ] Someone who is mentioned and does not read it in the app gets a mail with who wrote what in which project; someone who reads it in the app gets none.
- [ ] The mail also lists a changed role, a removal and how much waits in a project the person has not opened since.
- [ ] A person gets at most one mail in 30 minutes, and nothing is mailed twice.
- [ ] The switch in the account menu turns the mails off and on.
- [ ] Locally the mails land in the development mailbox.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the database, the task, the API and the components pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
