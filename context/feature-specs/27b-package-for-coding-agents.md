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
- [x] The ZIP holds `CLAUDE.md`, `AGENTS.md`, the context files, a feature spec per task and a diagram file per board with content, in the project's language.
- [x] `CLAUDE.md` and `AGENTS.md` name the files to read and the way of working; missing code standards and UI direction are named as open.
- [x] The dialog shows what the package holds and what is missing, and offers no download without a plan.
- [x] Owners and editors write code standards and UI direction; they are stored per project and go into the package. Viewers read them and can export.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for the shared code, the database, the API and the dialog pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-03)
- **The files** (`packages/shared/src/coding-package.ts`, `buildCodingPackage`):
  - `CLAUDE.md` and `AGENTS.md` hold the same text: the project's name, the day of the package, the seven context files to read in their order, where the diagrams are, and the way of working (spec by spec, work a skeleton out first, tracker, decisions hold, ask instead of guessing). A text the team did not give is marked "noch offen" in the list, and one more rule says to settle it before the first code.
  - `context/project-overview.md`: the plan's scope and the criteria. `context/architecture.md`: the plan's tech recommendation and links to the diagram files. A section the plan does not fill says so.
  - `context/decisions.md`: every decided decision with value, reasoning, alternatives, day and name; open ones in a list of their own, with the reason if they were reopened.
  - `context/code-standards.md` and `context/ui-context.md`: the team's text, or a note that asks the coding agent to propose it and have the team confirm it.
  - `context/project-plan.md`: the Markdown export of part 27a. `context/progress-tracker.md`: the milestones with every task as an open checkbox that links to its spec and names its assignee.
  - `context/feature-specs/00-overview.md` lists the specs by milestone. A spec is `MM-TT-name.md`: the task, its milestone with time and goal, the assignee, links to the context and a checklist of three points. The name is the task in at most 48 characters, cut at the end of a word; the title is at most 80 characters, the task itself stands whole in the spec.
  - `docs/diagrams/name.md`: one file per board that holds blocks, notes or the roadmap; boards with the same name get a number.
  - At most 500 specs. What people wrote is escaped where it stands in a line of Markdown; file names hold lowercase letters, digits and hyphens only.
  - Without a plan (no text below the section headings) there are no files.
- **Texts** (`package-texts.ts`): everything the package adds, in German and English.
- **Database:** migration `0026_package_texts.sql`: one row per project and kind (`code_standards`, `ui_direction`) with the text (1 to 8000 characters), who wrote it and when. Members read; owners and editors add, change and remove in their own name.
- **Server** (`apps/server/src/api/package.ts`):
  - `GET /api/projects/:id/package`: the counts, the paths of the files, the two texts and whether the person may write them.
  - `PUT …/package/texts/:kind` `{ content }`: stores the trimmed text; an empty one removes it. 403 for viewers.
  - `GET …/package/download`: the ZIP (`fflate` 0.8.3) with the files at its top, named `project-coding-paket.zip` (`…-coding-package.zip` for an English project); 404 without a plan.
  - The package is built from the project as it stands: the plan and the boards are read from the open documents, else from the stored ones (`readPlan` is new on the collaboration server).
- **Web** (`apps/web/src/features/export/`):
  - The plan's export menu has a third entry below a line, "Paket für Coding-Agents …", which opens `PackageDialog`.
  - The dialog loads what the package holds whenever it opens. Six lines say what is there (a green check) and what is missing (an empty circle): plan (also "outdated"), feature specs and milestones, decisions and open topics, diagrams, code standards, UI direction.
  - The two fields are stored when a field is left, before a download and when the dialog closes; a small note says "Gespeichert" or "Nicht gespeichert". Viewers read them.
  - "42 Dateien anzeigen" unfolds the paths. "Paket herunterladen" rests without a plan; a download that fails shows a note, and nothing is downloaded while a text could not be stored.
- **Verified** with `pnpm dev` and the browser as olga in "Vereins-App"; the ZIP was caught in the page instead of saved:
  - The dialog showed the plan, 31 feature specs in 4 milestones, 5 decisions with 1 open topic, the diagrams of 1 board and both texts as missing, and listed 42 files.
  - A text was stored on leaving its field, the other one by the download; both lines turned to "there", and after closing and opening the dialog the texts were back.
  - The ZIP (about 34 KB, `vereins-app-coding-paket.zip`) was unpacked in the page: `CLAUDE.md` equals `AGENTS.md`, the decisions carry reasoning, alternatives, day and name, the tracker links every task to its spec, and a spec reads as described above.
  - Closing the dialog gave the page back (focus on "Exportieren", nothing blocked).
  - The test texts were removed afterwards. Not tried live: viewers and a project without a plan; both are covered by tests.
- **Found while testing live:**
  - Names of spec files ended in the middle of a word (the task cut at 60 characters); they end with a whole word now.
  - Long paths in the file list broke in the middle of words; they break at hyphens now, with the rest indented.
  - A text typed into a field was lost when the dialog was closed with Escape, since no field is left then; closing stores it now.
- **Decided while building:**
  - Part 27b uses no model at all; the moderator's suggestions for the two texts moved to part 27c, together with the written-out specs.
  - `CLAUDE.md` and `AGENTS.md` carry the same full text instead of one pointing at the other, so every coding agent reads its own file completely.
  - The texts are stored in a table of their own instead of the project's settings, because editors write them and settings belong to owners.
- **Known limits:**
  - A package is the state of the day it was made; nothing brings it up to date in a repository (spec 29 brings it there).
  - Two people who write the same text at the same time: the later one counts.
  - A plan with more than 500 tasks gets specs for the first 500.
  - The file name of a spec changes when the task is reworded or moves in its milestone.
