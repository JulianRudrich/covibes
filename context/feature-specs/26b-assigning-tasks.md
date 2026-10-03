# 26b Assigning Tasks

## Goal
The tasks of the plan's milestones can be assigned to members, in the plan and on the roadmap. A task keeps its assignment while its text changes and when the moderator rewrites the section. The person a task goes to learns of it.

Second part of spec 26; part 26a brought the roadmap on the canvas.

## Design decisions
- **A task is a list item of the plan.** It carries an id in the plan's document (the attribute `taskId` of the list item), so its assignment stays with it whatever its text becomes. The plan stays the source of which tasks exist and how they read.
- **The server gives the ids.** After it stored a plan, it gives every list item of the section "Meilensteine und Aufgaben" an id that has none, or one that another item has too (a pasted copy). One writer means two clients never give the same task different ids. A new task can be assigned a few seconds after it was written.
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
- [ ] Tasks get ids from the server, keep them while their text changes, and keep them through an accepted suggestion for the section.
- [ ] Owners and editors assign and clear tasks on the roadmap and in the plan; viewers see the assignees; everyone sees a change at once.
- [ ] The assignee gets a notification in the app and by mail, not for a task they took themselves.
- [ ] Agents know who took which task; the read-only link names nobody; versions hold no ids.
- [ ] The derived looks were checked from screenshots and are listed in `ui-context.md`.
- [ ] Tests for the shared code, the database, the API, the notification and the components pass.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass, `progress-tracker.md` is updated.
