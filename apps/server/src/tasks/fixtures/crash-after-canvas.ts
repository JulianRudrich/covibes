// Spawned only by recovery tests: stop after a durable tool result, before the run finishes.
import type { DB } from '@covibes/db';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

import type { AgentReplyResult } from '@server/ai-gateway/types';
import { createBoardClient } from '@server/collab/board-client';
import { runAgentTurn } from '@server/tasks/agent-turn';

const admin = new Kysely<DB>({
  dialect: new PostgresDialect({
    pool: new pg.Pool({ connectionString: process.env.COVIBES_TEST_DATABASE_URL }),
  }),
});
const boards = createBoardClient({
  collabUrl: process.env.COVIBES_TEST_COLLAB_URL ?? '',
  appUrl: 'http://localhost:5173',
  token: process.env.COVIBES_TEST_INTERNAL_TOKEN ?? '',
});
const result: AgentReplyResult = {
  text: 'instruction',
  provider: 'anthropic',
  model: 'claude-opus-5-5',
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  costUsd: 0,
  webSearches: 0,
};
await runAgentTurn(
  {
    admin,
    boards,
    complete: () => Promise.resolve(result),
    logger: { error: () => undefined },
    reply: async (request) => {
      const tool = request.tools.find((candidate) => candidate.name === 'add_block');
      if (!tool) throw new Error('No canvas tool');
      await tool.run({ title: 'Recovered API' });
      process.kill(process.pid, 'SIGKILL');
      return result;
    },
  },
  { runId: process.env.COVIBES_TEST_RUN_ID },
  { attempt: 1, maxAttempts: 3 },
);
await admin.destroy();
