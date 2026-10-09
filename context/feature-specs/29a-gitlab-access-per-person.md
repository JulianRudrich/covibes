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
- [ ] Everyone connects their own GitLab account through the consent page and disconnects it again; the tokens are sealed and belong to the person.
- [ ] An owner with an account picks the repository of a project; an owner without one is sent to GitLab first and comes back to the dialog.
- [ ] Agents read the repository with the access of the owner who picked it; the token is renewed as before.
- [ ] Removing the repository from a project leaves the account; disconnecting the account disconnects the projects it served and revokes the token.
- [ ] The connections of part 28a are kept through the migration.
- [ ] No token is in any answer; editors and viewers cannot pick or remove a repository.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the database, the store, the API and the dialogs pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
