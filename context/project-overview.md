# Covibes: Project Overview

> As of 2026-09-27, extended with custom and external agents and the detailed rules from the dry run. Source: the approved product planning (8 rounds of questions). Product decisions only change after consulting the owner.

## Overview

Covibes is a shared planning space made of **chat and canvas**. Teams or individuals write to each other and address specialized AI agents with `@`. A **neutral AI moderator** guides them through brainstorming, decisions, architecture and the project plan. This works for any kind of project, such as a website, a web app or fine-tuning a model.

**Positioning:** Covibes is the planning space in front of the coding agent. Covibes steers; coding agents such as Claude Code or Cursor build.

**What makes Covibes unique:**
- a neutral moderator
- several AI perspectives that also disagree
- a team collaborating in real time
- structured diagrams
- a result that goes straight into the repository and to coding agents

## Goals

1. Teams and individuals can chat and work on a canvas together, in real time, within a project.
2. A neutral moderator helps with brainstorming, compares options, offers compromises, recognizes consensus and records decisions traceably.
3. Specialized agents contribute different professional perspectives, including dissent from a critic. Users can create their own agents and later connect agents of their own or of their company.
4. Decisions become visible as structured diagrams: mind map, architecture and data model, flows, pipelines and sitemaps, roadmap.
5. Decisions and canvas produce a versioned project plan.
6. Results can be exported and handed to the repository and to coding agents directly via GitLab.

## Target audience

First **developers and small teams** (devs, indie hackers, startups) who build with AI tools. Typically 2–8 people at the same time (assumption).

## Core concepts

### Project
- A project consists of **one shared chat and one large, infinite canvas**. Diagrams sit on it as labeled areas (frames). Additional **boards** can be added as tabs when needed.
- A project starts **empty** and contains:
  - members with roles (owner, editor, viewer)
  - project criteria
  - a decision log
  - a versioned project plan
  - optionally a connected repository (GitLab; GitHub after V1)
- **Phases serve as orientation:** brainstorming → decide → architecture → project plan. The indicator sits at the top and the moderator suggests the next step. Jumping between phases is always possible.

### Moderator (the heart of the product)
- **When:** anyone can call it at any time with `@Moderator`. It also notices when the team agrees or is stuck and then **offers help**. It never starts on its own.
- **Tasks:**
  - turn ideas into visuals
  - make suggestions and compare options
  - offer compromises
  - bring in specialists and summarize their contributions
  - record decisions
  - write "Since you were away" summaries
  - suggest the next step
- **Stance, configurable per project:**
  - "Neutral by your criteria" (default)
  - "With its own opinion"
  - optionally "Strictly neutral"
- **Decision process, configurable per project:**
  - The moderator recognizes consensus and briefly confirms it (default).
  - Vote by card
  - The owner decides.
  - Informally in the chat
- **Project criteria:** on its first use the moderator asks for goals, budget, time, the team's know-how and priorities. These criteria are the basis of every assessment.
- **Debates:** usually the moderator collects the opinions and summarizes them. On request there is a visible debate between agents with a limited number of rounds.

### Specialists and custom agents
- There is a **catalog** of well-tuned roles. The moderator proposes a team that fits the project; agents can be added or removed at any time.
- **Initial catalog (assumption):** critic, product, frontend & UX, backend & API, data & database, DevOps & infrastructure, security & privacy, ML engineer, content & SEO.
- **Custom agents (V1):**
  - They are created directly in Covibes with name, role, instructions, their own knowledge (files, links) and allowed tools. A catalog agent can serve as a template.
  - They can be personal, available in all of one's own projects, or shared in a project, available to all its members.
- **External agents (after V1):** agents running at the user's or their company's side take part in the chat through a standard interface (e.g. A2A or webhook). Covibes only sends them the context they need. In the chat they are marked as "external".
- **Company agents (after V1):** they come together with team workspaces and are available to all projects of a company.
- Specialists speak when called with `@` or brought in by the moderator. On risks or contradictions they **signal discreetly** ("raise a hand") but only speak after a click.
- **Same rules for all agents:** whether from the catalog, custom or external, all agents behave the same:
  - They raise a hand before speaking up on their own.
  - Changes on their own initiative are proposals.
  - Git actions need approval.

  Custom instructions cannot override these rules.
