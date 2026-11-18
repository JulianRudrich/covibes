import type { Author, CanvasNode, Position } from '@covibes/shared';

import type { BoardAccess } from '@server/collab/board-client';
import type { CanvasRules } from '@server/tools/canvas-writer';
import type { RunCommands } from '@server/tasks/run-commands';

/**
 * What every canvas tool needs: the board it works on, the agent it acts for and the rules of the
 * run (spec 13); without rules every change runs directly.
 */
export type CanvasToolOptions = {
  boards: BoardAccess;
  boardId: string;
  author: Author;
  rules?: CanvasRules;
  /** Durable command identity for an agent run; absent in isolated tool tests. */
  commands?: RunCommands;
};

/** Roughly the middle of the visible canvas at the default view (100 %, no scrolling). */
const DEFAULT_CENTER: Position = { x: 360, y: 320 };

/** New elements go next to the existing ones: around their center, or in view on an empty board. */
export function centerOfNodes(nodes: readonly CanvasNode[]): Position {
  if (nodes.length === 0) return DEFAULT_CENTER;
  const sum = nodes.reduce(
    (total, node) => ({
      x: total.x + node.position.x + node.size.width / 2,
      y: total.y + node.position.y + node.size.height / 2,
    }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / nodes.length, y: sum.y / nodes.length };
}

/** A position for the model to read, e.g. "40, 60". */
export function describePosition(position: Position): string {
  return `${String(Math.round(position.x))}, ${String(Math.round(position.y))}`;
}
