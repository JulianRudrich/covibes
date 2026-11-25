# 42 Sign-in and Accounts

## Goal

People can sign in by a single-use email code or link, a registered passkey, GitHub, Google, or GitLab when configured. They can edit their name, manage sessions and passkeys, enable an authenticator second factor, export their personal data, and remove their account after renewed verification. Production registration is closed unless the verified email has an active beta invitation or appears in the operator's allowlist.

The owner authorized the complete rework and a new design on 2026-11-17. This spec supplies accessible functional account controls; the new visual system is implemented separately in spec 55. The previous Covibes design is not a style reference.

## Decisions

- Keep Better Auth 1.7.18 and its first-party email OTP, two-factor and passkey plugins. Pin the matching passkey package; no separate password sign-in is introduced.
- The email code is single-use, expires after ten minutes, and has bounded attempts. An unknown or disallowed address receives the same request response; production checks admission only after the email/provider identity has been proved.
- Production registration is closed by default. The normalized, exact email must match BETA_ALLOWED_EMAILS, an unexpired operator-created beta invitation, or an unexpired, unrevoked and unused project email invitation. Generic sharing links never admit an account. Wildcards and domain-wide acceptance are not supported. Existing accounts remain able to sign in. Development and tests are open unless explicitly testing the production gate.
- Google, GitHub and GitLab are offered only with complete credentials. A provider's unverified address cannot admit a new beta account. Provider linking must retain Better Auth's verification and account-linking protections.
- Passkeys require an existing session to register. WebAuthn checks the application origin and relying-party ID; local development uses localhost. Registration does not become an unauthenticated signup shortcut.
- Authenticator second-factor setup requires confirming a valid TOTP before it becomes enabled. Recovery codes are encrypted at rest and shown to the user only through the plugin's authorized setup/recovery flow.
- Better Auth's stock second-factor hook covers password sign-in endpoints only. Extend its challenge handling to email OTP, magic-link verification, social callbacks and passkey authentication. No usable application session may be issued before a required second factor succeeds.
- Account removal uses Better Auth's actual deletion hook, not only a UI check. Require a fresh session (five minutes) or a single-use emailed deletion proof (ten minutes). Invoke a read-only ownership preflight before deleting the user, and a connection-close hook after deletion. Spec 43 supplies atomic ownership checks, private-project cleanup and a durable file-cleanup outbox in the actual user deletion transaction. Never remove project data in the preflight, since a later authentication/database failure must leave it intact.
- A custom export includes the requesting user's profile, membership and personal contributions they may read. It excludes session tokens, provider tokens, passkey public-key material, verification records, authenticator secrets and recovery codes. It does not export other members' private data.
- Profile updates accept a trimmed nonempty name of at most 80 characters. Email changes are not part of this spec.

## Implementation

### Server and authentication

- Add complete GitHub/Google credential pairs and a parsed exact beta email allowlist to validated server configuration. Production without a mailer may use configured social login and existing passkeys; email actions are unavailable.
- Add first-party email OTP delivery using localized plain-text templates and the existing development mailbox. Preserve magic links and language behavior.
- Add a first-party TOTP/recovery-code plugin with snake_case schema names, and cover all supported primary login routes with its challenge hook. Give redirects a safe route to the second-factor form.
- Add the passkey plugin with application-derived origin/rpID and matching client plugin.
- Migration 0046 adds the first-party security schema and the operator-only beta invitation table, with RLS and explicit privileges. Auth secrets stay outside the application role's grants. Generate database types from migrations.
- Add an operator command for exact-email, expiring beta invitations. Admission happens after identity proof, never from merely requesting an email or providing an OAuth hint.
- Add session-scoped account export and deletion preparation integration. The auth deletion hook always invokes the supplied preparation service. Without it, ownership that cannot safely be removed blocks deletion.

## Integration and external verification

