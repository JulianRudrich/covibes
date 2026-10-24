# Handoff: Covibes Studio (design pass, spec 36)

## Overview
The design of Covibes from spec 36 on, approved by the owner on 2026-10-24. It replaces the look of the main-screen handoff (`../main-screen/`) and keeps its principles and behavior. The UI language is German; the labels of the prototype are German.

`Covibes Studio.dc.html` is a clickable prototype of the main screen (desktop, 1440 × 900) in the phase "Architektur", light and dark. It opens in the browser with `support.js` next to it, served by any static server (e.g. the `design` entry of `.claude/launch.json`). The theme switches with the moon/sun button at the top right; "Szene neu abspielen" in the overview restarts the scene.

**Fidelity:** high. Colors, type, radii, shadows, layout and motion are the reference. Contents are sample data as before.

## How it came about
Three directions were drawn (A precise and dense, B a warm shared space with floating panels, C a dark command center). The owner chose a synthesis:
- **Layout fixed by the owner:** chat left, canvas center, overview right.
- **From B:** rounded, soft surfaces, pill buttons, chat bubbles (own messages on the right), the phase bar "Schritt 3 von 4 · Architektur" with four segments.
- **From C:** the live state of the agents at the top right (typing glow, raised hand badge).
- **From A:** mono type for edge labels, repository names and code.
- **Agent marks instead of letters:** the owner rejected letters in colored squares as unprofessional. Every agent has a glyph on a soft tint (see "Agent marks").

## Principles (unchanged from the main-screen handoff)
- Color belongs to the agents. Humans stay neutral. The main action is always ink, never an agent color.
- Authorship is always visible: every message and every block names its author.
- Humans and agents differ in shape: humans round with initials, agents rounded squares with their mark.
- No gradients, no emojis, no photos.

## Themes
Light and dark are both part of V1. The app follows the system setting until the person picks one; the choice is kept per device. Every token has a light and a dark value.

### Neutral tokens
| Role | Light | Dark |
|---|---|---|
| App background | `#ECEAE6` | `#0F0E0D` |
| Panel, block, card | `#FFFFFF` | `#1A1917` |
| Subtle surface (bubbles, chips, composer) | `#F4F2EF` | `#24221F` |
| Canvas | `#F8F7F4` | `#141312` |
| Canvas dot (1.2 px, every 24 px) | `#D8D4CC` | `#2B2926` |
| Frame fill | `rgba(255,255,255,.6)` | `rgba(255,250,240,.025)` |
| Line | `#E7E4DF` | `#2E2C29` |
| Line strong | `#D9D5CE` | `#3D3B36` |
| Track (empty phase segment) | `#E3E0DA` | `#34322E` |
| Text | `#1B1A18` | `#F2F0EC` |
| Text 2 (body secondary) | `#4A4741` | `#C8C4BC` |
| Text 3 (meta, ≥ 4.5:1) | `#736F67` | `#99948B` |
| Ink (primary action) / on ink | `#1B1A18` / `#FFFFFF` | `#F2F0EC` / `#141311` |
| Human avatar bg / fg | `#EAE7E1` / `#38352F` | `#35322E` / `#E6E2DB` |
| Edge | `#A09A90` | `#716C64` |
| Success / bg | `#1F7A45` / `#E4F2E8` | `#5BD08C` / `rgba(91,208,140,.14)` |
| Note bg / text / meta / avatar | `#FCEFB4` / `#3A3312` / `#5E5424` / `#F1E09A` | `#4A4120` / `#F7EDC4` / `#D6CA94` / `#5E5329` |

### Agent colors (the four of the prototype)
Each agent has base (mark, borders), ink (text on tint), tint (backgrounds), tint solid (an opaque tint where marks overlap), line (borders on tint) and on (text on base).

