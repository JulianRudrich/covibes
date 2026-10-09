# 29a GitLab Access per Person

## Goal
Git actions run with the GitLab access of the person who approves them (`project-overview.md`, "Identity"). So the access to GitLab becomes a person's own: everyone connects their GitLab account once, and with it an owner picks the repository of a project and, from part 29b on, someone with the right to approve runs Git actions in their own name. The project keeps one repository; what changes is whose token does what.

First part of spec 29.

## Design decisions
- **Owner decision (2026-10-09):** who approves Git actions connects their own GitLab account. The action runs in that person's name, and GitLab's own permissions apply to that person. This keeps the product rule and replaces the single token per project of part 28a.
- **Split (2026-10-09):** spec 29 is built in four parts, because it is large:
  - 29a the access per person (this part)
  - 29b Git actions as proposals, the approval queue with batch approval, the audit log, and issues from the plan
  - 29c the plan package as a merge request
  - 29d merging after approval, and agents that propose Git actions
- **One account per person:** a person connects one GitLab account, for all projects on this server. The tokens are sealed as before and belong to the person, not to a project.
- **The repository of a project:** an owner with a connected account picks it. The project remembers who picked it, and the agents read with that person's access (part 28b), as before.
- **Two different ends:**
  - An owner removes the repository from a project: the project is disconnected, the person's account stays.
  - A person disconnects their account: the token is revoked at GitLab, and every project whose repository that person picked is disconnected with it.
  - As before, a project is also disconnected when that person leaves it or is no owner any more.
- **Where:**
  - "Repository …" in the project's menu, as before. An owner without an account is sent to GitLab first and comes back to the dialog; then the list of repositories follows.
  - "GitLab-Konto …" in the account menu, for everyone: which account is connected, connecting and disconnecting it.
- **What exists is kept:** the connections made with part 28a become the account of the owner who made them; nobody has to connect again.

## Implementation

### Database
- Migration `0030`: `git_accounts` (one per person: the GitLab's address, the account, the sealed tokens with their expiry) takes the place of `oauth_tokens`; the tokens that exist are moved to the owner who connected. No request of a user reads the table. A project's connection ends with the account of who made it.

### Server
- `integrations/gitlab/connections.ts`: the store keeps accounts per person (connect, access with renewal, disconnect) and the repository per project (pick, access through the person who picked, remove).
- `/api/git/account`: the own account, starting the OAuth flow, and disconnecting. `/api/git/callback` stores the account and leads back to the project the flow was started from, or to the start page.
- `/api/projects/:projectId/git`: the state also says whether the person has an account; picking a repository makes the connection; removing it leaves the account.

### Web
- The dialog "Repository" follows the new flow.
- A dialog "GitLab-Konto" in the account menu.
- **i18n:** `git.*`, `account.*`.

## Out of scope
- Git actions and approvals (part 29b)
- several GitLab accounts per person, and a GitLab per project
- showing which projects use a person's account

## Dependencies
- Spec 28 (both parts)

## Checklist
- [x] Everyone connects their own GitLab account through the consent page and disconnects it again; the tokens are sealed and belong to the person.
- [x] An owner with an account picks the repository of a project; an owner without one is sent to GitLab first and comes back to the dialog.
- [x] Agents read the repository with the access of the owner who picked it; the token is renewed as before.
- [x] Removing the repository from a project leaves the account; disconnecting the account disconnects the projects it served and revokes the token.
- [x] The connections of part 28a are kept through the migration.
- [x] No token is in any answer; editors and viewers cannot pick or remove a repository.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for the database, the store, the API and the dialogs pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-09)
- **Database** (`packages/db/migrations/0030_git_accounts.sql`): `git_accounts` has one row per person with the GitLab's address, the account and the sealed tokens. RLS is on, without a policy and without a grant, as it was for `oauth_tokens`, which is dropped.
  - The connections of part 28a become the account of the owner who made them; someone who connected several projects keeps the tokens that were renewed last.
  - A connection whose owner had not picked a repository yet is only that owner's account now: a project is connected by picking its repository.
  - `git_connections.connected_by` points to `git_accounts` and cascades, so a project is disconnected with the account of who picked its repository. The trigger of part 28a (the maker leaves or is no owner any more) stays.
- **Store** (`apps/server/src/integrations/gitlab/connections.ts`):
  - per person: `connectAccount`, `account` (without tokens), `accessOf` (renews under the lock of the account's row; an account GitLab refuses is removed) and `disconnectAccount` (revokes the token at GitLab as far as that works)
  - per project: `setRepository` (only for a person with an account), `access` (through the person who picked) and `disconnect`
  - A person who comes back with another GitLab account than before loses the repositories picked with the old one; with the same account only its name is updated.
- **API** (`apps/server/src/api/git.ts`):
  - `GET /api/git/account`, `POST /api/git/account/connect` and `DELETE /api/git/account` for everyone who is signed in. Starting the flow names the dialog it came from (`origin`) and, if the person is in one, the project.
  - `GET /api/git/callback` stores the account and leads back to `/p/:id` or `/` with `?git=` (the dialog "Repository") or `?gitAccount=` (the dialog "GitLab-Konto") and how it ended. The signed state carries the person, the project and the origin.
  - `/api/projects/:projectId/git`: the state also names the asking person's own account; the list of repositories and the pick use the owner's own account (404 without one); `DELETE` removes the repository only.
- **Web:**
  - `features/git/git-dialog.tsx`: an owner without an account sees "Mit GitLab verbinden" and comes back to this dialog; with an account the list to pick from follows, below the line "Dein GitLab-Konto: …". A picked repository shows "Gewählt von … Die Agents lesen mit dem Zugriff von …", "Ändern" and "Repository entfernen". Editors and viewers see what is connected, or that an owner can pick one.
  - `features/git/git-account-dialog.tsx`: the dialog "GitLab-Konto" of the account menu, with the connected account, "Konto trennen" (a second click, with what goes with it) and "Mit GitLab verbinden".
  - `features/account/account-menu.tsx`: the entry "GitLab-Konto …"; the dialog opens by itself on `?gitAccount=` and cleans the address when it closes.
- **Verified** with `pnpm dev` and the browser as olga in "Vereins-App", against the stand-in:
  - After the migration the connection of part 28a was olga's account, the project still had its repository, and the list of repositories came with the personal token.
  - "Konto trennen" and "Wirklich trennen": the account was gone, and the project had no repository any more.
  - "Mit GitLab verbinden" in the account dialog led to the consent page and back to the project with `?gitAccount=connected`; the dialog opened by itself and named the account, and closing it cleaned the address.
  - "Repository …" then offered the three example repositories; picking "Vereins-App" connected the project again.
  - No model run was needed. A real GitLab was not used.
- **Decided while building:**
  - One account per person and server, not one per project: the tokens of a person are the same wherever that person approves.
  - The state of a project names the asking person's own account, so the dialog "Repository" needs one request.
  - Another owner who picks a repository takes the connection over; the agents read with that owner's access from then on.
  - Coming back with another GitLab account removes the repositories picked with the old one, since the new account may not reach them.
  - A flow that was started for the dialog "Repository" without a project leads back to the account dialog; the start page has no other.
- **Known limits:**
  - Nobody sees which projects use their account; disconnecting says only that those projects lose their repository.
  - The members of a project are not told when its repository goes with an account; the dialog shows it the next time it opens, and the agents say that no repository is connected.
  - The calls were checked against the stand-in and GitLab's documented API, not against a real GitLab.
