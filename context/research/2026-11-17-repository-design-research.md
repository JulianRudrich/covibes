# Repository design research for a new Covibes experience

Research date: **17 November 2026, Europe/Berlin**. The final GitHub Trending and repository metadata refresh was captured at **13:34 CET / 12:34 UTC**. Earlier observations from the same morning were superseded because the list order changed.

This is research for a new product interface. Existing Covibes visual design, design handoffs, screenshots and UI components were not used as references for this research. The relevant product requirements are shared project planning, human and agent discussion, structured diagrams, explicit decisions, a versioned plan, and a reviewed handoff to implementation.

## Main finding

The strongest transferable patterns are an **action-oriented review inbox** from Plannotator, **an artifact beside its originating conversation** from LibreChat, **parallel alternatives on a canvas** from Onlook, **a quiet reading and writing mode** from DeepTutor and Docmost, and **explicit operation and approval states** from T3 Code. These patterns support different moments of planning. Combining their useful behavior does not require copying their palettes, brands, component libraries or page layouts.

GitHub attention is a discovery signal. It does not establish usability, accessibility, visual quality, adoption, or suitability for Covibes. In particular, many prominent repositories contain skills and command-line tools rather than an application interface. Those are not treated as visual product precedents.

## Method and limits

Sources were inspected in this order:

