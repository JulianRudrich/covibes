import { ensureTaskIds, needsTaskIds } from '@covibes/shared';
import type * as Y from 'yjs';

/** The collaboration server's `changePlan`, as far as giving ids needs it. */
export type ChangePlan = (projectId: string, change: (doc: Y.Doc) => number) => Promise<number>;

/**
 * Gives the tasks of a plan their ids (spec 26b), for the collaboration server to call whenever it
 * stored a plan. Most stored plans need none, which a look at the document tells. A plan that
 * needs some is changed through `changePlan`, like every change the server makes: outside the
 * store that found it, and at once for everyone who has the plan open. That change is stored as
 * well and comes back here, where the plan needs nothing more, so it ends by itself. One run per
 * project at a time; a plan stored in between is the one the run changes.
 *
 * Without a document it runs for a plan that is known to need ids: the roadmap read a task
 * without one, e.g. in a plan from before tasks had ids, which nobody has changed since.
 */
export function createTaskIdGiver(changePlan: ChangePlan) {
  const running = new Set<string>();

  async function give(projectId: string) {
    try {
      await changePlan(projectId, (live) => ensureTaskIds(live));
    } catch (error) {
      // The next store of the plan tries again.
      console.error('Giving the tasks of a plan their ids failed', error);
    } finally {
      running.delete(projectId);
    }
  }

  return (projectId: string, doc?: Y.Doc) => {
    if (running.has(projectId) || (doc && !needsTaskIds(doc))) return;
    running.add(projectId);
    void give(projectId);
  };
}
