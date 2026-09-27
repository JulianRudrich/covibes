# Handoff: Covibes V1 – Main screen

## Overview
Covibes is a shared planning space made of chat and canvas for developers and small teams. People chat with each other and address AI agents with `@` (@Backend, @Critic, @Data). A neutral AI moderator helps with brainstorming, compares options, recognizes agreement and draws decisions as diagrams on the canvas. The result is a project plan. The UI language is German; the German UI labels of the prototype are given in parentheses.

This package describes the **main screen** (desktop, 1440 × 900) in the phase "Architecture".

## About the design files
The files in this package are **design references in HTML**: prototypes that show look and behavior. They are not production code to copy. The task is to **rebuild this design in the target codebase**, using its patterns and libraries. Without an existing codebase, the following fits the decisions made in the design:
- **React + TypeScript** (Vite or Next.js)
- **React Flow** (`@xyflow/react`) for the canvas: blocks as custom nodes, arrows as custom edges with labels
- **PostgreSQL** for the data; chat, live cursors and locks run in real time through the Covibes server

`Covibes Main Screen.dc.html` opens directly in the browser (`support.js` must sit next to it). All styles are inline in the markup; the state is described in the class `Component` in the `<script data-dc-script>` block.

## Fidelity
**High fidelity.** Colors, typography, spacing, radii, shadows and interactions are final and must be implemented pixel-exact. The contents (chat texts, blocks, decisions) are sample data but should be reused as seed data or Storybook fixtures.

---

## Design principle: who created what?
- **Color belongs to the agents.** Every agent has exactly one color (see tokens). Humans are always neutral (graphite/gray).
- **Humans** = round avatars with initials on `#E6EAF0`. **Agents** = rounded squares (radius 7–8 px) in the agent color with a white letter, plus the badge "Agent" in the chat.
- Every canvas block has an author line at the bottom (16 px avatar + name). Every chat message shows avatar and name in the author's color.
- The main action is always graphite (`#151B24`), never an agent color.

---

## Layout (1440 × 900)
```
┌──────────────────────────── header 52px (on app background) ─────────────────────────────┐
│ [8] Chat 380px [8] │ [8] Canvas (flex, ≈ 728px) [8] │ [8] Overview 300px [8]              │
└──────────────── panels: 8px outer spacing, 8px gap, 8px bottom ──────────────────────────┘
```
- Root: `display:grid; grid-template-rows:52px 1fr;` background `#EEF1F5`, font Geist 13 px, text color `#0F1720`.
- Header and main use **the same columns**: `grid-template-columns: 380px minmax(0,1fr) 300px; gap: 8px; padding: 0 8px;` (main additionally `padding-bottom: 8px`).
- Panels (chat, canvas, overview): background `#FFFFFF`, border `1px solid #E1E6EC`, radius 12 px, shadow `0 1px 2px rgba(16,24,40,.04)`, `overflow:hidden`. Every panel has a 52 px header with `border-bottom: 1px solid #EEF1F4`.

### 1. Header (52 px, transparent on `#EEF1F5`)
**Left (above the chat column), padding-left 8 px, gap 10 px:**
- Logo mark 22 × 22: two 14 × 14 squares with radius 5. Top left filled `#151B24`, bottom right only a `2px` border `#151B24`, overlapping.
- Wordmark "covibes": 15 px, 600, letter-spacing −0.02em.
- Divider "/" `#B4BDC8`.
- Project button "Covibes V1" + chevron-down (14 px, `#6B7686`): 30 px high, padding 0 8, radius 7, 13 px/500, hover background `#E3E8EE`.

**Center: phase indicator** (centered): a bar with `background:#E2E7ED; padding:3px; radius:10px; gap:2px`. A chevron-right (12 px, `#9AA4B2`) sits between the steps.
- Step: 28 px high, padding 0 10, radius 7, gap 7, 13 px, nowrap.
- **Done** (Brainstorming, Decide): 16 px circle `#151B24` with a white check (10 px), text `#3F4A5A`.
- **Active** (Architecture): white background, shadow `0 1px 2px rgba(16,24,40,.10), 0 0 0 1px rgba(16,24,40,.05)`, 600. Symbol: 16 px ring (1.5 px `#151B24`) with a 6 px dot.
- **Upcoming** (Project plan): 16 px ring (1.5 px `#AAB3BF`) with the number "4" (9 px/600), text `#5B6676`.

