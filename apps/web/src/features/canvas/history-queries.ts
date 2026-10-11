import type { BoardHistory, BoardHistoryUndo } from '@covibes/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';

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

/**
 * Takes an entry of the history back (spec 38b). The answer says how many of its elements were
 * set back and how many stayed; the history is loaded again either way, so the list says what
 * became of the entry, also when someone else was faster.
 */
export function useUndoHistoryEntry(projectId: string, boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) =>
      api<BoardHistoryUndo>(
        `/projects/${encodeURIComponent(projectId)}/boards/${encodeURIComponent(boardId)}/history/${encodeURIComponent(entryId)}/undo`,
        { method: 'POST' },
      ),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: boardHistoryQueryKey(projectId, boardId) }),
  });
}
