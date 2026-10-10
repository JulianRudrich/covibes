# 32a The Language of the Interface

## Goal
Everyone uses Covibes in German or in English (`project-overview.md`, "Language" and the checklist "The UI is available in German and English"): the interface follows the person's own language, and they switch it themselves.

First part of spec 32. The language a project writes in (plan, exports, Git texts) is part 32b.

## Design decisions
- **A person's language belongs to their account.** `users.locale` has been there since spec 02 and already decides the language of the mails about what they missed. Now it also decides the interface, on every device they sign in on.
- **Signed out, the browser decides:** the first of the browser's languages that is German or English, else English. That covers the login page, an invitation and a read-only link.
- **A switch, "Deutsch" and "English", each named in its own language:**
  - on the pages someone sees signed out (login, invitation, read-only view)
  - in the account menu
- **A choice made signed out is a decision:** it holds on that device and is taken into the account at the next sign-in. Without one, the account's language applies after signing in.
- **A new account starts in the language of its browser.** The login link by mail is written in the language of the page that asked for it.
- **Only the interface changes.** What people wrote stays as written, agents answer in the language of the message, and what a project writes stays in the project's language (part 32b). Dates, numbers and amounts follow the interface.
- **The English texts are read through once:** nothing German left, and one word for one thing.

## Implementation

### Shared: `packages/shared/src/`
- `language.ts`: the two languages, and which of a list of preferred languages Covibes speaks.

### Server
- The account's language can be set by its owner through the login library, to one of the two languages only.
- A new account takes the language its browser prefers (`Accept-Language`).
- The mail with the login link is written in the language the page names.

### Web
- `i18n/language.ts`: the language of this device (stored, else the browser's), the choice made signed out, and switching.
- The account's language is applied once the session is known; a choice made signed out is written to the account.
- `LanguageSwitch` on the signed-out pages; the two languages in the account menu.
- `<html lang>` follows the language.
- **i18n:** `language.*`.

## Out of scope
- more languages than the two
- translating what people or agents wrote
- the language of a project (part 32b)
- the development pages (the local mailbox, the stand-in for GitLab), which stay German

## Dependencies
- Spec 02 (accounts), spec 22b (mails in the person's language)

## Checklist
- [ ] Signed out, the interface is in the browser's language (German or English, else English), and a switch changes it.
- [ ] Signed in, the interface is in the account's language; the account menu changes it, and the change holds on every device.
- [ ] A choice made signed out is taken into the account at the next sign-in; without one the account wins.
- [ ] A new account starts in the language of its browser, and the login mail is in the language of the page that asked for it.
- [ ] Only the two languages can be stored.
- [ ] The English texts were read through: nothing German is left, and the wording is consistent.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the server and the web parts pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