**Right (above the overview column), gap 10 px, right-aligned:**
- Humans: 3 circles of 26 px, `background:#DFE4EA; color:#253041; border:2px solid #EEF1F5`, overlapping (`margin-left:-6px`), initials "You" (`Du`), "A", "S" (10–11 px/600). Tooltip = name.
- Divider 1 × 20 px `#CFD6DF`.
- Agents: 4 squares of 24 px, radius 7, gap 3, white letter 11 px/600: M (Moderator), B (Backend), K (Critic, `Kritiker`), D (Data, `Daten`) in the agent colors.
- Button "Share" (`Teilen`): primary, 30 px high, padding 0 14.

### 2. Chat (380 px)
Grid rows: `52px | 1fr (scroll) | auto`.

**Header:** "Chat" (14 px/600) on the left. On the right a status pill: 26 px high, radius 13, `#F3F5F8`, 12 px, `#3F4A5A`. Inside on the left three animated dots (4 px, `#3563E9`) while Backend is typing. Text: "Backend is typing · 1 waiting" → after typing "1 waiting" → after "Listen" "No one waiting to speak".

**Message list:** padding 16, gap 18, `overflow-y:auto`, scrolls down on new messages.
- Divider "Today": 11.5 px, `#7A8595`, hairlines `#EEF1F4` left and right.
- **Human message:** grid `28px 1fr`, gap 10. Round 28 px avatar. Header: name 13 px/600 + time 11.5 px `#7A8595` (tabular-nums). Text 13.5 px, line-height 1.55, `#1E2733`.
- **Agent message:** like a human message, but the avatar is a 28 px square with radius 8 in the agent color. Name in the dark agent color. Badge "Agent": 18 px high, padding 0 6, radius 5, 11 px/500, agent tint background.
- **Moderator message (card):** `border:1px solid #CDE6E9; background:#F4FAFB; radius:12; padding:12; gap:10`. Header: 24 px avatar (radius 7), "Moderator" `#0B5F68` 600, badge "Agent · neutral" (`#DCF0F2`/`#0B5F68`), time on the right. Buttons: "Yes, compare" (primary 30 px) and "Later" (secondary 30 px), gap 6. After a click the buttons are replaced by a line with a check, above it `border-top:1px solid #D7ECEE`, 12.5 px `#0B5F68`: "Variants A and B are being created" or "Postponed".
- **Mention** `@Backend`: inline chip `color:#2346B0; background:#EEF2FE; radius:5; padding:2px 5px; 500`.
- **Canvas reference** `[AI-Gateway]`: inline button, 22 px high, padding 0 7 0 5, radius 6, `border:1px solid #BFE3E6; background:#F4FAFB; color:#0B5F68`, 12.5 px/500, icon "network" (12 px), nowrap. Hover: `background:#DCF0F2; border-color:#0F7F8A`. The color follows the block's author (here the moderator). Click: highlights the block on the canvas; in the real app it also zooms or scrolls to it.
- **Backend typing:** animated dots + "is typing" (11.5 px, `#2346B0`) appear in the header instead of the time. Below that the line "↳ Reply to Sam" (icon corner-down-right, 11.5 px, `#6B7686`). The text streams character by character (45 ms per character in the prototype) with a blinking caret (2 × 15 px, `#3563E9`).

**Bottom area:** padding 12 16 16, gap 10.
- **Raised hand:** `display:flex; gap:10; padding:10px 10px 10px 12px; border:1px solid #F3CFBB; background:#FDF5F0; radius:10`. On the left a 28 px square (radius 8) `#C84A14` with a hand icon (15 px, white). Text 13 px: **"Critic raises a hand"** (600, `#9A360A`) " – objection about the costs" (`#3F4A5A`). Button "Listen" (`Anhören`): 30 px, `border:1px solid #E9B89D; color:#9A360A`, white, hover `#FBE7DC`. Click: the card disappears and the critic posts its objection in the chat.
- **Input (composer):** form, `border:1px solid #D9DFE7; radius:12; shadow 0 1px 2px rgba(16,24,40,.05)`.
  - Input 44 px, padding 0 14, 13.5 px, no border. Placeholder "Message the team and agents, @ calls an agent" (`#7A8595`).
  - Tool row (padding 0 8 8): 28 px icon buttons (radius 7, ghost, hover `#F1F4F7`) for "@" (inserts `@` and should open the agent menu) and "Attach" (paperclip). On the right the hint "Enter to send" (11.5 px `#7A8595`) and a 28 px primary send button with arrow-up.

