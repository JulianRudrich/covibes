import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

import { boardDocumentName, readNodes, type ProjectSummary } from '@covibes/shared';
import { getRequestListener } from '@hono/node-server';
import { afterAll, beforeAll, expect, it } from 'vitest';
import * as Y from 'yjs';

import type { AgentReplyResult } from '@server/ai-gateway/types';
import { createBoardClient } from '@server/collab/board-client';
import { createCollab, type Collab } from '@server/collab/collab';
import { runAgentTurn } from '@server/tasks/agent-turn';
import { APP_URL, createTestServer } from '@server/testing';
import { attachWebSockets } from '@server/websockets';

const TOKEN = 'recovery-test-internal-token-0123456789';
const test = createTestServer({ INTERNAL_TOKEN: TOKEN });
let server: Server;
let collab: Collab;
let collabUrl: string;

beforeAll(async () => {
  collab = createCollab({ db: test.db, auth: test.auth, internalToken: TOKEN });
  const listener = getRequestListener(test.appWith(collab).fetch);
  server = createServer((request, response) => {
    void listener(request, response);
  });
  attachWebSockets(server, {
    appUrl: APP_URL,
    routes: new Map([[test.env.COLLAB_PATH, collab.handleUpgrade]]),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  collabUrl = `ws://127.0.0.1:${String((server.address() as AddressInfo).port)}${test.env.COLLAB_PATH}`;
});
afterAll(async () => {
  await collab.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

it('recovers one block and the same reply after the worker process is killed', async () => {
  const cookie = await test.signIn();
  const created = await test.app.request('/api/projects', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Crash recovery' }),
  });
  const projectId = ((await created.json()) as ProjectSummary).id;
  const board = await test.db.admin
    .selectFrom('boards')
    .select('id')
    .where('project_id', '=', projectId)
    .executeTakeFirstOrThrow();
  const messageId = randomUUID();
  await test.app.request(`/api/projects/${projectId}/messages`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ id: messageId, content: '@Moderator draw a block' }),
  });
  const run = await test.db.admin
    .selectFrom('ai_runs')
    .select('id')
    .where('trigger_message_id', '=', messageId)
    .executeTakeFirstOrThrow();
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      fileURLToPath(new URL('./fixtures/crash-after-canvas.ts', import.meta.url)),
    ],
    {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      env: {
        ...process.env,
        COVIBES_TEST_DATABASE_URL: test.env.DATABASE_ADMIN_URL,
        COVIBES_TEST_COLLAB_URL: collabUrl,
        COVIBES_TEST_INTERNAL_TOKEN: TOKEN,
        COVIBES_TEST_RUN_ID: run.id,
      },
      stdio: 'pipe',
    },
  );
  let errors = '';
  child.stderr.on('data', (part: Buffer) => {
    errors += part.toString();
  });
  const exited = await once(child, 'exit');
  expect(exited, errors).toEqual([null, 'SIGKILL']);

  const interrupted = await test.db.admin
    .selectFrom('ai_runs')
    .select(['status', 'reply_message_id'])
    .where('id', '=', run.id)
    .executeTakeFirstOrThrow();
  expect(interrupted.status).toBe('running');
  expect(interrupted.reply_message_id).not.toBeNull();
  const stored = await test.db.adminPool.query<{ state: Buffer }>(
    'select state from yjs_documents where name = $1',
    [boardDocumentName(board.id)],
  );
  const durable = new Y.Doc();
  Y.applyUpdate(durable, new Uint8Array(stored.rows[0]?.state ?? []));
  expect(readNodes(durable)).toHaveLength(1);
  durable.destroy();

  const result: AgentReplyResult = {
    text: 'Recovered once.',
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    costUsd: 0,
    webSearches: 0,
  };
  const boards = createBoardClient({ collabUrl, appUrl: APP_URL, token: TOKEN });
  await runAgentTurn(
    {
      admin: test.db.admin,
      boards,
      logger: { error: () => undefined },
      complete: () => Promise.resolve({ ...result, text: 'instruction' }),
      reply: async (request) => {
        const tool = request.tools.find((candidate) => candidate.name === 'add_block');
        if (!tool) throw new Error('No canvas tool');
        await tool.run({ title: 'Recovered API' });
        return result;
      },
    },
    { runId: run.id },
    { attempt: 2, maxAttempts: 3 },
  );
  expect((await collab.readBoard(board.id)).nodes).toHaveLength(1);
  const recovered = await test.db.admin
    .selectFrom('ai_runs')
    .select(['status', 'reply_message_id'])
    .where('id', '=', run.id)
    .executeTakeFirstOrThrow();
  expect(recovered).toEqual({ status: 'done', reply_message_id: interrupted.reply_message_id });
  const replies = await test.db.admin
    .selectFrom('messages')
    .select('id')
    .where('reply_to', '=', messageId)
    .where('author_kind', '=', 'agent')
    .execute();
  expect(replies).toEqual([{ id: interrupted.reply_message_id }]);
}, 30_000);
