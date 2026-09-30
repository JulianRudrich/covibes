import { nodeLocks, type NodeLock } from '@covibes/shared';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { useCallback, useEffect, useState } from 'react';

export type NodeLocks = {
  /** Lock holder per node, including the own client while it edits. */
  locks: ReadonlyMap<string, NodeLock>;
  ownClientId: number;
  /** Announces that the own client edits a node (or nothing any more). */
  setEditing: (nodeId: string | null) => void;
};

const NO_LOCKS: ReadonlyMap<string, NodeLock> = new Map();

function lockKey(locks: ReadonlyMap<string, NodeLock>): string {
  return [...locks]
    .map(([nodeId, lock]) => `${nodeId}:${String(lock.clientId)}:${lock.name}`)
    .sort()
    .join('|');
}

/**
 * The locks of a board from its awareness (spec 08). The awareness also changes with every cursor
 * move, so the state only changes when the locks do.
 */
export function useNodeLocks(provider: HocuspocusProvider): NodeLocks {
  const awareness = provider.awareness;
  const [locks, setLocks] = useState<ReadonlyMap<string, NodeLock>>(NO_LOCKS);

  useEffect(() => {
    if (!awareness) return;
    let key = '';
    const update = () => {
      const next = nodeLocks(awareness.getStates());
      const nextKey = lockKey(next);
      if (nextKey === key) return;
      key = nextKey;
      setLocks(next);
    };
    update();
    awareness.on('change', update);
    return () => {
      awareness.off('change', update);
      // Leaving the board ends the own lock at once instead of after the awareness timeout.
      awareness.setLocalStateField('editing', null);
    };
  }, [awareness]);

  const setEditing = useCallback(
    (nodeId: string | null) => {
      awareness?.setLocalStateField('editing', nodeId ? { nodeId, since: Date.now() } : null);
    },
    [awareness],
  );

  return { locks, ownClientId: awareness?.clientID ?? -1, setEditing };
}
