# Security policy

## Reporting a vulnerability

Covibes has not been released, and this repository is private. If you have access and find a security problem, tell the maintainer, [@JulianRudrich](https://github.com/JulianRudrich), directly and privately. Do not describe it in an issue, a pull request, a commit or a review comment. Include what you found, how to reproduce it, its potential impact and the commit you tested, and leave credentials and private project content out of the report.

You will get an answer within a week. Once the problem is fixed, the report can be credited to you, if you like. When the repository becomes public, this policy will point to GitHub's private vulnerability reporting instead.

## Supported versions

There are no releases yet. Security fixes go into `main`. A self-hosted instance stays secure by updating to the latest `main`, as described under [Updates](deploy/README.md#updates) in the deployment guide.

## What to look at

These parts handle data from outside or protect access, and deserve the most attention:

- **Sign-in and accounts.** Better Auth serves `/api/auth/*`: single-use email codes and links, passkeys, and GitHub, Google or GitLab when configured, with no passwords. An authenticator second factor, once enabled, is required on every sign-in route before a session exists. Sessions are `httpOnly` cookies with `SameSite=Lax`, `Secure` in production; sign-in attempts are rate-limited and their origin is checked. In production only verified addresses with a beta invitation or on the operator's allowlist can register. The personal export leaves out tokens, passkey material and second-factor secrets, and deleting an account needs renewed verification.
- **Permissions.** Every request on behalf of a person runs as the database role `covibes_app` with that person's id, and every table has row-level security, so the database refuses what a missing check on the server would allow. Invitation and read-only links are random tokens of which only the hash is stored.
- **Live connections.** The chat channel and the collaboration server check access when a connection opens and accept WebSockets only from the app's own origin. A changed role or a removal closes the connections of that person.
- **Agents.** Models are called only through the AI gateway, agents act only through tools, and every change they make passes the rule engine. Content from repositories, the web and uploads is treated as data, never as instructions. Reading a link reaches only the public web. Budgets are reserved before every model call, and every attempt is accounted for.
- **Git actions.** Everything that changes a repository is a request that runs only after a person with the right to approve it agrees, with that person's own token, and is written to an audit log. Text a model wrote is made inert before it is posted.
- **Secrets.** Tokens of repository connections are sealed with AES-256-GCM under the server key `TOKEN_KEY` and never leave the server. Secrets come from the environment and are never logged or committed.
- **Uploads.** The server decides what a file is by its content, stores it through the storage interface, and serves it so that the browser runs nothing.
- **Webhooks.** A repository's webhook only makes Covibes read the repository's state sooner; the server does not read what the call contains.
- **Interrupted work.** One worker owns the job queue through a PostgreSQL lock, completed agent commands are never replayed, and a document only counts as saved once the database has acknowledged it. `/health` reports liveness and `/ready` the database, migrations and the worker.

## Keeping dependencies safe

CI audits the production dependencies on every change and fails on high and critical advisories, and a scheduled workflow audits them every week. New releases are only taken once they are seven days old. The workflows pin every action to a commit, run with read-only permissions and keep no credentials after checkout; the Lint workflow checks them with zizmor, and Dependabot keeps the pinned actions current.

## Running an instance

The [deployment guide](deploy/README.md#security) lists what an operator has to keep safe: fresh secrets per instance, HTTPS in front of the app, a database that is not reachable from outside, and backups. AI requests send the context a task needs to the configured provider, and GitLab and mail use their configured services; review them before inviting a team.
