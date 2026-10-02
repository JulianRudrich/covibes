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
- [ ] A member mentions another one with `@` from the menu or by typing; the message shows the chip, and the mentioned person gets a notification.
- [ ] The bell shows unread notifications with a counter, opens the project of one and marks it as read; all can be marked as read.
- [ ] A changed role, a removal and a new member of an own project show up in the bell of whom they concern.
- [ ] "Wartet auf dich" lists proposals, raised hands and votes without the own vote, and its counter counts what the person can act on.
- [ ] The project list shows how much waits in each project.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the database, the API and the components pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
