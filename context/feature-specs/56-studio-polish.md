# 56 Studio Polish for Search, Board Overview and Arrows

## Goal
The elements that specs 47 and 48 added without a visual treatment look and behave like the rest of Covibes Studio, and two defects found while capturing the repository screenshots are gone. The project search opens from the chat as a Studio control, the history notice and the board overview use the Studio tokens in both themes, arrow labels sit on top of their lines, and the own avatar shows its full label.

## Background
Specs 47 and 48 defined behavior only; their visual treatment was to come from spec 55, which the owner closed on 2026-11-24 when Covibes Studio was restored. Since then the search is a native disclosure with a browser triangle, the history notice is plain underlined text, and the minimap of React Flow keeps its default white look, which is a glaring box in the dark theme. While capturing the screenshots on 2026-11-24 two more defects showed: arrows are drawn through their mono labels, and the own avatar in "In the room" reads "Yo", because the English label "You" does not fit.

## Design decisions
- Everything follows `context/ui-context.md`: tokens only, round controls, `rounded-panel` and `shadow-float` for floating surfaces, the Studio input look of the project list search. No new color tokens; light and dark come from the existing ones.
- **Project search.** A round ghost icon button with a magnifier opens it: in the chat header next to the status pill on wider screens, and as a slim row at the top of the chat on a phone, where the header is hidden. Open, it is a panel below the header with a search field in the project list's look (magnifier, rounded, an ink ring on focus), a close button, and the results. Enter searches; nothing is sent while typing (the bounds of spec 47 stay: 2 to 200 characters). Escape or the close button closes it and gives the focus back to the button. The panel keeps the last results while it is open.
- **Results.** Each result is one row: the kind as a small pill (Message, Decision, Canvas, Plan), the title in medium weight and the snippet in `text-3`, at most two lines. Rows highlight on hover and focus. A count says how many were found; no result says so with the query; a failed search says so in `danger`. The list scrolls inside the panel, which never grows past 45 % of the chat's height.
- **History notice.** While the chat shows a message from the history, a pill bar on `bg-subtle` says so, with "Back to latest messages" as a small ghost pill.
- **Board overview.** The minimap floats at the lower right like the toolbar: the panel color, `rounded-panel`, `shadow-float`, 16 px from the edges. Blocks show in `border-strong`, frames in their frame color with the frame border, notes in the note color; the area outside the view is dimmed with `bg-subtle` and the view is outlined in `text-3`. On a phone, where the canvas is for reading, the overview stays hidden; "Show all" navigates there.
- **Arrow labels.** Labels render above the arrows' layer, so a line ends at the label pill instead of crossing the text; blocks and notes stay above labels.
- **Own avatar.** A label of three letters, such as the English "You", gets a smaller size step so it fits the circle at every avatar size. The German "Du" keeps its size.

## Implementation
- `apps/web/src/features/chat/project-search.tsx`: the open/closed state, the trigger as `IconButton`, the panel, field, results and states as described; the search request is unchanged.
- `apps/web/src/features/chat/chat-panel.tsx`: the trigger in the `PanelHeader`; the phone row; the history notice as a pill bar.
- `apps/web/src/styles/layout.css`: drop the rules for the native disclosure and the underlined notice.
- `apps/web/src/features/canvas/canvas-panel.tsx`: `MiniMap` with token colors per node type, mask, view outline, class names for the floating look, hidden below 768 px.
- `apps/web/src/features/canvas/canvas-arrow.tsx`: the label wrapper gets the stacking order between arrows and nodes from `LAYER`.
- `apps/web/src/components/ui/avatar.tsx`: a smaller text step for three-letter labels.
- `apps/web/src/i18n/en.json` and `de.json`: the texts for opening and closing the search, the field's placeholder and the empty result.
- `context/ui-context.md`: the derived looks of the search, the history notice and the board overview.

## Out of scope
- Search behavior, ranking, sources and the API of spec 47; navigation of spec 48.
- A search on the project list or across projects.
- Other screens and the archived Signal Atlas design.

## Checklist
- [ ] The search opens from the chat header and from the phone row, searches with Enter, shows results with kind, title and snippet, and opens a result.
- [ ] Escape and the close button close the search and return the focus to its button; a failed and an empty search say so.
- [ ] The history notice is a pill bar with a ghost pill to return to the latest messages.
- [ ] The board overview has the Studio look in light and dark and is hidden on a phone.
- [ ] Arrow labels sit above their lines and below blocks and notes.
- [ ] The own avatar shows "You" in full at every size; "Du" is unchanged.
- [ ] Web tests cover the search's states, focus return and result selection, the avatar's text step and the label's stacking order.
- [ ] Lint, type checks, formatting, web tests and the production build pass; the screens are checked in the browser in both themes and on a phone.
