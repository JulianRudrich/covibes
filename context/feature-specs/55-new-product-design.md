# 55 New Product Design: Signal Atlas

## Goal

Replace the existing Covibes visual design and workspace composition with the independently researched Signal Atlas direction. Deliver a dominant planning surface, stable object navigation, one contextual drawer, and visible links from reasoning to implementation work throughout the real application.

The owner explicitly requested a completely new design on 2026-11-17 and instructed the team to ignore the existing design. This supersedes earlier instructions to derive screens from the old Studio handoff. Product behavior, authorization, approval and persistence guarantees remain binding.

## Design decisions

- Normative handoff: [Signal Atlas](../design/next/README.md). Concrete composition and interaction reference: [independent prototype](../design/next/prototype.html). Previous design references are not inputs.
- The designer team studied 18 repositories and 16 web products using primary UI sources and dated discovery windows. Ranking is a popularity signal, not a usability measurement; limitations are documented.
- Signal Atlas was selected over independent Decision Journal and Momentum Desk directions for the combined spatial, conversational and decision jobs.
- New identity: ink navigation, cool light/dark surfaces, indigo actions, restrained chartreuse, Space Grotesk/Inter, rectangular controls and an original bracket/connection mark.
- Project views: Atlas, Decisions, Plan & handoff, Activity. Workspace navigation: Projects, Review inbox, Search, settings/account. Project phase remains independent of view selection.
- Conversation, Inspector, Decision, Review, Team and Handoff share a single drawer controller. Phone presents one focused task and a clear return route.
- Preserve and integrate the actual product. Static sample screens, generic dashboards and fake successful state do not implement the redesign.

## Implementation

### 55a. Foundation and shared primitives

- Implement semantic light/dark tokens, typography, geometry, elevation, selection, focus and reduced motion from the handoff.
- Self-host the OFL fonts with license/provenance; no runtime third-party font request.
- Replace the mark/wordmark and shared controls: buttons, icon actions, fields, labels, selects, checkboxes, tabs, menus, dialogs/drawers, alerts, badges and avatars.
- Compatibility aliases may support migration; new components cannot introduce obsolete hard-coded values.
- Human/AI authorship stays explicit. A specialist's role/name is distinct from model/provider and run state.

### 55b. Workspace/project shell

- Implement the new workspace spine, switcher, project hierarchy, command entry and responsive frame using real APIs.
- Show the complete project-view navigation once per breakpoint: labeled spine
  at 1280 px and above, labeled project tabs with compact rail/menu below it.
- Preserve board IDs, deep links, browser back/forward, selection, scroll and camera state.
- Use one controlled context drawer with explicit type/object. Retain unsent messages/forms across close and inspection changes; restore focus to the opener.
- Below 640 px, task drawers are labeled dialogs with inert background, focus containment, Escape/back and restoration. Desktop nonmodal inspection remains nonmodal.
- Implement 224 px spine, 74 px rail and phone menu/content breakpoints. Use dynamic viewport units and safe areas.

### 55c. Core planning surfaces

- Atlas mounts real boards, semantic nodes/relationships, frames and roadmap. Preserve editing, locks, authorship, selection/proposal states, undo and collaboration.
- Add a real non-spatial Outline with equivalent identities, relationships, permissions and actions. Phone starts in Outline; Map supports fit, pan and selection.
- Decisions expose criteria, open/accepted/reopened/superseded states, rationale, alternatives and evidence. Link the trail to actual data; show honest unlinked/unavailable states.
- Plan is a focused editor/reader with accessible contents, real saving, suggestions, versions/diffs, manual-edit preservation, task assignment and reviewed handoff.
- Conversation preserves history, mentions/references, uploads, debate, raised hands, streams, queues/cancel/errors and unread scrolling. Scope and billing source are visible before AI work.
- Activity and Review use real source events and action permissions. Badges count only work the person can act on.

### 55d. Account, collaboration and repository

