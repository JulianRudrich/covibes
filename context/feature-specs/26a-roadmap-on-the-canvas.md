# 26a The Roadmap on the Canvas

## Goal
The plan's milestones appear on the canvas as a roadmap with a timeline: each milestone with its time, its goal and its tasks, in the order they are built. The roadmap is generated from the plan and stays in sync with it by itself; it is changed by changing the plan.

First part of spec 26; part 26b brings assigning tasks to members.

## Design decisions
- **The plan is the source** (`architecture.md`): the roadmap holds no data of its own. It is a frame of the kind `roadmap` that shows what the section "Meilensteine und Aufgaben" says right now. There are no blocks in it to edit, and a change of the plan shows on the roadmap within seconds, for everyone.
- **Reading the milestones** happens in shared code, without a model call:
  - A milestone is a heading of the third level in the section, e.g. "### Meilenstein 1: Grundgerüst (3 Wochen)". Its name is the heading without the number in front and the time at the end. The first paragraph below it is its goal, and the top-level items of the lists below it are its tasks.
  - A section without such headings but with a list counts each top-level item as a milestone and its nested items as its tasks.
  - The time is a duration in parentheses at the end of the heading: weeks, days (working days, five to a week) or months (four and a third weeks), also as a range ("2–3 Wochen", where the middle counts), rounded to whole weeks.
  - A milestone without a time in its heading takes it from a line of the section "Kosten und Zeit" that names the milestone by its number, e.g. "- Meilenstein 2: 3 Wochen".
  - From now on the moderator writes the time into the heading (the prompts of generation and update).
- **The timeline:**
  - The milestones follow each other in the order of the plan. When every milestone has a time, the roadmap has a scale in weeks ("W1", "W2", …) and every milestone is as wide as its time.
  - Otherwise all milestones are equally wide, and the time stands at each milestone that has one.
  - Weeks are counted from the start; there are no dates.
- **The look** is derived from the prototype, like every look since spec 12:
  - The frame has its header like every frame: a Gantt icon, the title ("Roadmap") and "Roadmap · 4 Meilensteine · 13 Wochen".
  - Every milestone is a column: the number in a small ink square, the name, the time with its weeks ("3 Wochen · W1–3"), the goal in two lines, and the tasks as small cards of up to two lines. At most 12 tasks show, then "+ 3 weitere".
  - The size of the frame follows its content: it grows and shrinks with the plan and cannot be resized by hand. It can be moved, renamed and deleted like any frame.
  - Without milestones the frame says "Der Plan hat noch keine Meilensteine.", where they come from, and offers "Plan öffnen".
- **Placing the roadmap:**
  - "Roadmap" in the plan's toolbar opens the board with the roadmap and brings it into view. If there is none yet, owners and editors get one on the main canvas at a free spot; viewers are told that there is none.
  - The moderator adds it on request (tool `add_roadmap`, under the rules of spec 13: on its own initiative it becomes a proposal), and it sees the roadmap in the canvas overview. Every agent that draws has the tool, like the other canvas tools.
- **A roadmap holds no blocks:** a block dropped on it stays free, agents cannot add blocks to it, and its diagram type cannot be changed.
- **The read-only link** (spec 21b) shows the roadmap like the rest of the canvas.

## Implementation

### Shared: `packages/shared/src/`
- `plan-roadmap.ts`: `readRoadmap` gives the milestones of the plan's sections with name, goal, time and tasks; `parseDuration` reads a time; `roadmapLayout` gives the size of the frame and the place of every column, so the web app and the server size a roadmap alike.
- Canvas model: the frame kind `roadmap`. `addFrame` takes it together with its size; `frameAt` skips roadmaps, so they never take members; `updateNode` refuses to change the type of a roadmap; `fitRoadmap` sets its size without counting as a change of anyone.
- The live event `roadmap`.

### Server
- **API:**
  - `GET /api/projects/:projectId/roadmap` gives the roadmap from the plan as it stands: the live document if someone has the plan open, else the stored one.
  - `POST /api/projects/:projectId/roadmap/open` says where the roadmap is (board and frame). If there is none, it creates one on the main canvas for owners and editors.
