# Dry Run and V1 Acceptance Scenario

> Played through on 2026-09-27 with Covibes itself as the project. The 21 gaps it revealed are closed in `project-overview.md` under "Detailed rules".
> **When V1 is finished, we play through exactly this scenario for real.** V1 is accepted when all expected points are met.

**Participants:**
- owner
- Alex (frontend, editor)
- Sam (backend, editor)

**Project:** "Covibes V1", connected to a GitLab repository that already contains context files.

## 1. Start
**Flow:** the owner signs in with GitLab, creates "Covibes", invites Alex and Sam and connects the repository.

**Expected:**
- [ ] Signing in with GitLab works.
- [ ] The new project starts empty, with chat, canvas and the phase "Brainstorming".
- [ ] Alex (by email) and Sam (by link) join as editors.
- [ ] After the repository is connected, the moderator offers to read the existing documentation and derive criteria and a mind map from it. It does not start on its own.

## 2. Brainstorming
**Flow:** the team creates sticky notes ("real time", "moderator", "GitLab", "costs"). Alex and Sam call @Moderator almost simultaneously.

**Expected:**
- [ ] Everyone sees the sticky notes live.
- [ ] The second request to the moderator goes into the queue, and its status is visible.
- [ ] On its first use the moderator asks for the criteria. They then appear in the "Criteria" section.
- [ ] On the instruction, the moderator draws a mind map directly.
- [ ] The security agent raises its hand ("Which data goes to external AI providers?"). It only speaks after a click. At most two raised hands are open at the same time.

## 3. Decide
**Flow:** Alex wants tldraw, Sam wants React Flow. In the evening the two agree while the owner is offline.

**Expected:**
- [ ] The moderator offers a comparison and shows it as a card, assessed against the criteria.
- [ ] It recognizes the consensus and asks for confirmation. Sam confirms, and the decision lands in the log together with the comparison.
- [ ] The next morning the owner sees the decision under "Since you were away" and reopens it with a reason. Then:
  - [ ] The moderator starts a new round.
  - [ ] The old decision stays in the log as history.
  - [ ] An existing plan is marked as outdated.

## 4. Architecture
**Flow:**
1. The owner writes: "@Moderator, draw the architecture of Covibes V1."
2. Sam clicks the block "AI orchestration" and asks @Backend how several agents run in parallel.
3. Meanwhile Alex moves blocks in exactly that area.

**Expected:**
- [ ] The moderator draws directly. The changes are highlighted on the canvas and recorded in the history. No system notes appear in the chat.
- [ ] Backend answers Sam's question and offers the block "Queue" as a proposal. It does not change the canvas directly.
- [ ] The AI does not touch the area Alex is currently editing.
- [ ] The critic reports "Cost limits are missing". This becomes a dashed proposal that is applied after approval.
- [ ] For an alternative (monolith or separate real-time service) the moderator shows variants A and B side by side. The discarded one stays in the log as a snapshot.

## 5. Project plan
**Flow:** the moderator reports: "The architecture is 90 % done; only hosting is open." The team generates the plan. Then:
1. The owner corrects a time estimate by hand.
2. Later a decision changes.
3. Meanwhile Sam writes in English.

**Expected:**
- [ ] The phase indicator shows the progress, and the moderator suggests the next step.
- [ ] The plan contains the MVP scope, milestones and tasks, a tech recommendation as well as risks, costs and time.
- [ ] The roadmap on the canvas is generated from the milestones.
- [ ] After the changed decision Covibes shows "Plan outdated, update?". The update arrives as proposals, and the owner's manual edit is preserved.
- [ ] Tasks can be assigned to Alex and Sam.
- [ ] Before exporting the package for coding agents, the moderator asks for code standards and the UI direction. The package contains `CLAUDE.md` and `AGENTS.md`.
- [ ] The agents answer Sam in English. Plan and exports stay in the project language.

## 6. Handover to GitLab
**Flow:**
1. Covibes proposes a merge request with plan, specs and diagrams, plus the issues. The owner approves both together.
2. A coding agent (e.g. Claude Code) implements issue 1 and opens an MR that uses Socket.io instead of the decided real-time solution.

**Expected:**
- [ ] The MR puts the files into `context/` and `docs/diagrams/`. Existing files appear as changes and are not overwritten.
- [ ] There is one issue per feature spec, grouped by milestones and linked to the spec.
- [ ] MR and issues appear in GitLab under the owner's name with the note "via Covibes".
- [ ] Covibes reviews the coding agent's MR automatically. The deviation from the architecture is reported in Covibes; it appears as a GitLab comment only after approval.
- [ ] After the fix and the owner's approval, it is merged. Covibes takes the progress in the plan from GitLab.

## 7. Asynchronous
**Flow:** Sam was away for two days. In the evening the AI limit is reached.

**Expected:**
- [ ] Sam received notifications about the @ mentions, in the app and by email.
- [ ] On return, "Since you were away" shows:
  - decisions
  - changes on the canvas
  - new plan versions
  - events from GitLab
  - what is waiting under "Waiting for you": open proposals, approvals and raised hands
- [ ] When the AI limit is reached, a clear message appears and the owner sees the usage. Only the AI pauses; everything else keeps working.