| Agent | | Light | Dark |
|---|---|---|---|
| Moderator | base / ink / tint / line | `#0E7C74` / `#0A5C56` / `#E3F2EF` / `#C3E2DC` | `#3CC2B4` / `#8FE0D6` / `rgba(60,194,180,.12)` / `rgba(60,194,180,.34)` |
| Backend | base / ink / tint / line | `#3B5BDB` / `#2A44A8` / `#EDF0FD` / `#CAD5F8` | `#7B95FF` / `#B3C1FF` / `rgba(123,149,255,.13)` / `rgba(123,149,255,.36)` |
| Critic | base / ink / tint / line | `#C9501B` / `#97380D` / `#FBECE3` / `#F1CDB8` | `#F0844E` / `#FFBC97` / `rgba(240,132,78,.13)` / `rgba(240,132,78,.38)` |
| Data | base / ink / tint / line | `#8A4FD0` / `#6634A6` / `#F3ECFB` / `#DDCBF3` | `#B98BF5` / `#D9C3FF` / `rgba(185,139,245,.13)` / `rgba(185,139,245,.36)` |

Tint solid in dark: moderator `#1C2E2B`, backend `#22263A`, critic `#352319`, data `#2C2436`; in light it equals the tint. The other catalog agents and the six custom colors follow the same rules (spec 36a sets their values): in dark the base gets lighter until white text no longer works and dark text on it reaches 4.5:1, ink reaches 4.5:1 on the panel, tint is the base at 12–14 % over the panel.

## Typography
| Role | Font | Size / weight |
|---|---|---|
| Wordmark | Bricolage Grotesque | 18 / 700, −0.025em |
| Panel titles ("Chat", "Wartet auf dich") | Bricolage Grotesque | 17 / 600, −0.01em |
| Section titles, phase name | Bricolage Grotesque | 15.5 / 600 |
| Note title | Bricolage Grotesque | 17 / 600 |
| Body, chat | Figtree | 13.5 / 400, line height 1.5–1.55 |
| Block title | Figtree | 14 / 600 |
| Buttons | Figtree | 13 / 600 |
| Meta, times, authors | Figtree | 12 / 400–600 |
| Edge labels, repository names, code | JetBrains Mono | 11–12 / 400–500 |

All three fonts are OFL-1.1 and are served locally via `@fontsource-variable`, never from a font CDN. Numbers use `tabular-nums`.

## Shape
- **Radii:** main panels 24, cards in the overview 18, blocks 18, moderator card 20, bubbles 18 with the corner at the author 6, note `6 6 22 6`, frame 28, agent marks 30 % of their size (30 px → 10), chips and buttons fully round.
- **Shadows (light):** block `0 1px 2px rgba(40,30,10,.05), 0 4px 14px rgba(40,30,10,.07)`; panel `0 1px 2px rgba(40,30,10,.04), 0 10px 30px rgba(40,30,10,.06)`; floating (toolbar) `0 2px 6px rgba(40,30,10,.06), 0 16px 40px rgba(40,30,10,.14)`. **Dark:** block `0 2px 10px rgba(0,0,0,.35)`; panel `0 0 0 1px rgba(255,250,240,.04), 0 10px 30px rgba(0,0,0,.35)`; floating `0 0 0 1px rgba(255,250,240,.05), 0 16px 40px rgba(0,0,0,.55)`.
- Panels have no border; their shadow and the app background set them apart.

## Layout (1440 × 900)
- Rows `64px 1fr`. Columns `372px minmax(0,1fr) 300px`, gap 12, padding `0 12px 12px`.
- **Top bar** (on the app background): logo, wordmark, "/", project menu (pill) on the left; the phase bar centered; "Im Raum", theme button and "Teilen" on the right.
- **Phase bar:** a pill on the panel, 44 high: "Schritt 3 von 4" (meta), the phase name (section title), four segments 30 × 6 (done: text color; current: track with 60 % filled at 55 % opacity; upcoming: track), "Danach: Projektplan" (meta).
- **"Im Raum":** a pill on the panel, 44 high. Humans as overlapping 30 px circles with a 2.5 px ring in the panel color, an online dot (9 px, success) on whoever is active. A 1 px divider. Agents as overlapping 30 px marks. The agent that is writing glows (`cvglow`), an agent with a raised hand carries a 16 px hand badge in its base color.
- **Chat:** title row 58 high, messages bottom-aligned with gap 14, then the raised hand and the composer. Others' bubbles on the left with a 30 px avatar, own bubbles on the right in ink without an avatar. Agent bubbles are in the agent's tint. The moderator writes a card (tint, 1 px line inside, radius 20) with a "neutral" chip and pill buttons; after a choice a line with a check replaces the buttons. Canvas references are pills in the author's base color with white text. The composer is a pill 52 high on the subtle surface: @, input, attach, send (ink, round).
- **Canvas:** board tabs as pills at the top left, "Verlauf" at the top right, the toolbar as a pill at the bottom center (40 px round tools, the active one in ink; zoom with tabular numbers).
- **Overview:** "Wartet auf dich" with a count pill, cards on the subtle surface (radius 18), completed items as a line with a green check; "Entscheidungen" as rows with a status circle; "Kriterien" as outlined pills.

