import { LIVE_PATH, liveEventSchema, type LiveEvent } from '@covibes/shared';
import { useEffect, useEffectEvent } from 'react';

import { sameOriginWebSocketUrl } from '@web/lib/websocket-url';

const FIRST_RETRY_MS = 1_000;
const MAX_RETRY_MS = 15_000;

/**
 * A connection that stays open this long counts as healthy, so the next outage starts again with
 * the shortest delay. Resetting on every open would let a server that accepts and drops right away
 * cause a reconnect, and with it a reload of the chat, every second.
 */
const STABLE_AFTER_MS = 10_000;

export type LiveChannelHandlers = {
  onEvent: (event: LiveEvent) => void;
  /**
   * The connection is open, after the first attempt or after an interruption. Events sent before
   * (e.g. between loading the history and this moment, or while offline) were not delivered.
   */
  onConnect: () => void;
};

export type LiveChannelOptions = {
  /** Replaces the browser's WebSocket, for tests. */
  createSocket?: (url: string) => WebSocket;
};

/** WebSocket address of a project's live channel on the web app's own origin. */
export function liveUrl(location: Pick<Location, 'protocol' | 'host'>, projectId: string): string {
  return sameOriginWebSocketUrl(location, `${LIVE_PATH}?project=${encodeURIComponent(projectId)}`);
}

/** The event in a raw WebSocket message, or null if this client does not understand it. */
export function parseLiveEvent(data: unknown): LiveEvent | null {
  if (typeof data !== 'string') return null;
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return null;
  }
  const result = liveEventSchema.safeParse(json);
  return result.success ? result.data : null;
}

/**
 * Delay before reconnect attempt `attempt` (counted from 0): steps of 1 s, doubling up to 15 s. The
 * delay lies randomly between half and the full step, so clients that were dropped together (a
 * server restart) do not all come back at the same moment.
 */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const step = Math.min(FIRST_RETRY_MS * 2 ** attempt, MAX_RETRY_MS);
  return Math.round(step / 2 + (step / 2) * random());
}

/** Closes a socket without running its handlers, so neither events nor a reconnect follow. */
function closeQuietly(socket: WebSocket) {
  socket.onmessage = null;
  socket.onclose = null;
  if (socket.readyState === WebSocket.CONNECTING) {
    // Closing during the handshake makes browsers log an error, e.g. on every StrictMode remount.
    socket.onopen = () => {
      socket.close();
    };
  } else {
    socket.onopen = null;
    socket.close();
  }
}

/**
 * Live channel of a project (spec 06): one WebSocket while the component is mounted, authenticated
 * by the session cookie. Every close that the hook did not cause leads to a reconnect with a
 * growing delay; every successful open calls `onConnect`.
 * New handler identities between renders do not reconnect.
 */
export function useLiveChannel(
  projectId: string,
  handlers: LiveChannelHandlers,
  options?: LiveChannelOptions,
): void {
  const onEvent = useEffectEvent((event: LiveEvent) => {
    handlers.onEvent(event);
  });
  const onConnect = useEffectEvent(() => {
    handlers.onConnect();
  });
  const createSocket = useEffectEvent(
    (url: string) => options?.createSocket?.(url) ?? new WebSocket(url),
  );

  useEffect(() => {
    const url = liveUrl(window.location, projectId);
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const connect = (): WebSocket => {
      const next = createSocket(url);
      let openedAt: number | undefined;
      next.onopen = () => {
        openedAt = Date.now();
        onConnect();
      };
      next.onmessage = (message) => {
        const event = parseLiveEvent(message.data);
        if (event) onEvent(event);
        else if (import.meta.env.DEV) console.warn('Dropped an unknown live event', message.data);
      };
      next.onclose = () => {
        if (openedAt !== undefined && Date.now() - openedAt >= STABLE_AFTER_MS) attempt = 0;
        retryTimer = setTimeout(() => {
          socket = connect();
        }, reconnectDelay(attempt));
        attempt += 1;
      };
      return next;
    };
    let socket = connect();

    return () => {
      clearTimeout(retryTimer);
      closeQuietly(socket);
    };
  }, [projectId]);
}
