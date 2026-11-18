# Covibes — Signal Atlas

Independent product design handoff. 17 November 2026.

**Authority:** the owner's request of 17 November explicitly replaces the previous Covibes visual design. The design team did not read the previous UI handoff, tokens, current screen captures or application component styling as design references. The product's jobs, permissions and data contracts remain binding. This handoff and spec 55 are the visual and interaction reference for the redesign.

## The product idea

Covibes helps a team turn a conversation into a reviewable foundation for implementation. A person should quickly know what to do next: explore an idea, understand a decision, inspect its effect, contribute a perspective, or approve a precise handoff.

The distinctive object is the **decision trail**: a decision connects criteria and evidence to the diagram objects, plan sections and tasks it shaped. Chat remains first-class collaboration, while the project's knowledge also has stable destinations outside the conversation.

## Research and independent directions

The designer team examined **18 repositories and 16 web products**. Primary UI documentation, official app screenshots and dated changelogs were compared with current and historical discovery signals. Full methods, URLs, observation times and limits:

- [Repository research](../../research/2026-11-17-repository-design-research.md)
- [Web app research](../../research/2026-11-17-webapp-design-research.md)

Calendar windows are 16–17 November so far, 9–15 November, and October. GitHub's current seven/thirty-day lists are rolling windows and are identified separately. Rankings changed during the study. Popularity is a discovery signal, not a usability score; conflicting historical archives are not treated as definitive rankings.

Three directions were developed from the jobs, without using the previous Covibes composition:

| Direction | Core idea | Strength | Tradeoff |
| --- | --- | --- | --- |
| **A. Signal Atlas — selected** | One active work object, an open map/document surface and one contextual drawer; a decision trail connects the result to reasoning. | Spatial thinking, readable plans and focused review belong to one coherent workspace. | Needs deliberate context and selection handling. |
| **B. Decision Journal** | An editorial brief leads the session; diagrams are embedded evidence and conversation annotates the brief. | Strong asynchronous reading and finished handoff. | A blank project risks feeling like a form to complete; exploration receives less room. |
| **C. Momentum Desk** | A compact operations station organized around commands, queues and agent runs. | Fast for experienced technical users and review volume. | Risks turning collaborative planning into agent administration. |

Selection is a design judgment, not a quantitative usability result. Signal Atlas best serves the complete product: exploration, reasoning, architecture and handoff.

### Evidence translated into design