### 3. Canvas (flexible, ≈ 728 × 788 px)
**Header (52 px):** tab "Main canvas" (`Haupt-Canvas`; active: 30 px, padding 0 12, radius 8, `#F1F4F7`, 500) and ghost button "+ Board" (plus icon 13 px, `#4A5565`, hover `#F1F4F7`).

**Surface:** `background-color:#F6F7F9`, dot grid `radial-gradient(#D3D9E1 1px, transparent 1.3px)` at 20 × 20 px. The surface is infinite (pan and zoom); all coordinates below refer to the visible area at 100 %.

**Frame "Architecture":** x 24, y 36, 676 × 392, `border:1px solid #CFD7E1; radius:14; background:rgba(255,255,255,.55)`. Header inside (left 14, top 12): frame icon 14 px `#4A5565`, "Architecture" 600, "5 blocks" 12 px `#6B7686`.

**Block – base structure (all states):** 180 × 96 (server 190 × 96), radius 12, flex column.
- Content (flex 1, padding 0 12, gap 10): 30 × 30 icon tile (radius 8, `#F1F4F7`, `1px solid #E3E8EE`, icon 15 px, stroke 1.8, `#3F4A5A`). Title 13.5 px/600, subtitle 11.5 px `#6B7686`.
- Author line: 30 px high, `border-top:1px solid #EEF1F4`, padding 0 12, gap 6, 11.5 px. For humans a round 16 px avatar (`#E6EAF0`, initials 8–9 px/600) with the name in `#4A5565`. For agents a 16 px square (radius 5) in the agent color with a letter, name in the dark agent color (500).

**The four block states (core requirement):**

| State | Border | Background / shadow | Extra |
|---|---|---|---|
| **Normal** | `1px solid #DBE1E8` | `#FFF`, `0 1px 2px rgba(16,24,40,.05), 0 2px 8px rgba(16,24,40,.04)` | – |
| **Just changed by AI** | `1.5px solid <agent color>` | `#FFF`, ring `0 0 0 4px <agent color @16 %>` + `0 6px 16px <agent color @14 %>` | pill right-aligned above the block (top −27, 22 px high, radius 6, agent color, white, 11.5 px/500, sparkle icon 12 px): "Just drawn". Icon tile and subtitle use the agent tint and the dark agent color. After a few seconds the block returns to normal. |
| **Proposal** | `1.5px dashed <agent color>` | `rgba(253,245,240,.94)` (agent tint) | header "Proposal · Critic" with a mini avatar. The icon tile has a dashed border. Buttons "Apply" (primary 28) and "Reject" (secondary 28). The connection is dashed (`5 4`) in the agent color and has no arrowhead. Width 216 px, padding 12, gap 10. |
| **Locked (a human is editing)** | `1.5px solid #1E2733` | `#FAFBFC`, ring `0 0 0 4px rgba(30,39,51,.07)`, `cursor:not-allowed` | pill left above the block (top −27, `#1E2733`, white): lock icon + "Sam is editing". A blinking text caret `#1E2733` in the title. |

**Blocks in the example (x, y, state, subtitle, author):**
- Web app: 52, 84, normal, "Frontend", You (icon app-window)
- Covibes server: 330, 84, **locked**, "Server · hosting open", Backend (icon server)
- GitLab: 52, 292, normal, "Repository", Alex (icon git-branch)
- PostgreSQL: 274, 292, normal, "Database · EU", Data (icon database)
- AI gateway: 496, 292, **changed by AI (moderator)**, "Service · new", Moderator (icon network)
- Cost limits: 476, 456, **proposal (critic)**, "Budget per agent and day" (icon gauge)

**Arrows:** line color `#8792A2`, 1.5 px, filled arrowhead. If the target or the edge was just changed by AI, the edge is drawn in the agent color at 1.75 px (here API in `#0F7F8A`). The curves are cubic Béziers from the bottom edge to the top edge.
- REST: web app → server (straight line, y 132)
- Jobs: server (395,180) → GitLab (142,288)
- Data: server (425,180) → PostgreSQL (364,288)
- API: server (455,180) → AI gateway (530,288)
- Proposal: AI gateway (586,388) → cost limits (586,452), dashed
- **Label pill** centered on the edge: 20 px high, padding 0 7, radius 6, `#FFF`, `1px solid #DFE4EA`, Geist Mono 11 px `#4A5565`. For AI edges with tint `#F4FAFB`/`#BFE3E6`/`#0B5F68`.

