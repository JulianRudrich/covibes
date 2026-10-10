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
- [x] Signed out, the interface is in the browser's language (German or English, else English), and a switch changes it.
- [x] Signed in, the interface is in the account's language; the account menu changes it, and the change holds on every device.
- [x] A choice made signed out is taken into the account at the next sign-in; without one the account wins.
- [x] A new account starts in the language of its browser, and the login mail is in the language of the page that asked for it.
- [x] Only the two languages can be stored.
- [x] The English texts were read through: nothing German is left, and the wording is consistent.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for the server and the web parts pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-10)
- **Shared** (`packages/shared/src/language.ts`): the two languages (`LANGUAGES`, `Language`, `languageSchema`), their own names for a switch, `pickLanguage` (the first of a list of preferred languages that is German or English, else English) and `acceptedLanguages` (the languages of an `Accept-Language` header, the most wanted first).
- **Server** (`auth/auth.ts`):
  - `users.locale` is now a field the account's owner sets through the login library (`POST /api/auth/update-user`), validated to the two languages. Nobody sets it for someone else, and nothing else is stored.
  - A new account takes the language its browser prefers when the first login link is opened (`Accept-Language`). A request that names no language keeps the default, German. The same hook runs for an account that signs up through GitLab; that path has no test of its own.
  - The mail with the login link is written in the language the page names (`metadata.language`), else in the browser's, else in German.
- **Web:**
  - `i18n/language.ts` keeps the language of the device: what it showed last (`covibes.language` in the browser's storage), else what the browser prefers. A language picked while no account could take it is marked as an open choice. `<html lang>` follows. The app starts in the device's language without storing it, so a device nobody chose on keeps following its browser.
  - `features/account/language.ts`: `AccountLanguage`, mounted once in the app, shows the account's language as soon as the pages know the session. An open choice goes the other way: it is written to the account. `useChooseLanguage` switches for the account of who is signed in, else for the device.
  - `LanguageSwitch` ("Deutsch · English") sits under the card of the login page and of every message of the invitation page and the read-only view, and in the header of the read-only view. The account menu has the two languages as a group of radio items under "Sprache".
  - The login page names its language when it asks for the link.
  - `PageMessage` takes something to show below its card; the dropdown menu got radio items.
- **English texts:** all 1,018 texts of the interface were read through. Nothing German was left. 48 were reworded where they read like a translation (e.g. "waits for you" became "is waiting for you", "Take back" became "Withdraw", "Take over" became "Accept"), and the quotation marks are the curly ones everywhere, as in German. The project menu's label is "Projektmenü" / "project menu", which it has been since it holds more than the way to the project list. The English texts the server writes (mails, the agents' notes, exports) were skimmed and left as they are.
- **Verified** with `pnpm dev` and the browser:
  - Signed in as olga, "English" in the account menu turned the whole interface English at once, the account held `en`, and it stayed English after a reload. What people and agents wrote stayed as written.
  - Signed out on another origin, in a German browser: the login page was German with the switch below the card; "English" turned it English.
  - A login link asked for with the page's language `en` from a German browser arrived in English ("Your Covibes login link"), one with `de` in German.
  - On a page without a session, "Deutsch" changed the page and left the account alone; the next page with a session wrote it to the account.
  - Not tried live: a new account from an English browser, and the invitation page with a real invitation; tests cover both.
- **Decided while building:**
  - A request that names no language at all keeps German, the default since spec 02; English is for browsers that prefer other languages. So scripts and tests behave as before.
  - The account's language is changed through the login library, which owns the table of the accounts, not through a route of its own.
  - Only a choice made while no account could take it overrides an account. What a device merely showed never does, so signing in on a second device does not change the account.
  - A choice the account could not take (offline, refused) stays on the screen and open, and is tried again when the session is next known.
  - The switch names each language in its own language and carries no flag: a flag is a country.
- **Known limits:**
  - A person who picks a language on the login page and opens the link in another browser lands in that browser's language, and switches once.
  - The development pages (the local mailbox, the stand-in for GitLab) are German only.
  - What a project writes (plan, exports, Git texts, invitations) follows the project's language, which nobody can choose yet (part 32b).
