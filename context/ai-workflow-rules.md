# AI Workflow Rules

These rules apply to every coding agent working on Covibes, such as Claude Code, Cursor, Codex and others.

## Roles

- **Owner (human):** plans, decides, reviews and tests.
- **Coding agent:** implements specs and proposes options for open points. It does not make fundamental decisions on its own.

## Before every task

1. Read `CLAUDE.md` and all existing context files.
2. Read the feature spec (`context/feature-specs/NN-name.md`).
3. Mark the unit as "in progress" in `context/progress-tracker.md`.

## Scope

- Each session works on **exactly one feature unit**. A new unit gets a new chat; fixes to the same unit stay in the same chat.
- Do not mix system boundaries. A backend API and its UI integration, for example, are separate units.
- Implement the spec **exactly**. Nothing beyond it, no "improvements on the side".
- Do not touch files outside the scope of the spec.

## When something is unclear

- Do not guess. If the spec has gaps or contradictions: stop and ask.
- If a decision is covered neither by the spec nor by the context, the coding agent presents 2–3 options with a recommendation. The owner decides.
- Decisions go into `progress-tracker.md` under "Decisions".

## Libraries and versions

- Do not rely on training knowledge. Use the current documentation or installed agent skills for each library, especially for versions and APIs.

## After every unit

1. Work through the spec's checklist: build, type check, lint and tests as required by the spec.
2. Update `progress-tracker.md`: status, decisions, session notes.
3. Briefly summarize what was built and what is still open.

## Bugs and problems

- Describe bugs in `context/current-issues.md`: error message, steps to reproduce, expected behavior. This file is **never committed** (see `.gitignore`).
- Analyze first and propose a solution. **Implement only after approval.**
- Work through problems one at a time.

## Language

- The repository is written in English: documentation, code, comments, commit messages, pull requests and branch names.
- User-facing texts of the product live in the i18n files (German and English).
- Conversations with the owner are in German.

## Git

- **The coding agent maintains GitHub completely:** commits, pushes, pull requests, merges, pulls and branch cleanup. The owner handed this over on 2026-09-28. The history must look professional.
- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/):
  - `type(scope): subject`, with the types `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci` and `chore`
  - subject in the imperative mood, lowercase, no trailing period, at most 72 characters
  - the body explains what changed and why; spec work names the spec, e.g. `Implements spec 04.`
  - one commit per self-contained change
- **Branches:**
  - Documentation and planning changes (`context/`, `README.md`, `CLAUDE.md`) go straight to `main`.
  - Every feature spec runs on its own branch (`spec/NN-short-name`) with a pull request to `main`, on which CI runs.
- **Pull requests:** the title follows the commit format, e.g. `feat(auth): add magic-link login and projects`. The description states what is included and how it was verified.
- **Merges to `main`:**
  - only when CI is green
  - always as a squash merge, never with a merge commit
  - `main` gets exactly one commit per spec, titled after the pull request, e.g. `feat(auth): add magic-link login and projects (#1)`. The individual steps remain visible in the pull request.
  - afterwards the branch is deleted, locally and on GitHub
- **`main` stays linear:** no force pushes to `main` unless the owner explicitly asks for one.
- **Authorship:** everything in the repository is authored by the owner. Commits and pull requests carry no co-author trailer and no reference to an AI tool (no `Co-Authored-By`, no "Generated with …"). In the documentation the role is called "coding agent". The owner decided this on 2026-09-28.
- Never put secrets (API keys, tokens, contents of `.env` files) into code, commits or context files.