- **Knowledge:** file and image uploads, links, web search and the connected repository.

### Canvas and diagrams
- **Structured, with sticky notes:**
  - Blocks have a type and a meaning.
  - Connections are real relationships and carry a label.
  - Everything can be moved freely; auto-layout is available on request.
  - Sticky notes are for unfinished thoughts. After a decision the moderator turns them into blocks.
- **Diagram types in V1:**
  - mind map
  - architecture and data model
  - flows, pipelines and sitemaps
  - roadmap with a timeline

  Except for the roadmap, all of them technically consist of blocks and connections, only with different layouts.
- **Real time:**
  - live cursors and presence
  - every block shows who created it: a human or which agent
  - a change history with undo
- **How agents change the canvas (depending on the situation, for moderator and specialists):**
  - When asked, an agent draws directly. The change is visible to everyone immediately and can be undone.
  - When acting on its own, a dashed **proposal** appears. It is only applied after approval.
  - For alternatives it shows **variants A/B** side by side; one of them is adopted.
  - A project can be configured so that even direct changes arrive as proposals first.
- **Chat and canvas:**
  - Blocks can be referenced in the chat: click and ask about them. Markers in messages jump to the block.
  - AI changes are briefly highlighted on the canvas and recorded in the history. There are **no system notes in the chat**.
  - Comments on blocks come after V1.

### Project plan and export
- **Contents:**
  - MVP scope
  - milestones and tasks
  - recommendations for tech and tools, justified by the decisions
  - risks, costs and time
- **Update on click:** Covibes shows "Plan outdated, update?". Every version is kept and can be compared.
- **Export:**
  - document (PDF/Markdown)
  - diagrams as images (PNG/SVG)
  - diagrams as code (Mermaid)
  - package for coding agents (context files and feature specs)

### GitLab first, then GitHub
- **Principle:** Covibes steers, coding agents build. Covibes agents write **no application code**.
- **What the integration can do:**
  - read repository, code and issue board
  - maintain the issue board and create issues from the plan
  - bring plan, specs and diagrams into the repository as a merge request via commit and push
  - check merge requests against the architecture and show deviations
  - merge after approval
- **Permissions:**
  - Reading is always allowed.
  - Everything that changes something (issue, commit, push, merge) only arrives as a proposal and needs approval. Several changes can be approved together.
  - Every Git action is logged.
- **Handover:** coding agents implement the issues based on the specs in the repository, for example Claude Code (locally or in GitLab CI) or Cursor.

## Core flows

1. **Start:** sign in, then create an empty project. Invite people by link or email with a role. Optionally connect a GitLab repository.
2. **Brainstorming:**
   1. The team collects ideas in the chat, on sticky notes and in the mind map.
   2. Someone calls `@Moderator`, or it offers help on its own.
   3. The first time, it asks for the project criteria.
   4. Specialists contribute their perspectives; the critic reports risks.
3. **Decide:**
   1. The moderator compares options, as variants A/B if needed.
   2. Consensus is recognized or a vote takes place, depending on the configured decision process.
   3. The decision goes into the decision log.
4. **Architecture:**
   - On request, moderator and specialists draw directly.
   - What they suggest on their own appears as a proposal.
   - Sticky notes become blocks.
   - Questions about a block are asked right at the block.
5. **Plan:** "Generate plan" creates a versioned project plan. When something changes, it is updated.
6. **Handover:**
   1. Plan, specs and diagrams go into the repository as a merge request, and issues are created. Both need approval.
   2. Coding agents build.
   3. Covibes checks the merge requests against the architecture.
   4. After approval, they are merged.
7. **Asynchronous:** an `@` mention triggers a notification. Whoever comes back gets a "Since you were away" summary.

