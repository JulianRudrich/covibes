import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useEffect, useState, useSyncExternalStore } from 'react';

import { sessionQuery } from '@web/features/auth/session';
import {
  BoardConnection,
  collabUrl,
  type BoardConnectionState,
} from '@web/features/canvas/board-connection';

const IDLE: BoardConnectionState = { status: 'connecting', loaded: false, denied: false };
const noop = () => () => undefined;

/**
 * Connects to the Y.Doc of a board while the component is mounted. When the server refuses the
 * board, the session is loaded again: if it has expired, the user signs in and comes back here.
 */
export function useBoardDoc(boardId: string) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [connection, setConnection] = useState<BoardConnection | null>(null);

  useEffect(() => {
    const next = new BoardConnection({
      boardId,
      url: collabUrl(window.location),
      onDenied: () => {
        void queryClient
          .query({ ...sessionQuery, staleTime: 0 })
          .then((user) => {
            if (user) return;
            return router.navigate({
              to: '/login',
              search: { redirect: router.state.location.href },
              replace: true,
            });
          })
          .catch(() => undefined);
      },
    });
    setConnection(next);
    return () => {
      setConnection((current) => (current === next ? null : current));
      next.destroy();
    };
  }, [boardId, queryClient, router]);

  const state = useSyncExternalStore(
    connection?.subscribe ?? noop,
    connection?.getSnapshot ?? (() => IDLE),
  );
  return { connection, ...state };
}
