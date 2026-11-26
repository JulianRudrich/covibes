import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import { projectIdSchema, type LiveEvent } from '@covibes/shared';
import { WebSocket, WebSocketServer } from 'ws';

import type { Auth } from '@server/auth/auth';
import { withUser, type Database } from '@server/db/database';
import { acceptUpgrade, fetchHeaders, rejectUpgrade } from '@server/websockets';

/** Enough for many tabs and devices of one person, but not for a flood of sockets. */
export const MAX_CONNECTIONS_PER_USER = 20;

/** Close code for a connection whose owner lost access to the project (spec 21a). */
export const ACCESS_REVOKED_CODE = 4403;

/** Dead connections (e.g. a laptop that went to sleep) are dropped after at most two intervals. */
const HEARTBEAT_MS = 30_000;

type RealtimeDeps = { db: Database; auth: Auth };

export type LivePublisher = { publish: (projectId: string, event: LiveEvent) => void };

/**
 * Live channel `project:{projectId}` (spec 06): one WebSocket per open project. On connect the
 * session cookie and the membership are checked; afterwards the server only pushes events (new
 * messages, later AI streaming and queue status). Clients do not send anything yet.
 */
export function createRealtime({ db, auth }: RealtimeDeps) {
  const channels = new Map<string, Set<WebSocket>>();
  /** Whose connection it is, to close those of one person (spec 21a). */
  const owners = new WeakMap<WebSocket, string>();
  const connectionsPerUser = new Map<string, number>();
  const alive = new WeakSet<WebSocket>();
  const webSockets = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

  /** The project id if the caller may join its channel, otherwise the HTTP status to answer. */
  async function authorize(
    request: IncomingMessage,
    url: URL,
  ): Promise<{ projectId: string; userId: string } | 401 | 404 | 429> {
    const projectId = projectIdSchema.safeParse(url.searchParams.get('project'));
    if (!projectId.success) return 404;
    const session = await auth.api.getSession({ headers: fetchHeaders(request.headers) });
    if (!session) return 401;
    const membership = await withUser(db.app, session.user.id, (trx) =>
      trx
        .selectFrom('project_members')
        .where('project_id', '=', projectId.data)
        .where('user_id', '=', session.user.id)
        .select('role')
        .executeTakeFirst(),
    );
    if (!membership) return 404;
    if ((connectionsPerUser.get(session.user.id) ?? 0) >= MAX_CONNECTIONS_PER_USER) return 429;
    return { projectId: projectId.data, userId: session.user.id };
  }

  function join(projectId: string, userId: string, webSocket: WebSocket) {
    connectionsPerUser.set(userId, (connectionsPerUser.get(userId) ?? 0) + 1);
    let channel = channels.get(projectId);
    if (!channel) {
      channel = new Set();
      channels.set(projectId, channel);
    }
    channel.add(webSocket);
    owners.set(webSocket, userId);
    alive.add(webSocket);
    webSocket.on('pong', () => alive.add(webSocket));
    webSocket.on('close', () => {
      channel.delete(webSocket);
      if (channel.size === 0) channels.delete(projectId);
      const remaining = (connectionsPerUser.get(userId) ?? 1) - 1;
      if (remaining > 0) connectionsPerUser.set(userId, remaining);
      else connectionsPerUser.delete(userId);
    });
  }

  function handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, url: URL) {
    authorize(request, url).then(
      (result) => {
        if (typeof result === 'number') {
          rejectUpgrade(socket, result);
          return;
        }
        acceptUpgrade(webSockets, request, socket, head, (webSocket) => {
          join(result.projectId, result.userId, webSocket);
        });
      },
      (error: unknown) => {
        console.error(error);
        rejectUpgrade(socket, 500);
      },
    );
  }

  function publish(projectId: string, event: LiveEvent) {
    const channel = channels.get(projectId);
    if (!channel) return;
    const data = JSON.stringify(event);
    for (const webSocket of channel) {
      if (webSocket.readyState === WebSocket.OPEN) webSocket.send(data);
    }
  }

  /**
   * Closes the connections of one person to a project (spec 21a: they were removed or left).
   * Access is only checked on connect, so without this an open tab would keep receiving. The tab
   * is told to load the project again first, which is how it learns that it is no longer in it.
   */
  function closeUser(projectId: string, userId: string) {
    const channel = channels.get(projectId);
    if (!channel) return;
    for (const webSocket of channel) {
      if (owners.get(webSocket) !== userId) continue;
      if (webSocket.readyState === WebSocket.OPEN) {
        webSocket.send(JSON.stringify({ type: 'project' } satisfies LiveEvent));
      }
      webSocket.close(ACCESS_REVOKED_CODE, 'access revoked');
    }
  }

  /** An account deletion invalidates every open tab, including surviving shared projects. */
  function closeAccount(userId: string) {
    for (const projectId of channels.keys()) closeUser(projectId, userId);
  }

  const heartbeat = setInterval(() => {
    for (const webSocket of webSockets.clients) {
      if (!alive.has(webSocket)) {
        webSocket.terminate();
        continue;
      }
      alive.delete(webSocket);
      webSocket.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  /** Closes every connection right away; clients reconnect to the next server. */
  function close() {
    clearInterval(heartbeat);
    for (const webSocket of webSockets.clients) webSocket.terminate();
    webSockets.close();
    channels.clear();
    connectionsPerUser.clear();
  }

  /** Number of open connections per project, for tests. */
  function connectionCount(projectId: string) {
    return channels.get(projectId)?.size ?? 0;
  }

  return { handleUpgrade, publish, closeUser, closeAccount, close, connectionCount };
}

export type Realtime = ReturnType<typeof createRealtime>;