## Detailed rules (from the dry run)

These rules come from the dry run with Covibes as the project (see `context/dry-run.md`). They close the gaps that showed up there.

### Agents and moderator
- **Instruction or question:** agents only draw directly on a clear instruction ("draw", "add", "change"). To a question the agent answers and offers the change as a proposal.
- **Simultaneous requests:** every agent has a queue whose status is visible. Different agents work in parallel.
- **Raised hands:** at most two are open at the same time. They stay until someone listens to them or dismisses them.
- **Language:** agents answer in the language of the message. Plan and exports are produced in the configured project language.
- **AI limit reached:** a clear message appears and the owner sees the usage. Only the AI pauses; everything else keeps working.

### Decisions and criteria
- **Criteria:** they have their own "Criteria" section that editors can change. Every change goes into the decision log.
- **Comparisons and variants:** a comparison appears as a card in the chat and is attached to the log entry. Discarded variants stay there as a snapshot.
- **Reopening:** any editor can reopen a decision with a reason. Then:
  - The moderator starts a new round.
  - The old decision stays in the log as history.
  - The plan is marked as outdated.

### Canvas
- **Humans take precedence:** the AI does not touch a block that a human is currently editing. It waits or makes a proposal.

### Plan and export
- **Manual edits:** the plan can be edited directly. When updating, Covibes shows the new parts as proposals to accept or reject. Manual edits are never lost.
- **Roadmap:** it is generated from the plan's milestones and stays in sync with it.
- **Tasks:** they can be assigned to members. After the handover GitLab owns the status; Covibes reads it and shows the progress in the plan.
- **Package for coding agents:** if information is missing, such as code standards or the UI direction, the moderator asks before the export or makes suggestions. The package contains `CLAUDE.md` and `AGENTS.md`, so it works with any coding agent.

### GitLab
- **Approvals:** by default only the owner approves Git actions. The owner can grant this right to individual editors. GitLab's own permissions apply in addition.
- **Identity:** actions run with the GitLab access of the approving person and carry the note "via Covibes".
- **Issues:** one issue per feature spec, grouped by milestones and linked to the spec.
- **Files in the repository:** by default in `context/` and `docs/diagrams/`, configurable per project. Existing files appear as changes in the MR and are never simply overwritten.
- **MR review:** Covibes reviews MRs for Covibes issues automatically. The result is shown in Covibes; it appears as a comment in GitLab only after approval.
- **Existing documentation:** when a repository is connected, the moderator offers to read existing documentation and derive criteria and a mind map from it.

### Collaboration and roles
- **Roles:**
  - Viewers can only read.
  - Editors chat, call agents, edit the canvas and confirm decisions.
  - Owners additionally manage settings, invitations, the repository and Git approvals.
- **"Waiting for you":** open proposals, approvals and raised hands collect here. They also appear in the "Since you were away" summary and are sent by email.

## Product principles

- **Quality over cost:** where it improves quality, we use the strongest models.
- **No slop:**
  - The moderator asks before drawing.
  - Assessments follow the team's criteria.
  - Every decision stays traceable.
  - Exports are tested on real projects.
- **Humans decide:** the AI offers and suggests. What it contributes on its own is a proposal. Everything that changes something in Git needs approval.
- **Traceability:** authorship, history, undo, decision log and a log of Git actions.

## Scope

### In V1 (the Covibes MVP)
- **Access:** accounts, projects, invitations by link or email, roles (owner, editor, viewer) and a read-only link.
- **Chat:** real-time chat with `@` mentions. Notifications in the app and by email (assumption).
- **Canvas:** all four diagram groups, sticky notes, frames, additional boards, auto-layout, history, variants and proposals.
- **AI:**
  - moderator with all settings
  - specialist catalog
  - custom agents, personal or shared in the project
  - raised hands and debates
  - project criteria, decision log and phase indicator
- **Result:** project plan with versions and all four exports.
- **Integrations:** GitLab as described above, uploads, links and web search.
- **Frame:** German and English, desktop browser.

