# Web App Design Research for a New Covibes

Research date: 17 November 2026, Europe/Berlin. Scope: a completely new interface and interaction model for collaborative project planning with AI. The existing Covibes UI, its tokens, and its previous design handoffs are deliberately excluded as design references.

## Research method and evidence boundaries

This is a comparative product and interaction study of **16 products**: twelve established app benchmarks and four recently ranked products. Evidence comes primarily from current official application guides, documented UI screenshots, public product demos, and dated changelogs. Product Hunt supplies dated discovery signals. Marketing promises are distinguished from documented controls and workflows.

**Evidence labels:**

- **Documented UI:** an official guide describes concrete controls, screenshots, or an interaction sequence. This establishes the documented workflow, not independently measured usability or accessibility conformance.
- **Dated release:** a primary changelog identifies a release date. This does not establish feature availability for every account or plan.
- **Public demo:** interface content is exposed in a public product demo. It may be staged and may differ from the signed-in product.
- **Exploratory:** a primary announcement describes a product, but sufficient application UI was not publicly readable. It informs questions rather than a firm interaction recommendation.

No paid accounts were created, no private customer workspaces were inspected, and no authenticated desktop/mobile usability sessions or screen reader tests were conducted. A small visual sample of official Linear and Milanote application screenshots was inspected directly; see the visual evidence appendix. Typography, exact colors, animation quality, and measured responsiveness are **not** scored. An official document fetched today is current evidence of documentation, not proof that its UI changed today. The recommendations below are design hypotheses for Covibes, not a claim that all benchmark products implement them well.

## Date windows and ranking findings

Calendar windows use the user's Berlin date. Product Hunt's archive uses its own platform calendar; no unverified conversion of launch times to Berlin time is attempted.

