import type { ChatMessage } from '@covibes/shared';

import type { ChatItem } from '@web/features/chat/types';

/** Oldest first, like the server; ISO timestamps in UTC sort as strings. Ties go by id. */
export function compareItems(a: ChatItem, b: ChatItem): number {
  const timestamp = (value: string) =>
    value.replace(/\.(\d{1,6})Z$/, (_, fraction: string) => `.${fraction.padEnd(6, '0')}Z`);
  const aTime = timestamp(a.createdAt);
  const bTime = timestamp(b.createdAt);
  if (aTime !== bTime) return aTime < bTime ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

function isConfirmed(item: ChatItem): boolean {
  return item.delivery === undefined;
}

/**
 * Inserts a message or replaces the one with the same id, keeping the list in order. Once the
 * server has confirmed a message, an unconfirmed copy (`sending`, `failed`) no longer replaces it.
 */
export function upsertMessage(items: readonly ChatItem[], message: ChatItem): ChatItem[] {
  const existing = items.find((item) => item.id === message.id);
  if (existing && isConfirmed(existing) && !isConfirmed(message)) return [...items];
  return [...items.filter((item) => item.id !== message.id), message].sort(compareItems);
}

/**
 * The freshly loaded list combined with the cache. For a message in both, the server's version
 * wins. Local messages the server list lacks stay: unconfirmed ones are not stored yet, and
 * confirmed ones came in (live or as a POST answer) after the server had read its list. Messages
 * are never deleted, so keeping them cannot show something that no longer exists.
 */
export function mergeServerMessages(
  server: readonly ChatMessage[],
  current: readonly ChatItem[],
): ChatItem[] {
  const serverIds = new Set(server.map((message) => message.id));
  const localOnly = current.filter((item) => !serverIds.has(item.id));
  return [...server, ...localOnly].sort(compareItems);
}

/**
 * Sets or clears the delivery state of an unconfirmed message. Confirmed messages stay as they
 * are: a late error for a message that already arrived over the live channel must not mark it.
 */
export function setDelivery(
  items: readonly ChatItem[],
  id: string,
  delivery: ChatItem['delivery'],
): ChatItem[] {
  return items.map((item) => {
    if (item.id !== id || isConfirmed(item)) return item;
    if (delivery !== undefined) return { ...item, delivery };
    const confirmed = { ...item };
    delete confirmed.delivery;
    return confirmed;
  });
}