### After V1 (deliberately later)
- GitHub integration (next)
- team workspaces, together with company agents
- connecting external agents (e.g. via A2A or webhook)
- guests without an account
- mobile optimization
- Notion, Jira and Linear
- comments on blocks
- payment and subscription
- guided onboarding "idea + follow-up questions"

### Non-goals
- Covibes is not a coding agent. Covibes agents write no application code.
- Covibes is not a free-form whiteboard. The canvas is structured and has sticky notes.
- AI changes do not appear as system notes in the chat.

## Cross-cutting concerns

- **Privacy:**
  - GDPR-compliant. Processing is not limited to the EU, because Covibes aims at international users (owner decision, 2026-09-29).
  - AI providers without training on user data, secured by a data processing agreement
  - Projects and accounts can be deleted; data can be exported.
- **Costs:** V1 is free with generous limits against abuse. Costs are tracked per project and per user. A subscription comes later.
- **Language:** German and English are built in from the start. Agents answer in the language of the chat.
- **Platform:** V1 runs in the desktop browser. On mobile, reading and chatting work.

## Success criteria for V1

- [ ] Signed-in users can create a project and invite others by link or email with a role.
- [ ] Several users chat and edit the canvas at the same time, in real time.
- [ ] `@Moderator` and `@` specialists answer. The moderator offers help on its own but never acts unasked.
- [ ] The moderator compares options, shows variants A/B and writes decisions into the decision log.
- [ ] Agents draw directly on request. What they contribute on their own appears as a proposal.
- [ ] Users can create custom agents, also based on a catalog agent. They can use them themselves and share them in a project.
- [ ] All four diagram groups can be created, edited and exported as PNG/SVG and as Mermaid.
- [ ] Decisions and canvas produce a versioned project plan. It can be exported as PDF/Markdown and as a package for coding agents.
- [ ] With a connected GitLab repository, issues can be created from the plan, plan and specs submitted as a merge request, merge requests checked against the architecture and merged. Everything that changes something needs approval.
- [ ] The UI is available in German and English.
- [ ] The scenario from `context/dry-run.md` can be played through in Covibes step by step, and all expected points are met.
- [ ] The owner and acquaintances take a real project through Covibes, from the idea to the merged merge request with the plan.

## Assumptions (to be confirmed)

- Typical team size: 2–8 people at the same time.
- Sign-in via GitLab, GitHub, Google or email.
- Notifications in the app and by email.
- Initial specialist catalog as described above.
- The moderator is called "Moderator" for now. Name and persona follow later.

## Glossary

- **Project:** workspace made of a chat and a canvas, with members, criteria, decision log and plan.
- **Board:** additional canvas in a tab, optionally next to the main canvas.
- **Frame:** labeled area on the canvas that contains a diagram.
- **Block:** structured canvas element with a type and a meaning, for example a service, a database or a page.
- **Connection:** labeled, real relationship between two blocks.
- **Sticky note:** free element for unfinished thoughts that can later become a block.
- **Moderator:** neutral AI agent that moderates, compares, visualizes and records decisions.
- **Specialist:** AI agent with a professional role from the catalog.
- **Custom agent:** agent that users create in Covibes, with their own role, instructions and knowledge. It is personal or shared in a project.
- **External agent:** agent running outside Covibes, at the user's or their company's side. It takes part in the chat through a standard interface (after V1).
- **Raised hand:** discreet signal from a specialist that it has an important objection.
- **Proposal:** AI change shown dashed that is only applied after approval.
- **Variant:** alternative version of a diagram, placed next to the others for comparison.
- **Decision log:** list of recorded decisions with reasoning, discarded alternatives and approval.
- **Project criteria:** the team's goals, budget, time, know-how and priorities; the basis for neutral assessments.
- **Phase:** orientation step in the process: brainstorming, decide, architecture, project plan.
- **Package for coding agents:** export of context files and feature specs that Claude Code, Cursor and other tools can build from directly.
