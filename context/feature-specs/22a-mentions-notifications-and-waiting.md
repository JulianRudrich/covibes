# 22a Mentioning People, Notifications in the App and "Waiting for You"

## Goal
Nobody misses what concerns them: people mention each other in the chat, a bell collects what happened while someone looked elsewhere, and "Wartet auf dich" lists everything in a project that needs that person's say, with a counter that is true for them.

First part of spec 22; part 22b brings the notifications by email.

## Design decisions
- **Mentioning people:** `@` and a member's name mentions that person, like it calls an agent. The handle is the name with hyphens for everything that is not a letter or digit ("Alex Berg" is `@Alex-Berg`). The `@` menu of the composer offers the other members below the agents. The server decides who is mentioned and stores it with the message; a mention shows as a chip, the own one stronger.
  - A name an agent of the team answers to calls the agent. Two members with the same handle are both mentioned.
  - Only people's messages mention people. Agents talk to people by name without `@`.
- **Notifications in the app:** a bell in the header, in the project and on the project list, with the number of unread ones. It lists, newest first:
  - someone mentioned you (who, in which project, the start of the message)
  - an owner changed your role, or removed you from a project
  - someone joined a project you own
  - A notification opens its project and is read then; "Alle als gelesen markieren" reads all.
  - A mention in the project that is open and visible is read at once: the person is looking at it.
  - The bell asks the server every 30 seconds and when the window gets the focus. A person-wide live channel is not worth it yet.
- **"Wartet auf dich" is complete and personal:** besides the proposals (spec 13) it lists the raised hands of the agents and the open votes in which the person has not voted, each with its buttons. The counter counts what the person can act on: nothing for viewers, no decisions for editors while only the owner decides.
- **The project list says where something waits:** every project shows how many things wait for the person there.
- **Offers of the moderator** stay in the chat: they are part of the conversation and have "Später". Git approvals join "Wartet auf dich" with the GitLab specs.

## Implementation

### Database: migration `0018_notifications.sql`
- `messages.mentioned_users`: the people a message mentions.
- Table `notifications`: for whom, what kind, the project and its name, who caused it and their name, the start of the message, when, and when it was read. Names are stored with the notification, so it stays readable for someone who was removed. RLS: everyone reads and marks their own.
- Triggers: a message with mentions notifies the mentioned members (never its author); a change of the members notifies whom it concerns.
- `project_waiting_count(project)`: how much waits for the current user in a project.

### Shared: `packages/shared/src/`
- `memberHandle`, the parsing of people mentions, `mentionedUsers` on a chat message.
- `Notification` with its kinds, the input for marking as read, `waiting` on a project summary, `OpenVote`.

### Server
- **Chat:** sending a message stores whom it mentions.
- **API:** `GET /api/notifications`, `POST /api/notifications/read`; `GET /api/projects/:projectId/votes` for the open votes; the project list with the waiting count.
- **Tests:** who is mentioned and who is notified, RLS of the notifications, the notifications of member changes, reading, the waiting count per role, the open votes.

### Web
- **Composer and chat:** the members in the `@` menu, chips for people.
- **Bell:** the list in a popover, the unread counter, opening and reading.
- **"Wartet auf dich":** cards for raised hands and votes, and the personal counter.
- **Project list:** the number of waiting things per project.
- **i18n:** `notifications.*`, `overview.*`, `chat.*`.

## Out of scope
- notifications by email and the switch for them (spec 22b)
- push notifications of the browser or the operating system, and sounds
- mentioning everyone at once (`@alle`), and agents mentioning people
- settings per kind of notification or per project
- "Since you were away" (spec 23)

## Dependencies
- Spec 13 (proposals), spec 15 (raised hands), spec 16b (votes), spec 21a (members)
- Packages: none new

