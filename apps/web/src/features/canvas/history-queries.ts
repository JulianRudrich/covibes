import type { BoardHistory } from '@covibes/shared';
import { queryOptions } from '@tanstack/react-query';

import { api } from '@web/lib/api';

export function boardHistoryQueryKey(projectId: string, boardId: string) {
  return ['projects', projectId, 'boards', boardId, 'history'] as const;
}

/**
 * The history of a board (spec 38a). Only the open dialog holds it; the live channel loads it
 * again whenever the board gets an entry.
 */
export function boardHistoryQuery(projectId: string, boardId: string) {
  return queryOptions({
    queryKey: boardHistoryQueryKey(projectId, boardId),
    queryFn: () =>
      api<BoardHistory>(
        `/projects/${encodeURIComponent(projectId)}/boards/${encodeURIComponent(boardId)}/history`,
      ),
  });
}
