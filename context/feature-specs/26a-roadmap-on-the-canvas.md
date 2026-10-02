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
  - The moderator adds it on request (tool `add_roadmap`, under the rules of spec 13: on its own initiative it becomes a proposal), and it sees the roadmap in the canvas overview.
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
- [ ] Milestones, goals, times and tasks are read from the plan in the forms described above.
- [ ] "Roadmap" in the plan opens the roadmap, and creates it on the main canvas when there is none; the moderator adds it on request.
- [ ] The roadmap shows the milestones on a timeline with their times, goals and tasks, follows changes of the plan within seconds, and fits its size to them.
- [ ] A roadmap holds no blocks and keeps its type; viewers and the read-only link see it.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the shared code, the API, the live announcement, the tool and the components pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
