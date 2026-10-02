# 25a The Project Plan as a Shared Document

## Goal
Every project has a plan the team writes together: a document next to the boards, with the sections a project plan needs, that several people edit at the same time like the canvas.

First part of spec 25; part 25b lets the moderator generate the plan, part 25c brings "plan outdated", updates and versions.

## Design decisions
- **Where:** the plan is a fixed tab "Projektplan" at the end of the board tabs, in the same panel as the canvas. The address names it, so a link opens the plan. Chat and overview stay next to it.
- **One document per project**, edited live by everyone who has it open, with the others' carets and names. Owners and editors write; viewers read.
- **Sections:** a plan has five sections in a fixed order:
  - MVP-Umfang
  - Meilensteine und Aufgaben
  - Tech-Empfehlung
  - Risiken
  - Kosten und Zeit

  A new plan is empty and offers "Mit Vorlage beginnen", which writes the five headings in the project's language, each with a line that says what belongs there. A section is known by its heading, so parts 25b and 25c can write to it. Inside a section people write freely.
- **Formatting** stays small: headings of two levels, paragraphs, bold, italic, bullet and numbered lists. A toolbar above the document offers them; the usual shortcuts and Markdown-like typing ("## ", "- ") work.
- **Undo** covers one's own changes, as on the canvas.
- **Stored like the boards:** the document lives on the collaboration server and in the database; a broken connection shows the same hint as the canvas, and changes made meanwhile arrive when it is back.

## Implementation

### Shared: `packages/shared/src/`
- The sections of a plan with their keys, the name of the plan's document, and how a section heading is marked.

### Database: migration `0022_plans.sql`
- The plan's document goes with its project when the project is deleted.

### Server
- **Collaboration:** documents of plans next to those of boards. Members of the project connect; viewers read only; the worker connects with its token (for part 25b). A changed role or a removal closes the connection like a board's.
- **Tests:** who connects to a plan and who writes, that it is stored and loaded, and that it goes with the project.

### Web
- **Plan tab** in the board tabs and the plan view in the canvas panel, named in the address.
- **Editor:** Tiptap on the plan's document, with the toolbar, the others' carets, the empty state with the template, the read-only state and the connection hint.
- **i18n:** `plan.*`.

## Out of scope
- generating the plan and suggestions per section (spec 25b)
- "plan outdated", updating and versions (spec 25c)
- the roadmap on the canvas and tasks that can be assigned (spec 26)
- exporting the plan (spec 27)
- the plan in the read-only view, comments, images, tables and links in the plan
- what the agents know of the plan (spec 25b)

## Dependencies
- Spec 05 (collaboration server), spec 11 (board tabs)
- Packages (new, all MIT): `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-collaboration`, `@tiptap/extension-collaboration-caret`, `@tiptap/y-tiptap`

## Checklist
- [ ] The tab "Projektplan" opens the plan in the canvas panel, and the address names it.
- [ ] Two people write in the plan at the same time and see each other's text and carets; after a reload the plan is as it was.
- [ ] "Mit Vorlage beginnen" writes the five sections in the project's language.
- [ ] The toolbar formats headings, bold, italic and lists; undo takes back one's own changes.
- [ ] Viewers read the plan and cannot change it; someone who is no member cannot open it.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the shared code, the collaboration server and the components pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
