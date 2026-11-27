# 43 Personal and Team Workspaces

## Goal
Everyone has a personal workspace and teams share named workspaces with members,
projects and settings. Existing projects migrate to their owner's personal
workspace. Project deletion removes relational data and durably schedules every
stored file for cleanup. The interface follows the existing Covibes Studio design.

## Design decisions
- Workspace roles use the existing viewer/editor/owner order. Editors can create
  projects; owners manage workspace names, invitations and members. A personal
  workspace belongs to one person and cannot be shared or deleted separately.
- Project permissions remain authoritative. Existing explicit project memberships
  survive migration and are not silently elevated by workspace membership.
- When a project enters a team workspace, current members without an explicit
  project membership receive the corresponding project role. These managed
  grants are tracked separately. Workspace role changes/removal update only
  those managed grants; explicit project grants and revocations remain explicit.
- A project creator remains an explicit owner. Changing a managed project role
  explicitly detaches it from workspace role management. All existing permission
  checks continue to operate on the effective project member rows.
- Workspace invitations are random, expiring, single-use tokens; only their
  hashes are stored. Email-bound invitations require a verified matching account.
  Viewer/editor invitations cannot create workspace owners.
- Membership changes and last-owner checks serialize on the workspace row.
  A team cannot lose its final owner while it exists. Only an empty team
  workspace can be deleted; projects must be moved or explicitly deleted first.
- Creating an account atomically creates its personal workspace. Existing project
  creation without a workspace remains backward compatible and uses that space.
- A project owner can move a project to a workspace they can edit. Moving removes
  managed grants from the old workspace and establishes grants for the new one,
  while preserving explicit memberships and the acting owner's access.
- Deleting a project is an explicit owner action. File-deletion records are
  enqueued in the same database transaction as metadata deletion. Cleanup is
  idempotent and retried after storage failures; failed work is never discarded.
- Account deletion must first resolve sole ownership of shared teams/projects.
  Private owned projects may be deleted after the account-deletion confirmation;
  shared content is transferred or blocks deletion with a useful conflict.
- Workspace AI keys are added by spec 44 and never stored in public settings.

## Implementation
- Migration 0047: workspaces, workspace members/invitations, managed project
  grants, project workspace association, personal-workspace creation/backfill,
  permission helpers, locked mutation functions and a durable file cleanup queue.
  All new tables have RLS and explicit grants/revocations.
- Shared workspace schemas/types; session-authenticated `/api/workspaces` routes
  for listing, creation, editing, invitations, membership and workspace projects.
- Backward compatible project creation and owner-only move/delete endpoints.
- Storage cleanup task and account-deletion preparation service. Deleted boards
  and active project connections are closed after relational deletion.
- Accessible behavior contracts and i18n for workspace selection/settings, using
  the existing Studio components and design tokens.

## Out of scope
- Payment, subscriptions and public workspace directories.
- Workspace-owned provider credentials and model settings (spec 44).
- Changing the established Git approval or explicit project-sharing boundaries.

## Dependencies
- Spec 42 accounts; existing project, collaboration and storage contracts.

## Checklist
- [ ] Existing users/projects migrate into exactly one personal workspace each.
- [ ] New users get a personal workspace; old project creation keeps working.
- [ ] Team creation, role changes, invitations, moves and removal enforce roles
  and last-owner invariants under concurrent requests.
- [ ] Managed project grants follow workspace membership without overwriting
  explicit project permissions or leaking another workspace's projects.
- [ ] Project deletion removes boards/metadata and retries every file cleanup
  after a storage failure; account deletion preserves shared data boundaries.
- [ ] RLS, API validation, generated types, focused tests, lint, types, formatting
  and production build pass; tracker and user-facing behavior are updated.
