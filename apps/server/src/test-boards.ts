import type { NodeLock } from '@covibes/shared';
import * as Y from 'yjs';

import type { BoardAccess } from '@server/collab/board-client';

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
