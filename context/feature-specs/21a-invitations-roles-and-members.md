# 21a Invitations, Roles and Members

## Goal
A project becomes a team: owners invite people by link or by email with a role, everyone sees who is in the project, and owners change roles, grant the Git approval right and remove members. Whoever loses access loses it at once, also in open tabs.

First part of spec 21; part 21b brings the read-only link.

## Design decisions
- **Roles** as in `project-overview.md`: viewers read, editors work, owners manage. An invitation makes someone an editor or a viewer; an owner is made in the member list, as a deliberate step. A project always keeps at least one owner (the database enforces it since spec 04).
- **Two kinds of invitation**, both valid for seven days and revocable:
  - **By link:** one link for several people, e.g. to post in the team's own chat. Everyone who opens it while it is valid can join with its role.
  - **By email:** Covibes sends the link to one address; it works once. Locally the mail lands in the development mailbox. Without a mailer (production without SMTP) only links are offered.
  - An email invitation is not bound to the address: whoever has the mail can join, also with a GitLab login under another address. The owner sees who joined.
- **The link is a secret:** only its hash is stored, and the database checks it. So the link shows once, when it is created; an email invitation can be sent again, which makes a new link. Open invitations list what they are, never the link.
- **Joining is a decision:** the link opens a page that says who invites to which project with which role; "Beitreten" joins. Without a session the person signs in first and comes back to that page. Someone who is a member already just goes to the project; their role does not change.
- **Limits:** 20 open invitations and 50 members per project; 20 invitation mails per person and hour, since Covibes would otherwise send mail to any address for anyone.
- **Members:**
  - The share dialog lists the members with their role. Owners change the role of others and their own (unless they are the last owner), grant editors the right to approve Git actions (`project-overview.md`: "Approvals"; used from the GitLab specs on) and remove members. Everyone can leave a project, except its last owner.
  - A member's address stays hidden from the others, as before.
- **Losing access is immediate** (note from spec 06): removing a member or changing a role closes that person's open connections to the project. A removed member's tab says that they are no longer a member; a changed role applies without a reload.
- **What stays of a former member:** their messages, decisions and files keep their name. Their personal custom agents leave the project's team, since a personal agent is in a team through its creator.
- **The creator** of a project (`projects.owner_id`) is only its first owner: when that person leaves or stops being an owner, the longest-standing other owner takes that place.

## Implementation

### Database: migration `0016_invitations.sql`
- Table `invitations`: project, kind (`link` or `email`), role (`editor` or `viewer`), the address of an email invitation, the hash of the token, who created it, when it expires, how often it was used, when it was revoked. RLS: owners read, create and revoke; the hash is not readable for the app role.
- `invitation_preview(token)` and `accept_invitation(token)`: check the token against its hash and what became of the invitation; accepting adds the member and counts the use.
- `project_people`: everyone who ever was a member of a project, filled by a trigger. The `users` policy lets members read the names of these people, so former members keep their name.
- `project_members`: members may delete their own row (leave); a viewer cannot hold the Git approval right; changes are announced on the live channel by a trigger; a leaving member's personal agents leave the team; the creator's place passes on.

### Shared: `packages/shared/src/`
- `invitations.ts`: the roles of an invitation, the inputs for creating one, `Invitation`, `InvitationPreview` with its status, the input for changing a member, and the limits.
- `ProjectMember` gets `canApproveGit`; new error codes `already_member` and `last_owner`.

### Server
- **API:**
  - `GET/POST /api/projects/:projectId/invitations`, `POST …/:invitationId/resend`, `DELETE …/:invitationId` (owners)
  - `POST /api/invitations/preview` and `POST /api/invitations/accept` with the token in the body (signed in)
  - `PATCH` and `DELETE /api/projects/:projectId/members/:userId`
- **Mail:** the invitation mail in the project's language, as plain text.
- **Connections:** the live channel and the collaboration server each close the connections of one person to one project.
- **Tests:** RLS and the functions; the API for owners, editors, viewers and strangers; limits; the mail; closing connections on a role change and a removal.

### Web
- **Share dialog** behind "Teilen" in the header: inviting by email or link (owners), the open invitations with "Widerrufen" and "Erneut senden", the members with role, Git approval right, removing and "Projekt verlassen".
- **Invitation page** `/invite/$token`: who invites to what, "Beitreten", and what to say when the link is expired, revoked, used or unknown. The login page says that an invitation is waiting.
- **Workspace:** a note instead of "not found" when access was taken away while the project was open.
- **i18n:** `share.*`, `invite.*`.

## Out of scope
- the read-only link (spec 21b)
- notifications about invitations, role changes and removals (spec 22)
- transferring a project to another account, and deleting a project
- binding an invitation to an address or a domain, and approval of join requests
- invitations in a language the invited person chooses; the mail uses the project's language

## Dependencies
- Spec 04 (login, projects, roles in the database), spec 06 (live channel), spec 19 (custom agents)
- Packages: none new

