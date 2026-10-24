import type { AgentKey } from '@covibes/shared';

// The marks of the agents (spec 36a; handoff "Agent marks"): filled glyphs on a 24 × 24 grid,
// drawn with `fill-rule: evenodd`, so a ring is a circle with a circle cut out. They replace the
// letters, which looked like placeholders.

/** The glyph of every catalog agent. */
export const CATALOG_MARKS: Readonly<Record<AgentKey, string>> = {
  // A ring with a center dot: balance, neutral.
  moderator:
    'M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19zM12 5.2a6.8 6.8 0 1 0 0 13.6 6.8 6.8 0 0 0 0-13.6zM12 8.6a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8z',
  // Three stacked layers of a system.
  backend:
    'M7.5 3h9a2 2 0 0 1 0 4h-9a2 2 0 0 1 0-4zM4.5 10h15a2 2 0 0 1 0 4h-15a2 2 0 0 1 0-4zM7.5 17h9a2 2 0 0 1 0 4h-9a2 2 0 0 1 0-4z',
  // A lightning bolt: the objection.
  critic:
    'M13.6 1.8 4.4 13.2c-.5.7 0 1.6.8 1.6h5.4l-1.1 6.9c-.1.6.6 1 1 .5l9.1-11.4c.5-.7 0-1.6-.8-1.6h-5.4l1.2-6.9c.1-.6-.6-1-1-.5z',
  // Three rising bars: figures.
  data: 'M5 13h2.5a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 7.5 21H5a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 5 13zM10.75 8h2.5a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5h-2.5a1.5 1.5 0 0 1-1.5-1.5v-10A1.5 1.5 0 0 1 10.75 8zM16.5 3H19a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 19 21h-2.5a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 16.5 3z',
  // A flag: where the product is headed.
  product:
    'M5 3.5a1.5 1.5 0 0 1 1.5 1.5v.6h11.2c.9 0 1.4 1 .9 1.7L16.4 10l2.2 2.7c.5.7 0 1.7-.9 1.7H6.5V20a1.5 1.5 0 0 1-3 0V5A1.5 1.5 0 0 1 5 3.5z',
  // A window: the interface.
  frontend:
    'M5 3h14a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zM5 9v8.5c0 .3.2.5.5.5h13c.3 0 .5-.2.5-.5V9z',
  // A hexagonal nut: operations.
  devops:
    'M10.5 2.9a3 3 0 0 1 3 0l6 3.4a3 3 0 0 1 1.5 2.6v6.2a3 3 0 0 1-1.5 2.6l-6 3.4a3 3 0 0 1-3 0l-6-3.4A3 3 0 0 1 3 15.1V8.9a3 3 0 0 1 1.5-2.6zM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
  // A shield.
  security:
    'M11.3 2.2a2 2 0 0 1 1.4 0l6 2.3A2 2 0 0 1 20 6.4v4.8c0 5-3.3 9-7.4 10.7a1.6 1.6 0 0 1-1.2 0C7.3 20.2 4 16.2 4 11.2V6.4a2 2 0 0 1 1.3-1.9z',
  // A node with three around it: a model.
  ml: 'M12 8.8a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4zM12 2.3a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4zM5.5 15.3a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4zM18.5 15.3a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4z',
  // A quotation mark: words.
  content:
    'M4 11c0-4 2.2-6.6 5.5-7.5l.8 1.8C8.4 6.2 7.4 7.6 7.2 9.5H9a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM13 11c0-4 2.2-6.6 5.5-7.5l.8 1.8c-1.9.9-2.9 2.3-3.1 4.2H18a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2z',
};

/** The glyphs for custom agents: plain shapes that none of the catalog uses. */
export const CUSTOM_MARKS: readonly string[] = [
  // circle
  'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z',
  // diamond
  'M10.6 2.9a2 2 0 0 1 2.8 0l7.7 7.7a2 2 0 0 1 0 2.8l-7.7 7.7a2 2 0 0 1-2.8 0l-7.7-7.7a2 2 0 0 1 0-2.8z',
  // triangle
  'M10.3 3.9a2 2 0 0 1 3.4 0l7.6 13.1A2 2 0 0 1 19.6 20H4.4a2 2 0 0 1-1.7-3z',
  // framed square
  'M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zM8 7.5a.5.5 0 0 0-.5.5v8c0 .3.2.5.5.5h8c.3 0 .5-.2.5-.5V8a.5.5 0 0 0-.5-.5z',
  // plus
  'M10.5 3h3a1 1 0 0 1 1 1v5.5H20a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-5.5V20a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-5.5H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h5.5V4a1 1 0 0 1 1-1z',
  // drop
  'M12 2.5c3.3 4 6.5 7.8 6.5 11.5a6.5 6.5 0 0 1-13 0c0-3.7 3.2-7.5 6.5-11.5z',
  // leaf
  'M20 4c0 9-5 15-12.5 15-1 0-2-.2-2.8-.5L3 20.5 2 19.5l2-1.8C3.7 16.9 3.5 16 3.5 15 3.5 8.5 10 4 20 4z',
  // crescent
  'M14 3a9 9 0 1 0 7 14.6A8 8 0 0 1 14 3z',
  // star
  'M12 2.8l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.6l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z',
  // two dots
  'M7.5 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM16.5 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z',
  // wide ring
  'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z',
  // arrow up
  'M11.3 3.3a1 1 0 0 1 1.4 0l7.2 7.2a.9.9 0 0 1-.6 1.5H15v8a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-8H4.7a.9.9 0 0 1-.6-1.5z',
];

/**
 * The glyph of a custom agent, until its creator can choose one (spec 36c): it follows from the
 * agent's id, so the agent looks the same everywhere and for everyone.
 */
export function customMark(agentKey: string): string {
  let hash = 0;
  for (const char of agentKey) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return CUSTOM_MARKS[hash % CUSTOM_MARKS.length] ?? CUSTOM_MARKS[0] ?? '';
}
