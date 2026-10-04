# 28a Connecting GitLab

## Goal
A project gets its repository. An owner connects GitLab through OAuth with the scope `api` and picks the repository the project belongs to. The tokens are stored encrypted and renewed by the server. Every member sees which repository is connected. From here on the agents can read it (part 28b) and Git actions can be proposed (spec 29).

First part of spec 28.

## Design decisions
- **Owner decisions (2026-10-04):**
  - Development and tests run against a local stand-in for GitLab with an example repository; no account is needed. The real connection works as soon as an OAuth application is configured, and is checked against a real GitLab at the latest for the launch (spec 35).
  - One connection per project, made by an owner. The agents read with that access for all members; who has no access to the repository in GitLab sees its content through the agents' answers. The read-only link shows nothing of it.
- **Split (2026-10-04):** 28a connects (OAuth, tokens, picking the repository, the dialog, the stand-in); 28b lets the agents read repository, issues and merge requests.
- **One OAuth application, two flows:** the connection uses the application of the login (`GITLAB_CLIENT_ID`, `GITLAB_CLIENT_SECRET`, `GITLAB_ISSUER`; gitlab.com by default). The login asks for `read_user`, the connection for `api`, with a redirect address of its own (`…/api/git/callback`). Signing in never grants access to repositories.
- **The flow:**
  1. An owner chooses "Mit GitLab verbinden". The server answers with GitLab's address for the consent, with a signed `state` that names the project and the person and expires after ten minutes.
  2. GitLab sends the person back to the server with a code. The server checks the state against the session, trades the code for tokens, reads who the account is and stores the connection.
  3. Back in the project, the dialog lists the repositories the account can reach, with a search. The owner picks one.
- **Tokens:** access and refresh token are encrypted with AES-256-GCM under a key of the server (`TOKEN_KEY`) and sit in a table no request of a user can read. The server renews an access token shortly before it expires, one renewal at a time per connection, because GitLab hands out a new refresh token with every renewal. Tokens never reach the browser or a model.
- **Whose access it is:** the connection belongs to the person who made it. It ends when an owner disconnects (the token is revoked at GitLab), and by itself when that person leaves the project or is no owner any more.
- **Who sees what:** every member sees that a repository is connected, which one, and who connected it. Only owners connect, pick and disconnect. Without a way to reach a GitLab (no OAuth application and no stand-in) the dialog says that the server is not set up for it.
- **The stand-in:** in development, as long as no OAuth application is configured, the server itself answers as a small GitLab under `/api/dev/gitlab`, like the development mailbox: a consent page with one example account, tokens, and example repositories. Production never serves it. Tests use the same stand-in.
- **An own small client** over `fetch` for OAuth and the few calls of the API, with every answer checked. `@gitbeaker/rest` from the stack table is not used: the calls are few, and one client serves the real GitLab and the stand-in alike.
- **Where:** the project's menu gets "Repository …", which opens the dialog, for every member.

## Implementation

### Shared: `packages/shared/src/`
- The state of a project's connection for the dialog (whether the server can connect, the connection with account, repository and who connected), the input for picking a repository, and the live event `git`.

### Database
- Migration `0029`: `git_connections` (one per project: the GitLab's address, who connected, the account, the repository once it is picked) and `oauth_tokens` (the encrypted tokens with their expiry). Members read the connection; nobody but the server reads the tokens. A trigger ends a connection whose maker leaves the project or loses the owner role.

### Server
- `integrations/gitlab/`: the encryption of tokens and the signed state, the client, the store of connections with the renewal, and the stand-in for development.
- `/api/projects/:projectId/git`: the state for members; starting the connection, the repositories to pick from, picking one and disconnecting for owners. `/api/git/callback` ends the OAuth flow.
- Environment: `TOKEN_KEY` (at least 32 characters); development creates one with the other local secrets.

### Web
- `features/git/`: the dialog "Repository" with its states (not set up, not connected, connected without a repository, connected), opened from the project's menu and by itself after the way back from GitLab.
- The live channel loads the state again on `git`.
- **i18n:** `git.*`.

## Out of scope
- agents reading the repository (part 28b), Git actions and approvals (spec 29), webhooks (spec 30)
- a connection per member, and several repositories per project
- GitHub, and a GitLab whose address differs per project (the address is stored per connection, so this can follow)
- creating a repository from Covibes

## Dependencies
- Spec 21a (roles), spec 04 (login and the OAuth application's settings)

## Checklist
- [ ] An owner connects GitLab through the consent page and comes back to the project; the connection names the account, and the tokens are stored encrypted.
- [ ] The owner picks one of the account's repositories, with a search; every member sees the connected repository and who connected it.
- [ ] A state that is forged, expired or made for someone else is refused; a second use of a code stores nothing.
- [ ] The server renews a token that is about to expire, once per connection also when two calls need it at the same time.
- [ ] Disconnecting removes connection and tokens and revokes the token; the connection also ends when its maker leaves the project or is no owner any more.
- [ ] Editors and viewers cannot connect, pick or disconnect; no token is in any answer.
- [ ] Development runs against the stand-in without any account; production does not serve it.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the database, the client, the store, the API and the dialog pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