- **Live:** the collaboration server announces `roadmap` when a stored plan changes what its roadmap shows.
- **Read-only view:** a board with a roadmap comes with the roadmap.
- **Agents:** the tool `add_roadmap`; the canvas overview names a roadmap as one; the moderator's prompt says what a roadmap is and when to add it.
- **Prompts** `plan.md` and `plan-update.md`: the time in the heading of every milestone.
- **Tests:** reading milestones, tasks and times in all their forms, the layout, the model's rules for roadmaps, the API, the live announcement, the tool and the read-only view.

### Web
- `features/roadmap/`: the query, the content of a roadmap frame, and the button "Roadmap" for the plan's toolbar.
- `FrameNode` shows a roadmap. The canvas keeps the frame's size in line with its content (owners and editors write it) and brings a node into view that the address names (`focus`).
- The read-only view shows the roadmap.
- **i18n:** `roadmap.*`.

## Out of scope
- assigning tasks (part 26b), the status of tasks from GitLab (spec 30)
- dates in the calendar, a start date, milestones in parallel and dependencies between them
- editing milestones or tasks on the roadmap; they are edited in the plan
- exporting the roadmap (spec 27)

## Dependencies
- Spec 25 (all three parts), spec 12, spec 21b
- Packages: none new

## Checklist
- [x] Milestones, goals, times and tasks are read from the plan in the forms described above.
- [x] "Roadmap" in the plan opens the roadmap, and creates it on the main canvas when there is none; the moderator adds it on request.
- [x] The roadmap shows the milestones on a timeline with their times, goals and tasks, follows changes of the plan within seconds, and fits its size to them.
- [x] A roadmap holds no blocks and keeps its type; viewers and the read-only link see it.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for the shared code, the API, the live announcement, the tool and the components pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-03)
- **Reading the roadmap** (`packages/shared/src/plan-roadmap.ts`):
  - `readRoadmap` takes the plan's sections as nodes and gives the milestones with number, name, goal, time and tasks. Milestones are the headings of the third level in the section "milestones" (or of the highest level it has, when it has none of the third); a deeper heading belongs to its milestone, a higher one ends it. Without headings, the items of a list are the milestones and their nested items the tasks.
  - The name leaves out what only numbers the milestone: "Meilenstein 1: Name", "Milestone 1 - Name", "M1 Name" and "1. Name" all give "Name".
  - `parseDuration` reads weeks, working days and months, also as a range and with "ca." or "about", and rounds to whole weeks. A time of more than two years counts as no time.
  - A milestone without a time in its heading takes it from the section "costs": a line that names the milestone as a word of its own ("Meilenstein 2", "M2") gives it the time that follows, up to the next milestone the line names.
  - A roadmap has at most 24 milestones.
- **The layout** (`roadmapLayout`) has fixed heights, so the size of the frame is known without drawing it:
  - With a time on every milestone, a week is as wide as the shortest milestone needs to be readable (between 64 and 160 px), and every column is as wide as its weeks. A scale wider than 4800 px is dropped, and the columns are equally wide (240 px), as they are when a time is missing.
  - A column shows at most 12 tasks and counts the rest.
- **Canvas model:** a roadmap is a frame with the diagram type `roadmap`, which is no member of `DIAGRAM_TYPES`: the type menu does not offer it, and `updateNode` neither sets nor changes it. `frameAt` skips roadmaps, `addBlock` refuses one as its frame, and resizing one takes no members. `fitRoadmap` sets the size with an origin of its own, stamps nobody and refuses sizes beyond every roadmap. Applying operations adds no second roadmap to a board.
- **Server:**
  - `GET /api/projects/:projectId/roadmap` reads the plan through `readPlanSections` of the collaboration server: the live document if it is loaded, else the stored one.
  - `POST …/roadmap/open` looks through the boards in their order and answers with the first roadmap it finds (200). Without one, viewers get 404; owners and editors get a new frame on the main canvas with the size of the layout at a free spot (201). Two people asking at the same moment get one roadmap.
  - The collaboration server calls `onPlanStored` after it stored a plan. `createRoadmapAnnouncer` compares a fingerprint of the roadmap with the last one of the project and announces `roadmap` on the live channel only when it changed.
  - The read-only view sends the roadmap with a board that shows one.
  - `add_roadmap` adds the frame through the rule engine like `add_frame`, sized from the stored plan, and says where the roadmap is when the main canvas has one. It is one of the canvas tools, so every agent that draws has it. `add_block` and `arrange_frame` tell the model that a roadmap holds no blocks and arranges itself; the canvas overview names it as the roadmap of the plan.
  - The prompts of generation and update ask for "### Meilenstein 1: Name (3 Wochen)"; the moderator's prompt says to call `add_roadmap` for a roadmap and to ask for the plan first when it has no milestones.
