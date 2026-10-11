import {
  diffBoard,
  getEdgesMap,
  getNodesMap,
  HISTORY_DAYS,
  HISTORY_MAX_ENTRIES,
  HISTORY_MAX_ITEMS,
  HISTORY_MERGE_MS,
  historyItemsSchema,
  mergeItems,
  readEdges,
  readNodes,
  type BoardState,
  type HistoryActor,
  type HistoryItem,
} from '@covibes/shared';
import type pg from 'pg';
import type * as Y from 'yjs';

// The history of the boards (spec 38a). The collaboration server tells this module when a board
// was loaded, when a change arrived and when the board was stored. From that it writes entries:
// what each author did since the last entry, read from the board itself. No client reports what
// it did.

type BoardHistoryDeps = {
  /** The admin role's pool: the history is written by the server, for nobody in particular. */
  adminPool: pg.Pool;
  /** Called once a board got a new entry, or an entry of it grew. */
  onChanged?: (projectId: string, boardId: string) => void;
  now?: () => Date;
};

/** Who sent a change: a person, or the server itself (for an agent, or applying a proposal). */
export type ChangeSender = { id: string; name: string } | 'service';

type OpenBoard = {
  /** The board as it stood when the last entry was written. */
  state: BoardState;
  /** The elements that are on the board right now, to see what a change removes. */
  ids: Set<string>;
  /** Who was at work since the last entry: people by id with their name, and the server. */
  humans: Map<string, string>;
  service: boolean;
  removedBy: Map<string, HistoryActor>;
};

function read(doc: Y.Doc): BoardState {
  return { nodes: readNodes(doc), edges: readEdges(doc) };
}

function idsOf(doc: Y.Doc): Set<string> {
  return new Set([...getNodesMap(doc).keys(), ...getEdgesMap(doc).keys()]);
}

function opened(doc: Y.Doc): OpenBoard {
  return {
    state: read(doc),
    ids: idsOf(doc),
    humans: new Map(),
    service: false,
    removedBy: new Map(),
  };
}

type StoredEntry = {
  id: string;
  actor_kind: string;
  actor_user_id: string | null;
  actor_agent_key: string | null;
  items: unknown;
  updated_at: Date;
};

function isBy(entry: StoredEntry, actor: HistoryActor): boolean {
  if (actor.kind === 'human') {
    return entry.actor_kind === 'human' && entry.actor_user_id === actor.userId;
  }
  if (actor.kind === 'agent') {
    return entry.actor_kind === 'agent' && entry.actor_agent_key === actor.agentKey;
  }
  return entry.actor_kind === 'unknown';
}

