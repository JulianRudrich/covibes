import type { ChatMessage, LiveEvent } from '@covibes/shared';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  liveUrl,
  parseLiveEvent,
  reconnectDelay,
  useLiveChannel,
  type LiveChannelHandlers,
} from '@web/features/realtime/live-channel';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_PROJECT_ID = '00000000-0000-4000-8000-000000000002';

const MESSAGE: ChatMessage = {
  id: '00000000-0000-4000-8000-0000000000aa',
  projectId: PROJECT_ID,
  author: { kind: 'human', userId: '00000000-0000-4000-8000-0000000000bb', name: 'Sam' },
  content: '@Moderator, draw a block',
  mentions: ['moderator'],
  replyTo: null,
  status: 'complete',
  createdAt: '2026-09-29T10:00:00.000Z',
  updatedAt: '2026-09-29T10:00:00.000Z',
};
const EVENT: LiveEvent = { type: 'message', message: MESSAGE };

/** Stands in for the browser's WebSocket; the test drives the server side. */
class FakeSocket {
  readyState: number = WebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(readonly url: string) {}

  close() {
    this.readyState = WebSocket.CLOSING;
    // Like a browser, the close event follows asynchronously.
    setTimeout(() => {
      this.readyState = WebSocket.CLOSED;
      this.onclose?.();
    }, 0);
  }

  acceptConnection() {
    this.readyState = WebSocket.OPEN;
    this.onopen?.();
  }

  receive(data: unknown) {
    this.onmessage?.({ data });
  }

  drop() {
    this.readyState = WebSocket.CLOSED;
    this.onclose?.();
  }
}

describe('liveUrl', () => {
  it('uses the own origin with ws during development', () => {
    expect(liveUrl({ protocol: 'http:', host: 'localhost:5173' }, PROJECT_ID)).toBe(
      `ws://localhost:5173/api/live?project=${PROJECT_ID}`,
    );
  });

  it('uses wss behind HTTPS', () => {
    expect(liveUrl({ protocol: 'https:', host: 'covibes.example.org' }, PROJECT_ID)).toBe(
      `wss://covibes.example.org/api/live?project=${PROJECT_ID}`,
    );
  });

  it('encodes the project id', () => {
    expect(liveUrl({ protocol: 'http:', host: 'localhost:5173' }, 'a b&c=d')).toBe(
      'ws://localhost:5173/api/live?project=a%20b%26c%3Dd',
    );
  });
});

describe('parseLiveEvent', () => {
  it('accepts messages from humans and agents', () => {
    expect(parseLiveEvent(JSON.stringify(EVENT))).toEqual(EVENT);
    const agentEvent: LiveEvent = {
      type: 'message',
      message: { ...MESSAGE, author: { kind: 'agent', agentKey: 'critic' }, status: 'streaming' },
    };
    expect(parseLiveEvent(JSON.stringify(agentEvent))).toEqual(agentEvent);
  });

  it('drops invalid JSON and data that is not text', () => {
    expect(parseLiveEvent('{"type":')).toBeNull();
    expect(parseLiveEvent(new ArrayBuffer(4))).toBeNull();
  });

  it('drops unknown event types and invalid messages', () => {
    const invalid = [
      { type: 'presence', message: MESSAGE },
      { type: 'message' },
      { type: 'message', message: { ...MESSAGE, author: { kind: 'agent', agentKey: 'ghost' } } },
      { type: 'message', message: { ...MESSAGE, author: { kind: 'human', userId: 'x' } } },
      { type: 'message', message: { ...MESSAGE, mentions: ['nobody'] } },
      { type: 'message', message: { ...MESSAGE, status: 'deleted' } },
      { type: 'message', message: { ...MESSAGE, replyTo: undefined } },
    ];
    for (const event of invalid) expect(parseLiveEvent(JSON.stringify(event))).toBeNull();
  });
});