## Checklist
- [x] An owner creates an invitation link with a role; someone else opens it, signs in if needed, joins and has that role.
- [x] An owner invites by email; the mail arrives in the development mailbox, its link works once, and it can be sent again or revoked.
- [x] Expired, revoked, used and unknown links say so and add nobody.
- [x] The share dialog lists the members; owners change roles, grant the Git approval right and remove members; everyone but the last owner can leave.
- [x] A changed role applies in the open tab without a reload; a removed member's open connections are closed and the tab says so.
- [x] Messages of former members keep their author's name.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for the database, the API, the connections and the components pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-02)
- **The link:** the server makes 32 random bytes as base64url and stores their SHA-256; the link is `/invite/<token>`. A link invitation's address is in the answer of the request that creates it and nowhere else; an email invitation's only in the mail. Sending again replaces the hash, so the earlier mail's link is unknown from then on.
- **The database decides:** `invitation_preview` and `accept_invitation` hash the token and compare. The preview tells the project's name, the role and who invites only while the invitation is open (or to a member); an expired, revoked or used one only says which of these it is, and a token nobody issued gives no row (404). Accepting locks the invitation, adds the member with the invitation's role and counts the use; it answers `joined`, `member`, `full`, `expired`, `revoked` or `used`. The app role cannot read the hash.
- **API:** the token goes in the body of `POST /api/invitations/preview` and `…/accept`, so it is in no address of the API. Owners list the open invitations (not revoked, not expired, by mail not used), create, send again and revoke. Inviting an address again revokes its open invitation; an address of a member is refused with `already_member` without telling whose it is.
- **Limits:** 20 open invitations and 50 members per project, 20 invitation mails per person and hour (in memory, like the other rate limits).
- **The mail** is plain text in the project's language, with names reduced to one line.
- **Members:**
  - `PATCH …/members/:userId` changes the role and the Git approval right. The right is one of editors: it is cleared when the role changes, and the project details report it as true for owners. `DELETE` removes a member (owners) or leaves (oneself). The last owner can neither step down nor leave (`last_owner`).
  - A trigger on `project_members` announces every change on the live channel, takes a leaving member's personal agents out of the team and passes the creator's place on.
  - `project_people` keeps everyone who ever was a member; the `users` policy reads it, so names of former members stay readable for the members, and for nobody else.
- **Connections:** `ProjectConnections.closeUser` closes one person's board connections with Hocuspocus' "reset connection", so the browser connects again and authenticates anew (new rights, or refused). For a removed member the live channel sends one `project` event to their sockets and closes them with code 4403; a reconnect is refused as for any stranger.
- **Web:**
  - "Teilen" opens the share dialog: one row to invite (address, role, "Einladen", "Link erstellen"), the new link in a box with "Kopieren" and the note that it shows only now, the open invitations with "Erneut senden" and "Widerrufen", the members with a role select, the checkbox for the Git approval right under an editor's name, and "×" with a second click to remove. "Projekt verlassen" needs a second click; the last owner sees why it is off. Everyone but owners sees the members only.
  - `/invite/$token` shows the invitation and joins on "Beitreten"; a member is led to the project; everything else says why the link adds nobody. The login page says that an invitation waits.
  - A project that was open and answers "not found" shows "Du bist nicht mehr in diesem Projekt" instead of "Projekt nicht gefunden". The open invitations reload with the project's live event.
- **Verified** with `pnpm dev`, the browser as olga and a second local test account (sam) through a script against the same server:
  - Olga invited sam by mail as "Bearbeiter" and created a link for "Leser" in "Vereins-App"; the mail was in the development mailbox, sam joined through it (`joined`, then `member`), and olga's open dialog showed two members and the header a second avatar without a reload.
  - Olga granted sam the Git approval right and then made sam a "Leser": the right was gone, and sam's message was refused with 403.
  - Sam created "Sams Projekt" and a link; olga opened it, saw "sam lädt dich ein, als Bearbeiter mitzumachen" and joined. Sam made olga a "Leser": her open tab lost the composer ("Du hast Lesezugriff") and the canvas tools without a reload; back to "Bearbeiter" they returned, and she sent a message. Sam removed olga: her tab showed "Du bist nicht mehr in diesem Projekt", and sam still read her message under her name.
  - A wrong link showed "Diese Einladung gibt es nicht". Olga revoked the link and removed sam in the dialog after the second click.
  - Expired and used invitations, the limits, viewers and strangers are covered by the tests of the database, the API and the components; they were not tried live.
- **Known limits:**
  - When the mail of an email invitation cannot be sent, the invitation exists anyway; the owner sees an error and sends it again or revokes it.
  - An email invitation is not bound to its address. A login link requested from the invitation page carries the page's address, so the invitation's token is also in that login mail.
  - The rate limit of the mails is per server process. Nobody is told by mail or in the app that their role changed or that they were removed (spec 22).
  - A project cannot be deleted or handed over yet; its last owner cannot leave.
