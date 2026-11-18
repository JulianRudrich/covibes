import { randomUUID } from 'node:crypto';

import { addBlock, type ProjectSummary } from '@covibes/shared';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { createBoardHistory } from '@server/collab/board-history';
import { createTestServer } from '@server/testing';

const test = createTestServer();

describe('history delivery recovery (spec 41)', () => {
  it.each(['board_changes', 'board_history_outbox'] as const)(
    'retries a rejected %s write once',
    async (table) => {
      const cookie = await test.signIn();
      const response = await test.app.request('/api/projects', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'History recovery' }),
      });
      const projectId = ((await response.json()) as ProjectSummary).id;
      const board = await test.db.admin
        .selectFrom('boards')
        .select('id')
        .where('project_id', '=', projectId)
        .executeTakeFirstOrThrow();
      const suffix = randomUUID().replaceAll('-', '');
      const functionName = `fail_history_${suffix}`;
      const triggerName = `reject_history_${suffix}`;
      const doc = new Y.Doc();
      const recorder = createBoardHistory({ adminPool: test.db.adminPool });
      recorder.loaded(board.id, doc);
      addBlock(
        doc,
        { id: randomUUID(), label: 'API', position: { x: 0, y: 0 } },
        { kind: 'agent', agentKey: 'moderator' },
      );
      recorder.changed(board.id, doc, 'service');
      // All interpolated identifiers and the UUID are generated here, not external input.
      await test.db.adminPool
        .query(`create function public.${functionName}() returns trigger language plpgsql as $$
      begin raise exception 'controlled history storage failure'; end; $$;
      create trigger ${triggerName} before insert or update on public.${table}
      for each row when (new.board_id = '${board.id}'::uuid) execute function public.${functionName}();`);
      try {
        await recorder.stored(board.id, doc);
        expect(recorder.failedCount()).toBe(1);
        expect(
          (
            await test.db.adminPool.query('select id from board_changes where board_id = $1', [
              board.id,
            ])
          ).rows,
        ).toHaveLength(0);
        await test.db.adminPool.query(`drop trigger ${triggerName} on public.${table}`);
        // A failed history insert has a durable outbox batch and survives a recorder restart.
        // A rejected outbox insert is still in memory and is restaged on the next attempt.
        const recovered =
          table === 'board_changes'
            ? createBoardHistory({ adminPool: test.db.adminPool })
            : recorder;
        await recovered.reconcile();
        const entries = await test.db.adminPool.query<{ id: string }>(
          'select id from board_changes where board_id = $1',
          [board.id],
        );
        expect(entries.rows).toHaveLength(1);
        await recovered.reconcile();
        expect(
          (
            await test.db.adminPool.query('select id from board_changes where board_id = $1', [
              board.id,
            ])
          ).rows,
        ).toEqual(entries.rows);
        const delivery = await test.db.adminPool.query<{
          payload: unknown;
          completed_at: Date | null;
        }>('select payload, completed_at from board_history_outbox where board_id = $1', [
          board.id,
        ]);
        expect(delivery.rows).toHaveLength(1);
        expect(delivery.rows[0]?.payload).toBeNull();
        expect(delivery.rows[0]?.completed_at).toBeInstanceOf(Date);
        await recovered.close();
      } finally {
        await test.db.adminPool.query(
          `drop trigger if exists ${triggerName} on public.${table}; drop function public.${functionName}();`,
        );
        await recorder.close();
        doc.destroy();
      }
    },
  );
});
