import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import {
  boardDocumentName,
  boardIdFromDocumentName,
  nodeLocks,
  type NodeLock,
  type ProjectRole,
} from '@covibes/shared';
import { Database } from '@hocuspocus/extension-database';
import { Hocuspocus } from '@hocuspocus/server';
import { WebSocketServer, type RawData } from 'ws';
import type * as Y from 'yjs';

import type { Auth } from '@server/auth/auth';
import { withUser, type Database as AppDatabase } from '@server/db/database';
import { acceptUpgrade, fetchHeaders } from '@server/websockets';

export type CollabContext = {
  user: { id: string; name: string; role: ProjectRole };
  boardId: string;
  projectId: string;
};

type CollabDeps = {
  db: AppDatabase;
  auth: Auth;
  /** Shared secret of the worker (spec 07). Unset, no connection gets service access. */
  internalToken?: string;
};

/**
 * Hocuspocus' close code "reset connection": the browser connects again and authenticates anew.
 */
const RESET_CONNECTION = { code: 4205, reason: 'Reset Connection' } as const;

/** The worker, drawing on a board for an agent (spec 07). */
const SERVICE_USER = { id: 'service', name: 'Covibes', role: 'editor' } as const;

/** Constant-time comparison; hashing first gives both sides the same length. */
function sameSecret(given: string, expected: string): boolean {
  const hash = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(given), hash(expected));
}

/** Refuses a document; the client learns "permission denied" and nothing more. */
class AccessDenied extends Error {
  readonly reason = 'permission-denied';
}

function toUint8Array(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data);
  return data instanceof ArrayBuffer ? new Uint8Array(data) : data;
}

/**
 * Hocuspocus for the Y.Docs of the boards, on the same HTTP server as the API (spec 05).
 * Access is checked per document: signed in via the session cookie, member of the board's project;
 * viewers only read. The worker connects with the internal token to draw for agents.
 */
export function createCollab({ db, auth, internalToken }: CollabDeps) {
  const pendingStores = new Set<Promise<unknown>>();
  // Documents of deleted boards. Hocuspocus still stores a document after its last connection
  // closed; for these it must not, or the deleted canvas would come back.
  const deletedDocuments = new Set<string>();

  const hocuspocus = new Hocuspocus<CollabContext>({
    name: 'covibes',
    quiet: true,
    // Store at most every 2 s while people work, and at least every 10 s.
    debounce: 2_000,
    maxDebounce: 10_000,

    async onAuthenticate({ documentName, requestHeaders, connectionConfig, token }) {
      const boardId = boardIdFromDocumentName(documentName);
      if (!boardId) throw new AccessDenied();

      // Browsers send no token; a wrong one falls through to the normal session check.
      if (internalToken && token && sameSecret(token, internalToken)) {
        const board = await db.admin
          .selectFrom('boards')
          .where('id', '=', boardId)
          .select('project_id')
          .executeTakeFirst();
        if (!board) throw new AccessDenied();
        const context: CollabContext = { user: SERVICE_USER, boardId, projectId: board.project_id };
        return context;
      }

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
          if (deletedDocuments.has(documentName)) return;
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

  /** Takes over a WebSocket upgrade on `COLLAB_PATH` (routed by `attachWebSockets`). */
  function handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, url: URL) {
    acceptUpgrade(webSockets, request, socket, head, (webSocket) => {
      const connection = hocuspocus.handleConnection(
        webSocket,
        new Request(url, { headers: fetchHeaders(request.headers) }),
      );
      webSocket.on('message', (data: RawData) => {
        connection.handleMessage(toUint8Array(data));
      });
      webSocket.on('close', (code: number, reason: Buffer) => {
        connection.handleClose({ code, reason: reason.toString() });
      });
    });
  }

  /**
   * Removes the canvas of a deleted board (spec 11): closes every connection to it and deletes the
   * stored document. The board row must be gone already, so nobody can connect again.
   */
  async function deleteBoard(boardId: string) {
    const documentName = boardDocumentName(boardId);
    deletedDocuments.add(documentName);
    hocuspocus.closeConnections(documentName);
    // A store that started before could otherwise write the document again after the delete.
    await Promise.allSettled([...pendingStores]);
    await db.adminPool.query('delete from yjs_documents where name = $1', [documentName]);
  }

  /**
   * Closes the board connections of one person in a project (spec 21a: their role changed, or
   * they are no longer a member). What a connection may do is decided when it authenticates, so
   * the sockets are closed; the browser connects again and gets its current rights, or is refused.
   */
  function closeUser(projectId: string, userId: string) {
    for (const document of hocuspocus.documents.values()) {
      for (const connection of document.getConnections()) {
        const context = connection.context as CollabContext | undefined;
        if (context?.projectId === projectId && context.user.id === userId) {
          connection.webSocket.close(RESET_CONNECTION.code, RESET_CONNECTION.reason);
        }
      }
    }
  }

  /**
   * Changes a board from the server (spec 13: applying a proposal). `fn` gets the live document
   * and who edits which node, read from the awareness of everyone on the board; its changes reach
   * them at once and are stored like theirs.
   */
  async function changeBoard<T>(
    board: { boardId: string; projectId: string },
    fn: (doc: Y.Doc, locks: ReadonlyMap<string, NodeLock>) => T | Promise<T>,
  ): Promise<T> {
    const connection = await hocuspocus.openDirectConnection(boardDocumentName(board.boardId), {
      user: SERVICE_USER,
      ...board,
    });
    try {
      const { document } = connection;
      if (!document) throw new Error(`Board ${board.boardId} could not be opened`);
      return await fn(document, nodeLocks(document.awareness.getStates()));
    } finally {
      await connection.disconnect();
    }
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

  return { hocuspocus, handleUpgrade, deleteBoard, changeBoard, closeUser, close };
}

export type Collab = ReturnType<typeof createCollab>;

/** What the API needs from the collaboration server. */
export type BoardDocuments = Pick<Collab, 'deleteBoard' | 'changeBoard'>;