- Apply the shared system to authentication/invitations, account/security, workspace/project creation/settings, agents/custom knowledge, sharing/members, notifications and usage.
- Repository dialogs show exact destination, identity, reviewed revision, changes and consequences. Canvas acceptance and Git authorization remain separate.
- Read-only sharing is an intentional reading experience without private chat/person data or enabled mutations.
- Implement loading, empty, slow, offline, failed, expired, stale and forbidden states.

### Data contracts

- **Spec 40:** global instance amounts and ceilings are operator-only. Workspace ownership does not grant operator access. Nonoperators see only authorized project/workspace usage plus shared-fallback availability/reached/reset state. No prototype amount becomes runtime data.
- **Spec 41:** saved status comes from acknowledged persistence, not an open socket. Flush, export, handoff and navigation use the real save/flush boundary and retain work across failure.
- **42–46:** coordinate real account/workspace/provider/assistant/GitHub interfaces. Do not create parallel fake stores or bypass authorization.
- **47–49:** reuse real history/search, large-board and lazy-loading capabilities. Login must not eagerly import every editor.
- Linked decisions, repo start, onboarding, memory and evaluation use their actual backend readiness. An unfinished feature has an explicit unavailable state, never fabricated success.

### Interaction and accessibility

- Shared semantic actions power visible controls, menus, commands and keyboard. Shortcuts do not intercept input/editor typing.
- Single-character keys are remappable/disableable or confined to focused navigation; no permanent page-global letter shortcuts.
- Graph actions have keyboard/menu alternatives to dragging, labeled relationships, focus distinct from selection and a non-spatial list.
- Ordinary text reaches 4.5:1, large text and required control/focus boundaries 3:1. Essential state is not color-only.
- Essential metadata is at least 10 px desktop / 11 px phone. Verify 200% text enlargement, 16 px mobile fields and 44 px touch targets.
- Dialog names/focus, concise live announcements, native field labels/errors, reduced motion, German and English are part of implementation.

## Out of scope

- Using the old handoff, palette, fonts or persistent three-surface composition as a visual template.
- Copying proprietary reference branding, assets or stylesheets.
- Replacing backend authorization, approval, accounting or persistence guarantees.
- Treating the static prototype as a production application.
- Enabling paid external services, public source visibility or a changed application audience.

## Dependencies

- Product requirements and dry-run behavior define functional meaning.
- New handoff and both research reports under context/design/next and context/research.
- Account/workspace/AI/Git/save interfaces from 40–49, staged through coordinated adapters.
- Browser acceptance 34 runs against the integrated new UI. Launch preparation 35 remains separately verifiable.

## Checklist

- [ ] Independent tokens, fonts, mark and primitives work in both themes; old references are superseded.
- [ ] Real workspace/project navigation, deep links, commands and one drawer retain drafts, selection and focus.
- [ ] Atlas/Outline, Decisions, Plan, Conversation, Activity and Review preserve all actual capabilities and permissions.
- [ ] Account, collaboration, agents, settings, usage, repository and shared reading surfaces use the new system.
- [ ] No runtime sample data, global budget leak, fake saved label or invented backend success.
- [ ] Keyboard/touch, outline, dialogs, restoration, reduced motion, long chat and 200% text pass meaningful checks.
- [ ] 320, 390, 768, 1024, 1280, 1440 and 1920 px pass in German/English and light/dark without document-level horizontal overflow.
- [ ] Slow/failed save, reconnect, queued/failed/cancelled runs, paused budgets, viewers, stale approval and missing references are verified.
- [ ] Existing behavior tests are adapted to intended semantics rather than weakened; browser flows and captures cover the shell and highest-risk dialogs.
- [ ] Lint, types, format, tests, database types, build and production audit pass; CI/tracker reflect actual completed work.

## Design artifact validation

The independent prototype was captured at 1440×1000 and 390×844, then all seven
views were exercised in both themes at 320, 390, 768, 1024, 1280, 1440 and 1920 px.
There were no page errors or document-level horizontal overflow. Command search,
draft/sent-message retention, one-time proposal application, mobile focus
containment, Escape and focus restoration passed. Token contrast calculations
are in the handoff. This validates the design artifact, not completion of the
application checklist.