- Operator configuration adds optional complete `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` and `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` pairs, alongside GitLab. Callback paths are `/api/auth/callback/github`, `/api/auth/callback/google` and `/api/auth/callback/gitlab` on `APP_URL`. Never commit their values.
- `BETA_ALLOWED_EMAILS` is comma-separated exact email addresses; its default is empty. Operators can instead run `pnpm --filter @covibes/server beta:invite person@example.com 7` with the configured admin database. The default invitation duration is seven days, maximum thirty. An invitation permits registration only after the chosen login method proves the address.
- Auth dependencies expose `beforeDeleteUser(userId)` (read-only preflight) and `afterDeleteUser(userId)` (post-deletion connection cleanup). Both run from Better Auth's built-in deletion flow, including its verification callback. Spec 43 wires workspace guards and the database cleanup transaction; without that integration this spec conservatively blocks users who own any project.
- Spec 43 adds verified workspace email invitations to the admission query after its table exists. An OAuth address claimed by the browser or an unverified provider never passes the production gate.
- Security tests exercise real PostgreSQL, actual Better Auth handlers, RFC 6238 TOTP proofs and cryptographically signed WebAuthn assertions. OAuth callback tests use a controlled upstream token/profile response to test state, callback and 2FA handling without external credentials. These are not live provider checks. Live GitHub/Google/GitLab applications, SMTP delivery, browser/device passkey interoperability and production cookie/domain checks remain deployment prerequisites requiring configured credentials and target domains.

### Client

- Extend the public configuration without removing existing flags: available providers, email code and passkey availability, and closed-beta status.
- Extend the auth client with first-party email OTP, two-factor and passkey clients. Keep the session query compatible and expose whether TOTP is enabled.
- Provide labeled login choices, email code request/verification, magic-link request, passkey authentication, social login and TOTP/recovery-code challenge. Preserve the safe return destination.
- Add a reachable account settings surface for name, active sessions/revocation, registered passkeys, TOTP setup/confirmation/disable, personal export and account deletion. Use semantic labels, announced errors, visible pending states, and keyboard access. Show recovery codes only on intentional setup/generation.
- Add German and English interface and email text. The later design pass replaces presentation, not authentication behavior.

## Out of scope

- Password sign-in, arbitrary email changes, enterprise SSO or SCIM.
- Billing and workspace membership policy beyond the deletion integration contract (43).
- Automatically trusting devices without an explicit user choice.
- Reusing the previous visual design or changing unrelated workspace screens.

## Checklist

- [x] Email codes and links sign in once; wrong, expired, reused and over-attempted codes are rejected.
- [x] Production registration is closed with an empty allowlist, opens for an exact allowlisted or actively invited verified address, and rejects unverified provider identity.
- [x] GitHub/Google/GitLab configuration and login availability agree; partial credential pairs fail validation.
- [x] Passkey registration requires a session and WebAuthn rejects the wrong origin/RP.
- [x] TOTP setup needs proof; every supported primary login path challenges an enabled account before creating a usable session; valid recovery codes work once.
- [x] Names, sessions and passkeys can be managed by their owner; another user cannot manage or export them.
- [x] Personal export excludes credentials and other members' private data.
- [x] Deletion requires renewed proof, calls the mandatory preparation hook, and cannot orphan shared ownership or forget file cleanup.
- [x] Accessible login and account controls work in German and English, including pending/error states.
- [x] Lint, type checks, formatting, meaningful auth/API/client tests, generated database types and the production build pass. Tracker and integration notes are updated.


## Validation (2026-11-19)

- The final account/security and personal-data API run passes all 21 tests against real PostgreSQL. Earlier combined authentication, configuration and environment verification passes 53 tests; the final security run additionally checks unconfirmed authenticator setup and reuse of a consumed recovery code in a new primary-login challenge.
- The complete web package passes 842 tests in 71 files, including the new account flows, keyboard focus after a challenge, manual authenticator setup, profile/session controls, ownership/freshness errors, and preserved invitation/redirect/language behavior.
- Repository lint (including token checks), all package/script type checks, generated database type verification, formatting and production builds pass. Vite reports the existing large-chunk advisory; bundle splitting is handled separately.
- The standalone deletion fallback blocks owned projects. Spec 43 must inject the read-only ownership preflight and post-commit connection hook and install its atomic user-delete cleanup trigger before owner-account deletion is enabled for private projects. This branch does not claim that cross-spec runtime integration is already installed.
- The authenticated provider fixtures are local protocol tests. No live OAuth application, external SMTP delivery, browser/device passkey ceremony or production domain/cookie deployment was available or claimed.