export function createBoardHistory({
  adminPool,
  onChanged,
  now = () => new Date(),
}: BoardHistoryDeps) {
  const boards = new Map<string, OpenBoard>();
  // One write per board at a time, in the order the board was stored.
  const writing = new Map<string, Promise<void>>();

  /** A board was loaded: this is how it stands, and nothing of it is news. */
  function loaded(boardId: string, doc: Y.Doc) {
    boards.set(boardId, opened(doc));
  }

  /** A change arrived on a board. What it removed is attributed to a person who sent it. */
  function changed(boardId: string, doc: Y.Doc, sender: ChangeSender) {
    const board = boards.get(boardId);
    if (!board) {
      // Not seen loading: how it stands now is where its history starts.
      boards.set(boardId, opened(doc));
      return;
    }
    const present = idsOf(doc);
    if (sender === 'service') {
      board.service = true;
    } else {
      board.humans.set(sender.id, sender.name);
      for (const id of board.ids) {
        if (!present.has(id)) board.removedBy.set(id, { kind: 'human', userId: sender.id });
      }
    }
    board.ids = present;
  }

  /**
   * Says who removes elements the server is about to remove for them, e.g. when someone takes an
   * entry back (spec 38b). Without it, what the server removes is nobody's.
   */
  function removing(boardId: string, ids: readonly string[], actor: HistoryActor) {
    const board = boards.get(boardId);
    if (!board) return;
    for (const id of ids) board.removedBy.set(id, actor);
  }

  /** A board is no longer open; what it changed was written when it was stored. */
  function unloaded(boardId: string) {
    boards.delete(boardId);
  }

  async function nameOf(client: pg.PoolClient, userId: string, known: Map<string, string>) {
    const name = known.get(userId);
    if (name !== undefined) return name;
    const { rows } = await client.query<{ name: string }>('select name from users where id = $1', [
      userId,
    ]);
    return rows[0]?.name ?? '';
  }

  async function write(
    boardId: string,
    groups: readonly { actor: HistoryActor; items: HistoryItem[] }[],
    names: Map<string, string>,
  ): Promise<string | undefined> {
    const at = now();
    const client = await adminPool.connect();
    try {
      await client.query('begin');
      // The board may be gone meanwhile; then its history is, too.
      const found = await client.query<{ project_id: string }>(
        'select project_id from boards where id = $1 for share',
        [boardId],
      );
      const projectId = found.rows[0]?.project_id;
      if (projectId === undefined) {
        await client.query('rollback');
        return undefined;
      }
      for (const group of groups) {
        const latest = await client.query<StoredEntry>(
          `select id, actor_kind, actor_user_id, actor_agent_key, items, updated_at
           from board_changes where board_id = $1
           order by updated_at desc, id desc limit 1 for update`,
          [boardId],
        );
        const entry = latest.rows[0];
        const earlier = entry ? historyItemsSchema.safeParse(entry.items) : undefined;
        // The same author going on within a minute, with nobody in between: their entry grows.
        if (
          entry &&
          earlier?.success &&
          isBy(entry, group.actor) &&
          at.getTime() - entry.updated_at.getTime() < HISTORY_MERGE_MS
        ) {
          const merged = mergeItems(earlier.data, group.items);
          if (merged.length === 0) {
            // Everything was put back as it was: nothing happened.
            await client.query('delete from board_changes where id = $1', [entry.id]);
          } else {
            await client.query(
              'update board_changes set items = $2::jsonb, updated_at = $3 where id = $1',
              [entry.id, JSON.stringify(merged), at],
            );
          }
          continue;
        }
        const { actor } = group;
        await client.query(
          `insert into board_changes
             (project_id, board_id, actor_kind, actor_user_id, actor_agent_key, actor_name, items,
              created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $8)`,
          [
            projectId,
            boardId,
            actor.kind,
            actor.kind === 'human' ? actor.userId : null,
            actor.kind === 'agent' ? actor.agentKey : null,
            actor.kind === 'human' ? await nameOf(client, actor.userId, names) : '',
            JSON.stringify(group.items.slice(0, HISTORY_MAX_ITEMS)),
            at,
          ],
        );
      }
      // Old entries go as new ones come (owner decision: 30 days, 200 per board).
      await client.query(
        `delete from board_changes
         where board_id = $1
           and (updated_at < $2::timestamptz - make_interval(days => $3)
                or id not in (
                  select id from board_changes where board_id = $1
                  order by updated_at desc, id desc limit $4))`,
        [boardId, at, HISTORY_DAYS, HISTORY_MAX_ENTRIES],
      );
      await client.query('commit');
      return projectId;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * A board was stored: what changed since the last entry is written, one entry per author. The
   * board as it stands becomes what the next entry is compared with, whether or not the write
   * succeeds: a history with a gap is better than one that repeats itself.
   */
  function stored(boardId: string, doc: Y.Doc): Promise<void> {
    const board = boards.get(boardId);
    if (!board) {
      boards.set(boardId, opened(doc));
      return Promise.resolve();
    }
    const current = read(doc);
    const groups = diffBoard(board.state, current, {
      humans: new Set(board.humans.keys()),
      service: board.service,
      removedBy: board.removedBy,
    });
    const names = board.humans;
    board.state = current;
    board.ids = idsOf(doc);
    board.humans = new Map();
    board.service = false;
    board.removedBy = new Map();
    if (groups.length === 0) return writing.get(boardId) ?? Promise.resolve();

    const before = writing.get(boardId) ?? Promise.resolve();
    const done = before
      .then(() => write(boardId, groups, names))
      .then((projectId) => {
        if (projectId !== undefined) onChanged?.(projectId, boardId);
      })
      .catch((error: unknown) => {
        console.error('Writing the history of a board failed', error);
      })
      .finally(() => {
        if (writing.get(boardId) === done) writing.delete(boardId);
      });
    writing.set(boardId, done);
    return done;
  }

  /** Resolves once everything that was stored so far is written. */
  function settled(boardId: string): Promise<void> {
    return writing.get(boardId) ?? Promise.resolve();
  }

  return { loaded, changed, removing, stored, unloaded, settled };
}

export type BoardHistoryRecorder = ReturnType<typeof createBoardHistory>;