| Requested window | Archive examined | Verified relevant signal | Interpretation |
| --- | --- | --- | --- |
| This week so far: 16–17 November | [Daily 16 November](https://www.producthunt.com/leaderboard/daily/2026/11/16), [daily 17 November](https://www.producthunt.com/leaderboard/daily/2026/11/17), [week starting 16 November](https://www.producthunt.com/leaderboard/weekly/2026/47) | Zoom Slides was listed first and Boost.space AgentOS second on 16 November. The weekly page showed the same leading pair at observation time. The 17 November page did not expose comparable final ranks. | Week 47 covers 16–22 November and is incomplete on the research date. These are launch-community signals, not a completed weekly usability ranking. |
| Last week: 9–15 November | [Week starting 9 November](https://www.producthunt.com/leaderboard/weekly/2026/46) | TK by Medium appeared at position 15. Its product launch entry gives 10 November. | A relevant new thinking tool; ranking reflects a launch, not the quality of its editor. |
| Last calendar month: 1–31 October | [October leaderboard](https://www.producthunt.com/leaderboard/monthly/2026/10) | Velozity appeared at position 8. Product Hunt Visual Launch Editor appeared at position 6. | Velozity warrants study for human/agent collaboration. The launch editor is a task-specific artifact-editing signal, not a general planning benchmark. |
| Rolling / unspecified | “Trending products” and “Top reviewed” sections embedded alongside archive results | Lovable, Bolt, Replit, and other established names appeared in surrounding navigation. | These sections do not inherit the archive's time window. They are not used to claim “best this week” or “best in October.” |

Scores were not copied because the archive says scores can reflect current activity while ordering reflects the viewed period. Sponsored placements were excluded. [Product Hunt's October archive](https://www.producthunt.com/leaderboard/monthly/2026/10) explicitly explains that distinction.

Awwwards' public [Sites of the Day directory](https://www.awwwards.com/websites/sites_of_the_day/) timed out on both retrieval attempts. No verified Awwwards winner list for these windows is asserted. More fundamentally, a visually awarded marketing website would not establish the quality of its application's planning, sharing, keyboard, or recovery flows.

## Established application benchmarks

### 1. Linear: dense work without losing orientation

**Evidence:** documented UI and a dated release within last week. [Custom Views](https://linear.app/docs/custom-views) describes filtered list/board views and Peek; [assignment](https://linear.app/docs/assigning-issues) supports the command menu. The [12 November changelog](https://linear.app/changelog) documents BYOK, a Latest control after scrolling up in agent output, explicit startup failures, stopping ongoing requests, and toolbar focus with Alt+F10 and Escape.

**Interaction lesson:** inspect an object temporarily while retaining the list and selection that led to it. Saved views should represent jobs such as “needs my review,” not an expanding dashboard of unrelated widgets. Explicit failures beat an indefinitely busy agent.

**Covibes opportunity:** a compact decision/task queue with object Peek; keep the selected object and scroll position when moving between its evidence, discussion, and plan. Show provider billing separately from instance costs. Linear's release is evidence of November activity, not a November design award.

### 2. Notion: contextual assistance with accountable changes

**Evidence:** [Notion Agent](https://www.notion.com/help/notion-agent) documents the current page as default context and the user's permissions as the agent's boundary. [October releases](https://www.notion.com/releases) describe attributable version history and connection governance. Some announced spending controls were marked coming soon and BYOK private alpha; they must not be treated as generally available UI.

**Interaction lesson:** assistance can appear around the thing a person is already editing rather than requiring a new empty chat. Durable changes need attribution and a route back to the prior version.

**Covibes opportunity:** make the exact scope visible before an agent acts: selected object, section, board, or project. Preserve source links and show “proposed,” “approved,” and “superseded” as meaningful object states. A page editor alone cannot explain why an architectural choice exists; Covibes can make that relationship first-class.

### 3. FigJam: a shared session has structure

**Evidence:** [Explore FigJam files](https://help.figma.com/hc/en-us/articles/15300412458647-Explore-FigJam-files) documents separate regions for file navigation, collaboration, and creation tools. [Sections](https://help.figma.com/hc/en-us/articles/4939765379351-Organize-your-FigJam-board-with-sections) organize the board; [voting](https://help.figma.com/hc/en-us/articles/9359912208663-Run-voting-sessions-in-FigJam) scopes a session to selected material.

**Interaction lesson:** give a group a bounded area and a clear activity, rather than expecting it to navigate an undifferentiated infinite space. Creation, navigation, and facilitation are different jobs.

**Mobile/accessibility:** [screen reader guidance](https://help.figma.com/hc/en-us/articles/14477051168791-Use-FigJam-with-a-screen-reader) warns that cursor chat and emotes are poor substitutes for persistent accessible communication; quick actions offer a keyboard creation path. [iPad guidance](https://help.figma.com/hc/en-us/articles/4502073572247-FigJam-for-iPad) documents a touch-specific flow.

**Covibes opportunity:** turn a framed discussion into a decision with a persistent rationale. Make following a facilitator optional and reversible. Never make transient multiplayer decoration the only record of something important.

### 4. Miro: a canvas can contain focused applications

**Evidence:** [Toolbars](https://help.miro.com/hc/en-us/articles/360017730553-Toolbars) groups creation, collaboration, and navigation. [Miro Diagrams](https://help.miro.com/hc/en-us/articles/25275263961874-Miro-Diagrams) and [Slides](https://help.miro.com/hc/en-us/articles/25542531289234-Miro-Slides) expose Focus mode for a specific artifact. [Sidekicks](https://help.miro.com/hc/en-us/articles/29902701849618-Sidekicks-overview) provides contextual AI creation; [mobile documentation](https://help.miro.com/hc/en-us/articles/360017572834-Mobile-app) names its supported operations.

**Interaction lesson:** overview and deep editing need different levels of chrome. Opening a diagram or document can temporarily make it the main workspace.

**Covibes opportunity:** move from a project map into a focused decision, architecture, or plan surface with a consistent return route. Assistance should target the active artifact. Avoid presenting every tool and every specialist at once merely because all exist in the product.

### 5. Eraser: generate from reality, then inspect the plan

**Evidence:** [Quickstart](https://docs.eraser.io/quickstart) starts from a prompt, image, file, or repository. [Creating a map](https://docs.eraser.io/creating-a-map) documents short questions, a card per proposed view, Edit plan, Build all, and a saved version before AI mutations. [Freeform diagrams](https://docs.eraser.io/freeform-diagrams) distinguishes visual editing from diagram-as-code. [MCP](https://docs.eraser.io/mcp) exposes explicit read/write tools.

**Interaction lesson:** clarify intent, show an inspectable construction plan, then build. The output remains directly editable and interoperable.

**Covibes opportunity:** show a small set of planned artifacts and unresolved questions before generating a project foundation. Link each diagram to evidence and decisions. Make a coding package a readable, versioned result rather than a download button on an arbitrary chat response. Eraser's strong technical diagram path is a baseline; Covibes needs broader collaborative reasoning, not another diagram generator.

### 6. tldraw: one action model across input methods

**Evidence:** the current [UI components documentation](https://tldraw.dev/sdk-features/ui-components) describes shared actions across menus, toolbars, and shortcuts, responsive breakpoints, and accessibility announcements. [Custom menus](https://tldraw.dev/examples/custom-menus) shows quick actions moving above the toolbar on smaller screens. [Actions](https://tldraw.dev/sdk-features/actions) describes required accessibility actions.

**Interaction lesson:** a shortcut must invoke the same action as its visible control. Toolbars are a responsive presentation of a semantic command system, not the command system itself.

**Covibes opportunity:** every canvas action should have a discoverable menu/command route, including arranging, connecting, and moving items. Use the SDK examples as an implementation reference; they are not proof of every detail in the current tldraw.com hosted app. Keep selection, editing, and panning distinguishable on touch as well as desktop.

### 7. Milanote: organization by grouping, then presentation

**Evidence:** [first project](https://help.milanote.com/en/articles/112349-creating-your-first-project) demonstrates dragging a board from the creation toolbar, opening it, and adding varied content. [Columns](https://help.milanote.com/en/articles/10478526-columns) documents insertion indicators and collapsing groups. [Presentation mode](https://help.milanote.com/en/articles/6815489-presentation-mode) hides editing tools and focuses selected cards.

**Interaction lesson:** make relationships and grouping tangible before demanding a formal schema. Clean presentation can be a mode of existing content rather than a separate deliverable to rebuild.

**Mobile limitation:** the [mobile FAQ](https://help.milanote.com/en/articles/2966365-milanote-iphone-android-apps) explicitly notes no offline operation and no table editing, while Quick Notes supports capture for later organization.

**Covibes opportunity:** allow quick capture on a phone, then deliberate organization on a larger surface. Provide Move to section as an alternative to dragging. Show what a shared presentation includes, especially nested content.

### 8. Heptabase: objects should survive their current arrangement

**Evidence:** [deep links](https://support.heptabase.com/en/articles/11176386-use-deep-links) target cards, whiteboards, and precise content locations without granting new access. [Collaboration and permissions](https://support.heptabase.com/en/articles/10510497-collaboration-and-permissions) documents shared-space boundaries and mobile limitations. Its [ChatGPT/Codex integration](https://support.heptabase.com/en/articles/17120206-use-heptabase-with-chatgpt-and-codex) uses the currently open whiteboard/card as action context.

**Interaction lesson:** an object can have a stable identity beyond where it is placed. External assistants need to know what “this” refers to.

**Covibes opportunity:** a decision referenced in chat, on a diagram, and in a task should remain one decision. Share a deep link to its rationale, not a fragile viewport position. Display a clear missing/deleted/inaccessible state. Do not promise desktop collaboration parity on mobile without testing it; Heptabase's documented differences show why such claims need evidence.

### 9. Lovable: discuss, plan, and act are distinct commitments

**Evidence:** [Plan mode](https://docs.lovable.dev/features/plan-mode) separates discussion, editable planning, and implementation, with a full-screen Plan view and explicit approval. [Preview toolbar](https://docs.lovable.dev/features/preview-toolbar) replaces a separate visual editing panel with selection, inline text, annotation, and comment modes. Selected elements become references at the chat input.

**Interaction lesson:** people can point at a concrete thing instead of describing its location. A visible mode identifies whether a request discusses, proposes, or modifies. Manual comments and AI execution have different costs.

**Covibes opportunity:** let a user select a map element, see its context reference, and ask a scoped question or request a proposal. Keep choosing a decision separate from starting a repository mutation. Existing unsent work must survive a mode change, with a clear send/discard choice where necessary. Do not hide a critical permission change behind a tiny mode icon.

### 10. Bolt: inspection, cost, and recovery accompany creation

**Evidence:** the current [QuickStart](https://support.bolt.new/get-started/quickstart) documents prompt-to-preview, element selection for edits, optional token display in chat, previewing a prior version, and confirming restoration. The navigation exposes separate Plan, Preview, Code, and version-control workflows. Older indexed documents still call a planning feature Discussion Mode, so exact labels require care.

**Interaction lesson:** creation is incomplete without an inspectable result and a recovery route. A history preview should precede restoration, and users need to understand whether an operation consumes credits.

**Covibes opportunity:** show a before/after preview for plan or diagram changes, and a trustworthy saved state. A plain estimate and payer label are more useful than making ordinary planning users reason in tokens. Restoration must say exactly which artifacts and collaborative changes it affects; avoid implying that every kind of change has identical history coverage.

### 11. Replit: a plan can become tracked work

**Evidence:** [Plan Mode](https://docs.replit.com/features/agent/plan-mode) documents a composer toggle, a task plan, Revise/Cancel, and separate Build here/Build in background decisions. Background work normally waits for review and application. [Version control](https://docs.replit.com/replit-workspace/workspace-features/version-control) distinguishes agent checkpoints, Git commits, and file history.

**Interaction lesson:** the same plan supports synchronous and asynchronous execution, while review remains a separate step. History is understandable only when the unit of recovery is explicit.

**Covibes opportunity:** a reviewed handoff can become a tracked repository request with pending, running, review, and failed states. Let people leave and return to the right review object. Covibes should retain its planning role: it can describe and review implementation work without confusing that with automatically building application code itself.

### 12. ClickUp: unified retrieval is useful; universal chrome is costly

**Evidence:** [AI Command Bar](https://help.clickup.com/hc/en-us/articles/6533695640343-What-is-the-AI-Command-Bar) searches tasks, documents, whiteboards and connected content, with source icons and object actions. [AI Hub](https://help.clickup.com/hc/en-us/articles/36954958035863-AI-Hub) documents a closable, resizable AI sidebar. [Mobile Brain](https://help.clickup.com/hc/en-us/articles/39099138359575-Use-ClickUp-Brain-on-the-mobile-app) documents prompts, attachments, models, and shared chat history.

**Interaction lesson:** retrieval across artifacts needs a stable entry point and recognizable result types. A broad feature set benefits from task-oriented entry points and optional panels.

**Covibes opportunity:** one search can find decisions, diagram nodes, plan sections, messages, and tasks, each with an exact destination and access-aware snippet. Keep the primary planning surface legible; a catalogue of all product capabilities should not be the default workspace. This is a design inference, not a measured critique of ClickUp.

## Recently ranked products: frontier scans

### 13. Zoom Slides: conversation becomes an editable artifact

**Date signal:** first on Product Hunt's 16 November daily archive; this is a launch ranking, not evidence that the product first became available that day.

**Evidence:** [Using Zoom Slides](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0084912) describes the web entry, slide navigator, layout selection, object order, comments, and sharing. [Content generation and revision](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0084921) documents attaching meeting/document sources, generation-step status, clarifying questions, and element-specific AI actions.

**Covibes opportunity:** carry source material into the generated result and show what remains editable. A discussion should yield an artifact people can inspect independently of its chat. Bring back decisions and references, not merely an attractive AI summary. Mobile authoring and accessibility were not established by this source set.

### 14. Boost.space AgentOS: an agent's capabilities are inspectable

**Date signal:** second on Product Hunt's 16 November daily archive; the [vendor launch post](https://boost.space/blog/boost-space-agentos-is-live-on-product-hunt) is dated 16 November.

**Evidence:** [Your AI team](https://docs.boost.space/guides/agents) describes role-specific cards, runtime statuses and a picker. [An agent's page](https://docs.boost.space/guides/agents/agent-page) exposes model, runtime, connections, skills, memory, and published work.

**Covibes opportunity:** an agent should be inspectable in terms of purpose, allowed actions, sources, and payer. A friendly identity is secondary to knowing whether it can act and why it is waiting. Put runtime/provider details in an inspector rather than permanent workspace chrome. Documented status vocabulary is valuable; its actual error-recovery usability and mobile accessibility remain untested.

### 15. TK by Medium: protect the user's thinking time

**Date signal:** position 15 in the 9–15 November archive; the [product launch entry](https://www.producthunt.com/products/medium) gives 10 November. Medium's [17 November primary explainer](https://medium.com/blog/what-is-tk-by-medium-b19f58d53fb7) describes private writing, organization in libraries, selective sharing, and summoning assistance within writing.

**Evidence limit:** the public [app entry](https://tk.xyz/) returned no readable application content. This is an exploratory benchmark based on the primary explainer, not a verified editor-layout study.

**Covibes opportunity:** make room for humans to state their own constraints, uncertainty, and disagreements before an agent fills the space. Quiet assistance, private drafts, and selectively inviting a reviewer may support better decisions. Test that proposition with teams; the announcement alone cannot establish it.

### 16. Velozity: people and agents share explicit spaces

**Date signal:** position 8 in the October Product Hunt archive.

**Evidence:** the [public product demo](https://velozity.ai/) exposes Spaces, threads, tasks, agent-related memory/knowledge/skills controls, usage, and a space-creation flow including visibility and members. It also presents guest-pass settings and workspace navigation. This is a public demonstration, not an authenticated production session.

**Covibes opportunity:** make the collaboration boundary obvious: which people, assistants, sources, and permissions belong to this project. Keep shared conversation separate from a private assistant exchange. Do not inherit an office metaphor merely because it is current; verify whether it helps a planning task. Vendor statements about using existing AI subscriptions are not generalized provider permission or billing guidance for Covibes.

## Cross-product synthesis for an original Covibes

These are proposed design principles, not copied layouts or approvals to change scope.

| Planning problem | Evidence-informed pattern | Independent Covibes response |
| --- | --- | --- |
| Too many concurrent surfaces | Miro artifact focus; Linear Peek; optional ClickUp sidebar | One dominant work surface. Open a contextual inspector or conversation when needed; remember the route back. |
| A blank project demands too much prompting | Eraser's short intake and inspectable construction plan | Ask for the project's outcome and one or two critical constraints, then offer a small, editable starting map. Show unanswered questions rather than fabricate detail. |
| AI changes feel opaque | Lovable planning approval; Replit review stages; Eraser pre-change version | A proposal names its scope, source context, estimated cost and concrete changes. Show before/after, accept a meaningful unit, and allow revision. |
| A diagram becomes detached from reasoning | Heptabase object identity and deep links; Notion attributable history | Make a decision a durable object linked to evidence, alternatives, affected nodes, tasks, and the current plan. |
| Many agents become noise | Boost.space capability inspection; Notion context; Linear stop/error controls | A moderator offers relevant specialists for a question. Show active contributions and inspectable capabilities rather than a permanent wall of personas. |
| Large boards become inaccessible | FigJam sections; Miro Focus mode; tldraw command system | Provide a board outline, search, fit selection/all, breadcrumbs, and a nonspatial object list. |
| Leaving a session loses momentum | Replit background review; Linear review queues; shared mobile history | Return to a concise set of changed decisions, pending reviews, and one suggested next action with exact links. |
| Cost is a surprise | Bolt visible consumption; Linear BYOK; Notion announced governance | Identify who pays before paid work starts, estimate plainly where possible, show reserved/used amounts and the reason a run waits. |

The defensible product distinction is **traceable collaborative reasoning**. The screen should help answer: What are we trying to achieve? What did we decide? Why? What depends on that decision? What needs review? What can a coding agent safely build from this version? A generic AI composer, a large canvas, or a visually elaborate dashboard alone does not answer those questions.

## Candidate interaction architecture

1. **Project entry:** recent work and pending decisions, plus a clear new-project action. Avoid a setup questionnaire that demands information the user does not yet know.
2. **Brief:** short editable intent, constraints, sources, and open questions. Invite collaborators and connect a repository when relevant.
3. **Explore:** one dominant map or discussion, with contextual links to the other. Scope an AI request with visible references.
4. **Decide:** compare alternatives against stated criteria; preserve disagreement and source evidence. Confirm a chosen decision as an object.
5. **Plan:** derive a structured plan with tasks and dependencies. Display which decisions support each part and what became outdated.
6. **Review and hand off:** inspect the exact package/repository changes, permissions, destination, and version. Approval applies to a concrete result.
7. **Return:** show what changed, what awaits this person, and the next actionable question. Resume the previous surface and selection.

These are jobs, not a required seven-tab navigation bar. Test which transitions deserve persistent navigation and which should be contextual. The new visual direction should be designed from this work model, without inheriting the old Covibes panel layout, colors, typography, or avatar treatment.

## Mobile, keyboard, and accessibility requirements to validate

- **Mobile jobs:** prioritize reading a decision, adding a thought/source, reviewing a proposal, and replying to a collaborator. A canvas can have a focused outline/detail path rather than requiring precision dragging on a phone. Keep the active object and unsent work when switching views.
- **Keyboard equivalence:** expose creation, selection, connect, move-to-section, arrange, inspect, and undo through named commands. A command menu supplements visible controls; users should not need to memorize shortcuts to discover a feature.
- **Focus behavior:** an inspector or dialog returns focus to its opener. Sticky toolbars/composers must not obscure the focused control. Streaming AI output must not steal focus or force a person back to the bottom while reading older content.
- **Canvas semantics:** give objects names, types, state and relationships in a navigable list/tree. Add text explanations for nonvisual users. A minimap is useful but does not replace a semantic navigation route.
- **Persistent communication:** important agent outputs and facilitator instructions need a readable record. Follow/presence modes must be optional; cursor chat, color, and transient reactions cannot carry essential meaning alone.
- **Touch targets:** use 44 CSS pixel targets for common mobile controls as a product target. WCAG 2.2 AA's target-size criterion is 24 CSS pixels with specified exceptions; 44 must not be misrepresented as that AA rule. [W3C target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum)
- **Dragging alternative:** provide tap/menu alternatives for reorder, group, move, and connect where dragging is not essential. [WCAG 2.2](https://www.w3.org/TR/WCAG22/) includes AA requirements for dragging alternatives and focus not being obscured. [Focus guidance](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum)
- **Truthful persistence:** distinguish saving, saved, offline/pending sync, and failure. A successful optimistic animation is not evidence that collaborators or the server received the change.

## Validation plan for the new direction

Recruit a mix of solo builders and small teams; include keyboard users and at least one screen reader participant. Prototype the jobs below with realistic project content, not only empty or idealized screens. Test at phone, tablet, laptop, and wide-desktop widths, plus zoom and reduced motion.

| Task | Question to answer | Evidence to collect |
| --- | --- | --- |
| Start a project from a short brief | Can a first-time user produce one useful artifact without learning a prompt language? | Time to first meaningful edit; requests for help; incorrectly assumed details. |
| Compare two approaches and decide | Does the group understand the criteria, rationale, and remaining disagreement? | Ability to explain the decision later; source retrieval; confidence calibrated to evidence. |
| Ask about one diagram element | Is the active scope obvious before sending? | Wrong-object requests; context corrections; whether references remain visible. |
| Review an AI proposal | Can a person identify what changes and what it costs before accepting? | Missed changes; accidental scope expansion; successful revision and undo. |
| Revisit a changed assumption | Can the team find affected tasks and plan sections? | Missed dependencies; time to affected artifact; retained rationale. |
| Return after another teammate worked | Can the user distinguish information from work requiring their action? | Correct review destination; notification overload; resumed selection and reading position. |
| Use a large board without dragging | Is the project operable by keyboard and a narrow viewport? | Completion using outline/search/commands; focus loss; inaccessible relationships. |
| Hand off to a repository | Is the destination, version, approval, and result unambiguous? | Wrong-repository risk; approval comprehension; recovery from denied permissions. |

Measure these against the prototype rather than claiming a percentage improvement in advance. Visual review must then examine hierarchy, density, typography, contrast, state distinctions, loading, empty/error states and motion with the chosen new direction. The research supplies interaction evidence and questions; it does not substitute for that prototype review.

## Visual evidence appendix

Two official application-image sets were opened and visually inspected on the research date. Images were retrieved from their documentation pages for inspection; no benchmark media was added to the repository. These are vendor-selected screenshots, not independent live account sessions, and their capture dates are not asserted.

| Official source | What was visibly inspected | Design inference and boundary |
| --- | --- | --- |
| [Linear Custom Views](https://linear.app/docs/custom-views), “Issue and Project Views” and view-sidebar screenshots | A compact list groups issues by state, while an editing header exposes source/status filter chips and explicit Cancel/Save actions. The optional side region names the view and its visibility/owner, with an Overview/Insights switch and distribution tabs. | Contextual metadata can sit beside the work without replacing it. Applied filters should remain readable and editable. This screenshot is not evidence that a permanent inspector suits every Covibes job; the intended width must be tested. |
| [Milanote Columns](https://help.milanote.com/en/articles/10478526-columns), introductory project-board screenshot | A project breadcrumb and explicit Saved label sit above a board. A left creation rail has labeled tools. Titled columns show item counts and collect different content types: an image, a document card, objectives, contacts, and tasks. | Visible grouping and saved state help explain a spatial document. Group counts communicate scale without requiring every object to be open. The screenshot uses substantial content space; copying its proportions into a narrow viewport would need separate evaluation. |

Replit's official Plan-mode screenshot links were identified, but its image CDN denied direct retrieval in this environment. The guide's readable control descriptions remain valid documentation evidence; no visual assertion about those screenshots is made. Direct shell retrieval of some Figma, Eraser, and Boost.space pages was also denied, while their official text was accessible through the web research tool. These are access limits, not evidence that the products themselves are inaccessible.

## Remaining uncertainty

- Ranking snapshots can change, especially the incomplete current week. They measure launch engagement, not retention, accessibility, or task success.
- Official docs sometimes contain old labels or positions, notably Bolt's Discussion/Plan naming and different FigJam toolbar references. Prefer current product guides and confirm exact placement in the implementation prototype.
- TK lacks enough publicly readable application UI for a layout recommendation. Velozity's interface evidence is a staged public demo.
- Native mobile support is not proof of responsive web parity. Plan-specific and region-specific features should be tested in the account configuration actually used.
- No benchmark's claims about subscription access, model quality, uptime, speed, or savings are adopted as Covibes promises without separate technical and provider verification.
- This study does not reuse the existing Covibes design system. A new design must still be coherent, original, and validated with real planning work.