| Primary evidence | Principle retained | Covibes interpretation |
| --- | --- | --- |
| [Linear views/Peek](https://linear.app/docs/custom-views), [12 November changelog](https://linear.app/changelog) | Stable work list, temporary inspection, explicit run failure and one command entry. | Decisions and consequences are first-class, not only issues. |
| [Miro Focus mode](https://help.miro.com/hc/en-us/articles/25275263961874-Miro-Diagrams) | The active artifact receives the main surface. | Conversation and inspectors are optional; every capability is not permanently mounted. |
| [Eraser map planning](https://docs.eraser.io/creating-a-map) | Clarify intent, inspect a plan, then apply. | Preserve disagreement and why a diagram exists. |
| [Notion Agent context](https://www.notion.com/help/notion-agent) | Selected scope and the user's permission boundary. | Scope, payer and discussion versus change are explicit before execution. |
| [Plannotator Inbox](https://plannotator.ai/inbox/) | Concrete next review action and version-bound approval. | Ordinary agent messages do not become urgent inbox items. |
| [Archify](https://github.com/tt-a1i/archify) | Node selection reveals dependencies and sources. | Generated polish does not imply certainty; missing provenance is honest. |
| [LibreChat artifacts](https://www.librechat.ai/docs/features/artifacts) | Named results, versions and a return route to conversation. | Plan, diagram and decision are durable project objects. |
| [tldraw action model](https://tldraw.dev/sdk-features/ui-components) | Shared semantic actions across toolbar, menu and keyboard. | Preserve structured planning objects and permission checks; no SDK adoption is implied. |

Brand colors, fonts, geometry and mark below are original decisions. No proprietary reference styles, brand assets or screen source were copied.

## Information architecture

### Workspace and project

Workspace navigation contains Projects, Review inbox, Search, settings and account. The switcher distinguishes personal and team workspaces. The current workspace and project remain visible without a breadcrumb maze.

Project destinations have equal standing:

1. **Atlas:** boards, diagrams, frames, roadmap and the non-spatial outline.
2. **Decisions:** criteria, open choices, accepted decisions, alternatives and connected work.
3. **Plan & handoff:** versioned plan, suggested edits, tasks, feature specs and repository package.
4. **Activity:** changes, authorship and useful return-to-work actions.

The phase indicator expresses progress. It does not force navigation or advance a project when somebody opens a different view.

Review inbox is a queue across the workspace. Each item names project, actor, action and consequence. Counts include only actions the person may take. Unread chat and an approval are different states.

Use one primary project-view navigation per breakpoint. At 1280 px and above,
the labeled spine carries Atlas/Decisions/Plan/Activity and the header carries
the current view/board context. Below 1280 px, the compact rail/phone menu is
complemented by labeled project tabs. Do not repeat the same full navigation in
both places. The study shows both arrangements to compare their behavior;
production applies this responsive rule.

### One active surface, one contextual drawer

The main surface presents the selected view. Only one right drawer can be open: Conversation, Object details, Decision reasoning, Proposal review, Team, or Handoff review. Switching drawers retains the selected object and unsent composer/form drafts. A review may be modal; ordinary desktop inspection is not.

- Large screens: the drawer takes room from the work area while minimum usable width remains.
- Medium screens: a temporary drawer overlays the edge.
- Phones: a focused full-screen task with a clear return action.
- Closing restores focus to the opener and preserves camera/scroll position.

When a drawer opens another context, Back returns to the previous context and
its retained draft. Close returns to the main work surface. An opener removed
from the DOM falls back to the active view's heading.

The compact “Ask the team” entry opens the shared conversation. Selecting an object gives the composer an explicit, removable reference. A reference does not silently follow another selection after writing begins.

### Decision trail

An object's trail links to its nearest decision, connected objects and implementation tasks/plan sections. These are real IDs, not duplicated text. “Show impact” highlights affected objects and provides the equivalent accessible list. Reopening records a reason and identifies dependent plan sections for review.

An unlinked object says “No decision linked yet.” Inaccessible sources reveal no unauthorized title/snippet. Removed, missing and superseded references have clear states.

## Identity and visual language

Precise, energetic and calm. A deep ink navigation spine anchors a cool work area. Indigo carries actions and selection. Chartreuse is a restrained brand signal, used for the mark, active navigation and occasional emphasis. It is not a universal success color.

Controls have deliberate small corners, clear labels and readable boundaries. Hierarchy comes from typography, spacing and content. Shadows express elevation; they are never the only selection/focus cue.

The original mark is an open bracket frame around an upward connecting stroke, drawn as SVG in the prototype. It represents a shared boundary around multiple perspectives. The lower-case Space Grotesk wordmark may carry a chartreuse period.

Use one 24 px line-icon grid at 1.6–1.8 px stroke, normally 18 px. Rare actions need labels, not icon guessing. Humans have circular initials/photos; agents have compact rectangular role abbreviations plus an explicit AI label. External assistants identify their person. Name/role/provider/run state remain separate.

### Semantic color tokens

Themes change values, not layout. Existing identifiers may be compatibility aliases while styles migrate; new code uses the semantic model.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| app | #F1F3F8 | #0C1221 | Outer work area |
| surface | #FFFFFF | #141E32 | Cards, drawers, dialogs |
| surface-subtle | #F7F8FC | #1A263D | Nested groups and fields |
| text | #172039 | #EEF2FF | Primary copy |
| text-muted | #5B657B | #B3BFD7 | Secondary copy |
| text-quiet | #5F6D88 | #96A6C4 | Small readable metadata |
| border | #DCE1EC | #33415E | Decorative separation |
| border-control | #7C8DAF | #66799E | Required control boundaries |
| action | #4338CA | #A5AFFF | Primary action / selection |
| action-hover | #3529AB | #BCC3FF | Primary hover |
| action-soft | #EEEDFF | #2B315F | Context / selection background |
| action-text | #3730A3 | #C1C8FF | Text on action-soft |
| on-action | #FFFFFF | #101831 | Text on primary action |
| brand-signal | #D6FA77 | #D6FA77 | Limited brand emphasis |
| on-signal | #1D2E09 | #1D2E09 | Text on brand-signal |
| nav | #121B32 | #080E1A | Navigation spine |
| nav-surface | #202B46 | #1A263E | Selected nav / workspace |
| nav-text | #F4F6FF | #F4F6FF | Navigation text |
| nav-muted | #A7B4CF | #A7B4CF | Navigation metadata |
| success / success-soft | #146641 / #E8F6ED | #86DFAE / #153C2D | Saved / accepted / connected |
| warning / warning-soft | #8B4C05 / #FFF4DD | #FFD19A / #49331A | Review / paused / question |
| danger / danger-soft | #AD263B / #FFEDF0 | #FFB1BF / #4C2430 | Failed / destructive |
| focus | #3658E8 | #B2C3FF | Keyboard focus |
| canvas-grid | #D8DEEB | #2A3750 | Optional nonessential dots |

Computed sRGB pairs: text/white 16.13:1; muted/white 5.85:1; quiet/app 4.69:1; white/light action 7.90:1; on-signal/chartreuse 12.30:1; control border/white 3.34:1; dark text/surface 14.89:1; dark muted/surface 9.00:1; on-action/dark action 8.50:1. These token calculations do not establish whole-product accessibility conformance.

### Type and geometry

- Display/wordmark: **Space Grotesk**, 500–600.
- Interface and sustained copy: **Inter**, 400–600; tabular figures for usage.
- IDs/technical metadata: system mono. Never mono for sustained prose.
- Self-host OFL fonts. Local prototype files and licenses are in fonts/. Production can use corresponding fontsource packages. No runtime Google Fonts request.

| Role | Desktop | Phone |
| --- | --- | --- |
| Workspace greeting | 38/44 Space 600 | 31/37 |
| Project title | 30/36 Space 600 | 27/33 |
| Section title | 22/29 Space 600 | 20/27 |
| Object title | 14/20 Inter 600 | 14/20 |
| Body / chat / form | 14/21 Inter 400 | 14/22 prose; 16/24 inputs |
| Navigation / controls | 12–13/18 Inter 500 | 13/20 |
| Essential metadata | 10–11/16 Inter 400 | 11/17 |
| Nonessential index | 9/14 system mono | 9/14 |

Spacing: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64. Corners: buttons/fields 8, cards/drawers 10–12, dialogs 12–16, chips 4–5. Buttons: 36 px desktop, 44 px touch. Compact 30 px controls are desktop only. A small icon may sit inside a 44 px touch target.

Default elevation is a 1 px border. Drawers/dialogs use a soft 16 px / 48 px shadow at 8% ink in light and 32% black in dark. Selection is action border plus a 3 px action-soft halo. Focus is a separate 3 px ring with 3 px offset.

Motion: 120 ms control response, 160 ms menu/selection, 200 ms drawer. At most 8 px translation. No looping glow for an idle agent. Disable nonessential motion under reduced motion. Streaming announces state without repeatedly reading the answer.

## Responsive composition

| Width | Navigation | Work area | Context |
| --- | --- | --- | --- |
| >=1600 | 224 px spine | 42 px side inset | 390 px drawer; may push |
| 1280–1599 | 224 px spine | 30 px inset | 362 px drawer; push only with >=640 px remaining main area |
| 960–1279 | 74 px icon rail, labels available | 25 px inset | Temporary 362 px drawer |
| 640–959 | 74 px rail, labeled project tabs | 20 px inset; collapsed document index | One overlaid task |
| 320–639 | Hidden menu navigation | 16 px inset; one view | Full-screen task/dialog, inert background and focus containment |

Use content breakpoints for localization and long titles. Phone Atlas starts in Outline. Map remains available with pan, fit and selection, not a shrunken desktop. The outline exposes identical object IDs, relationships, states, decisions and allowed actions. Every drag action has a Move/Connect/Arrange menu alternative.

The document never scrolls horizontally; only the map pans. The title, phase, view tabs and one primary action stay discoverable. Plan contents collapse to a menu. Dynamic viewport units, safe-area insets and an anchored composer accommodate the virtual keyboard. Labels wrap/truncate accessibly; controls never overlap.

## Interaction and data contracts

### Truthful saved state — spec 41

The header follows the real save/flush contract: connecting, pending local changes, synchronizing, server-acknowledged saved, offline with retained work, or failed. An open WebSocket or sent frame is insufficient evidence of saving. Flush/leave/export/handoff waits for the acknowledged document revision. Retain recoverable errors and unsent work. The prototype's “Saved snapshot” only describes its sample data and must not become a runtime constant.

### Billing and roles — spec 40

Before an AI action, scope and payer are understandable: workspace key or permitted shared instance credit. A project owner sees authorized project usage and limits. **Global instance amounts and ceilings belong only to the instance operator.** A workspace owner is not automatically an instance operator.

Nonoperators see shared fallback availability and reached/reset state, using the UsageState.instance?.reached/resetAt boundary, without amounts. The prototype examples are explicitly a project budget. No sample amount enters production. AI paused by a budget does not disable editing, reading, human chat or exports.

### Conversation and agent work

- Distinguish queued, running, waiting for a person, stopped, failed and complete.
- Preserve actor, thread, scope and unsent drafts when drawers close.
- Do not pull a person from older messages to the latest stream. Provide “Latest” and a new-message count.
- Stop targets a real run; retry explains another charged attempt and respects server idempotency.
- A raised hand invites a perspective. It does not apply a change.
- Shared history stays shared. Private assistant data must not silently enter the project.

### Decisions, proposals and Git approval

Each approval names actor, source revision, exact changes, destination and consequence. A diagram proposal has a dashed boundary and “Proposal / not applied” label until server confirmation. Selection, proposal, saved and editing-locked are different states.

Git is a separate approval boundary: show repository, base branch, approving identity, file changes and whether the action creates a PR/issues, posts a review or merges. A stale reviewed version requires a refreshed preview. A viewer has no enabled approval control; the backend still authorizes every mutation.

### Keyboard and accessible space

One semantic action registry powers controls, menus, commands and shortcuts. Command search retrieves access-aware actions/objects. Shortcuts do not fire inside inputs/editors and platform notation adapts.

The study demonstrates Cmd/Ctrl+K (command), Cmd/Ctrl+J (conversation), Escape (return), Cmd/Ctrl+Enter (send). Its A/D/P/R keys are demo mappings. Production character shortcuts must be disabled/remappable or scoped to focused navigation under WCAG 2.1.4; no unchangeable global letter keys.

Provide skip links, labeled landmarks, visible focus, concise status live regions and a full semantic outline. Arrow-key graph navigation, roving toolbar focus and object search complement pointing. Announce source/relationship/target. Nothing essential exists only as color, position, animated cursor or transient emote.

Phone task dialogs trap focus, set background inert and restore the opener. Nonmodal desktop drawers do not trap focus. Verify reduced motion, keyboard-only use, 200% text enlargement, native form labels/errors and long German/English copy.

## Screen and state inventory

| Surface | Main job | Required edge states |
| --- | --- | --- |
| Sign-in/invite | Code/link/passkey/provider choice and return | Expired, unavailable, beta restriction, already joined, invalid invite |
| Workspace/project home | Resume project, start from brief/repo, review queue | Empty, no search match, archived/deleted, forbidden |
| Workspace switcher | Personal/team identity and membership | Loading, removed member, no team access |
| Atlas/Outline | Semantic map, frame, roadmap and selection | Empty, loading, offline, removed role, missing link, large graph |
| Decisions | Criteria, open/accepted/reopened/superseded decisions | No evidence, conflict, dependent plan needs review |
| Plan | Versioned document, scoped suggestions and tasks | Pending save, manual-edit conflict, outdated, compare/restore, long text |
| Conversation | Shared reasoning and explicit context | Long history, distant search result, streaming, queue/cancel/fail, unread |
| Inspector/reasoning | Why an object exists and its consequences | Missing/inaccessible evidence, prior version, recovery |
| Review inbox | Next authorized action | Empty, stale, already acted on, forbidden |
| Handoff/repository | Exact package and approval consequence | Disconnected, changed destination, stale base, failed job |
| Activity/return | Meaningful changes and waiting work | No new activity, partial load, pagination |
| Team/agents | Stable identity, role and tool scope | Removed agent, denied tool, disconnected assistant, model failure |
| AI/usage/settings | Authorized budget, model, key and payer | Invalid own key, project limit, global pause without amounts, reset |
| Members/account/security | Roles, sessions, MFA, export/deletion | Last owner, linking conflict, reauthentication, pending action |
| Shared read-only | Understand without private chat/person data | Expired/removed share, missing data, no mutation affordance |

Loaders use the final geometry; they are not fake empty screens. Errors identify the failure, preserve the work and offer a relevant next action. Destructive confirmations name the consequence.

## Concrete prototype

Open [prototype.html](prototype.html) through an HTTP preview server. It is independent HTML/CSS/JS with locally served fonts. No application database, paid AI account or remote font request is needed.

It demonstrates seven views, Map/Outline, one drawer, object-to-decision/plan routes, draft conversation, proposal review, team, package preview, sharing, themes, commands and phone navigation. Data is illustrative. Some controls explain their proposed flow instead of performing a backend action. It is a design study, not a replacement app or evidence of implemented features.

### Previews

- [Atlas light](preview-atlas-light.png)
- [Decision reasoning](preview-decision-light.png)
- [Atlas dark](preview-atlas-dark.png)
- [Decision collection](preview-decisions-light.png)
- [Plan](preview-plan-light.png)
- [Phone outline](preview-mobile-light.png)
- [Phone conversation](preview-mobile-conversation.png)

### Artifact validation

The prototype ran in real headless Chromium at 1440×1000 and 390×844 for visual
captures. A second browser sweep exercised all seven views in both themes at
320, 390, 768, 1024, 1280, 1440 and 1920 px. No page had document-level horizontal
overflow and no JavaScript page errors were recorded. Interaction checks passed
for view changes, drawer/theme switching, command filtering, draft retention
after closing, retention of sent sample messages, applying a proposal once,
phone navigation, mobile focus containment, Escape and opener focus restoration.
Desktop light/dark Atlas and phone Outline/Conversation captures were visually
inspected. Target-size, screen reader and 200% text checks remain application
acceptance work, not an inferred result from these captures.

These checks do not establish screen-reader conformance, real multiplayer, backend/provider behavior or cross-browser parity. Production type metrics above are normative; essential metadata must not be reduced to make a crowded screenshot fit.

## Staged implementation

1. **Foundation:** tokens, fonts, mark, geometry, themes, focus and shared primitives.
2. **Shell:** workspace/project navigation and one drawer controller with retained drafts/focus.
3. **Objects:** real Atlas/Outline, Decisions, Plan, Conversation, Activity and decision trail.
4. **Control surfaces:** authentication/account, sharing/settings, usage, agents and Git review.
5. **Acceptance:** 320/390/768/1024/1280/1440/1920, both themes/languages, 200% text, slow/failing save, role changes, budgets, large graphs and long chats.

UI work coordinates with specs 40–49 and linked-decision/onboarding work using explicit adapters. No runtime sample data, hard-coded “saved” labels or invented backend success substitutes for a feature. New primitives are shared; feature teams do not recreate button, field or dialog styling independently.