1. Live, unfiltered [GitHub Trending daily](https://github.com/trending?since=daily), [weekly](https://github.com/trending?since=weekly), and [monthly](https://github.com/trending?since=monthly) pages. The web lookup tool could not open these URLs; direct public HTTP retrieval succeeded. Positions below come from the displayed article order, not from sorting repositories by the displayed gains.
2. Dated historical snapshots and monthly archives, explicitly identified as third-party sources.
3. Official GitHub repository metadata and current primary READMEs, following repository redirects.
4. Official product documentation, demos and screenshots. Thirteen of the eighteen references have an original app screenshot or app screenshot crop that was actually viewed. Five have documentation or demo-page evidence only and are marked accordingly.

The screenshot assessment is a visual and information-architecture review, not a completed hands-on usability study. A screenshot cannot prove keyboard operation, screen-reader support, responsiveness, speed, multiplayer correctness, or the accuracy of generated work. Strengths, weaknesses and Covibes applications below are the researcher's design judgments unless explicitly described as documented behavior.

Some screenshot CDNs returned HTTP 403. Where an official documentation repository contained the same product material, that primary source was inspected instead. AFFiNE, Plane and LobeHub imagery could not be confidently inspected; their entries make no claims about observed visual polish. Astryx's live sandbox and OpenBot's application-preview page were read as documented interaction references, not as tested application sessions.

Screenshots are current repository references, not necessarily recently captured images. The drawDB image visibly contains a 2024 save timestamp. It is useful evidence of a structural pattern, not proof of drawDB's latest screen design. Univer and Onlook supply promotional composites containing real app crops; observations apply to the visible crop. No installed package or framework change is recommended by this report.

## The requested time windows

| Requested period | Calendar interpretation in Berlin | Evidence available | What can be claimed |
| --- | --- | --- | --- |
| This week | Monday 16 November through Tuesday 17 November so far | Dated 16 November daily archive and live 17 November GitHub list | Relevant daily appearances during this incomplete week; no completed weekly ranking |
| Last week | 9–15 November inclusive | Seven individually dated daily snapshots | Appearance frequency among the evaluated references; not a weekly star-growth ranking |
| Last month | 1–31 October inclusive | Third-party October archives and dated October daily snapshots | Attributed discovery signals; no independently verified complete GitHub calendar-month ranking |
| GitHub `since=weekly` | Rolling recent-week view captured 17 November | Live GitHub page | The positions and gains displayed at capture time; not the calendar week above |
| GitHub `since=monthly` | Rolling recent-month view captured 17 November | Live GitHub page | The positions and gains displayed at capture time; not October's calendar-month result |

GitHub's daily list is also a live ranking rather than a Berlin-midnight measurement. A displayed gain should not be interpreted as an independently reconstructed count of stars between two exact local timestamps.

### Current primary snapshot, 17 November at 13:34 CET

The following are the relevant entries from the unfiltered pages, not a claim that these are the eight best-designed repositories in the world.

| Repository | Daily position / displayed gain | Rolling weekly position / displayed gain | Rolling monthly position / displayed gain |
| --- | --- | --- | --- |
| backnotprop/plannotator | #11 / +691 today | #2 / +2,325 this week | #8 / +2,848 this month |
| dream-num/univer | #5 / +1,776 today | — | — |
| getarcaneapp/arcane | #6 / +46 today | — | — |
| meta/astryx | — | #3 / +10,939 this week | — |
| we-promise/sure | — | #4 / +4,679 this week | — |
| pingdotgg/t3code | — | — | #3 / +34,691 this month |
| HKUDS/DeepTutor | — | — | #7 / +18,533 this month |

Source: the three live GitHub pages linked in the method. An em dash means not observed on that unfiltered page at capture time. It does not mean zero growth.

### Calendar evidence for this week and last week

The [16 November daily snapshot](https://trend.ondo.sh/github/2026-11-16/en.html) reproduces Plannotator at #2, Univer at #3 and Arcane at #5. Their continuing presence in the live 17 November list makes them useful leads for this incomplete calendar week. The snapshot is a third-party reproduction of GitHub's list, not a GitHub historical endpoint.

For 9–15 November, the daily-list sections of all seven dated Trend archives were read. The following counts are calculated from those seven observations **within this report's selected references**:

| Reference | Days present | Observed daily positions by date |
| --- | --- | --- |
| Sure | 5 of 7 | 10 Nov #6; 11 Nov #7; 12 Nov #5; 13 Nov #5; 14 Nov #12 |
| Astryx | 4 of 7 | 9 Nov #2; 10 Nov #1; 11 Nov #1; 12 Nov #10 |
| Plannotator | 3 of 7 | 13 Nov #6; 14 Nov #1; 15 Nov #4 |
| Univer | 2 of 7 | 14 Nov #7; 15 Nov #1 |

Historical source pages: [9 November](https://trend.ondo.sh/github/2026-11-09/en.html), [10 November](https://trend.ondo.sh/github/2026-11-10/en.html), [11 November](https://trend.ondo.sh/github/2026-11-11/en.html), [12 November](https://trend.ondo.sh/github/2026-11-12/en.html), [13 November](https://trend.ondo.sh/github/2026-11-13/en.html), [14 November](https://trend.ondo.sh/github/2026-11-14/en.html), [15 November](https://trend.ondo.sh/github/2026-11-15/en.html). These are frequency observations, not a league table of all repositories or measured design quality.

### October evidence and an important disagreement

[GitTrend's October 2026 archive](https://gittrend.io/monthly/2026-10) labels itself a star-growth list for that month. It reports Archify at #30 with approximately +16.9k, DeepTutor at #55 with approximately +12.3k, and T3 Code at #60 with approximately +11.7k. These are attributed archive claims, not independently verified growth measurements.

Another [October report from RepoRadar](https://reporadar.spreix.com/reports/monthly/2026-10) places Archify at #5 and gives a different gain. It also describes a last-thirty-days view despite its calendar-month title. Their populations, capture dates or calculation windows evidently differ; this research does not reconcile them or promote either to an official October ranking. The consistent finding is that Archify was visible in dated October discovery sources.

A [30 October daily snapshot](https://noozlet.com/c/tech@noozlet.com/p/3182/trending-on-github-30-october-2026) lists DeepTutor first and nightly-labs/OpenBot sixth, with OpenBot shown at +709 that day. This proves a reported daily appearance in October, not a sixth-place result for the month. These dated leads were followed to their primary repositories and product material before being used below.

## Reference inventory

Total stars are a **current stock**, not gains in any requested period. Counts below were refreshed through `GET /repos/{owner}/{repo}` from the [official GitHub REST API](https://docs.github.com/en/rest/repos/repos#get-a-repository) at approximately 13:34 CET. Repository links also resolve name changes. They are included to make the popularity signal inspectable, not to weight the visual conclusions.

Evidence: **V** = original product screenshot or app crop viewed; **D** = documented interaction or demo page read, with visual inspection incomplete.

| Repository | Current stars | Popularity context | UI evidence |
| --- | ---: | --- | --- |
| [backnotprop/plannotator](https://github.com/backnotprop/plannotator) | 12,890 | Current daily, rolling weekly and monthly; last-week daily appearances | V |
| [dream-num/univer](https://github.com/dream-num/univer) | 28,662 | Current daily; last-week daily appearances | V, app crop |
| [getarcaneapp/arcane](https://github.com/getarcaneapp/arcane) | 9,059 | Current daily; 16 November archive | V |
| [meta/astryx](https://github.com/meta/astryx) | 29,907 | Current rolling weekly; four last-week daily appearances | D, live sandbox |
| [we-promise/sure](https://github.com/we-promise/sure) | 16,150 | Current rolling weekly; five last-week daily appearances | V |
| [pingdotgg/t3code](https://github.com/pingdotgg/t3code) | 63,543 | Current rolling monthly; attributed October archive | V |
| [HKUDS/DeepTutor](https://github.com/HKUDS/DeepTutor) | 59,951 | Current rolling monthly; dated October evidence | V |
| [tt-a1i/archify](https://github.com/tt-a1i/archify) | 97,333 | Attributed October archive; conflicting archive rankings disclosed | V |
| [nightly-labs/openbot](https://github.com/nightly-labs/openbot) | 8,422 | Reported 30 October daily appearance | D |
| [LibreChat-AI/LibreChat](https://github.com/LibreChat-AI/LibreChat) | 47,219 | Established popularity anchor; no current-window top rank asserted | V |
| [tldraw/tldraw](https://github.com/tldraw/tldraw) | 51,454 | Established canvas anchor; no current-window top rank asserted | V |
| [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw) | 135,851 | Established canvas anchor; no current-window top rank asserted | V |
| [toeverything/AFFiNE](https://github.com/toeverything/AFFiNE) | 74,601 | Established hybrid-workspace anchor; no period rank asserted | D |
| [makeplane/plane](https://github.com/makeplane/plane) | 62,562 | Established planning anchor; no period rank asserted | D |
| [docmost/docmost](https://github.com/docmost/docmost) | 22,358 | Established collaborative-document anchor; no period rank asserted | V |
| [lobehub/lobehub](https://github.com/lobehub/lobehub) | 85,692 | Established agent-workspace anchor; no period rank asserted | D |
| [drawdb-io/drawdb](https://github.com/drawdb-io/drawdb) | 40,335 | Established structured-diagram anchor; no period rank asserted | V, older screenshot |
| [onlook-dev/onlook](https://github.com/onlook-dev/onlook) | 27,234 | Established visual-authoring anchor; no period rank asserted | V, app crop |

LibreChat's older `danny-avila/LibreChat` URL now resolves to `LibreChat-AI/LibreChat`. The older `lobehub/lobe-chat` URL resolves to `lobehub/lobehub`; treating the old name as a separate product would double-count it.

## App-level findings

### 1. Plannotator: make human attention a first-class workflow

Primary evidence: [README](https://github.com/backnotprop/plannotator/blob/main/README.md), [Inbox behavior and examples](https://plannotator.ai/inbox/), viewed [light Inbox screenshot](https://raw.githubusercontent.com/backnotprop/plannotator/main/.github/assets/inbox-light.webp) and [annotation screenshot](https://raw.githubusercontent.com/backnotprop/plannotator/main/.github/assets/annotate.webp).

The Inbox screenshot groups threads by whether a person blocks work, needs to answer, or has new material to read. A selected item opens a concrete question with picture alternatives. The separate annotation view has document contents, the document itself and an annotation list. The documentation says feedback is delivered when the person sends it, and that a reviewed document remains tied to the sent version even if the original changes later.

Strength: the return journey starts with the action needed, and feedback has a clear draft-to-sent boundary. Risk: similarly named urgency groups can become hard to distinguish, and a permanently open multi-column layout can compete with the work. For Covibes, use a review queue of decisions, diagram proposals and repository approvals with a named consequence, a source link and a precise state. Do not turn every new agent message into an urgent inbox item.

### 2. Univer: coherent editing across structured work

Primary evidence: [README](https://github.com/dream-num/univer/blob/dev/README.md), [official app demos](https://univer.ai/demo/web-app), [spreadsheet demo](https://univer.ai/demo/spreadsheets), viewed [README composite](https://raw.githubusercontent.com/dream-num/univer/dev/docs/img/readme/hero-banner.png).

The visible app crop uses familiar document and spreadsheet controls, a stable ribbon, a formula area, and the content's own hierarchy. The README documents coordinated edits and undo across features: an operation that affects both content and another feature can be represented as one complete undo action.

Strength: a complex surface can feel dependable when the operation model and navigation stay consistent. Risk: an office ribbon is too large a default for a conversational planning room. For Covibes, reuse the principle of one coherent operation: applying an agent proposal should update the diagram and its related decision state together, with a comprehensible undo result. Do not import a spreadsheet-shaped interface or assume the hero proves the full demo's usability.

### 3. Arcane: operational state that can be scanned

Primary evidence: [README](https://github.com/getarcaneapp/arcane/blob/main/README.md), viewed [dashboard screenshot](https://raw.githubusercontent.com/getarcaneapp/arcane/main/.github/assets/arcane-dash-v3-light.jpg), [official product site](https://getarcane.app).

The dashboard puts online status, attention needed, updates and an unscanned risk state above an agent table. Navigation is grouped by operational area. The screen distinguishes a healthy count of zero from a risk result that has not been measured.

Strength: visible state and an attention-oriented hierarchy reduce inspection effort. Risk: the sparse sample has large empty cards; circular gauges and summary tiles can become decoration when there is little meaningful data. For Covibes, separate queued, working, waiting for a person, failed and completed agent work. Treat unknown, disconnected and not-yet-reviewed states explicitly. Avoid making a creative project look like a fleet-monitoring dashboard.

### 4. Astryx: prototype the interaction contract, not just the skin

Primary evidence: [README](https://github.com/meta/astryx/blob/main/README.md), [Sandbox](https://astryx.atmeta.com/sandbox/), [Chat Layout cases](https://astryx.atmeta.com/sandbox/pages/chat-layout/), [Shell Lab](https://astryx.atmeta.com/sandbox/pages/shell-lab/).

This is a design-system reference rather than a complete planning app. Its sandbox exposes long-chat and streaming-scroll cases, shell configuration, mobile sheets, reorderable lists and touch-target examples. The Shell Lab lets a designer compare collapse and navigation arrangements; the README describes consistent component conventions and themes.

Strength: layout and interaction edge cases are inspectable parts of design work. Risk: a rich component catalogue does not solve the product's information architecture, and example themes are not a distinctive product identity. For Covibes, compare long conversations, simultaneous collaborators, slow agent responses, tablet drawers and preserved composer drafts in the prototype itself. The sandbox was read, not exercised with keyboard and touch; no accessibility conformance claim is made here.

### 5. Sure: let the result remain the primary surface

Primary evidence: [README](https://github.com/we-promise/sure/blob/main/README.md), viewed [light dashboard screenshot](https://raw.githubusercontent.com/we-promise/sure/main/docs/screenshots/dashboard-light.webp), [official site](https://sure.am).

The screenshot combines a narrow icon navigation rail, a broad workspace of financial charts and a right-hand conversation about the same data. The assistant is contextual to the visible work. The neutral surfaces and one strong action make the charts readable; the chart color encodes the data rather than coloring every control.

Strength: the useful artifact remains visible while a person asks questions. Risk: multiple charts, date filters and a chat rail still create a heavy desktop composition; a financial dashboard is not a suitable literal model for team ideation. For Covibes, offer an artifact-focused mode with optional contextual assistance. A person should be able to inspect the plan or diagram without keeping a second conversation permanently open. The screenshot supports the visual relationship, not verified data grounding.

### 6. T3 Code: precise approval and continuity across devices

Primary evidence: [README](https://github.com/pingdotgg/t3code/blob/main/README.md), viewed [desktop and phone composite](https://raw.githubusercontent.com/pingdotgg/t3code/main/.github/readme/hero.webp), [official site](https://t3.codes).

The visible thread list carries Approval and Done states. The open thread separates an answer, verification results, changed files and repository actions. The phone crop shows the proposed command with distinct allow-once and decline choices, rather than burying the request in ordinary prose. The README describes continuing threads across clients and changing providers within a thread.

Strength: work state persists outside the current scroll position, and approval names the actual operation. Risk: model names, branches and command controls are appropriate to coding but would overwhelm a planning audience. For Covibes, retain stable thread identity and expose the exact destination and changes before a Git action. Do not give a general planning approval an implicit session-wide authorization. A phone review should be a focused decision, not a shrunken desktop workspace.

### 7. DeepTutor: give durable writing its own reading mode

Primary evidence: [README](https://github.com/HKUDS/DeepTutor/blob/main/README.md), viewed [chat screen](https://raw.githubusercontent.com/HKUDS/DeepTutor/main/assets/figs/web-dev/chat.png) and [notebook screen](https://raw.githubusercontent.com/HKUDS/DeepTutor/main/assets/figs/web-dev/notebook-detail.png), [official site](https://deeptutor.info/).

The chat screenshot combines quiet workspace navigation with unusually readable long-form content. The notebook moves the result into an editing destination with a visible Saved state and an Ask Dito entry point. Serif document typography contrasts with simple sans-serif application controls. The supplied notebook image also repeats the document title, illustrating how a spacious design can still have redundant hierarchy.

Strength: conversation output can become a legible, durable object rather than another chat bubble. Risk: very large type and generous whitespace can hide too much of a long plan; duplicate headings waste attention. For Covibes, make the plan a real reading and editing mode, preserve its source discussion, and show saved/proposed status plainly. Let writing typography serve sustained reading; it should not become oversized display styling throughout the application.

### 8. Archify: make a diagram explain itself

Primary evidence: [README and interactive examples](https://github.com/tt-a1i/archify/blob/main/README.md), [gallery](https://archify.si/gallery.html), viewed [light architecture example](https://raw.githubusercontent.com/tt-a1i/archify/main/docs/assets/archify-light.png).

The screenshot groups architecture elements with explicit boundaries, named relationships, a legend and restrained role colors. The README's examples document focusing on a node's downstream reach, highlighting a route, and tracing authored relationships. Its explainer examples put a conclusion and supporting sources beside interactive diagrams.

Strength: diagrams become navigable arguments instead of attractive pictures. Risk: role color, boxes and legends can overload a large graph, and a generated visual can look more authoritative than its sources deserve. For Covibes, selection should expose the node's related decision, constraints and evidence. A proposed change should show its affected relationships before application. Do not treat auto-layout or source links as proof that the underlying architecture is correct.

### 9. OpenBot: separate the teammate from its runtime

Primary evidence: [README](https://github.com/nightly-labs/openbot/blob/main/README.md), [official application-preview page](https://openbot.run/), [workflow guide](https://openbot.run/guides).

The README documents persistent agents with their own workspaces, FIFO queues, pause/resume/cancel controls, shared channels with an explicit task owner, reassignment, and provider-independent identity. The product page presents agent handoffs and workflow approval steps. A product session or independent screenshot was not inspected; these are documented behavior claims, not a visual-quality rating.

Strength: identity, ownership and work status are distinct concepts. Risk: the documented unrestricted agent execution model is a poor fit for Covibes' explicit human approval of changing Git actions. The repository also uses a noncommercial license; it is an interaction reference, not an adoption recommendation. For Covibes, keep the specialist's name and role stable when a provider changes, and show who owns the next step. Preserve human control over consequential actions.

### 10. LibreChat: artifacts with an inspectable relationship to chat

Primary evidence: [README](https://github.com/LibreChat-AI/LibreChat/blob/main/README.md), [artifact documentation](https://www.librechat.ai/docs/features/artifacts), viewed [official documentation screenshot](https://raw.githubusercontent.com/LibreChat-AI/docs/main/public/images/features/artifacts/panel-preview-light.png).

The screenshot shows a named artifact in the conversation and a Preview/Code panel beside it. The documented controls include an artifact/version menu, full screen, download and moving the panel into a separate window while retaining the conversation. The image proves the composition; the window and version behaviors are documentation evidence.

Strength: a result has a name, type, location and return path. Risk: preview, source and multiple versions can become competing representations, especially when an edit is still streaming. For Covibes, a diagram or plan should have one stable identity and a clear distinction between the accepted version and an open suggestion. Make the side panel optional, preserve drafts when it closes, and make every artifact reachable from its originating discussion and from a dedicated project view.

### 11. tldraw: a canvas can be part of the conversation itself

Primary evidence: [README](https://github.com/tldraw/tldraw/blob/main/README.md), [starter kits](https://tldraw.dev/starter-kits), viewed [official chat starter screenshot](https://raw.githubusercontent.com/tldraw/tldraw/main/apps/docs/public/images/starter-kits/chat-screenshot.png).

The annotated screenshot demonstrates adding an image, marking it up, attaching a sketch and sending it as conversational input. The README also presents canvas-oriented chat, branching chat and agent starter kits. This is evidence of interaction possibilities, not a complete ready-made Covibes product.

Strength: people can point, sketch and reference a region instead of explaining everything in prose. Risk: a freeform canvas without structure can lose the traceable meaning needed for planning. For Covibes, let a selected diagram region become explicit message context and offer a visible preview of what will be sent. Preserve semantic nodes, relationships and decisions. Researching this interaction does not imply adopting the SDK or establish commercial licensing suitability.

### 12. Excalidraw: make unfinished thinking feel editable

Primary evidence: [README](https://github.com/excalidraw/excalidraw/blob/master/README.md), viewed [official product screenshot](https://excalidraw.nyc3.cdn.digitaloceanspaces.com/github%2Fproduct_showcase.png), [application](https://excalidraw.com).

The screenshot shows a compact shape toolbar, an object-specific style panel, a canvas wireframe, visible collaborator cursors, and spatial annotations. The selected object has an obvious boundary; the work looks intentionally provisional.

Strength: roughness invites participation and lowers the cost of revising an early idea. Risk: hand-drawn styling and unconstrained annotations do not automatically support a precise accepted architecture or exported implementation plan. For Covibes, distinguish exploration from committed decisions without making the accepted result feel immutable. Keep selection and authorship clear. Give the team a route from rough sketches to structured, named diagrams rather than assuming one appearance works equally well for every planning phase.

### 13. AFFiNE: preserve identity when moving between document and space

Primary evidence: [README](https://github.com/toeverything/AFFiNE/blob/canary/README.md), [official product explanation](https://affine.pro/), [Edgeless](https://affine.pro/edgeless).

The primary material describes documents, whiteboard blocks and databases as related representations in one workspace, with an edgeless mode and collaborative editing. The official screenshot CDN was inaccessible for reliable visual inspection; no claims about the observed palette, spacing, animation or current app quality are made.

Strength of the documented model: people do not have to duplicate the same knowledge into unrelated tools. Risk: adding every representation can create mode confusion, particularly when selection, permissions or edits behave differently. For Covibes, preserve object identity when a decision appears in chat, on a board and in the plan. Make the current editing context explicit. A diagram does not need to become a full database just because the reference product supports one.

### 14. Plane: a plan needs useful views and recoverable drafts

Primary evidence: [README](https://github.com/makeplane/plane/blob/preview/README.md), [work-item creation](https://docs.plane.so/work-items/create-and-manage-work-items), [documentation](https://docs.plane.so/).

The primary documentation describes creating work items from several views, explicit properties, reusable templates, a create-more flow and a draft prompt when closing a partially completed item. The documentation also exposes layouts, filters, views, dependency timelines and version history. Screenshot visual inspection was incomplete, so these are interaction-model findings.

Strength: the task is a persistent object that survives different views and interrupted creation. Risk: exposing all properties, project modules and filters at once would be excessive for an early planning session. For Covibes, add ownership, acceptance criteria and handoff readiness when a plan becomes actionable. Preserve a draft if the creation flow closes. Use progressive disclosure so brainstorming does not immediately feel like issue administration.

### 15. Docmost: make a shared knowledge destination easy to return to

Primary evidence: [README](https://github.com/docmost/docmost/blob/main/README.md), [editor guide](https://docmost.com/docs/user-guide/editor), viewed [official documentation home screenshot](https://raw.githubusercontent.com/docmost/docs/main/static/img/home_image.png).

The screenshot combines global search, a small stable navigation hierarchy, favorite spaces, a workspace query composer, and recently updated documents. The editor guide documents slash insertion, a selection toolbar, inline comments and links to pages or members. The screen viewed was the home page; the editor behaviors were read in the guide.

Strength: durable content has both a spatial home and multiple retrieval routes. Risk: a generic assistant composer can consume the most prominent home position while obscuring actual work. For Covibes, favor recent project outcomes and outstanding decisions, with a clear search path to plans and diagrams. Keep selected-text or selected-node actions near the thing they affect. A return page should answer where to continue, not require a fresh open-ended prompt.

### 16. LobeHub: clear roles and user-owned memory

Primary evidence: [current README](https://github.com/lobehub/lobehub/blob/canary/README.md), [official site](https://lobehub.com).

The current primary README frames agents as members of existing team chats and describes agent discovery, workspace additions and structured memories that a person can inspect, edit and delete. Its screenshots could not be reliably inspected, and a linked documentation route returned a migration placeholder during research. Older recollections of LobeChat's interface are therefore not used as evidence for today's product.

Strength of the documented workflow: agent expertise and retained knowledge are visible concepts rather than invisible prompt state. Risk: marketplaces and many agent identities can make a project feel like a catalogue of personas instead of a shared task. For Covibes, show a specialist's role, allowed capabilities and evidence scope before adding it, and provide a comprehensible record of the context it uses. Treat this as a model-level reference until the current UI is inspected.

### 17. drawDB: semantic density and direct editing

Primary evidence: [README](https://github.com/drawdb-io/drawdb/blob/main/README.md), viewed [repository screenshot](https://raw.githubusercontent.com/drawdb-io/drawdb/main/drawdb.png), [application](https://drawdb.app).

The screenshot links a searchable table list and field editor with a canvas of entities, named fields and cardinality markers. A selected field exposes its constraints without making every table equally detailed. The screenshot's visible save timestamp is from 2024, so this is a historical structural reference served by the current README.

Strength: the diagram's appearance corresponds to editable domain meaning. Risk: dense inspectors, abbreviations and overlapping callouts assume expertise and become difficult on small screens. For Covibes, a selected architecture or data-model node should expose only its relevant fields, decisions and links. Use explicit relationship labels and searchable objects. Do not copy the desktop density or let a node's metadata occupy the canvas when it is not selected.

### 18. Onlook: compare alternatives in place

Primary evidence: [README](https://github.com/onlook-dev/onlook/blob/main/README.md), viewed [app crop in repository composite](https://raw.githubusercontent.com/onlook-dev/onlook/main/assets/web-preview.png), [official product site](https://onlook.com).

The visible crop shows light and dark alternatives and desktop/mobile frames side by side, with a neighboring conversation referring to named frames. The README documents selecting frames as context and selecting an element for a focused follow-up. This was not a live editing session.

Strength: comparison happens on the result, with the conversation attached to a specific alternative. Risk: a large collection of frames can become a wall of thumbnails; selected scope can be ambiguous when a prompt affects several frames. For Covibes, show two or three named architectural or roadmap alternatives with explicit shared criteria, a concise difference summary, and a clear adoption action. Retain discarded variants as inspectable reasoning. Covibes can use this comparison pattern while remaining a planning tool rather than becoming a visual code editor.

## What this means for the new Covibes design

The following are design hypotheses to prototype, not changes to the approved product scope.

| Planning moment | Transferable pattern | Concrete Covibes hypothesis | Failure to avoid |
| --- | --- | --- | --- |
| Returning to a project | Plannotator attention groups; Docmost retrieval | Lead with the decision or review requiring this person's judgment, followed by changed outcomes | A generic dashboard of counts or a fresh prompt with no continuity |
| Discussing a concrete proposal | LibreChat artifacts; Sure contextual assistant | Keep the proposal visible and give the conversation a stable, optional place beside it | Making chat, overview, diagram and inspector equally dominant |
| Exploring alternatives | Onlook frames; Excalidraw provisional work | Compare a small number of named variants against shared criteria | A gallery with no adoption decision or explanation |
| Understanding a system | Archify focus and source tracing; drawDB semantics | Selecting a node reveals its related decision and evidence; spotlight the affected path | Treating a generated graph as verified truth |
| Writing the implementation plan | DeepTutor reading mode; Docmost documents | Offer a durable document with saved state, provenance and explicit proposed edits | Replacing a person's manual changes with a fresh AI answer |
| Waiting for agents | Arcane status model; T3 Code thread state | Show queued, working, blocked, failed and completed states with a clear next action | A spinner that looks like work but carries no information |
| Reviewing a consequential action | T3 Code operation approval; Plannotator sent version | Name destination, artifact version and exact changes; approve only that proposal | Broad implicit consent or approval of content that later changes |
| Working on a tablet | Astryx shell cases; focused mobile approval | Preserve one primary surface and reveal secondary context in deliberate drawers | Scaling a many-column desktop layout down until every surface is unusable |

### Principles worth carrying into the design exploration

1. **Outcomes have identity.** A decision, diagram, variant and plan are objects that can be revisited, compared and linked to their source discussion.
2. **Human judgment has a visible place.** Questions and approvals are recoverable work items, not transient messages lost in a feed.
3. **There is one primary activity at a time.** Discussion, diagramming, comparison and sustained writing can have different spatial arrangements while keeping a common project context.
4. **The useful work is quieter than the assistant's brand.** Agents explain and assist; the plan and team's reasoning remain the product's center.
5. **Modes and permissions are explicit.** Draft, suggested, accepted, sent and applied have different meanings and must not be reduced to decorative badges.
6. **Progressive disclosure preserves depth.** Rich evidence, usage and metadata remain available without requiring every participant to manage them constantly.
7. **Motion explains a state change.** The evidence supports meaningful transitions such as opening a proposal, focusing a related node or applying an accepted variant. It does not justify continual decorative animation.

### Checks for the next prototype

Evaluate a first-time participant and a returning collaborator with the same scenario: inspect two options, ask a specialist about one region, record a decision, revise part of the plan, and review a repository handoff. Check whether each person can identify the active object, find the reasoning, tell what is proposed versus accepted, and recover from closing a secondary panel. Repeat with long titles, a long discussion, no agent configured, an agent failure, a permission-limited viewer and a tablet-width viewport.

Measure the work rather than visual preference alone: time to find the next decision, mistaken approvals, lost drafts, incorrect assumptions about what an agent changed, and the ability to explain why an alternative was chosen. None of these outcomes is established by repository stars or screenshots.

## Reproducibility and remaining uncertainty

- The current figures can be rechecked at the linked GitHub pages and each repository's REST metadata endpoint. They will change. The capture time is part of each claim.
- The seven last-week daily source links are supplied so the frequency table can be independently reconstructed. The archived lists are third-party reproductions and may have captured different times of day.
- October archives disagree. No definitive calendar-month top list, historical star reconstruction, or design-quality ranking is claimed.
- Visual findings are tied to linked primary images. The report distinguishes a full screenshot, an app crop, an older screenshot and documentation-only evidence.
- Product accessibility, performance, collaboration behavior and end-to-end success were not audited. Those require direct interaction and task-based evaluation.
- This is an inspiration set of eighteen relevant references, not a recommendation to transplant their source code or dependencies. License and product-fit review would be a separate implementation decision.
