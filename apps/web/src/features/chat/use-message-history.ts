import type { MessageCursor, MessagePage } from '@covibes/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { mergeServerMessages } from '@web/features/chat/message-cache';
import { messagesQueryKey, type ChatItem } from '@web/features/chat/types';
import { api } from '@web/lib/api';

/** History has its own cursor; live events keep using the existing message-array cache. */
export function useMessageHistory(projectId: string) {
  const client = useQueryClient();
  const cursorKey = ['projects', projectId, 'message-history-cursor'] as const;
  const [cursor, setCursor] = useState<MessageCursor | null | undefined>(() =>
    client.getQueryData(cursorKey),
  );
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
    try {
      let before = context ? context.before : cursor;
      if (before === undefined) before = (await api<MessagePage>(base)).before;
      if (before === null) {
        if (!context) {
          setCursor(null);
          client.setQueryData(cursorKey, null);
        }
        return;
      }
      const page = await api<MessagePage>(
        `${base}?before=${encodeURIComponent(JSON.stringify(before))}`,
      );
      if (context) {
        setContext(
          (current) =>
            current && { ...page, items: mergeServerMessages(page.items, current.items) },
        );
      } else {
        client.setQueryData<ChatItem[]>(messagesQueryKey(projectId), (current) =>
          mergeServerMessages(page.items, current ?? []),
        );
        setCursor(page.before);
        client.setQueryData(cursorKey, page.before);
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
