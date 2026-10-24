import {
  presentUsers,
  remoteCursors,
  type AwarenessUser,
  type RemoteCursor,
} from '@covibes/shared';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { useReactFlow } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useState, type PointerEvent } from 'react';

import { throttle } from '@web/lib/throttle';

/** About 30 updates per second, as agreed for live cursors. */
const CURSOR_INTERVAL_MS = 33;

const NOBODY: readonly string[] = [];

/**
 * Live cursors through the Yjs awareness of the board, and who else is on it. The own cursor is sent in flow coordinates,
 * so it lands on the same spot for everyone regardless of their zoom and scroll position.
 */
export function useLiveCursors(provider: HocuspocusProvider, user: AwarenessUser) {
  const { screenToFlowPosition } = useReactFlow();
  const [cursors, setCursors] = useState<RemoteCursor[]>([]);
  const [present, setPresent] = useState<readonly string[]>(NOBODY);

  useEffect(() => {
    const awareness = provider.awareness;
    if (!awareness) return;
    awareness.setLocalStateField('user', { id: user.id, name: user.name });
    const update = () => {
      const own = { clientId: awareness.clientID, userId: user.id };
      setCursors(remoteCursors(awareness.getStates(), own));
      // A new list only when someone came or went, so listeners do not run on every move.
      const next = presentUsers(awareness.getStates(), own);
      setPresent((previous) => (previous.join(' ') === next.join(' ') ? previous : next));
    };
    update();
    awareness.on('change', update);
    return () => {
      awareness.off('change', update);
    };
  }, [provider, user.id, user.name]);

  const sendCursor = useMemo(
    () =>
      throttle((position: { x: number; y: number } | null) => {
        provider.awareness?.setLocalStateField('cursor', position);
      }, CURSOR_INTERVAL_MS),
    [provider],
  );
  useEffect(() => sendCursor.cancel, [sendCursor]);

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      sendCursor(screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    },
    [sendCursor, screenToFlowPosition],
  );

  const onPointerLeave = useCallback(() => {
    sendCursor(null);
  }, [sendCursor]);

  return { cursors, present, onPointerMove, onPointerLeave };
}