**Sticky note "Offline mode?" (Alex):** x 56, y 462, 176 × 124. `background:#FDF6D3; border:1px solid #ECDD98; radius:4px 4px 14px 4px; rotate(-1.5deg)`, shadow `0 1px 2px rgba(110,90,20,.08), 0 6px 14px rgba(110,90,20,.08)`, padding 14. Title 15 px/600 `#3A3312`, footer "Note · Alex" 11.5 px `#5E5424` with an avatar (`#F1E5AD`).

**Live cursor Sam:** arrow 16 × 18 (`#1E2733`, white border 1.3), below it, offset, a name pill "Sam" (20 px, radius 6, `#1E2733`, white, 11.5 px/500). Human cursors are always graphite.

**Toolbar (bottom center, 16 px from the edge):** `#FFF; border:1px solid #DFE4EA; radius:12; padding:5; gap:2`, shadow `0 1px 2px rgba(16,24,40,.06), 0 8px 24px rgba(16,24,40,.08)`.
- Tools with icon (15 px) and label (12.5 px/500), each 34 px high, padding 0 10 0 8, radius 8: block (square), note (sticky-note), frame (frame), connect (spline), auto-layout (layout-grid). The active tool has a `#151B24` background and white text; the others are transparent with `#1E2733`.
- Divider 1 × 22 `#E3E8EE`. Then zoom: "−" / "100 %" (tabular-nums, min-width 46) / "+", in steps of 10 from 30 to 200.

### 4. Overview (300 px)
Header "Overview" (14 px/600). Below it three sections, each with padding 16, separated by `1px solid #EEF1F4`.

**Waiting for you** + counter badge (20 px, radius 10, `#151B24`, white, 11 px/600, counts live).
- Card: `border:1px solid #E1E6EC; radius:10; padding:12; gap:10`, shadow `0 1px 2px rgba(16,24,40,.04)`.
- Meta line (11.5 px `#6B7686`): 16 px agent mini avatar, agent name (dark agent color, 500), "· Proposal" or "· Approval", time on the right ("2 min ago").
- Card 1 (critic): "Add block **Cost limits**", with [Apply] [Reject]. This action is synchronized with the proposal on the canvas.
- Card 2 (backend): "Create 3 issues in the repository `covibes`" (repository name as a mono chip `#F1F4F7`), with [Approve] [View]. "View" expands the list of issues (AI gateway with queue / database schema for boards / compare hosting variants) and then reads "Close".
- Completed items appear as a line with a green check (`#1B7A43`, 12.5 px `#4A5565`).

**Decisions:** rows with padding 8 0, separated by `#F1F3F6`. 20 px status symbol: decided = circle `#E5F4EA` with check `#1B7A43`; open = dashed ring `1.5px dashed #9AA4B2` plus the chip "open" (`#F1F4F7`). Label 11.5 px `#6B7686`, value 13.5 px/500.
- Canvas: React Flow ✓ · Backend: PostgreSQL ✓ · Server hosting: "Not decided yet" (open). After "Yes, compare" the value reads "Comparison A/B in progress".

**Criteria:** wrapping chips with gap 6: 26 px high, padding 0 9, radius 7, `#F3F5F8`, `1px solid #E3E8EE`, 12.5 px `#253041`. Contents: EU hosting · quality over cost · team: 3 devs.

---

## Interactions & behavior
| Trigger | Result |
|---|---|
| Load | The backend answer streams; the chat status shows "Backend is typing · 1 waiting". |
| "Yes, compare" | The buttons are replaced by a confirmation. After about 0.9 s the moderator posts the variants; the decision "Hosting" changes to "Comparison A/B in progress". (The variant comparison A/B on the canvas follows in V2.) |
| "Later" | Confirmation "Postponed" |
| `[AI-Gateway]` in the chat | The block is highlighted in the state "changed by AI" for about 2.5 s and then returns to normal. In the real app additionally `fitView` or centering on the node. |
| "Listen" | The raised hand disappears, the critic posts its objection, the status changes. |
| "Apply" (canvas or overview) | The proposal becomes a normal block "Cost limits" (author critic, subtitle "Applied by you"), the edge becomes solid with an arrow, the counter decreases. |
| "Reject" | Proposal and edge disappear, the counter decreases, the overview shows "Cost limits rejected". |
| "Approve" | The card disappears and the entry "3 issues created in covibes" appears (the real app calls the GitLab API here). |
| "View" / "Close" | The issue list expands or collapses. |
| Tool click | The tool becomes active (only one at a time). |
| Zoom − / + | Steps of 10, range 30–200 %. |
| Composer: Enter / send | The own message is appended (empty messages are ignored), the field is cleared, the list scrolls down. |
| @ button | Inserts `@`. In the real app an agent menu opens (Moderator, Backend, Critic, Data). |

