import type { MessagePage } from '@covibes/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { mergeServerMessages } from '@web/features/chat/message-cache';
import {
  messageHistoryCursorKey,
  messagesQueryKey,
  type ChatItem,
  type MessageHistoryState,
} from '@web/features/chat/types';
import { api } from '@web/lib/api';

/** History has its own cursor; live events keep using the existing message-array cache. */
export function useMessageHistory(projectId: string) {
  const client = useQueryClient();
  const cursorKey = messageHistoryCursorKey(projectId);
  const historyState = useQuery({
    queryKey: cursorKey,
    queryFn: () => Promise.resolve<MessageHistoryState>({ generation: 0, before: undefined }),
    enabled: false,
  }).data;
  const cursor = historyState?.before;
  const [context, setContext] = useState<MessagePage | null>(null);
  const [focusId, setFocusId] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const base = `/projects/${encodeURIComponent(projectId)}/message-history`;

  async function loadOlder() {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setFailed(false);
    const generation = historyState?.generation ?? 0;
    const stale = () =>
      !context &&
      (client.getQueryData<MessageHistoryState>(cursorKey)?.generation ?? 0) !== generation;
    try {
      let before = context ? context.before : cursor;
      if (before === undefined) before = (await api<MessagePage>(base)).before;
      if (stale()) return;
      if (before === null) {
        if (!context) {
          client.setQueryData<MessageHistoryState>(cursorKey, { generation, before: null });
        }
        return;
      }
      const page = await api<MessagePage>(
        `${base}?before=${encodeURIComponent(JSON.stringify(before))}`,
      );
      if (stale()) return;
      if (context) {
        setContext(
          (current) =>
            current && { ...page, items: mergeServerMessages(page.items, current.items) },
        );
      } else {
        client.setQueryData<ChatItem[]>(messagesQueryKey(projectId), (current) =>
          mergeServerMessages(page.items, current ?? []),
        );
        client.setQueryData<MessageHistoryState>(cursorKey, { generation, before: page.before });
      }
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }

  async function openMessage(id: string) {
    if (busy.current) return;
    busy.current = true;
    setFocusId(undefined);
    setLoading(true);
    setFailed(false);
    try {
      const page = await api<MessagePage>(`${base}/${encodeURIComponent(id)}`);
      setContext(page);
      setFocusId(id);
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }

  function latest() {
    setContext(null);
    setFocusId(undefined);
  }
  return {
    context,
    focusId,
    loading,
    failed,
    hasOlder: context ? context.before !== null : cursor !== null,
    loadOlder,
    openMessage,
    latest,
  };
}
