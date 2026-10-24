# 36d Workspace Dialogs and Screens

## Goal
Every dialog and screen of the workspace that 36b and 36c left out takes on the design "Covibes Studio": the share dialog with invitations and roles, the project settings, the notifications and "Seit du weg warst", the read-only view, the plan editor with its suggestions, versions and roadmap, the usage dialog, the Git dialogs, the history and the error pages. With it every entry under "Derived looks" in `ui-context.md` is confirmed or replaced, which is the "done when" of spec 36.

Fourth part of spec 36 (the design pass).

## Design decisions
- **The coding agent derives the looks** from the studio handoff and the drafts of 36c (owner decision, 2026-10-24: the rest of the design pass is the coding agent's). There is no draft for these dialogs; they follow the building blocks the handoff and 36c set: round pills, soft surfaces without borders, display titles, the canvas color for a side column.
- **Behavior and texts stay.** Every action, state and i18n text keeps working; texts are only added where a new label is needed.
- **Shared building blocks** (new in `components/ui/`), so the dialogs look alike and stop styling their own controls:
  - **Select:** the native `select` (it stays native for keyboard and screen readers) as a round pill on the panel with `border-strong`, a 14 px chevron at the right, the border ink on focus; sizes S (28 px) and M (32 px), and a field size (36 px, `rounded-md`) for forms next to inputs.
  - **Checkbox and Radio:** native inputs drawn anew: 16 px, the checkbox `rounded-xs` with `border-strong`, checked in ink with an `on-ink` check; the radio round, checked as an ink ring around a dot of the panel color. Focus as every control (`outline: 2px solid ink`, 2 px off).
  - **Choice:** a radio or checkbox with a label in medium weight and one gray line below, as a card (`rounded-card`, 1 px `border`) that turns to the subtle surface on hover and gets an ink border while chosen. It replaces the plain rows of the project settings, the agent editor's switch for drawing and the language of a new project.
  - **Segmented switch:** the visibility switch of the agent editor (spec 36c) becomes a building block: the track on `bg-subtle`, the chosen item a panel pill with the block shadow. The usage dialog's month switch and the three views of the plan versions use it.
  - **Dialog section:** a heading in the display font (`text-display`, 15.5 / 600) with an optional gray hint below and an action at the right; sections of a dialog stand 20 px apart without dividers.
  - **Inset:** a soft box on the subtle surface with the card radius (16) and no border, for link boxes, the account and repository cards, open invitations, file lists and comparison areas inside dialogs. Rows inside dialogs keep thin soft hairlines (`border-subtle`).
  - **Dialog foot:** the actions at the bottom right as pills, the main one in ink; a destructive action on the left as a red ghost pill; the foot stands 24 px below the content.
- **Share dialog** (520 px): sections "Einladen", "Offene Einladungen", members and "Nur-Lese-Link"; the invite row with a 36 px field, the role select and "Einladen" as pills; invitations as inset rows with a 28 px round icon tile; members with 32 px avatars, the role select as a pill and the Git approval as a checkbox; link boxes as insets with the mono field.
- **Project settings** (520 px): four sections with choice cards: stance, decision process, the switches for agents and the language.
- **Notifications:** the bell's popover 380 px with radius 18, the rows with a 32 px round icon tile on the subtle surface, the unread dot in ink; "Seit du weg warst" keeps the section look of 36b, its facts as rows with a 28 px round icon tile.
- **Read-only view:** the top bar of the main screen (64 px on the app background, logo and wordmark, "/", the project name, the badge "Nur lesen" and "Stand 15:19" at the right with the language switch); the canvas and the overview as panels in the columns `minmax(0,1fr) 300px`, gap 12, padding `0 12px 12px`; the board tabs as the floating pills of the main screen.
- **Plan editor:** the plan sits on the canvas color with the document as a sheet on the panel (radius 24, `shadow-panel`, at most 760 px wide, padding 48 56); the formatting toolbar becomes a floating pill like the canvas toolbar above the sheet; notes above the document (outdated, generating, failed) are insets; suggestions keep the proposal look (dashed agent border on its tint) with radius 20 and pill buttons; the versions dialog uses the segmented switch and an inset for the comparison.
- **Roadmap:** milestones as cards in one panel box with radius 24 and the panel shadow instead of the bordered white box, the number as a 22 px ink square with radius 7, tasks as cards on the subtle surface with radius 12.
- **Usage dialog** (580 px): the month switch as the segmented switch, the meter 8 px round as before, figures as display numbers; bars and columns as before.
- **Git dialogs** (repository, GitLab account, issues, merge requests, review, Git log, package): sections, insets for the account and repository cards and for file lists, checkboxes and pills of the shared blocks; the review's verdict as a notice with the card radius.
- **History:** the dialog 600 px; entries with hairlines, the element chips as round pills (22 px) on the subtle surface; the rest as derived in 38a and 38b.
- **Error pages** (not found, unavailable) and the dead read-only link: `PageMessage` of 36c with their action as a 46 px pill.
- **Menus** (project, account, export): items with a 15 px Lucide icon in `text-3` in front, 34 px high.

## Implementation

### Web: building blocks (`apps/web/src/components/ui/`)
- New `select.tsx`, `checkbox.tsx` (`Checkbox`, `Radio`), `choice.tsx`, `segmented.tsx`; `dialog.tsx` gets `DialogSection` and `DialogFooter`; `card.tsx` gets `Inset`; `dropdown-menu.tsx` gets an `icon` on its items.

### Web: dialogs and screens
- `features/share/share-dialog.tsx`, `share-view-page.tsx`, `shared-board.tsx`
- `features/workspace/project-settings-dialog.tsx`, `workspace-header.tsx` (menu icons)
- `features/notifications/notification-bell.tsx`, `features/away/since-you-were-away.tsx`
- `features/plan/*`, `features/roadmap/*`
- `features/usage/usage-dialog.tsx`
- `features/git/*`, `features/export/package-dialog.tsx`, `package-specs.tsx`, `package-suggestion.tsx`, `export-menu.tsx`, `plan-export-menu.tsx`
- `features/canvas/board-history.tsx`, the delete dialog in `board-tabs.tsx`
- `features/decisions/decisions-overview.tsx` and the decision dialog in `decisions-section.tsx`
- `features/projects/create-project-dialog.tsx`, `features/agents/agent-editor.tsx` (the shared choice, select and segmented switch)
- `features/account/account-menu.tsx`, `features/errors/error-pages.tsx`

### i18n
- No new texts expected; if a label is needed it goes in German and English.

### Docs
- `ui-context.md`: the new building blocks, the dialogs and screens as built, and every entry under "Derived looks" marked as confirmed or replaced.

## Out of scope
- the mobile view (36e)
- new behavior in any dialog
- own shapes per diagram type and the building block overview page (they stay under "Still to be designed" unless this part settles them)

## Dependencies
- Specs 36a, 36b and 36c; the specs of the dialogs that change their looks: 16, 21–23, 25–31, 33, 38

## Checklist
- [ ] The shared building blocks exist and every dialog of the workspace uses them; no dialog styles its own select, checkbox or radio.
- [ ] Share dialog, project settings, notifications, "Seit du weg warst", the read-only view, the plan editor with suggestions, versions and roadmap, the usage dialog, the Git dialogs, the history and the error pages show the studio look in light and dark at 1440 × 900, with every action as before.
- [ ] Text reaches 4.5:1 on its background in both themes on the changed screens.
- [ ] Every entry under "Derived looks" in `ui-context.md` is confirmed or replaced.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm test`, `pnpm db:types:check` and `pnpm build` pass; `progress-tracker.md` and `ui-context.md` are updated.
