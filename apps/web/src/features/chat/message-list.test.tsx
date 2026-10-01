import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MessageList } from '@web/features/chat/message-list';
import type { ChatItem } from '@web/features/chat/types';

const ITEM: ChatItem = {
  id: 'message-1',
  projectId: 'project-1',
  author: { kind: 'human', userId: 'user-alex', name: 'Alex Adams' },
  content: 'Hallo',
  mentions: [],
  replyTo: null,
  status: 'complete',
  createdAt: '2026-09-30T12:00:00.000Z',
  updatedAt: '2026-09-30T12:00:00.000Z',
};

/** Replaces ResizeObserver, which jsdom lacks, and returns a way to report a resize. */
function stubResizeObserver() {
  const callbacks: (() => void)[] = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        callbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  return () => {
    act(() => {
      for (const callback of callbacks) callback();
    });
  };
}

function renderList() {
  render(<MessageList items={[ITEM]} currentUserId="user-olga" team={[]} onRetry={vi.fn()} />);
  const scroller = screen.getByRole('list', { name: 'Nachrichten' }).parentElement;
  if (!scroller) throw new Error('The list has no scroller');
  // jsdom lays nothing out, so the test gives the scroller its sizes.
  const size = (scrollHeight: number, clientHeight: number) => {
    Object.defineProperty(scroller, 'scrollHeight', { value: scrollHeight, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: clientHeight, configurable: true });
  };
  return { scroller, size };
}

describe('MessageList', () => {
  it('stays at the bottom when it gets shorter, e.g. for a raised hand below it (spec 15)', () => {
    const resize = stubResizeObserver();
    const { scroller, size } = renderList();

    // A card appears above the composer: the list loses 100 px.
    size(1000, 400);
    resize();

    expect(scroller.scrollTop).toBe(1000);
  });

  it('stays put when the reader scrolled up', () => {
    const resize = stubResizeObserver();
    const { scroller, size } = renderList();
    size(1000, 500);
    scroller.scrollTop = 200;
    fireEvent.scroll(scroller);

    size(1000, 400);
    resize();

    expect(scroller.scrollTop).toBe(200);
  });
});
