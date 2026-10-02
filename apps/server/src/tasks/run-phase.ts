import type { DB } from '@covibes/db';
import { toPhase } from '@covibes/shared';
import type { Kysely } from 'kysely';

import type { PhaseWriter } from '@server/tools/set-phase';

/**
 * The phase of a project for the moderator's tool (spec 24). The worker writes it directly; the
 * database announces the change on the live channel.
 */
export function phaseWriter(admin: Kysely<DB>, projectId: string): PhaseWriter {
  return {
    current: async () => {
      const project = await admin
        .selectFrom('projects')
        .select('phase')
        .where('id', '=', projectId)
        .executeTakeFirst();
      return toPhase(project?.phase);
    },
    set: async (phase) => {
      await admin.updateTable('projects').set({ phase }).where('id', '=', projectId).execute();
    },
  };
}
