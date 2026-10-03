# 26b Assigning Tasks

## Goal
The tasks of the plan's milestones can be assigned to members, in the plan and on the roadmap. A task keeps its assignment while its text changes and when the moderator rewrites the section. The person a task goes to learns of it.

Second part of spec 26; part 26a brought the roadmap on the canvas.

## Design decisions
- **A task is a list item of the plan.** It carries an id in the plan's document (the attribute `taskId` of the list item), so its assignment stays with it whatever its text becomes. The plan stays the source of which tasks exist and how they read.
- **The server gives the ids.** After it stored a plan, and when the roadmap reads a task without an id, it gives every list item of the section "Meilensteine und Aufgaben" an id that has none, or one that another item has too (a pasted copy). One writer means two clients never give the same task different ids. A new task can be assigned a few seconds after it was written.
- **A rewritten section keeps the ids of its tasks.** When a suggestion for the section is accepted:
  - a task that reads the same keeps its id
  - a task whose text changed takes the id of the most similar task from before, if at least half of their words match
  - every other task is new
- **Assignments are rows** in `tasks`: the project, the id of the task, the assignee, who assigned it and when, and how the task read then.
  - Owners and editors assign and clear; every member can be assigned. A task has one assignee.
  - Someone who leaves the project loses their tasks.
- **Where tasks are assigned:**
  - On the roadmap every task shows the avatar of its assignee at its right end; for owners and editors a task without one shows a faint button to assign.
  - In the plan every task of a milestone shows the same at the end of its line.
  - Both open the same small menu: the members with a check at the current assignee, and "Niemand".
- **The assignee is notified** in the app and by mail like every notification (spec 22), unless they took the task themselves: "Olga hat dir eine Aufgabe zugewiesen: Login bauen".
- **Agents** see in their context who took which task. They do not assign tasks.
- **The read-only link** shows that a task is assigned without naming anyone ("Teammitglied"), as on the canvas.
- **Versions of the plan** hold its text without the ids.

## Implementation

### Shared: `packages/shared/src/`
- `PLAN_TASK_ATTRIBUTE`; a task of the roadmap gets its id and its assignee (`RoadmapTask`).
- `plan-tasks.ts`: `ensureTaskIds` gives the list items of the milestones section their ids in the plan's document; `carryTaskIds` gives the tasks of a rewritten section the ids of the tasks before; `withoutTaskIds` for versions.
- The input of assigning; the notification kind `task_assigned`.

### Database: migration `0025_tasks.sql`
- Table `tasks`. RLS: members read; nobody writes directly.
- `assign_task` for owners and editors: sets or clears the assignee, who must be a member, and notifies them.
- Members who leave lose their tasks; the notification kind.

### Server
- **Ids:** after a plan was stored, the collaboration server lets `ensureTaskIds` run on it; accepting a suggestion for the milestones carries the ids over.
- **API:**
  - `GET /api/projects/:projectId/roadmap` gives every task its id and its assignee.
  - `PUT /api/projects/:projectId/roadmap/tasks/:taskId/assignee` assigns or clears. The task must be in the plan as it stands.
- **Live:** an assignment announces `roadmap`.
- **Notifications:** the new kind in the list and in the mail.
- **Agents:** a section of the context with who took which task.
- **Read-only view:** assignees without their names. **Versions:** without ids.
- **Tests:** ids in all their cases, carrying over, the function and its rights, the API, the notification, the context, the read-only view.

### Web
- `features/roadmap/`: the menu of members, the assignee on a task of the roadmap, assigning with an immediate effect.
- **Plan:** list items keep their id (`PlanTasks`), and every task shows its assignee or the button to assign.
- **Notifications:** the row of the new kind.
- **i18n:** `roadmap.*`, `notifications.*`.

## Out of scope
- the status of a task, due dates, several people on one task
- assigning by agents or from the chat, and a list of one's tasks across projects
- issues per task (spec 29) and their status from GitLab (spec 30)
- removing the assignments of tasks that left the plan; they stay as rows and show nowhere

## Dependencies
- Spec 26a, spec 25 (all three parts), spec 22 (both parts), spec 21b
- Packages: none new

## Checklist
- [x] Tasks get ids from the server, keep them while their text changes, and keep them through an accepted suggestion for the section.
- [x] Owners and editors assign and clear tasks on the roadmap and in the plan; viewers see the assignees; everyone sees a change at once.
- [x] The assignee gets a notification in the app and by mail, not for a task they took themselves.
- [x] Agents know who took which task; the read-only link names nobody; versions hold no ids.
- [x] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [x] Tests for the shared code, the database, the API, the notification and the components pass.
- [x] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.

## Implementation notes (2026-10-03)
- **Ids of tasks** (`packages/shared/src/plan-tasks.ts`):
  - `ensureTaskIds` gives every list item of the section "milestones" an id that has none, an invalid one, or one that an item before it has too (a pasted copy; the first keeps it). Every list item gets one, also nested items and notes: which items are tasks follows from how the roadmap reads the section, and that changes with the next edit. `needsTaskIds` tells without writing whether there is anything to do.
  - `carryTaskIds` gives the list items of a rewritten section the ids of the items before: the same text first, then the most similar pairs of what is left (the share of common words, at least half), then new ids. An id goes to one item only.
  - `withoutTaskIds` takes the ids out, for the versions of the plan.
  - The roadmap reads the id of every task (`RoadmapTask.id`, null until the server gave one), and `withAssignees` puts the assignees on it.
