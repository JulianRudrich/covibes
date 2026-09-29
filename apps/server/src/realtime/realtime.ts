import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import { projectIdSchema, type LiveEvent } from '@covibes/shared';
import { WebSocket, WebSocketServer } from 'ws';

import type { Auth } from '@server/auth/auth';
import { withUser, type Database } from '@server/db/database';
import { acceptUpgrade, fetchHeaders, rejectUpgrade } from '@server/websockets';

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
  const alive = new WeakSet<WebSocket>();
  const webSockets = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

  /** The project id if the caller may join its channel, otherwise the HTTP status to answer. */
  async function authorize(request: IncomingMessage, url: URL): Promise<string | 401 | 404> {
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
    return membership ? projectId.data : 404;
  }

  function join(projectId: string, webSocket: WebSocket) {
    let channel = channels.get(projectId);
    if (!channel) {
      channel = new Set();
      channels.set(projectId, channel);
    }
    channel.add(webSocket);
    alive.add(webSocket);
    webSocket.on('pong', () => alive.add(webSocket));
    webSocket.on('close', () => {
      channel.delete(webSocket);
      if (channel.size === 0) channels.delete(projectId);
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
          join(result, webSocket);
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
  }

  /** Number of open connections per project, for tests. */
  function connectionCount(projectId: string) {
    return channels.get(projectId)?.size ?? 0;
  }

  return { handleUpgrade, publish, close, connectionCount };
}

export type Realtime = ReturnType<typeof createRealtime>;
