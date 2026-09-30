import type { AgentKey } from '@covibes/shared';
import { useLayoutEffect, useState } from 'react';

import { justDrawnRemainingMs } from '@web/features/canvas/flow-mapping';

/**
 * The agent whose change an element currently shows as "just drawn", or null. A timer ends the
 * state once the rest of the 5 s has passed; a change that ran out stays over, so a later check
 * cannot bring it back. The layout effect runs before paint, so an agent change that arrives
 * already old (e.g. after a reconnect) never flashes up.
 */
export function useJustDrawnBy(data: {
  changedByAgent: AgentKey | null;
  lastChangedAt: string;
}): AgentKey | null {
  const { changedByAgent, lastChangedAt } = data;
  const [overAt, setOverAt] = useState(() =>
    justDrawnRemainingMs(data, Date.now()) > 0 ? null : lastChangedAt,
  );

  useLayoutEffect(() => {
    if (changedByAgent === null) return;
    const remaining = justDrawnRemainingMs({ changedByAgent, lastChangedAt }, Date.now());
    if (remaining === 0) {
      setOverAt(lastChangedAt);
      return;
    }
    const timer = setTimeout(() => {
      setOverAt(lastChangedAt);
    }, remaining);
    return () => {
      clearTimeout(timer);
    };
  }, [changedByAgent, lastChangedAt]);

  return overAt === lastChangedAt ? null : changedByAgent;
}
