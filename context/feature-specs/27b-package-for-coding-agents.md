# 27b The Package for Coding Agents

## Goal
What the team planned leaves Covibes as a package a coding agent can build from: one ZIP with `CLAUDE.md`, `AGENTS.md`, the context files, a feature spec per task of the plan and the diagrams as Mermaid. An export dialog shows what the package holds and what is still missing, and takes the two things the plan does not say: the code standards and the UI direction.

Second part of spec 27. This part uses no model: the package is built from what the project holds. Part 27c brings the moderator in: it suggests the two texts and writes the feature specs out.

## Design decisions
- **Owner decisions (2026-10-03):**
  - The feature specs are a skeleton first: every task of the plan becomes a short spec with its task, its milestone and pointers to the context. The moderator writes them out on demand in part 27c, one model run per milestone.
  - Code standards and UI direction are two text fields in the export dialog, stored per project. The dialog shows what is missing. The moderator's suggestion on click comes with part 27c, one model run per suggestion.
- **What the package holds:** file names are English and always the same, so `CLAUDE.md` can point at them and spec 29 can bring them into a repository. What is in the files is in the project's language.

  | File | From |
  |---|---|
  | `CLAUDE.md`, `AGENTS.md` | the same text in both: what to read in which order, and how to work (spec by spec, tracker, decisions hold, ask instead of guessing) |
  | `context/project-overview.md` | the plan's scope and the project's criteria |
  | `context/architecture.md` | the plan's tech recommendation and a list of the diagrams |
  | `context/decisions.md` | the decisions with value, reasoning and alternatives; open ones listed apart |
  | `context/code-standards.md` | the team's text, or a note that it is open and to be agreed before the first code |
  | `context/ui-context.md` | the team's text, or the same kind of note |
  | `context/project-plan.md` | the whole plan, as the Markdown export of part 27a |
  | `context/progress-tracker.md` | the milestones with their tasks as open checkboxes, each with its spec and assignee |
  | `context/feature-specs/00-overview.md` | the milestones with goal, time and their specs |
  | `context/feature-specs/MM-TT-name.md` | one per task: milestone `MM`, task `TT` |
  | `docs/diagrams/name.md` | one per board with content, as the Mermaid export of part 27a |

- **A skeleton says that it is one:** a feature spec names the task, its milestone with goal and time, who took it, where the context is, and a checklist to start from. It says that it is to be worked out with the team before it is built, and `CLAUDE.md` makes that the way of working.
- **Where:** "Exportieren" in the plan's toolbar gets a third entry, "Paket für Coding-Agents …", which opens the dialog. The package is built on the plan, so it sits with the plan's exports.
- **The dialog:**
  - what the package holds, each line with its count: plan, feature specs, decisions, diagrams, code standards, UI direction
  - what is missing, as notes that do not block: no tasks in the plan, open decisions, the plan is outdated, no code standards, no UI direction, no diagram
  - the two text fields; they are saved when the field is left and before a download
  - the files of the package as a list to unfold
  - "Paket herunterladen": one ZIP, named after the project
- **Without a plan there is no package:** the dialog says so and the download rests.
- **Who:** every member exports, viewers too. Owners and editors write the two texts; viewers read them.
- **Built by the server:** it reads all boards, the plan, the decisions and the texts, builds the files with shared code and sends the ZIP. Spec 29 needs the same files on the server to bring them into a repository.
- **New package:** `fflate` (MIT) packs the ZIP on the server.

## Implementation

### Shared: `packages/shared/src/`
- `coding-package.ts`: `buildCodingPackage` turns what a project holds into the files of the package (path and text); `codingPackageSummary` gives the counts and what is missing. Both are pure: no model, no database.
- `package-texts.ts`: what the package adds in both languages (headings, the way of working, the notes for what is open).
- The kinds of texts a team gives (`code_standards`, `ui_direction`) with their limit, and the types of the API.

### Database
- Migration `0026`: table `package_texts` (project, kind, content, who changed it and when). Members read; owners and editors write. RLS, policies and grants in the same migration.

### Server
- `/api/projects/:projectId/package`:
  - `GET /`: the summary with the two texts, for members
  - `PUT /texts/:kind`: stores a text, for owners and editors; an empty text removes it
  - `GET /download`: the ZIP, for members
- The collaboration server reads the whole plan of a project, as it reads its sections.

### Web
- `features/export/`: the export dialog with summary, notes, the two text fields, the file list and the download.
- The plan's export menu opens it.
- **i18n:** `export.package.*`.

## Out of scope
- the moderator's suggestions for the two texts and written-out feature specs (part 27c)
- choosing what goes into the package, and editing its files before the download
- bringing the package into a repository and issues from the specs (spec 29)
- keeping the package in step with a project that moves on: a package is the state of the day it was made
- a package from the read-only link

## Dependencies
- Spec 27a, spec 26 (both parts), spec 25 (all three parts), spec 16
- Package: `fflate` (server)

## Checklist
- [ ] The ZIP holds `CLAUDE.md`, `AGENTS.md`, the context files, a feature spec per task and a diagram file per board with content, in the project's language.
- [ ] `CLAUDE.md` and `AGENTS.md` name the files to read and the way of working; missing code standards and UI direction are named as open.
- [ ] The dialog shows what the package holds and what is missing, and offers no download without a plan.
- [ ] Owners and editors write code standards and UI direction; they are stored per project and go into the package. Viewers read them and can export.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the shared code, the database, the API and the dialog pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
