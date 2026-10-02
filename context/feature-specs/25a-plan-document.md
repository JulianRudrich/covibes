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

  A new plan is empty and offers "Mit Vorlage beginnen", which writes the five headings in the project's language. While a section is empty, a gray line below its heading says what belongs there; it is a hint and no text of the plan. A section is known by its heading, so parts 25b and 25c can write to it. Inside a section people write freely.
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
- [x] The tab "Projektplan" opens the plan in the canvas panel, and the address names it.
- [x] Two people write in the plan at the same time and see each other's text and carets; after a reload the plan is as it was.
- [x] "Mit Vorlage beginnen" writes the five sections in the project's language.
- [x] The toolbar formats headings, bold, italic and lists; undo takes back one's own changes.
- [x] Viewers read the plan and cannot change it; someone who is no member cannot open it.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for the shared code, the collaboration server and the components pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-02)
- **Packages:** Tiptap 3.31.4 (`@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-collaboration`, `@tiptap/extension-collaboration-caret`) and `@tiptap/y-tiptap` 3.0.9, all MIT, in `apps/web` only. All Tiptap packages have to be the same version: with 3.31.3 the optional menus of `@tiptap/react` resolved to 3.31.4 and asked for a core of that version.
- **The document** is the Y.Doc `plan:<project id>` on the collaboration server, stored in `yjs_documents` like a board. Tiptap writes into its fragment `default`.
  - The server takes a document name as a board's or a plan's. For a plan it checks the membership in the project; viewers connect read-only, the worker connects with its token (for part 25b), and a changed role or a removal closes the connection, as for boards.
  - `yjs_documents` has no key to the projects, so a trigger removes the plan when its project is deleted (migration `0022_plans.sql`). No route deletes projects yet.
  - The project details now carry the project's `language`; the template and the hints are written in it.
- **Sections** (`packages/shared/src/plan.ts`, `features/plan/plan-sections.ts`): a section starts at a heading of level 2 that carries the section's key (`scope`, `milestones`, `tech`, `risks`, `costs`) in the attribute `section`.
  - The key stays when someone rewords the heading. A heading that splits off does not inherit it, and a second heading with the same key (a pasted copy) loses it, so a key names one heading.
  - The hint of a section is a decoration on the empty paragraph right below its heading. It goes with the first character and is never stored. The first version wrote the hints as text in italics; in the live test, typing over one stayed italic, so they became hints.
- **Web:**
  - The address `?view=plan` shows the plan in the canvas panel. The row of the board tabs ends with the button "Projektplan"; while the plan is open no board tab is selected, and a tab opens its board again.
  - `PlanEditor` connects like a board (`useCollabDoc`, the board connection by document name) and shows "Plan wird geladen …", the refusal, and the canvas's hint while the connection is down.
  - The editor has headings of level 2 and 3, paragraphs, bold, italic and the two lists; the other formats of the starter kit are off. Undo and redo come from the collaboration extension and cover one's own changes.
  - Other people's carets are a line in the human color with the name above it, like the live cursors of the canvas.
  - "Mit Vorlage beginnen" writes the template and puts the caret below the first heading.
- **Verified** with `pnpm dev` and the browser as olga in "Vereins-App":
  - "Projektplan" opened the empty plan with the toolbar and the card "Der Plan ist noch leer". The template wrote the five headings with their hints; typing below "MVP-Umfang" removed that hint and stored plain text.
  - A list, undo and redo worked from the toolbar. After a reload the plan was as it had been left.
  - A second tab of the same person showed the text, and what was typed there arrived in the first tab at once. The other caret showed as a dark line with "olga" above it.
  - A board tab brought the canvas back without `view` in the address; "Projektplan" opened the plan again.
  - Checked from screenshots: the plan with the template, with text, and with another person's caret.
  - A viewer, someone outside the project, the worker's token and a removed member are covered by the tests of the collaboration server; a second account was not used live.
- **Known limits:**
  - Two people who click "Mit Vorlage beginnen" in the same moment get the headings twice; the second set carries no section keys.
  - A section heading can be deleted like any text. Part 25b writes a missing section again.
  - The plan is not in the read-only view, and the agents do not know it yet (part 25b).
  - The web bundle grew by the editor; splitting the bundle is left for later.
