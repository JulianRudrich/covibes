# 43 Workspace Interface and Account Integration

## Goal

People select their personal or team workspace, create and manage teams, invite members, accept workspace invitations, and move or permanently delete projects through the real spec 43 APIs. Existing project permissions remain authoritative. Spec 42 authentication invokes spec 43's actual account-deletion lifecycle and admits verified active workspace email invitations to the closed beta.

## Current owner direction (2026-11-24)

The owner restored the existing productive Covibes Studio design. This supersedes the earlier Signal Atlas direction for this work. Reuse the existing components, tokens, cards, headers and dialogs. Do not wait for a spec 55 foundation or introduce a replacement visual system. Account and login controls from spec 42 retain their behavior while their presentation is brought into the existing design.

## Decisions

- Keep an All projects selection so explicit project access outside one's workspace memberships remains reachable. A workspace selection is a validated URL search value. Workspace-specific cards are the intersection of real workspace project IDs and the existing rich project summaries; no card metadata is invented.
- Personal workspaces can be renamed but cannot be shared, left or deleted separately. Team owners manage settings, invitations and roles; editors and owners can create projects. A project owner alone may move/delete that project, regardless of workspace role.
- Workspace project creation sends the currently chosen project language explicitly. Existing creation with no selected workspace keeps its personal-workspace behavior.
- Invitation creation yields a token once. The current API does not send mail or expose a preview. The interface clearly asks the owner to copy/share the new link, never reconstructs tokens from invitation listings, and never claims a mail was sent. An optional verified-email restriction is explained.
- The authenticated invitation page preserves the token through sign-in and asks for an explicit acceptance. It displays only facts the server supplies, handles wrong-identity and expired/used/revoked failures, and selects the returned workspace after success.
- Member role/removal changes await server success before changing the display. A conflict explains final-owner protection and explicit project access is not promised to disappear with workspace membership.
- Only empty team workspaces can be removed. Accessible project counts do not prove the workspace is empty; a server conflict remains actionable. Permanent project deletion requires the exact, case-sensitive project name, without client trimming.
- Mutations refresh workspace counts, memberships, invitations and affected project caches. Loading/failure states never reuse another workspace's project list as if it were current.
- Production and test initialization bind the actual read-only account-deletion preflight and post-commit connection closure. Database triggers perform atomic relational cleanup and durable file cleanup. Beta signup trusts only a proved exact email on an active workspace invitation.

## Implementation

- Integrate the committed spec 43 backend/shared types onto the spec 42 branch.
- Add typed TanStack Query queries/mutations for the existing workspace, membership, invitation and project lifecycle endpoints.
- Add workspace selection, team creation/settings and selected-workspace project creation to the existing project index.
- Add a workspace settings route for name, members, invitations, leaving and empty-team deletion. Add an authenticated workspace invitation route and preserve its safe sign-in return.
- Add owner project move/delete controls through existing dialogs, reachable from project cards and the project settings surface.
- Bring the functional spec 42 pages into existing Studio headers/cards; retain every primary login method, authenticator/recovery flow, pending/error state and keyboard focus behavior.
- Add English/German interface text and meaningful HTTP-contract UI tests. Extend real PostgreSQL/auth/runtime tests for verified workspace-beta access and built-in deletion lifecycle integration.

## Checklist

- [ ] Selection, creation and project filtering use real API contracts and preserve explicit project access.
- [ ] Team/personal and viewer/editor/owner controls match server authority; errors, retry and last-owner conflicts remain usable.
- [ ] Invitations show the one-time share link, owner-only controls and truthful email restriction; acceptance survives sign-in and distinguishes unavailable identity/token failures.
- [ ] Project move targets only editable workspaces; exact-name deletion navigates/refreshes only after confirmed server success.
- [ ] Actual auth runtime/test hooks enforce account ownership, atomic cleanup and post-commit connection closure; proved active workspace invitations pass the closed-beta gate.
- [ ] Studio presentation, phone layout, labels, keyboard access, focus and German/English flows remain coherent.
- [ ] Focused UI/security/API tests, full affected suites, lint, types, generated DB types, formatting and production build pass. Tracker and integration notes are current.
