import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import {
  boardDocumentName,
  boardIdFromDocumentName,
  nodeLocks,
  planDocumentName,
  projectIdFromPlanDocumentName,
  readEdges,
  readNodes,
  readPlan as planOf,
  readPlanSections as planSectionsOf,
  type CanvasEdge,
  type CanvasNode,
  type NodeLock,
  type PlanNode,
  type PlanSection,
  type ProjectRole,
} from '@covibes/shared';
import { Database } from '@hocuspocus/extension-database';
import { Hocuspocus } from '@hocuspocus/server';
import { WebSocketServer, type RawData } from 'ws';
import * as Y from 'yjs';

import type { Auth } from '@server/auth/auth';
import { createBoardHistory, type RevertMark } from '@server/collab/board-history';
import { withUser, type Database as AppDatabase } from '@server/db/database';
import { sameSecret } from '@server/secrets';
import { acceptUpgrade, fetchHeaders } from '@server/websockets';

export type CollabContext = {
  user: { id: string; name: string; role: ProjectRole };
  projectId: string;
  /** The board of a board's document; the document of a plan (spec 25a) has none. */
  boardId?: string;
};

type CollabDeps = {
  db: AppDatabase;
  auth: Auth;
  /** Shared secret of the worker (spec 07). Unset, no connection gets service access. */
  internalToken?: string;
  /**
   * Called with the document after the plan of a project was stored (spec 26a: the roadmap; spec
   * 26b: the ids of its tasks). It only reads the document; a change goes through `changePlan`.
   */
  onPlanStored?: (projectId: string, doc: Y.Doc) => void;
  /** Called once the history of a board got an entry, or an entry of it grew (spec 38a). */
  onBoardHistory?: (projectId: string, boardId: string) => void;
};

/**
 * Hocuspocus' close code "reset connection": the browser connects again and authenticates anew.
 */
const RESET_CONNECTION = { code: 4205, reason: 'Reset Connection' } as const;

/** The worker, drawing on a board for an agent (spec 07). */
const SERVICE_USER = { id: 'service', name: 'Covibes', role: 'editor' } as const;

/** Refuses a document; the client learns "permission denied" and nothing more. */
class AccessDenied extends Error {
  readonly reason = 'permission-denied';
}

function toUint8Array(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data);
  return data instanceof ArrayBuffer ? new Uint8Array(data) : data;
}

/**
 * Hocuspocus for the Y.Docs of the boards and of the plans (spec 25a), on the same HTTP server as
 * the API (spec 05). Access is checked per document: signed in via the session cookie, member of
 * the document's project; viewers only read. The worker connects with the internal token to draw
 * for agents.
 */