describe('reconnectDelay', () => {
  it('doubles from 1 s up to 15 s', () => {
    const steps = [0, 1, 2, 3, 4, 5, 20, 5000].map((attempt) => reconnectDelay(attempt, () => 1));
    expect(steps).toEqual([1000, 2000, 4000, 8000, 15_000, 15_000, 15_000, 15_000]);
  });

  it('spreads the delay between half and the full step', () => {
    expect(reconnectDelay(0, () => 0)).toBe(500);
    expect(reconnectDelay(0, () => 0.5)).toBe(750);
    expect(reconnectDelay(10, () => 0)).toBe(7500);
  });
});

describe('useLiveChannel', () => {
  let sockets: FakeSocket[];

  function createSocket(url: string) {
    const socket = new FakeSocket(url);
    sockets.push(socket);
    return socket as unknown as WebSocket;
  }

  function latestSocket() {
    const socket = sockets.at(-1);
    if (!socket) throw new Error('No socket was opened');
    return socket;
  }

  function mockHandlers() {
    return { onEvent: vi.fn(), onConnect: vi.fn() } satisfies LiveChannelHandlers;
  }

  function renderChannel(projectId: string, handlers: LiveChannelHandlers) {
    return renderHook(
      (props: { projectId: string; handlers: LiveChannelHandlers }) => {
        // A new options object on every render, as a caller would write it inline.
        useLiveChannel(props.projectId, props.handlers, { createSocket });
      },
      { initialProps: { projectId, handlers } },
    );
  }

  function advance(ms: number) {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }

  /** The next attempt follows a random delay between half the step and the full step. */
  function expectReconnectAfter(step: number) {
    const count = sockets.length;
    advance(step / 2 - 1);
    expect(sockets).toHaveLength(count);
    advance(step / 2 + 1);
    expect(sockets).toHaveLength(count + 1);
  }

  beforeEach(() => {
    sockets = [];
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('connects to the project on the own origin', () => {
    renderChannel(PROJECT_ID, mockHandlers());
    expect(sockets).toHaveLength(1);
    expect(latestSocket().url).toBe(liveUrl(window.location, PROJECT_ID));
  });

  it('delivers valid events and drops everything else', () => {
    const handlers = mockHandlers();
    renderChannel(PROJECT_ID, handlers);
    const socket = latestSocket();
    act(() => {
      socket.acceptConnection();
      socket.receive('not json');
      socket.receive(JSON.stringify({ type: 'message', message: { id: 'x' } }));
      socket.receive(JSON.stringify(EVENT));
    });
    expect(handlers.onEvent).toHaveBeenCalledOnce();
    expect(handlers.onEvent).toHaveBeenCalledWith(EVENT);
    expect(handlers.onConnect).toHaveBeenCalledOnce();
  });

  it('reconnects with growing delays capped at 15 s', () => {
    renderChannel(PROJECT_ID, mockHandlers());
    for (const step of [1000, 2000, 4000, 8000, 15_000, 15_000, 15_000]) {
      act(() => {
        latestSocket().drop();
      });
      expectReconnectAfter(step);
    }
  });

  it('keeps growing the delay while connections drop right after opening', () => {
    renderChannel(PROJECT_ID, mockHandlers());
    for (const step of [1000, 2000, 4000]) {
      act(() => {
        latestSocket().acceptConnection();
      });
      advance(5000);
      act(() => {
        latestSocket().drop();
      });
      expectReconnectAfter(step);
    }
  });

  it('starts with the shortest delay again after a stable connection', () => {
    renderChannel(PROJECT_ID, mockHandlers());
    for (const step of [1000, 2000, 4000]) {
      act(() => {
        latestSocket().drop();
      });
      expectReconnectAfter(step);
    }
    act(() => {
      latestSocket().acceptConnection();
    });
    advance(10_000);
    act(() => {
      latestSocket().drop();
    });
    expectReconnectAfter(1000);
  });

  it('calls onConnect after the first open and after every re-open', () => {
    const handlers = mockHandlers();
    renderChannel(PROJECT_ID, handlers);
    expect(handlers.onConnect).not.toHaveBeenCalled();
    act(() => {
      latestSocket().acceptConnection();
    });
    expect(handlers.onConnect).toHaveBeenCalledOnce();

    act(() => {
      latestSocket().drop();
    });
    advance(1000);
    expect(handlers.onConnect).toHaveBeenCalledOnce();
    act(() => {
      latestSocket().acceptConnection();
    });
    expect(handlers.onConnect).toHaveBeenCalledTimes(2);

    act(() => {
      latestSocket().receive(JSON.stringify(EVENT));
    });
    expect(handlers.onEvent).toHaveBeenCalledWith(EVENT);
  });

  it('calls onConnect once the connection works after a failed first attempt', () => {
    const handlers = mockHandlers();
    renderChannel(PROJECT_ID, handlers);
    act(() => {
      latestSocket().drop();
    });
    advance(1000);
    act(() => {
      latestSocket().acceptConnection();
    });
    expect(handlers.onConnect).toHaveBeenCalledOnce();
  });

  it('closes the socket on unmount and does not reconnect', () => {
    const handlers = mockHandlers();
    const { unmount } = renderChannel(PROJECT_ID, handlers);
    const socket = latestSocket();
    act(() => {
      socket.acceptConnection();
    });
    unmount();
    expect(socket.readyState).toBe(WebSocket.CLOSING);
    advance(60_000);
    expect(socket.readyState).toBe(WebSocket.CLOSED);
    expect(sockets).toHaveLength(1);
    socket.receive(JSON.stringify(EVENT));
    expect(handlers.onEvent).not.toHaveBeenCalled();
  });

  it('closes a socket that is still connecting once its handshake finishes', () => {
    const handlers = mockHandlers();
    const { unmount } = renderChannel(PROJECT_ID, handlers);
    const socket = latestSocket();
    unmount();
    expect(socket.readyState).toBe(WebSocket.CONNECTING);
    socket.acceptConnection();
    advance(60_000);
    expect(socket.readyState).toBe(WebSocket.CLOSED);
    expect(sockets).toHaveLength(1);
    expect(handlers.onConnect).not.toHaveBeenCalled();
  });

  it('cancels a pending reconnect on unmount', () => {
    const { unmount } = renderChannel(PROJECT_ID, mockHandlers());
    act(() => {
      latestSocket().drop();
    });
    unmount();
    advance(60_000);
    expect(sockets).toHaveLength(1);
  });

  it('switches to the new project without a reconnect', () => {
    const handlers = mockHandlers();
    const { rerender } = renderChannel(PROJECT_ID, handlers);
    const first = latestSocket();
    act(() => {
      first.acceptConnection();
    });

    rerender({ projectId: OTHER_PROJECT_ID, handlers });
    advance(60_000);
    expect(first.readyState).toBe(WebSocket.CLOSED);
    expect(sockets).toHaveLength(2);
    const second = latestSocket();
    expect(second.url).toBe(liveUrl(window.location, OTHER_PROJECT_ID));

    act(() => {
      second.acceptConnection();
    });
    // One open per project, no reconnect of the old one.
    expect(handlers.onConnect).toHaveBeenCalledTimes(2);
  });

  it('keeps the connection when the handlers change', () => {
    const before = mockHandlers();
    const { rerender } = renderChannel(PROJECT_ID, before);
    const socket = latestSocket();
    act(() => {
      socket.acceptConnection();
    });

    const after = mockHandlers();
    rerender({ projectId: PROJECT_ID, handlers: after });
    expect(sockets).toHaveLength(1);
    expect(socket.readyState).toBe(WebSocket.OPEN);

    act(() => {
      socket.receive(JSON.stringify(EVENT));
    });
    expect(before.onEvent).not.toHaveBeenCalled();
    expect(after.onEvent).toHaveBeenCalledWith(EVENT);
  });
});
