import type { CanvasOperationInput, NodeLock, ProposalReason } from '@covibes/shared';
import * as Y from 'yjs';

import type { BoardAccess } from '@server/collab/board-client';
import type { Intent } from '@server/rules/decide';
import type { CanvasRules } from '@server/tools/canvas-writer';

/**
 * Boards as plain Y.Docs, the way the collaboration server holds them, for tests of agent tools and
 * runs. `lock` lets a test pretend that someone edits a node.
 */
export function memoryBoards() {
  const docs = new Map<string, Y.Doc>();
  const locks = new Map<string, NodeLock>();

  function doc(boardId: string) {
    let existing = docs.get(boardId);
    if (!existing) {
      existing = new Y.Doc();
      docs.set(boardId, existing);
    }
    return existing;
  }

  const boards: BoardAccess = {
    withBoard: async (boardId, fn) => fn(doc(boardId), { locks: () => new Map(locks) }),
  };

  function lock(nodeId: string, name: string) {
    locks.set(nodeId, { clientId: locks.size + 2, userId: name.toLowerCase(), name, since: 1 });
  }

  return { boards, doc, lock };
}

/**
 * The rules of a run for tests of tools (spec 13): an intent, the proposals-only mode and a
 * proposal kept in memory, with the reason of every addition.
 */
export function memoryRules(intent: Intent = 'instruction', proposalsOnly = false) {
  const operations: CanvasOperationInput[] = [];
  const reasons: ProposalReason[] = [];
  const names: Record<string, string> = {};
  const rules: CanvasRules = {
    intent: Promise.resolve(intent),
    proposalsOnly,
    proposal: {
      operations,
      add: (added, reason, addedNames) => {
        operations.push(...added);
        reasons.push(reason);
        Object.assign(names, addedNames);
        return Promise.resolve();
      },
    },
  };
  return { rules, operations, reasons, names };
}
