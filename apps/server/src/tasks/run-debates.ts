import type { DB } from '@covibes/db';
import type { AgentKey } from '@covibes/shared';
import type { Kysely } from 'kysely';

import { notifyLive } from '@server/realtime/notifications';
import { loadTeam } from '@server/tasks/run-team';

function hasCode(error: unknown, code: string): boolean {
  return (error as { code?: unknown } | null)?.code === code;
}

/** How the moderator's tool opens a debate for one run (spec 18). */
export type DebateWriter = {
  /** The agents of the project's team, read fresh for every call. */
  team: () => Promise<ReadonlySet<AgentKey>>;
  /**
   * Opens a debate tied to the run's answer; the chain starts once the answer is finished
   * (migration 0012). `busy` if another debate of the project is not over yet.
   */
  start: (debate: {
    topic: string;
    question: string;
    participants: readonly AgentKey[];
    rounds: number;
  }) => Promise<'started' | 'busy'>;
};

export function debateWriter(
  admin: Kysely<DB>,
  /** `messageId` is the run's answer, which carries the debate's card. */
  run: { id: string; projectId: string; messageId: string },
): DebateWriter {
  return {
    team: async () => {
      const team = await loadTeam(admin, run.projectId);
      return new Set(team.members.map((member) => member.key));
    },
    start: async (debate) => {
      const active = await admin
        .selectFrom('debates')
        .select('message_id')
        .where('project_id', '=', run.projectId)
        .where('status', 'in', ['running', 'summarizing'])
        .executeTakeFirst();
      // An earlier attempt of this run opened it already; the retry writes the answer again.
      if (active) return active.message_id === run.messageId ? 'started' : 'busy';

      try {
        await admin.transaction().execute(async (trx) => {
          const inserted = await trx
            .insertInto('debates')
            .values({
              project_id: run.projectId,
              message_id: run.messageId,
              topic: debate.topic,
              question: debate.question,
              participants: [...debate.participants],
              rounds: debate.rounds,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          // The run belongs to the debate from now on: when it ends, the first turn is queued.
          await trx
            .updateTable('ai_runs')
            .set({ debate_id: inserted.id })
            .where('id', '=', run.id)
            .execute();
          await notifyLive(trx, {
            kind: 'message',
            projectId: run.projectId,
            messageId: run.messageId,
          });
        });
      } catch (error) {
        // One debate at a time per project, and one per answer.
        if (hasCode(error, '23505')) return 'busy';
        throw error;
      }
      return 'started';
    },
  };
}