export function createCollab({
  db,
  auth,
  internalToken,
  onPlanStored,
  onBoardHistory,
}: CollabDeps) {
  const pendingStores = new Set<Promise<unknown>>();
  // Documents of deleted boards. Hocuspocus still stores a document after its last connection
  // closed; for these it must not, or the deleted canvas would come back.
  const deletedDocuments = new Set<string>();
  // What changed on the boards, written as entries of their history (spec 38a).
  const history = createBoardHistory({ adminPool: db.adminPool, onChanged: onBoardHistory });

  const hocuspocus = new Hocuspocus<CollabContext>({
    name: 'covibes',
    quiet: true,
    // Store at most every 2 s while people work, and at least every 10 s.
    debounce: 2_000,
    maxDebounce: 10_000,

    async onAuthenticate({ documentName, requestHeaders, connectionConfig, token }) {
      // A document is the canvas of a board or the plan of a project (spec 25a).
      const boardId = boardIdFromDocumentName(documentName);
      const planOf = boardId ? undefined : projectIdFromPlanDocumentName(documentName);
      if (!boardId && !planOf) throw new AccessDenied();

      // Browsers send no token; a wrong one falls through to the normal session check.
      if (internalToken && token && sameSecret(token, internalToken)) {
        const found = boardId
          ? await db.admin
              .selectFrom('boards')
              .where('id', '=', boardId)
              .select('project_id')
              .executeTakeFirst()
          : await db.admin
              .selectFrom('projects')
              .where('id', '=', planOf ?? '')
              .select('id as project_id')
              .executeTakeFirst();
        if (!found) throw new AccessDenied();
        const context: CollabContext = { user: SERVICE_USER, boardId, projectId: found.project_id };
        return context;
      }

      const session = await auth.api.getSession({ headers: requestHeaders });
      if (!session) throw new AccessDenied();

      const userId = session.user.id;
      const access = await withUser(db.app, userId, (trx) =>
        boardId
          ? trx
              .selectFrom('boards')
              .innerJoin('project_members', 'project_members.project_id', 'boards.project_id')
              .where('boards.id', '=', boardId)
              .where('project_members.user_id', '=', userId)
              .select(['boards.project_id', 'project_members.role'])
              .executeTakeFirst()
          : trx
              .selectFrom('project_members')
              .where('project_id', '=', planOf ?? '')
              .where('user_id', '=', userId)
              .select(['project_id', 'role'])
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

    // The history of a board (spec 38a) starts from how the board stands when it is loaded,
    // and notes with every change who sent it.
    afterLoadDocument({ documentName, document }) {
      const boardId = boardIdFromDocumentName(documentName);
      if (boardId) history.loaded(boardId, document);
      return Promise.resolve();
    },
    onChange({ documentName, document, context }) {
      const boardId = boardIdFromDocumentName(documentName);
      // A change without a person is the server's own: for an agent, or applying a proposal.
      const user = (context as CollabContext | undefined)?.user;
      if (boardId) {
        history.changed(
          boardId,
          document,
          !user || user.id === SERVICE_USER.id ? 'service' : { id: user.id, name: user.name },
        );
      }
      return Promise.resolve();
    },
    afterUnloadDocument({ documentName }) {
      const boardId = boardIdFromDocumentName(documentName);
      if (boardId) history.unloaded(boardId);
      return Promise.resolve();
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
        store: async ({ documentName, state, document }) => {
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

          // The board is stored; what changed on it since goes into its history (spec 38a). A
          // history that cannot be written must not make the store count as failed.
          const boardId = boardIdFromDocumentName(documentName);
          if (boardId) await history.stored(boardId, document);

          const planOf = projectIdFromPlanDocumentName(documentName);
          if (!planOf || !onPlanStored) return;
          // The plan is stored; whatever follows from it must not make the store count as failed.
          try {
            onPlanStored(planOf, document);
          } catch (error) {
            console.error('Following a stored plan failed', error);
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
    history.unloaded(boardId);
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

  /**
   * Writes what changed on a board into its history right now (spec 38a), without waiting for
   * the board to be stored, and resolves once it is written. For a board nobody has open there
   * is nothing left to write: it was written when the board was stored for the last time.
   *
   * What changed is read before this returns to its caller, so two calls in a row tell apart
   * what happened before and between them. With `mark`, what changed took an entry back (spec
   * 38b) and is written as that.
   */
  async function recordHistory(boardId: string, mark?: RevertMark): Promise<void> {
    const live = hocuspocus.documents.get(boardDocumentName(boardId));
    if (live && !live.isLoading) await history.stored(boardId, live, mark);
    await history.settled(boardId);
  }

  /**
   * Changes the plan of a project from the server (spec 25b: an accepted suggestion). Like a
   * board: `fn` gets the live document, and its changes reach everyone who has the plan open at
   * once and are stored like theirs.
   */
  async function changePlan<T>(projectId: string, fn: (doc: Y.Doc) => T | Promise<T>): Promise<T> {
    const connection = await hocuspocus.openDirectConnection(planDocumentName(projectId), {
      user: SERVICE_USER,
      projectId,
    });
    try {
      const { document } = connection;
      if (!document) throw new Error(`The plan of project ${projectId} could not be opened`);
      return await fn(document);
    } finally {
      await connection.disconnect();
    }
  }

  /**
   * Reads a document as it is right now, without connecting to it: the live document if people
   * have it open, else the stored one; nothing is loaded into the server and nothing is written.
   */
  async function readDocument<T>(documentName: string, read: (doc: Y.Doc) => T): Promise<T> {
    const live = hocuspocus.documents.get(documentName);
    if (live && !live.isLoading) return read(live);
    const { rows } = await db.adminPool.query<{ state: Buffer }>(
      'select state from yjs_documents where name = $1',
      [documentName],
    );
    const stored = new Y.Doc();
    try {
      if (rows[0]) Y.applyUpdate(stored, new Uint8Array(rows[0].state));
      return read(stored);
    } finally {
      stored.destroy();
    }
  }

  /** What is on a board right now (spec 21b: the read-only view). */
  function readBoard(boardId: string): Promise<{ nodes: CanvasNode[]; edges: CanvasEdge[] }> {
    return readDocument(boardDocumentName(boardId), (doc) => ({
      nodes: readNodes(doc),
      edges: readEdges(doc),
    }));
  }

  /** What the sections of a project's plan hold right now (spec 26a: the roadmap). */
  function readPlanSections(projectId: string): Promise<Partial<Record<PlanSection, PlanNode[]>>> {
    return readDocument(planDocumentName(projectId), planSectionsOf);
  }

  /** The whole plan of a project as nodes, in the order of the document (spec 27b: the package). */
  function readPlan(projectId: string): Promise<PlanNode[]> {
    return readDocument(planDocumentName(projectId), planOf);
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

  return {
    hocuspocus,
    handleUpgrade,
    deleteBoard,
    changeBoard,
    changePlan,
    readBoard,
    readPlan,
    readPlanSections,
    recordHistory,
    closeUser,
    close,
  };
}

export type Collab = ReturnType<typeof createCollab>;

/** What the API needs from the collaboration server. */
export type BoardDocuments = Pick<
  Collab,
  | 'deleteBoard'
  | 'changeBoard'
  | 'changePlan'
  | 'readBoard'
  | 'readPlan'
  | 'readPlanSections'
  | 'recordHistory'
> & {
  /**
   * Asks for ids for the tasks of a plan that has some without (spec 26b); it returns at once and
   * the ids follow. Missing where nothing gives ids, e.g. in most tests.
   */
  giveTaskIds?: (projectId: string) => void;
};
