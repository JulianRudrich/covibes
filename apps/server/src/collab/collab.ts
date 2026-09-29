import type { IncomingHttpHeaders, IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';

import { boardIdFromDocumentName, type ProjectRole } from '@covibes/shared';
import { Database } from '@hocuspocus/extension-database';
import { Hocuspocus } from '@hocuspocus/server';
import { WebSocketServer, type RawData } from 'ws';

import type { Auth } from '@server/auth/auth';
import { withUser, type Database as AppDatabase } from '@server/db/database';
import type { ServerEnv } from '@server/env';

export type CollabContext = {
  user: { id: string; name: string; role: ProjectRole };
  boardId: string;
  projectId: string;
};

type CollabDeps = {
  env: Pick<ServerEnv, 'APP_URL' | 'COLLAB_PATH'>;
  db: AppDatabase;
  auth: Auth;
};

/** Refuses a document; the client learns "permission denied" and nothing more. */
class AccessDenied extends Error {
  readonly reason = 'permission-denied';
}

function toHeaders(incoming: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else if (value !== undefined) headers.set(name, value);
  }
  return headers;
}

function toUint8Array(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data);
  return data instanceof ArrayBuffer ? new Uint8Array(data) : data;
}

/**
 * Hocuspocus for the Y.Docs of the boards, on the same HTTP server as the API (spec 05).
 * Access is checked per document: signed in via the session cookie, member of the board's project;
 * viewers only read.
 */
export function createCollab({ env, db, auth }: CollabDeps) {
  const pendingStores = new Set<Promise<unknown>>();

  const hocuspocus = new Hocuspocus<CollabContext>({
    name: 'covibes',
    quiet: true,
    // Store at most every 2 s while people work, and at least every 10 s.
    debounce: 2_000,
    maxDebounce: 10_000,

    async onAuthenticate({ documentName, requestHeaders, connectionConfig }) {
      const boardId = boardIdFromDocumentName(documentName);
      if (!boardId) throw new AccessDenied();
      const session = await auth.api.getSession({ headers: requestHeaders });
      if (!session) throw new AccessDenied();

      const userId = session.user.id;
      const access = await withUser(db.app, userId, (trx) =>
        trx
          .selectFrom('boards')
          .innerJoin('project_members', 'project_members.project_id', 'boards.project_id')
          .where('boards.id', '=', boardId)
          .where('project_members.user_id', '=', userId)
          .select(['boards.project_id', 'project_members.role'])
          .executeTakeFirst(),
      );
      if (!access) throw new AccessDenied();

      // Viewers receive every change, but Hocuspocus ignores the updates they send.
      connectionConfig.readOnly = access.role === 'viewer';
      const context: CollabContext = {
        user: { id: userId, name: session.user.name, role: access.role },
        boardId,
        projectId: access.project_id,
      };
      return context;
    },

    extensions: [
      new Database({
        fetch: async ({ documentName }) => {
          const { rows } = await db.adminPool.query<{ state: Buffer }>(
            'select state from yjs_documents where name = $1',
            [documentName],
          );
          return rows[0] ? new Uint8Array(rows[0].state) : null;
        },
        store: async ({ documentName, state }) => {
          const stored = db.adminPool.query(
            `insert into yjs_documents (name, state, updated_at) values ($1, $2, now())
             on conflict (name) do update set state = excluded.state, updated_at = now()`,
            [documentName, state],
          );
          pendingStores.add(stored);
          try {
            await stored;
          } finally {
            pendingStores.delete(stored);
          }
        },
      }),
    ],
  });

  const webSockets = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
  const allowedOrigin = new URL(env.APP_URL).origin;

  /** Takes over WebSocket upgrades on `COLLAB_PATH`. */
  function attach(server: Server) {
    server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.pathname !== env.COLLAB_PATH) {
        socket.destroy();
        return;
      }
      // Browsers attach the session cookie to WebSocket requests from other sites too, so only
      // the web app's own origin may connect (protection against cross-site WebSocket hijacking).
      if (request.headers.origin !== allowedOrigin) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        return;
      }
      webSockets.handleUpgrade(request, socket, head, (webSocket) => {
        const connection = hocuspocus.handleConnection(
          webSocket,
          new Request(url, { headers: toHeaders(request.headers) }),
        );
        webSocket.on('message', (data: RawData) => {
          connection.handleMessage(toUint8Array(data));
        });
        webSocket.on('close', (code: number, reason: Buffer) => {
          connection.handleClose({ code, reason: reason.toString() });
        });
      });
    });
  }

  /** Closes all connections and waits until every document is stored. */
  async function close() {
    hocuspocus.closeConnections();
    hocuspocus.flushPendingStores();
    const deadline = Date.now() + 5_000;
    while (
      (pendingStores.size > 0 || hocuspocus.getDocumentsCount() > 0) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    // Everything is stored; do not wait up to 30 s for clients to finish the close handshake.
    for (const webSocket of webSockets.clients) webSocket.terminate();
    webSockets.close();
  }

  return { hocuspocus, attach, close };
}

export type Collab = ReturnType<typeof createCollab>;
