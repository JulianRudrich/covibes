import { randomUUID } from 'node:crypto';

import {
  diffBoard,
  getEdgesMap,
  getNodesMap,
  HISTORY_DAYS,
  HISTORY_MAX_ENTRIES,
  HISTORY_MAX_ITEMS,
  HISTORY_MERGE_MS,
  historyItemsSchema,
  historyActorSchema,
  mergeItems,
  readEdges,
  readNodes,
  type BoardState,
  type HistoryActor,
  type HistoryItem,
} from '@covibes/shared';
import type pg from 'pg';
import type * as Y from 'yjs';
import { z } from 'zod';

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

/**
 * What the server just did on a board to take an entry back (spec 38b): which entry, for whom,
 * and what came of it.
 */
export type RevertMark = {
  /** The entry that is taken back. */
  reverts: string;
  by: { userId: string; name: string };
  /** The elements that were taken off the board for it. */
  removed: readonly string[];
  /** How many elements were set back, and how many stayed as they were. */
  reverted: number;
  kept: number;
};

const batchSchema = z.object({
  groups: z.array(z.object({ actor: historyActorSchema, items: historyItemsSchema })),
  names: z.record(z.string(), z.string()),
  at: z.iso.datetime(),
  mark: z
    .object({
      reverts: z.uuid(),
      by: z.object({ userId: z.string(), name: z.string() }),
      removed: z.array(z.string()),
      reverted: z.number().int().min(0),
      kept: z.number().int().min(0),
    })
    .optional(),
});
type HistoryBatch = z.infer<typeof batchSchema>;

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
  reverts: string | null;
  undone_at: Date | null;
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
  const unstaged = new Map<string, { boardId: string; batch: HistoryBatch }>();
  const failures = new Set<string>();
  const deletedBoards = new Set<string>();
  let stopped = false;
  const isStopped = () => stopped;

  async function drain(boardId: string) {
    if (deletedBoards.has(boardId)) return;
    for (const [id, entry] of unstaged) {
      if (entry.boardId !== boardId) continue;
      // Insert by a stable identity. A committed receipt survives a lost response and is
      // never replaced with another copy of its payload.
      await adminPool.query(
        `insert into board_history_outbox (id, board_id, payload) values ($1, $2, $3::jsonb)
         on conflict (id) do nothing`,
        [id, boardId, JSON.stringify(entry.batch)],
      );
      unstaged.delete(id);
    }
    const { rows } = await adminPool.query<{ id: string; payload: unknown }>(
      `select id, payload from board_history_outbox where board_id = $1
       and completed_at is null order by created_at, id`,
      [boardId],
    );
    for (const row of rows) {
      const batch = batchSchema.parse(row.payload);
      const projectId = await write(
        boardId,
        batch.groups,
        new Map(Object.entries(batch.names)),
        batch.mark,
        row.id,
        new Date(batch.at),
      );
      if (projectId !== undefined) onChanged?.(projectId, boardId);
    }
    failures.delete(boardId);
  }

  function enqueue(boardId: string): Promise<void> {
    const before = writing.get(boardId) ?? Promise.resolve();
    const next = before
      .then(() => drain(boardId))
      .catch((error: unknown) => {
        if (!deletedBoards.has(boardId)) {
          failures.add(boardId);
          console.error(
            'Writing the history of a board failed; its delivery will be retried',
            error,
          );
        }
      })
      .finally(() => {
        if (writing.get(boardId) === next) writing.delete(boardId);
      });
    writing.set(boardId, next);
    return next;
  }

  async function reconcile(): Promise<void> {
    if (isStopped()) return;
    const { rows } = await adminPool.query<{ board_id: string }>(
      `select distinct board_id from board_history_outbox where completed_at is null`,
    );
    if (isStopped()) return;
    const ids = new Set([
      ...rows.map((row) => row.board_id),
      ...[...unstaged.values()].map((entry) => entry.boardId),
    ]);
    await Promise.all([...ids].map(enqueue));
  }

  /** A board was loaded: this is how it stands, and nothing of it is news. */
  function loaded(boardId: string, doc: Y.Doc) {
    boards.set(boardId, opened(doc));
    void enqueue(boardId);
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

  /** A board is no longer open; what it changed was written when it was stored. */
  function unloaded(boardId: string) {
    boards.delete(boardId);
  }

  async function write(
    boardId: string,
    groups: readonly { actor: HistoryActor; items: HistoryItem[] }[],
    names: Map<string, string>,
    mark?: RevertMark,
    batchId?: string,
    at = now(),
  ): Promise<string | undefined> {
    const client = await adminPool.connect();
    try {
      await client.query('begin');
      if (batchId) {
        const receipt = await client.query<{ completed_at: Date | null }>(
          'select completed_at from board_history_outbox where id = $1 for update',
          [batchId],
        );
        if (!receipt.rows[0] || receipt.rows[0].completed_at !== null) {
          await client.query('rollback');
          return undefined;
        }
      }
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
        // What the person who takes an entry back did by it is an entry of its own.
        const taking =
          mark && group.actor.kind === 'human' && group.actor.userId === mark.by.userId
            ? mark
            : undefined;
        const latest = await client.query<StoredEntry>(
          `select id, actor_kind, actor_user_id, actor_agent_key, items, updated_at, reverts,
                  undone_at
           from board_changes where board_id = $1
           order by updated_at desc, id desc limit 1 for update`,
          [boardId],
        );
        const entry = latest.rows[0];
        const earlier = entry ? historyItemsSchema.safeParse(entry.items) : undefined;
        // The same author going on within a minute, with nobody in between: their entry grows.
        // An entry that takes one back, or was taken back, stays what it is.
        if (
          !taking &&
          entry &&
          earlier?.success &&
          isBy(entry, group.actor) &&
          entry.reverts === null &&
          entry.undone_at === null &&
          at.getTime() >= entry.updated_at.getTime() &&
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
        // An outbox batch can outlive its author. Lock an existing account until this
        // transaction commits so a concurrent deletion cannot invalidate the foreign key.
        const person =
          actor.kind === 'human'
            ? (
                await client.query<{ id: string; name: string }>(
                  'select id, name from users where id = $1 for key share',
                  [actor.userId],
                )
              ).rows[0]
            : undefined;
        await client.query(
          `insert into board_changes
             (project_id, board_id, actor_kind, actor_user_id, actor_agent_key, actor_name, items,
              created_at, updated_at, reverts)
           values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $8,
                   (select id from board_changes where id = $9 and board_id = $2))`,
          [
            projectId,
            boardId,
            actor.kind,
            person?.id ?? null,
            actor.kind === 'agent' ? actor.agentKey : null,
            actor.kind === 'human' ? (names.get(actor.userId) ?? person?.name ?? '') : '',
            JSON.stringify(group.items.slice(0, HISTORY_MAX_ITEMS)),
            at,
            taking?.reverts ?? null,
          ],
        );
        if (!taking) continue;
        // The entry that was taken back says by whom, and is not taken back twice.
        await client.query(
          `update board_changes
           set undone_at = $3, undone_by = $4, undone_by_name = $5, undone_reverted = $6,
               undone_kept = $7
           where id = $1 and board_id = $2 and undone_at is null`,
          [
            taking.reverts,
            boardId,
            at,
            person?.id ?? null,
            taking.by.name.slice(0, 200),
            taking.reverted,
            taking.kept,
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
      if (batchId)
        await client.query(
          'update board_history_outbox set payload = null, completed_at = now() where id = $1',
          [batchId],
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
   * succeeds. A delivery outbox retries failed entries without repeating committed ones.
   *
   * With `mark`, the server just took an entry back for a person (spec 38b): what they did by
   * it is written as an entry of its own, and the entry it takes back is marked.
   */
  function stored(boardId: string, doc: Y.Doc, mark?: RevertMark): Promise<void> {
    const board = boards.get(boardId);
    if (!board) {
      boards.set(boardId, opened(doc));
      return Promise.resolve();
    }
    const current = read(doc);
    if (mark) {
      // What the server removed for the person is removed by them.
      const actor: HistoryActor = { kind: 'human', userId: mark.by.userId };
      for (const id of mark.removed) board.removedBy.set(id, actor);
    }
    const groups = diffBoard(board.state, current, {
      humans: new Set(board.humans.keys()),
      // Taking back is a change of the server; that it happened may not have arrived here yet.
      service: board.service || mark !== undefined,
      removedBy: board.removedBy,
    });
    const names = board.humans;
    if (mark && !names.has(mark.by.userId)) names.set(mark.by.userId, mark.by.name);
    board.state = current;
    board.ids = idsOf(doc);
    board.humans = new Map();
    board.service = false;
    board.removedBy = new Map();
    if (groups.length > 0) {
      unstaged.set(randomUUID(), {
        boardId,
        batch: {
          groups,
          names: Object.fromEntries(names),
          at: now().toISOString(),
          ...(mark ? { mark: { ...mark, removed: [...mark.removed] } } : {}),
        },
      });
    }
    return enqueue(boardId);
  }

  /** Resolves once everything that was stored so far is written. */
  function settled(boardId: string): Promise<void> {
    return writing.get(boardId) ?? Promise.resolve();
  }

  return {
    loaded,
    changed,
    stored,
    unloaded,
    settled,
    reconcile,
    deleted: (boardId: string) => {
      deletedBoards.add(boardId);
      boards.delete(boardId);
      failures.delete(boardId);
      for (const [id, entry] of unstaged) if (entry.boardId === boardId) unstaged.delete(id);
    },
    failedCount: () => failures.size,
    close: async () => {
      stopped = true;
      await Promise.allSettled([...writing.values()]);
    },
  };
}

export type BoardHistoryRecorder = ReturnType<typeof createBoardHistory>;
