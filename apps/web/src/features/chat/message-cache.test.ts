import type { ChatMessage } from '@covibes/shared';
import { describe, expect, it } from 'vitest';

import { mergeServerMessages, setDelivery, upsertMessage } from '@web/features/chat/message-cache';
import type { ChatItem } from '@web/features/chat/types';

const PROJECT_ID = '0b6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de';

function message(id: string, minute: number, overrides: Partial<ChatItem> = {}): ChatItem {
  const at = `2026-09-29T10:${String(minute).padStart(2, '0')}:00.000Z`;
  return {
    id,
    projectId: PROJECT_ID,
    author: { kind: 'human', userId: '11111111-1111-4111-8111-111111111111', name: 'Olga Owner' },
    content: `Message ${id}`,
    mentions: [],
    replyTo: null,
    status: 'complete',
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

function ids(items: readonly ChatItem[]) {
  return items.map((item) => item.id);
}

describe('upsertMessage', () => {
  it('orders sub-millisecond server timestamps alongside optimistic millisecond timestamps', () => {
    const first = message('z', 1, { createdAt: '2026-09-29T10:01:00.000Z' });
    const second = message('a', 1, { createdAt: '2026-09-29T10:01:00.000001Z' });
    const third = message('b', 1, { createdAt: '2026-09-29T10:01:00.000002Z' });
    expect(ids(mergeServerMessages([third, second], [first]))).toEqual(['z', 'a', 'b']);
  });
  it('inserts a new message in the order of creation', () => {
    const items = [message('a', 1), message('c', 3)];

    expect(ids(upsertMessage(items, message('d', 4)))).toEqual(['a', 'c', 'd']);
    expect(ids(upsertMessage(items, message('b', 2)))).toEqual(['a', 'b', 'c']);
  });

  it('orders messages created at the same time by id', () => {
    const items = [message('b', 1), message('d', 1)];

    expect(ids(upsertMessage(items, message('c', 1)))).toEqual(['b', 'c', 'd']);
    expect(ids(upsertMessage(items, message('a', 1)))).toEqual(['a', 'b', 'd']);
  });

  it('replaces a confirmed message with a newer confirmed version', () => {
    const updated = message('a', 1, { content: 'Edited', updatedAt: '2026-09-29T10:05:00.000Z' });

    expect(upsertMessage([message('a', 1), message('b', 2)], updated)).toEqual([
      updated,
      message('b', 2),
    ]);
  });

  it('confirms an optimistic message with the server version and moves it to its place', () => {
    const optimistic = message('x', 9, { delivery: 'sending' });
    const confirmed = message('x', 2);

    const items = upsertMessage([message('a', 1), message('b', 3), optimistic], confirmed);

    expect(items).toEqual([message('a', 1), confirmed, message('b', 3)]);
    expect(items[1]).not.toHaveProperty('delivery');
  });

  it('confirms a failed message as well', () => {
    const items = upsertMessage([message('x', 1, { delivery: 'failed' })], message('x', 1));

    expect(items).toEqual([message('x', 1)]);
  });

  it('never lets an unconfirmed copy replace a confirmed message', () => {
    const items = [message('a', 1), message('x', 2)];

    expect(upsertMessage(items, message('x', 2, { delivery: 'sending' }))).toEqual(items);
    expect(upsertMessage(items, message('x', 5, { delivery: 'failed' }))).toEqual(items);
  });

  it('replaces an unconfirmed message with another unconfirmed copy', () => {
    const items = [message('x', 1, { delivery: 'failed' })];

    expect(upsertMessage(items, message('x', 1, { delivery: 'sending' }))).toEqual([
      message('x', 1, { delivery: 'sending' }),
    ]);
  });

  it('does not change the given list', () => {
    const items = [message('a', 1), message('x', 2, { delivery: 'sending' })];
    const copy = structuredClone(items);

    upsertMessage(items, message('x', 2));
    upsertMessage(items, message('b', 3));

    expect(items).toEqual(copy);
  });
});

describe('mergeServerMessages', () => {
  it('takes the server list when nothing is cached', () => {
    const server: ChatMessage[] = [message('a', 1), message('b', 2)];

    expect(mergeServerMessages(server, [])).toEqual(server);
    expect(mergeServerMessages([], [])).toEqual([]);
  });

  it('prefers the server version of a message that is also cached', () => {
    const server = [message('a', 1), message('x', 2)];
    const current = [
      message('a', 1, { content: 'Old copy' }),
      message('x', 7, { delivery: 'sending' }),
    ];

    const items = mergeServerMessages(server, current);

    expect(items).toEqual(server);
    expect(items[1]).not.toHaveProperty('delivery');
  });

  it('keeps unconfirmed messages that the server does not have yet, in order', () => {
    const sending = message('s', 2, { delivery: 'sending' });
    const failed = message('f', 5, { delivery: 'failed' });

    const items = mergeServerMessages([message('a', 1), message('b', 3)], [failed, sending]);

    expect(items).toEqual([message('a', 1), sending, message('b', 3), failed]);
  });

  it('keeps confirmed messages that arrived after the server read its list', () => {
    const server = [message('a', 1), message('b', 2)];
    const current = [message('a', 1), message('b', 2), message('c', 3), message('d', 4)];

    expect(ids(mergeServerMessages(server, current))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('adds new messages from the server to the cached ones', () => {
    const server = [message('b', 2), message('c', 3)];
    const current = [message('a', 1), message('b', 2)];

    expect(ids(mergeServerMessages(server, current))).toEqual(['a', 'b', 'c']);
  });
});

describe('setDelivery', () => {
  it('marks an unconfirmed message as failed and back as sending', () => {
    const failed = setDelivery(
      [message('a', 1), message('x', 2, { delivery: 'sending' })],
      'x',
      'failed',
    );
    expect(failed).toEqual([message('a', 1), message('x', 2, { delivery: 'failed' })]);

    expect(setDelivery(failed, 'x', 'sending')).toEqual([
      message('a', 1),
      message('x', 2, { delivery: 'sending' }),
    ]);
  });

  it('removes the delivery state when it is cleared', () => {
    const [item] = setDelivery([message('x', 1, { delivery: 'sending' })], 'x', undefined);

    expect(item).toEqual(message('x', 1));
    expect(item).not.toHaveProperty('delivery');
  });

  it('leaves confirmed messages alone', () => {
    const items = [message('a', 1), message('x', 2)];

    expect(setDelivery(items, 'x', 'failed')).toEqual(items);
    expect(setDelivery(items, 'x', 'sending')[1]).not.toHaveProperty('delivery');
  });

  it('ignores unknown ids and does not change the given list', () => {
    const items = [message('x', 1, { delivery: 'sending' })];

    expect(setDelivery(items, 'unknown', 'failed')).toEqual(items);
    setDelivery(items, 'x', 'failed');
    expect(items[0]?.delivery).toBe('sending');
  });
});