- **Database** (migration `0025_tasks.sql`):
  - `tasks` holds per project and task id the assignee, who assigned it and when, and how the task read then. Members read; the read-only link reads too (the server takes only the ids of taken tasks from it); nobody writes directly.
  - `assign_task` is for owners and editors and gives a task to a member or to nobody, one call at a time per project. It writes the notification `task_assigned` with the task's text, unless someone takes a task themselves or the assignee stays the same. The mail of spec 22b is scheduled for the new kind.
  - A member who leaves or is removed loses their tasks (trigger); tasks go with their project.
- **Server:**
  - **Ids:** after the collaboration server stored a plan, `createTaskIdGiver` looks whether it needs ids and, if so, gives them through `changePlan`, outside the store that found it; the plan is then stored again and needs nothing more, so it ends by itself. One run per project at a time. `GET /roadmap` asks for the same when it reads a task without an id, which gives plans from before this spec their ids the first time someone looks at their roadmap or plan.
  - **Accepting** a suggestion for the milestones writes it with `carryTaskIds`; a kept version holds the plan through `withoutTaskIds`.
  - **`GET /api/projects/:projectId/roadmap`** gives every task its id and its assignee (members only, read under RLS; someone who left has no task).
  - **`PUT …/roadmap/tasks/:taskId/assignee`** takes `{ userId }` or `{ userId: null }`. The task must be a task of the roadmap of the plan as it stands (404 otherwise); its text there becomes the title. Viewers get 403, an assignee who is no member 400. A change is announced as `roadmap` on the live channel.
  - **Notifications:** the list needs no change for the new kind; the mail has the line "Olga hat dir eine Aufgabe zugewiesen: Login bauen" (English: "Olga assigned you a task: …").
  - **Agents:** the context has a section `<assignments>` after `<plan>`, one line per assigned task with its milestone, left out while nobody took a task; the common prompt says that agents do not assign.
  - **Read-only view:** a taken task comes with an assignee without id and name.
- **Web:**
  - **Roadmap:** a task card shows the assignee's avatar at its right end. Owners and editors get a button there (the avatar, or a dashed circle with a person-plus icon) that opens the menu of members with "Niemand". A task without an id shows nothing to assign until its id arrived.
  - **Plan:** `PlanTasks` keeps the id on a list item (not inherited by an item split off it) and draws a control at the end of every task the roadmap knows: a chip with avatar and name, or "Zuweisen" for owners and editors. The controls are decorations, no text of the plan. A click opens the same menu, anchored where the control stands.
  - Assigning shows at once and is taken back with a note when the server refuses it. The roadmap is loaded again on the live events `roadmap` and `project` (someone left).
  - **Bell:** the row "… hat dir in … eine Aufgabe zugewiesen" with the task below it opens the plan.
- **Built with a subagent** for the server part, against the shared contract and the migration. Its report named two gaps that were closed before the merge: the mail job was not scheduled for the new kind (the trigger of migration 0019 lists the kinds), and plans from before this spec got no ids until their next edit. A second subagent for the review ran into the usage limit; the review was done by hand instead and led to three changes: the ids take the section exactly as the roadmap reads it (a second heading of a section inside the milestones had left its tasks without ids for good), the comparison of words is prepared once per task, and the roadmap is loaded again when the team changes.
- **Verified** with `pnpm dev` and the browser as olga in "Vereins-App"; sam joined as an editor through an invitation link for the test and was removed again at its end:
  - The 31 tasks of the plan, written before this spec, had their ids a moment after the roadmap was first read.
  - On the roadmap every task had its button; the menu listed olga, sam and "Niemand". Giving the first task to sam showed his avatar at once, and sam had the notification from olga with the task's text.
  - In the plan the 31 tasks of the milestones had a control and the list items of other sections none. "Zuweisen" on a second task opened the menu below it; choosing olga showed her chip, and a second tab on the canvas showed both avatars without a reload. The plan's document held nothing of the controls.
  - Rewording the assigned task kept its assignee. A task split off it had no control at first and "Zuweisen" about three seconds later, with an id of its own.
  - Asked who took which task, the moderator named both assignments and said that tasks are assigned in the plan or on the roadmap.
  - The read-only link gave both tasks an assignee without name and id.
  - "Niemand" cleared a task. Removing sam cleared his task for everyone at once, in the plan and on the canvas.
  - Checked from screenshots: the plan with the chip, the faint "Zuweisen" controls and the open menu, and the roadmap at 121 % with the avatar and the buttons.
  - Not tried live: the mail (it waits ten minutes; the database test checks that it is scheduled and the worker test what it says), a suggestion for the milestones that rewords tasks (it needs a run of the model; covered by the tests of `carryTaskIds` and of accepting), the row in the bell, and viewers.
- **Found while testing live:** the jump to the roadmap (spec 26a) moved the view with an animation, which never runs in a tab that is not drawn; the address had forgotten the element by then. The view is set at once now.
- **Known limits:**
  - Only tasks the roadmap reads can be assigned: the items of the lists below a milestone, not their nested items, and not tasks beyond the 24th milestone.
  - A tab that was opened before this release does not know the ids. If someone edits tasks in it, their ids are lost, the server gives new ones, and their assignments show nowhere.
  - The assignments of tasks that left the plan stay in the table and show nowhere.
  - When a copy of a task is pasted above the original, the copy keeps the id and with it the assignee; the original gets a new id.
  - A task has one assignee, no status and no date. Agents do not assign tasks.
  - While two changes meet (an assignment and a reload from another change), the roadmap can show the old assignee for a moment.
