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
- [x] An owner connects GitLab through the consent page and comes back to the project; the connection names the account, and the tokens are stored encrypted.
- [x] The owner picks one of the account's repositories, with a search; every member sees the connected repository and who connected it.
- [x] A state that is forged, expired or made for someone else is refused; a second use of a code stores nothing.
- [x] The server renews a token that is about to expire, once per connection also when two calls need it at the same time.
- [x] Disconnecting removes connection and tokens and revokes the token; the connection also ends when its maker leaves the project or is no owner any more.
- [x] Editors and viewers cannot connect, pick or disconnect; no token is in any answer.
- [x] Development runs against the stand-in without any account; production does not serve it.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for the database, the client, the store, the API and the dialog pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-08)
- **Database** (migration `0029_git_connections.sql`):
  - `git_connections`: one row per project with the GitLab's address, the owner who connected, the account (id, username, name) and the repository once it is picked (id, path, name, address, default branch; all of them or none). Members read; nobody writes through a request of a user.
  - `oauth_tokens`: the sealed access and refresh token with the expiry and the scope. RLS is on without a policy and without a grant: `covibes_app` cannot touch it at all.
  - A trigger ends the connection when its maker leaves the project, is removed, or is no owner any more; it also goes with the account and with the project. Another trigger announces every change as `git` on the live channel.
- **Secrets** (`apps/server/src/integrations/gitlab/crypto.ts`): a token is stored as `v1.nonce.ciphertext.tag` (AES-256-GCM, a fresh nonce each time). The `state` of a flow is the project, the person, an expiry of ten minutes and a nonce, signed with HMAC-SHA-256. Both use keys derived from `TOKEN_KEY`, one per purpose.
- **Client** (`client.ts`): `authorizeUrl`, `exchangeCode`, `refresh`, `revoke`, `account`, `repositories` (the account's repositories with at least Developer access, the latest active first, 20 per search) and `repository`. Every answer is checked with zod; an error status becomes a `GitlabError`; a call ends after 15 seconds.
- **Setup** (`setup.ts`): with `GITLAB_CLIENT_ID` and `GITLAB_CLIENT_SECRET` the server connects to `GITLAB_ISSUER` (gitlab.com by default); without them, outside of production, to its own stand-in. Without `TOKEN_KEY`, or in production without an application, projects cannot connect.
- **Store** (`connections.ts`): `connect` (in the place of an earlier connection), `access` (the token, renewed when it ends within a minute, with the row locked so that two calls renew once; a connection GitLab refuses is removed, a GitLab that is away leaves it), `setRepository`, `disconnect` (revokes as far as that works, then removes). It is the only code that opens tokens, and it works with the admin role after its callers checked who asks.
- **API** (`apps/server/src/api/git.ts`):
  - `GET /api/projects/:id/git`: whether the server can connect, whether the person may manage, and the connection (address, account, who connected and when, repository).
  - `POST …/git/connect` (owners): the address of the consent page. `GET …/git/repositories?search=` and `PUT …/git/repository` `{ repositoryId }` (owners): the list to pick from, and the pick, which must be a repository the account reaches. `DELETE …/git` (owners): the end.
  - `GET /api/git/callback`: checks the state against the session and the owner role, trades the code, reads the account, stores the connection and sends the browser to `/p/:id?git=connected`, `denied` or `failed`; without a valid state to the start page.
- **Stand-in** (`dev/stand-in.ts`), served under `/api/dev/gitlab` before the check of the origin: the consent page with "Zugriff erlauben" and "Ablehnen", the token endpoint (a code and a refresh token work once), revoking, the account "Olga Beispiel", three example repositories, and a page behind a repository's link. Its tokens are signed instead of remembered, so connections made in development survive a restart of the server.
- **Web** (`apps/web/src/features/git/`): the project's menu has "Repository …". The dialog shows one of: not set up, not connected (owners: "Mit GitLab verbinden"), connected without a repository (owners: the list with a search; others: who still picks), connected (the repository with a link, "Ändern", "Verbindung trennen" with a second click). After the way back the address carries `?git=…`; the dialog opens with it once and the address is cleaned when it closes.
- **Environment:** `TOKEN_KEY` (at least 32 characters). `pnpm dev` creates it with the other local secrets (`.data/local-secrets.json`); the Docker setup takes it from `deploy/.env` (`deploy/README.md` says how, together with the second redirect address and the scope `api`).
- **Verified** with `pnpm dev` and the browser as olga in "Vereins-App", against the stand-in:
  - "Repository …" opened the dialog with "Mit GitLab verbinden"; the click led to the consent page of the stand-in (scope `api`, back to `/api/git/callback`).
  - "Zugriff erlauben" led back to the project with `?git=connected`; the dialog opened by itself with "Verbunden als Olga Beispiel (@olga.beispiel), von olga." and the three repositories.
  - Picking "Vereins-App" showed the repository with its link (the stand-in's page answers); closing the dialog cleaned the address.
  - A connection from before a restart of the server ended by itself at its next use while the stand-in still forgot its tokens: the dialog went back to "Mit GitLab verbinden" without a reload (the live event).
  - The test project stays connected to the example repository, for part 28b. Not tried live: another member's view, denying the consent and disconnecting; all are covered by tests. A real GitLab was not used.
- **Found while testing live:**
  - The stand-in kept its tokens in memory, so every restart of the development server ended the connections two hours later. Its tokens are signed now and hold over a restart.
  - The link of a connected example repository led to nothing; the stand-in has a page for it now.
  - Two older tests listened on the live channel of the shared test database and broke when another test sent something that is no JSON at that moment; their listeners skip such payloads now.
- **Decided while building:**
  - The login's OAuth application also serves the connection, with a redirect address of its own.
  - The state is signed, not stored: no table, and nothing to clean up.
  - Only repositories in which the account has at least Developer access are offered, since spec 29 opens merge requests and issues with it.
  - A new connection replaces the old one and its repository is picked anew.
  - An own client instead of `@gitbeaker/rest` (see `architecture.md`).
- **Known limits:**
  - When GitLab refuses a connection at its next use, the dialog just shows "Mit GitLab verbinden" again; it does not say why.
  - The address of the GitLab is one per server; `base_url` is stored per connection, but tokens of another GitLab cannot be renewed.
  - If `TOKEN_KEY` changes, the stored tokens cannot be opened and every project has to connect again.
  - A real GitLab was not part of the tests; that check is due at the latest with spec 35.