**Animations:**
- Typing dots: `@keyframes cvdot { 0%,80%,100% { opacity:.25; translateY(0) } 40% { opacity:1; translateY(-2px) } }`, 1.2 s ease-in-out infinite, 0.16 s offset per dot.
- Caret: `@keyframes cvblink` (hard on/off), 1 s infinite.
- For the "changed by AI" highlight, a 200 ms transition on `box-shadow`/`border-color` and fading out after about 4–6 s are recommended.

**Hover:** primary `#151B24 → #2A3340`. Secondary `#FFF → #F5F7F9`. Ghost `transparent → #F1F4F7`. Focus: `outline: 2px solid #151B24; outline-offset: 2px`, on the composer `box-shadow: 0 0 0 3px #D5DDE6`.

**Locks and presence (real app):** when editing a block, the human sets a lock (Yjs awareness through the Covibes server). Everyone else sees the state "locked" with the name, and agents may not change the block during that time. Cursors are broadcast (throttled to 20–30 Hz).

## State (prototype → product)
```ts
type AgentId = 'moderator' | 'backend' | 'kritiker' | 'daten';
type Author = { kind: 'human'; userId: string } | { kind: 'agent'; agent: AgentId };

type BlockState = 'normal' | 'ai_changed' | 'suggestion' | 'locked';
interface CanvasBlock {
  id: string; title: string; subtitle: string; icon: string;
  x: number; y: number; w: number; h: number; frameId?: string;
  author: Author;
  state: BlockState;
  changedAt?: string;                                    // for ai_changed (expiry)
  lockedBy?: string;                                     // userId, for locked
  suggestion?: { by: AgentId; status: 'open' | 'accepted' | 'rejected' };
}
interface Edge { id: string; from: string; to: string; label: 'REST' | 'API' | 'Jobs' | 'Daten' | string; dashed?: boolean; author: Author }
interface Message { id: string; author: Author; text: string; createdAt: string; replyTo?: string; streaming?: boolean; actions?: { id: string; label: string; variant: 'primary' | 'secondary' }[]; refs?: { blockId: string; label: string }[] }
interface HandRaise { agent: AgentId; reason: string; status: 'raised' | 'heard' }
interface PendingItem { id: string; kind: 'suggestion' | 'approval'; by: AgentId; title: string; payload: unknown; status: 'open' | 'done' | 'rejected' }
interface Decision { id: string; topic: string; value?: string; status: 'decided' | 'open' | 'comparing' }
type Phase = 'brainstorming' | 'entscheiden' | 'architektur' | 'projektplan';
```
Prototype state (see `Component` in the HTML file): `typed, compare, critic, sug, release, detail, gw, extra[], draft, tool, zoom`.

## Design tokens
**Neutral colors (cool, low saturation)**
| Token | Hex | Usage |
|---|---|---|
| bg-app | `#EEF1F5` | app background, header |
| bg-panel | `#FFFFFF` | panels, blocks, cards |
| bg-canvas | `#F6F7F9` | canvas surface |
| canvas-dot | `#D3D9E1` | dot grid |
| bg-subtle | `#F1F4F7` | tabs, icon tiles, hover |
| bg-muted | `#F3F5F8` | status pill, chips |
| track | `#E2E7ED` | phase bar |
| border-subtle | `#EEF1F4` | dividers inside panels |
| border | `#E1E6EC` / `#DBE1E8` | panel and block borders |
| border-strong | `#D9DFE7` | secondary buttons, composer |
| frame-border | `#CFD7E1` | frames on the canvas |
| edge | `#8792A2` | arrows |
| text | `#0F1720` | primary text |
| text-body | `#1E2733` | body text in the chat |
| text-2 | `#3F4A5A` / `#4A5565` | secondary text |
| text-3 | `#6B7686` | meta, subtitles (4.6:1 on white) |
| text-4 | `#7A8595` | times, placeholders |
| ink / primary | `#151B24` | primary buttons, active states |
| ink-hover | `#2A3340` | primary hover |
| human | `#1E2733` | lock, live cursor |
| human-avatar | `#E6EAF0` bg / `#253041` fg | human avatars |
| success | `#1B7A43` on `#E5F4EA` | decision made, done |
| note | `#FDF6D3` / border `#ECDD98` / text `#3A3312` | sticky notes |