## Blocks (four states, behavior unchanged)
180 × 96, radius 18, padding 12 14, a round 32 px icon tile on the subtle surface, title 14/600, subtitle 12, the author line at the bottom (20 px avatar or mark and name).
| State | Look |
|---|---|
| Normal | panel, block shadow, no border |
| Just changed by AI | `0 0 0 2px base, 0 0 0 7px <base ring>, 0 10px 24px <base ring>`, a pulsing outline (`cvring`), the pill "Gerade gezeichnet" (base, white, sparkle twinkling) above it; fades back after about 6 s |
| Proposal | 2 px dashed base, tint, radius 20, header "Vorschlag vom <Agent>", dashed icon tile, "Übernehmen" and "Ablehnen" as pills; the edge dotted (`2 6`) without a head |
| Locked | `0 0 0 2px <cursor>, 0 0 0 7px <lock ring>`, pill "Sam bearbeitet" with a lock above it, a blinking caret in the title, `cursor: not-allowed` |

Edges: 2 px, round caps, an open chevron head; an agent's edge 2.25 px in its base. Labels are pills in mono on the panel.

## Agent marks
An agent's avatar is a rounded square in its **tint** with a 1 px inner line in its **line** color and its glyph in its **base** color. The glyphs are filled 24 × 24 paths (`fill-rule: evenodd`), shown at about 52 % of the avatar.
| Agent | Glyph | Meaning |
|---|---|---|
| Moderator | ring with a center dot | balance, neutral |
| Backend | three stacked layers, the middle one wider | layers of a system |
| Critic | lightning bolt | objection |
| Data | three rising bars | figures |

Paths (from the prototype):
- Moderator `M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19zM12 5.2a6.8 6.8 0 1 0 0 13.6 6.8 6.8 0 0 0 0-13.6zM12 8.6a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8z`
- Backend `M7.5 3h9a2 2 0 0 1 0 4h-9a2 2 0 0 1 0-4zM4.5 10h15a2 2 0 0 1 0 4h-15a2 2 0 0 1 0-4zM7.5 17h9a2 2 0 0 1 0 4h-9a2 2 0 0 1 0-4z`
- Critic `M13.6 1.8 4.4 13.2c-.5.7 0 1.6.8 1.6h5.4l-1.1 6.9c-.1.6.6 1 1 .5l9.1-11.4c.5-.7 0-1.6-.8-1.6h-5.4l1.2-6.9c.1-.6-.6-1-1-.5z`
- Data `M5 13h2.5a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 7.5 21H5a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 5 13zM10.75 8h2.5a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5h-2.5a1.5 1.5 0 0 1-1.5-1.5v-10A1.5 1.5 0 0 1 10.75 8zM16.5 3H19a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 19 21h-2.5a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 16.5 3z`

The other catalog agents and custom agents get glyphs of the same kind (spec 36a).

## Motion
| Name | What | Timing |
|---|---|---|
| `cvdot` | typing dots | 1.2 s, 0.16 s offset per dot |
| `cvblink` | streaming and editing caret | 1 s, hard on/off |
| `cvrise` | a message or card appears: from 8 px below and transparent | 0.45 s ease-out, staggered 80 ms on first load |
| `cvpop` | a confirmation, a badge, a chip appears: from 96 % | 0.25–0.35 s ease-out |
| `cvring` | the outline of a block just drawn widens and fades | 2 s ease-out, repeating while the block is fresh |
| `cvtwinkle` | the sparkle in "Gerade gezeichnet" | 1.6 s |
| `cvglow` | the mark of an agent that is writing | 1.6 s |
| hover | blocks lift by 2 px; buttons brighten; ghost buttons get a neutral 12 % wash | 0.15–0.2 s |
| press | buttons move 1 px down and scale to 98 % | 0.08 s |

The live cursor drift in the prototype only stands in for a moving cursor. With `prefers-reduced-motion: reduce` every animation and transition is off.
