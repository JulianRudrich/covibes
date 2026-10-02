import type { Collab } from '@server/collab/collab';
import type { Realtime } from '@server/realtime/realtime';

/**
 * What a person has open in a project (spec 21a). The live channel and the boards check access
 * when a connection opens, so a change of someone's access closes their connections.
 */
export type ProjectConnections = {
  /**
   * `boards`: the role changed; the boards reconnect with the current rights. `all`: no longer a
   * member; the live channel closes too and every reconnect is refused.
   */
  closeUser: (projectId: string, userId: string, scope: 'boards' | 'all') => void;
};

export function projectConnections(
  realtime: Pick<Realtime, 'closeUser'>,
  collab: Pick<Collab, 'closeUser'>,
): ProjectConnections {
  return {
    closeUser: (projectId, userId, scope) => {
      collab.closeUser(projectId, userId);
      if (scope === 'all') realtime.closeUser(projectId, userId);
    },
  };
}