**Agent colors** (base = avatar/border, dark = text, tint = background, border = card border)
| Agent | Base | Dark | Tint | Border |
|---|---|---|---|---|
| Moderator | `#0F7F8A` | `#0B5F68` | `#DCF0F2` / `#F4FAFB` | `#CDE6E9` / `#BFE3E6` |
| Backend | `#3563E9` | `#2346B0` | `#EEF2FE` | `#C9D6FB` |
| Critic | `#C84A14` | `#9A360A` | `#FBE7DC` / `#FDF5F0` | `#F3CFBB` / `#E9B89D` |
| Data | `#8B4FD6` | `#6532A8` | `#F3ECFC` | `#DCCAF5` |

White text on all base colors reaches at least ≈ 4.5:1.

**Typography:** Geist (400/500/600/700) for the UI, Geist Mono (400/500) for edge labels and repository names; the app serves both locally. `-webkit-font-smoothing: antialiased`, numbers with `font-variant-numeric: tabular-nums`.
| Role | Size / weight |
|---|---|
| Wordmark | 15 / 600, −0.02em |
| Panel title | 14 / 600 |
| Note title | 15 / 600 |
| Block title, chat text | 13.5 / 600 or 400, lh 1.55 |
| UI base, buttons | 13 / 500 |
| Small buttons, chips | 12.5 / 500 |
| Status, meta | 12 / 400 |
| Subtitles, times, authors | 11.5 / 400–500 |
| Badges, edge labels | 11 / 500 (labels in mono) |

**Spacing:** 4 px grid; used values are 2, 4, 6, 8, 10, 12, 14, 16, 18 and 24 px. Panels have 16 px padding inside and 8 px outer spacing and gap.

**Radii:** 5 (badges, mini avatars) · 6 (pills, labels, reference chip) · 7 (buttons S, agent avatar 24) · 8 (buttons M, icon tiles, tabs, agent avatar 28) · 10 (cards, raised hand, phase bar) · 12 (panels, blocks, composer, toolbar) · 14 (frames) · round (human avatars).

**Buttons**
- Primary: `#151B24`, white, 500, `box-shadow: inset 0 1px 0 rgba(255,255,255,.12), 0 1px 2px rgba(16,24,40,.24)`. Size M 30 px (padding 0 12–14, radius 8), size S 28 px (padding 0 10, radius 7, 12.5 px).
- Secondary: `#FFF`, `1px solid #D9DFE7`, `#1E2733`, `0 1px 2px rgba(16,24,40,.05)`.
- Ghost / icon: transparent, 28–34 px, hover `#F1F4F7`.

**Shadows**
- Panel: `0 1px 2px rgba(16,24,40,.04)`
- Block: `0 1px 2px rgba(16,24,40,.05), 0 2px 8px rgba(16,24,40,.04)`
- Floating (toolbar): `0 1px 2px rgba(16,24,40,.06), 0 8px 24px rgba(16,24,40,.08)`
- AI ring: `0 0 0 4px rgba(15,127,138,.16), 0 6px 16px rgba(15,127,138,.14)`
- Lock ring: `0 0 0 4px rgba(30,39,51,.07)`

Style: no gradients, no emojis.

## Assets
- **Icons:** Lucide (https://lucide.dev), included as `lucide-react`. In use: check, chevron-down, chevron-right, plus, minus, lock, hand, arrow-up, at-sign, paperclip, corner-down-right, app-window, server, git-branch, database, network, gauge, square, sticky-note, frame, spline, layout-grid, circle-dot. Stroke width 1.8–2 (up to 3.5 for small checks).
- **Sparkle** (AI marker): custom four-pointed star, SVG path `M12 3c.5 4.8 3.2 7.5 8 8-4.8.5-7.5 3.2-8 8-.5-4.8-3.2-7.5-8-8 4.8-.5 7.5-3.2 8-8z`, filled.
- **Logo:** two overlapping squares (see header). A placeholder until a final logo exists.
- No images or photos are used.

## Files
- `Covibes Main Screen.dc.html`: the main screen as a clickable prototype (open in the browser; `support.js` must sit next to it). The markup structure follows the sections above; the logic is in the class `Component` in the `<script data-dc-script>`.
- `support.js`: runtime only needed to preview the prototype; it does not belong in the app.

## Next steps (not designed yet)
- Step 2: building block overview (design system page)
- Variant comparison A/B for hosting on the canvas
- Phase "Project plan"
