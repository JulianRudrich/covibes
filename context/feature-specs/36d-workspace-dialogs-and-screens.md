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
  - **Choice:** a radio or checkbox with a label in medium weight and one gray line below, as a card (`rounded-card`, 1 px `border`) that turns to the subtle surface on hover and gets an ink border while chosen. It replaces the plain rows of the project settings and the agent editor's switch for drawing.
  - **Segmented switch:** the visibility switch of the agent editor (spec 36c) becomes a building block: the track on `bg-subtle`, the chosen item a panel pill with the block shadow. The language of a new project uses it; for views that are not a form value (the usage dialog's months, the three views of the plan versions) the same look holds toggle buttons with `aria-pressed`.
  - **Dialog section:** a heading in the display font (`text-display`, 15.5 / 600) with an optional gray hint below and an action at the right; sections of a dialog stand 20 px apart without dividers.
  - **Inset:** a soft box on the subtle surface with the card radius (16) and no border, for link boxes, the account and repository cards, open invitations, file lists and comparison areas inside dialogs. Rows inside dialogs keep thin soft hairlines (`border-subtle`).
  - **Dialog foot:** the actions at the bottom right as pills, the main one in ink; a destructive action on the left as a red ghost pill; the foot stands 24 px below the content.
- **Share dialog** (520 px): sections "Einladen", "Offene Einladungen", members and "Nur-Lese-Link"; the invite row with a 36 px field, the role select and "Einladen" as pills; invitations as inset rows with a 28 px round icon tile; members with 32 px avatars, the role select as a pill and the Git approval as a checkbox; link boxes as insets with the mono field.
- **Project settings** (520 px): four sections with choice cards: stance, decision process, the switches for agents and the language.
- **Notifications:** the bell's popover 380 px with radius 18, the title in the display font, "Alle als gelesen markieren" as a small ghost pill, the rows with radius 16 and a 32 px round icon tile on the subtle surface, the unread dot in ink; "Seit du weg warst" keeps the section look of 36b, its facts as rows with a 24 px round icon tile.
- **Read-only view:** the top bar of the main screen (64 px on the app background, logo and wordmark, "/", the project name, the badge "Nur lesen" and "Stand 15:19" at the right with the language switch); the canvas and the overview as panels in the columns `minmax(0,1fr) 300px`, gap 12, padding `0 12px 12px`; the board tabs as the floating pills of the main screen.
- **Plan editor:** the plan sits on the canvas color with the document as a sheet on the panel (radius 24, `shadow-panel`, at most 760 px wide, padding 40 48); headings in the display font; the formatting toolbar becomes a 44 px pill on the panel with the block shadow above the sheet; notes above the document (outdated, generating, failed) are cards on the panel with the block shadow, like blocks on the canvas; suggestions keep the proposal look (2 px dashed agent border on its tint) with radius 20, the section title in the display font; the versions dialog has its rows with radius 16, the three views in the segmented look and the comparison in an inset.
- **Roadmap:** milestones as cards in one panel box with radius 24 and the panel shadow instead of the bordered white box, the number as a 22 px ink square with radius 7, tasks as cards on the subtle surface with radius 12.
- **Usage dialog** (580 px): the months in the segmented look, the amount 28 px in the display font, the meter 8 px round as before, the three figures as insets with display numbers, the headings "Je Agent", "Je Person", "Je Tag" as section titles; bars and columns as before.
- **Git dialogs** (repository, GitLab account, issues, merge requests, review, Git log, package): sections, insets for the account and repository cards and for file lists, checkboxes and pills of the shared blocks; the review's verdict as a notice with the card radius.
- **History:** the dialog 600 px; entries with hairlines, the element chips as round pills (22 px) on the panel with the stronger border, removed ones on the subtle surface; the tag "Zurücknahme" a round pill; the rest as derived in 38a and 38b.
- **Decisions:** the dialog of a decision 480 px with the status and value in an inset at the top, the value in the display font; the decision log with hairlines between the entries; the board's delete dialog keeps its two pills.
- **Error pages** (not found, unavailable), the dead read-only link, the invitations that no longer work and the card of a project one left: `PageMessage` of 36c with their action as a 46 px pill ("Zur Startseite" and the like as a secondary pill, "Erneut versuchen" as the primary one); the text in body size.
- **Menus:** items 34 px high; the project menu gets a 15 px Lucide icon in `text-3` before every entry (back arrow, settings, branch, merge, log, gauge), like the account menu's GitLab and sign-out entries. The export menus stay text, since they list formats.

## Implementation

### Web: building blocks (`apps/web/src/components/ui/`)
- New `select.tsx`, `checkbox.tsx` (`Checkbox`, `Radio`), `choice.tsx`, `segmented.tsx` (`Segmented`, `SegmentedToggle`); `dialog.tsx` gets `DialogSection`, `DialogFooter` and `DIALOG_SECTION_TITLE`; `card.tsx` gets `Inset`; `dropdown-menu.tsx` items are 34 px and color their icons; `page-message.tsx` gets `PageMessageLink`; the button variants move to `button-variants.ts`, so a link can take a button's look.

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
- [x] The shared building blocks exist and every dialog of the workspace uses them; no dialog styles its own select, checkbox or radio.
- [x] Share dialog, project settings, notifications, "Seit du weg warst", the read-only view, the plan editor with suggestions, versions and roadmap, the usage dialog, the Git dialogs, the history and the error pages show the studio look in light and dark at 1440 × 900, with every action as before.
- [x] Text reaches 4.5:1 on its background in both themes on the changed screens.
- [x] Every entry under "Derived looks" in `ui-context.md` is confirmed or replaced.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm test`, `pnpm db:types:check` and `pnpm build` pass; `progress-tracker.md` and `ui-context.md` are updated.

## Implementation notes (2026-10-24)
- **Building blocks:** `Select`, `Checkbox`, `Radio`, `Choice`, `Segmented`, `SegmentedToggle`, `DialogSection`, `DialogFooter`, `DIALOG_SECTION_TITLE`, `Inset` and `PageMessageLink` are new; the button variants moved to `button-variants.ts` (a file of their own, so fast refresh keeps working and a link can take a button's look). Every select, checkbox and radio of the workspace's dialogs uses them; the agent editor and "Neues Projekt" of 36c use them too (the switch for drawing as a choice, the model as a select, the visibility and the project language as the segmented switch).
- **Segmented vs. toggle:** a form value (visibility, language) keeps radio buttons; a view (the usage months, the views of the plan versions) keeps toggle buttons with `aria-pressed`, so both stay what screen readers and the tests expect.
- **Dialogs:** share dialog, project settings, usage, plan versions, history, decisions and the log, the Git dialogs (repository, GitLab account, issues, merge requests, review, log, sync), the package dialog with its specs and suggestions, the delete dialog of a board; section titles, insets, hairlines and feet as in `ui-context.md`.
- **Screens:** the plan as a sheet on the canvas color with a pill toolbar; the roadmap box; the read-only view in the main screen's layout (its overview is now an `aside` like the workspace's, so one test asks for the role `complementary`); the notification popover; the facts of "Seit du weg warst"; the message pages with 46 px pill actions; the project menu with icons.
- **Derived looks:** every entry in `ui-context.md` starts with "Confirmed" or "Replaced". The coding agent also settled the rest of "Still to be designed": the diagram types keep the block cards of spec 12, the building block overview is `ui-context.md` with `components/ui/` (no product page), the variant comparison keeps its look of spec 17. Only the mobile view (36e) is open.
- **Verified** with the running `pnpm dev` and the browser as olga at 1440 x 900: share dialog (dark and light, with a read-only link made and switched off again), project settings and usage (dark), plan with the sheet and toolbar, versions and history (light), repository dialog and notifications (light), the read-only view (light) and the not-found page. The usage dialog was too tall at 900 px and got a lower scroll limit. The theme was switched in the page only, so the device's choice stayed.
- **Contrast:** only token pairs that spec 36a checked (`text`, `text-2`, `text-3` on panel, subtle and canvas, `on-ink` on ink); no new colors.