- **Web:**
  - `FrameNode` shows a roadmap with its summary in the header and `RoadmapContent` below it: the scale, then one column per milestone, everything placed by `roadmapLayout`. A selected roadmap has neither resize handles nor the type menu.
  - The canvas shows a roadmap in the size of its content, also when the stored size lags behind. The clients of owners and editors write the size when a roadmap appears or the roadmap they know changes, never in answer to a stored size, so two clients cannot write in turns.
  - "Roadmap" in the plan's toolbar asks the server where the roadmap is and opens that board with `focus=<frame>` in the address; the canvas centers the frame, zoomed out as far as it needs, and the address forgets the focus.
  - The live event `roadmap` loads the roadmap again; the read-only view takes it from its snapshot.
- **Built with two subagents,** as the owner asked for parallel work: one built the server part against the shared contract while the web part was written; a second one reviewed everything read-only. The review found six things that were fixed before the merge:
  - A time like "9999999999 Wochen" made a frame of a trillion pixels and crashed the canvas for everyone on the board. Times and milestones have bounds now, the scale has a widest width, and `fitRoadmap` refuses absurd sizes.
  - Two clients that knew different states of the plan for a moment wrote the size in turns. The effect no longer answers to the stored size.
  - In the costs, the "m" at the end of a word counted as a milestone ("Plattform 2: 6 Wochen"), and only the first milestone of a line was read.
  - Every heading in the section counted as a milestone, also "#### Aufgaben" below one.
  - A proposal for a roadmap that was applied after someone had added one made a second roadmap.
  - The announcer kept the whole roadmap of every project in memory for good; it keeps a fingerprint of the 2000 projects announced last.
- **Verified** with `pnpm dev` and the browser as olga in "Vereins-App", whose plan came from the generations of spec 25:
  - The roadmap read four milestones with 3, 4, 4 and 2 weeks, 13 in all. The times came from the section "Kosten und Zeit", since the headings of that plan carry none yet.
  - "Roadmap" in the plan opened the main canvas with the roadmap centered at 46 % zoom, and the address had no focus afterwards. The first call of the API created the frame (201), the second found it (200).
  - With the plan open in a second tab, adding "(3 Wochen)" to the heading of milestone 4 and a task below it showed on the canvas within seconds, without a reload: "14 Wochen", "3 Wochen · W12–14", the new task, and a narrower frame. The stored size followed (1064 × 694). Undoing both in the plan brought back 13 weeks and the size from before.
  - A selected roadmap had no resize handles and no type menu (the frame "Architektur" next to it had both). A block placed on it with the tool stayed free.
  - Asked to show the roadmap, the moderator said where it is and that it follows the plan. After the frame was deleted and it was asked to add the roadmap, it added one with the right size.
  - The read-only link showed the roadmap with its scale, columns and tasks.
  - Checked from screenshots: the roadmap in the read-only view at about 110 % (scale, columns, numbers, times, goals, task cards) and on the canvas after the jump. The empty roadmap, a roadmap without a scale and viewers are covered by the tests; they were not tried live.
- **Known limits:**
  - Weeks are counted from the start of the project; the roadmap knows no dates, no milestones in parallel and no dependencies.
  - A time is read in the forms above only. "ein Quartal" or a time in the middle of a heading is no time, and the roadmap then shows all milestones equally wide.
  - The stored size of the frame follows only while an owner or editor has its board open. Until then viewers see the right size, but layout and agents count with the old one.
  - `add_roadmap` looks at the main canvas only; a roadmap on another board does not keep an agent from adding one there.
  - A block can be placed on a roadmap and then covers it.
  - Tasks have no identity yet and cannot be assigned (part 26b).
