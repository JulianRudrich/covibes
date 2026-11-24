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
  render(
    <MessageList
      items={[ITEM]}
      empty={null}
      currentUserId="user-olga"
      team={[]}
      onRetry={vi.fn()}
    />,
  );
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
  it('anchors the reader when older history is prepended', () => {
    stubResizeObserver();
    const loadOlder = vi.fn(async () => {});
    const props = {
      empty: null,
      currentUserId: 'user-olga',
      team: [],
      onRetry: vi.fn(),
      onLoadOlder: loadOlder,
      hasOlder: true,
    };
    const view = render(<MessageList {...props} items={[ITEM]} />);
    const scroller = screen.getByRole('list', { name: 'Nachrichten' }).parentElement;
    if (!scroller) throw new Error('No scroller');
    Object.defineProperty(scroller, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 500, configurable: true });
    scroller.scrollTop = 20;
    fireEvent.scroll(scroller);
    expect(loadOlder).toHaveBeenCalledOnce();
    Object.defineProperty(scroller, 'scrollHeight', { value: 1400, configurable: true });
    view.rerender(
      <MessageList
        {...props}
        items={[{ ...ITEM, id: 'older', createdAt: '2026-09-29T12:00:00Z' }, ITEM]}
      />,
    );
    expect(scroller.scrollTop).toBe(420);
  });

  it('focuses a message loaded through a history reference', () => {
    stubResizeObserver();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    render(
      <MessageList
        items={[ITEM]}
        empty={null}
        currentUserId="user-olga"
        team={[]}
        onRetry={vi.fn()}
        focusMessageId={ITEM.id}
      />,
    );
    expect(document.activeElement).toHaveAttribute('data-message-id', ITEM.id);
  });
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
