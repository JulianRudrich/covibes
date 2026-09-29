import type { HocuspocusProvider } from '@hocuspocus/provider';
import { useReactFlow } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useState, type PointerEvent } from 'react';

import {
  remoteCursors,
  type AwarenessUser,
  type RemoteCursor,
} from '@web/features/canvas/awareness';
import { throttle } from '@web/lib/throttle';

/** About 30 updates per second, as agreed for live cursors. */
const CURSOR_INTERVAL_MS = 33;

/**
 * Live cursors through the Yjs awareness of the board. The own cursor is sent in flow coordinates,
 * so it lands on the same spot for everyone regardless of their zoom and scroll position.
 */
export function useLiveCursors(provider: HocuspocusProvider, user: AwarenessUser) {
  const { screenToFlowPosition } = useReactFlow();
  const [cursors, setCursors] = useState<RemoteCursor[]>([]);

  useEffect(() => {
    const awareness = provider.awareness;
    if (!awareness) return;
    awareness.setLocalStateField('user', { id: user.id, name: user.name });
    const update = () => {
      setCursors(
        remoteCursors(awareness.getStates(), { clientId: awareness.clientID, userId: user.id }),
      );
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

  return { cursors, onPointerMove, onPointerLeave };
}