## Checklist
- [x] A member mentions another one with `@` from the menu or by typing; the message shows the chip, and the mentioned person gets a notification.
- [x] The bell shows unread notifications with a counter, opens the project of one and marks it as read; all can be marked as read.
- [x] A changed role, a removal and a new member of an own project show up in the bell of whom they concern.
- [x] "Wartet auf dich" lists proposals, raised hands and votes without the own vote, and its counter counts what the person can act on.
- [x] The project list shows how much waits in each project.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for the database, the API and the components pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-02)
- **Mentions of people:**
  - `memberHandle` turns a name into one word (hyphens for every run of characters that are neither letters, digits nor `_`). `parsePeopleMentions` finds them with the same rules as agent mentions (not in code, not inside addresses), with the agents' names first, so a name an agent of the team answers to stays the agent's.
  - Sending a message stores the mentioned members (never the sender) in `messages.mentioned_users`, at most 20. The message carries them as `mentionedUsers`, and the chat shows a chip only for those: neutral, and in the ink color for the reader's own mention. The composer's `@` menu lists the other members under "Mitglieder"; the browser parses the same way for the message it shows before the server answers.
- **Notifications:**
  - Triggers write them: a person's message notifies the mentioned members; a new member notifies the owners; a role someone else changed and a removal by someone else notify the member. Leaving and stepping down on one's own, a deleted account and a deleted project notify nobody.
  - A notification stores the project's name, who caused it and, for a mention, the first 200 characters of the message as one line. So it needs no join, and someone who was removed still reads what happened.
  - `GET /api/notifications` returns the latest 50 and the number of unread ones; `POST /api/notifications/read` marks single ones, the mentions of one project, or all. RLS shows and lets mark only one's own.
- **The bell** is in the header of the workspace and of the project list: a counter (up to "9+"), a popover with the list, "Alle als gelesen markieren". A row opens its project and is read; a removal is only read. It asks every 30 seconds and on focus. In an open project a live message that mentions the user reloads it at once, and mentions of the open, visible project are marked as read.
- **"Wartet auf dich":**
  - Cards for raised hands ("Anhören", "Nicht jetzt") and for open votes without the user's vote (a button per option, and how many have voted). Voting there and in the chat are the same action; the card goes when the vote is cast. `GET /api/projects/:projectId/votes` lists the open votes, since the chat only holds the latest messages.
  - The counter counts proposals, hands and votes the user can act on. Viewers see proposals without buttons and a counter of 0; raised hands and votes are not listed for them.
- **Project list:** `project_waiting_count` counts the same per project in the database, and the list shows "3 warten auf dich".
- **Verified** with `pnpm dev`, the browser as olga and a second local test account (sam) through a script:
  - Sam joined "Vereins-App" through a link: olga's bell showed 1 and "sam ist Vereins-App beigetreten, als Bearbeiter".
  - Olga chose sam under "Mitglieder" in the `@` menu; the message showed the chip `@sam`, and sam's notifications listed the mention with the start of the message. Sam's answer with `@olga` arrived with the strong chip and was read at once in the open project.
  - On the project list the bell showed 1 after another mention, the row opened the project and was read; "Vereins-App" showed "2 warten auf dich".
  - The moderator started a vote on request: its card appeared under "Wartet auf dich" with the counter. A raised hand (inserted for the test) appeared as a second card. Voting in the overview removed the card and showed the vote in the chat; "Nicht jetzt" removed the hand, and the section went away.
  - After olga removed sam, sam's notifications listed the removal.
  - Role changes, the limits and what viewers see are covered by the tests of the database, the API and the components; they were not tried live.
- **Known limits:**
  - The bell is not live across projects: outside the open project it learns of something new within 30 seconds or on focus.
  - A member whose name an agent of the team answers to cannot be mentioned; two members with the same handle are always mentioned together. There is no "@alle", and agents do not mention people.
  - Mentions are found when a message is sent; a later change of a name does not change old messages.
  - Notifications are kept without a limit; nothing removes old ones yet.
