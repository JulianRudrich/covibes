import { randomUUID } from 'node:crypto';

import { readNodes, type ProjectSummary } from '@covibes/shared';
import { describe, expect, it, vi } from 'vitest';

import { createRunCommands, RecoveryConflictError } from '@server/tasks/run-commands';
import { memoryBoards } from '@server/test-boards';
import { createTestServer } from '@server/testing';
import { addBlockTool } from '@server/tools/add-block';

const test = createTestServer();

async function request() {
  const cookie = await test.signIn();
  const response = await test.app.request('/api/projects', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Recovery' }),
  });
  const projectId = ((await response.json()) as ProjectSummary).id;
  const board = await test.db.admin
    .selectFrom('boards')
    .select('id')
    .where('project_id', '=', projectId)
    .executeTakeFirstOrThrow();
  const messageId = randomUUID();
  await test.app.request(`/api/projects/${projectId}/messages`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ id: messageId, content: '@Moderator draw an API block' }),
  });
  const run = await test.db.admin
    .selectFrom('ai_runs')
    .select('id')
    .where('trigger_message_id', '=', messageId)
    .executeTakeFirstOrThrow();
  return { runId: run.id, boardId: board.id, projectId };
}

describe('durable tool replay (spec 41)', () => {
  it('rechecks the current proposals-only setting before replaying an unflushed mutation', async () => {
    const { runId, boardId, projectId } = await request();
    const memory = memoryBoards();
    const boards = {
      ...memory.boards,
      flush: () => Promise.reject(new Error('lost acknowledgement')),
    };
    const commands = await createRunCommands(test.db.admin, runId, boards);
    const tool = commands.wrap(
      addBlockTool({ boards, boardId, author: { kind: 'agent', agentKey: 'moderator' }, commands }),
    );
    await expect(tool.run({ title: 'API' })).rejects.toThrow('lost acknowledgement');
    await test.db.admin
      .updateTable('projects')
      .set({ settings: JSON.stringify({ proposalsOnly: true }) })
      .where('id', '=', projectId)
      .execute();
    const restarted = memoryBoards();
    const recovered = await createRunCommands(test.db.admin, runId, restarted.boards);
    await expect(recovered.recover()).rejects.toBeInstanceOf(RecoveryConflictError);
    expect(readNodes(restarted.doc(boardId))).toHaveLength(0);
  });
  it.each([false, true])(
    'recovers once after a lost acknowledgement (document lost: %s)',
    async (documentLost) => {
      const { runId, boardId } = await request();
      const first = memoryBoards();
      const boards = {
        ...first.boards,
        flush: () => Promise.reject(new Error('process stopped before acknowledgement')),
      };
      const commands = await createRunCommands(test.db.admin, runId, boards);
      const tool = commands.wrap(
        addBlockTool({
          boards,
          boardId,
          author: { kind: 'agent', agentKey: 'moderator' },
          commands,
        }),
      );
      await expect(tool.run({ title: 'API' })).rejects.toThrow('process stopped');
      const firstNode = readNodes(first.doc(boardId))[0];
      expect(firstNode?.label).toBe('API');

      // A restart either retains the live receipt or reloads a board whose unflushed changes were lost.
      const restarted = documentLost ? memoryBoards() : first;
      const recovered = await createRunCommands(test.db.admin, runId, restarted.boards);
      await recovered.recover();
      const shouldNotRun = vi.fn(() => Promise.resolve('duplicate'));
      const replay = recovered.wrap({ ...tool, run: shouldNotRun });
      const response = await replay.run({ title: 'API' });
      expect(response).toContain('API');
      expect(shouldNotRun).not.toHaveBeenCalled();
      expect(readNodes(restarted.doc(boardId))).toHaveLength(1);
      expect(readNodes(restarted.doc(boardId))[0]?.id).toBe(firstNode?.id);
      await expect(replay.run({ title: 'another block' })).rejects.toBeInstanceOf(
        RecoveryConflictError,
      );
      expect(readNodes(restarted.doc(boardId))).toHaveLength(1);
    },
  );

  it('rejects a different mutation at a recorded position', async () => {
    const { runId, boardId } = await request();
    const memory = memoryBoards();
    const commands = await createRunCommands(test.db.admin, runId, memory.boards);
    const options = {
      boards: memory.boards,
      boardId,
      author: { kind: 'agent', agentKey: 'moderator' } as const,
    };
    await commands.wrap(addBlockTool({ ...options, commands })).run({ title: 'API' });
    const restarted = await createRunCommands(test.db.admin, runId, memory.boards);
    await expect(
      restarted
        .wrap(addBlockTool({ ...options, commands: restarted }))
        .run({ title: 'API changed' }),
    ).rejects.toBeInstanceOf(RecoveryConflictError);
    expect(readNodes(memory.doc(boardId))).toHaveLength(1);
  });

  it('does not re-execute an interrupted non-canvas operation with an uncertain result', async () => {
    const { runId } = await request();
    const memory = memoryBoards();
    const commands = await createRunCommands(test.db.admin, runId, memory.boards);
    const mutate = vi.fn(() => Promise.reject(new Error('connection lost after remote write')));
    await expect(
      commands.wrap({ name: 'remote_write', description: 'test', input: {}, run: mutate }).run({}),
    ).rejects.toThrow('connection lost');
    const restarted = await createRunCommands(test.db.admin, runId, memory.boards);
    await expect(restarted.recover()).rejects.toBeInstanceOf(RecoveryConflictError);
    expect(mutate).toHaveBeenCalledTimes(1);
  });
});
