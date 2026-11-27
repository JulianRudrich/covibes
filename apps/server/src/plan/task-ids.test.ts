import { randomUUID } from 'node:crypto';

import {
  ensureTaskIds,
  listItemText,
  needsTaskIds,
  planNodesFromMarkdown,
  readPlanSections,
  readRoadmap,
  taskIdOf,
  writePlanSection,
  type LiveEvent,
  type PlanNode,
} from '@covibes/shared';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { createCollab, type Collab } from '@server/collab/collab';
import { createRoadmapAnnouncer } from '@server/plan/roadmap-live';
import { createTaskIdGiver, type ChangePlan } from '@server/plan/task-ids';
import { createTestServer } from '@server/testing';

// The ids of the plan's tasks (spec 26b).
const test = createTestServer();

const MILESTONES = '### Meilenstein 1: Grundgerüst\n\n- Login\n- Export';

function planWith(milestones: string) {
  const doc = new Y.Doc();
  writePlanSection(doc, 'milestones', planNodesFromMarkdown(milestones), 'de');
  return doc;
}

function listItems(nodes: readonly PlanNode[]): PlanNode[] {
  return nodes.flatMap((node) => [
    ...(node.type === 'listItem' ? [node] : []),
    ...listItems(node.content ?? []),
  ]);
}

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** A collaboration server that holds one plan and changes it when the test lets it. */
function setup(live: Y.Doc) {
  const waiting: (() => void)[] = [];
  const changePlan = vi.fn<ChangePlan>(async (_projectId, change) => {
    await new Promise<void>((resolve) => {
      waiting.push(resolve);
    });
    return change(live);
  });
  return {
    changePlan,
    give: createTaskIdGiver(changePlan),
    /** Lets the changes go on that wait, and waits until they are through. */
    proceed: async () => {
      for (const resolve of waiting.splice(0)) resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

describe('giving the tasks of a stored plan their ids', () => {
  it('changes the plan through the collaboration server, not in the store that found it', async () => {
    const doc = planWith(MILESTONES);
    const { give, changePlan, proceed } = setup(doc);
    const projectId = randomUUID();

    give(projectId, doc);

    // The stored document is as it was; the change follows.
    expect(needsTaskIds(doc)).toBe(true);
    expect(changePlan).toHaveBeenCalledExactlyOnceWith(projectId, expect.any(Function));
    await proceed();
    expect(needsTaskIds(doc)).toBe(false);

    // The plan is stored again with its ids, and that is the end of it.
    give(projectId, doc);
    expect(changePlan).toHaveBeenCalledTimes(1);
  });

  it('leaves a plan alone that needs no ids', () => {
    const doc = planWith(MILESTONES);
    ensureTaskIds(doc);
    const { give, changePlan } = setup(doc);

    give(randomUUID(), doc);
    give(randomUUID(), planWith('Noch keine Meilensteine.'));
    give(randomUUID(), new Y.Doc());

    expect(changePlan).not.toHaveBeenCalled();
  });

  it('runs once per project at a time', async () => {
    const doc = planWith(MILESTONES);
    const { give, changePlan, proceed } = setup(doc);
    const [first, second] = [randomUUID(), randomUUID()];

    give(first, doc);
    give(first, doc);
    give(second, doc);

    expect(changePlan.mock.calls.map(([projectId]) => projectId)).toEqual([first, second]);
    await proceed();

    // A task written later gets its id with the store after it.
    const later = planWith(`${MILESTONES}\n- Import`);
    give(first, later);
    expect(changePlan).toHaveBeenCalledTimes(3);
    await proceed();
  });

  it('runs without a document for a plan that is known to need ids', async () => {
    const doc = planWith(MILESTONES);
    const { give, changePlan, proceed } = setup(doc);
    const projectId = randomUUID();

    // The roadmap read a task without an id; nobody stored the plan since.
    give(projectId);
    give(projectId);

    expect(changePlan).toHaveBeenCalledExactlyOnceWith(projectId, expect.any(Function));
    await proceed();
    expect(needsTaskIds(doc)).toBe(false);
  });

  it('logs a failure and tries again with the next store', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const doc = planWith(MILESTONES);
    const failure = new Error('The plan could not be opened');
    const changePlan = vi.fn<ChangePlan>(() => Promise.reject(failure));
    const give = createTaskIdGiver(changePlan);
    const projectId = randomUUID();

    try {
      give(projectId, doc);
      await until(() => errors.mock.calls.length > 0);
      expect(errors).toHaveBeenCalledWith('Giving the tasks of a plan their ids failed', failure);

      give(projectId, doc);
      expect(changePlan).toHaveBeenCalledTimes(2);
      await until(() => errors.mock.calls.length > 1);
    } finally {
      errors.mockRestore();
    }
  });

  it('gives a plan the collaboration server stored its ids and comes to rest', async () => {
    const cookie = await test.signIn();
    const created = await test.app.request('/api/projects', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Plan task IDs' }),
    });
    expect(created.status).toBe(201);
    const { id: projectId } = (await created.json()) as { id: string };
    let stores = 0;
    const announced: LiveEvent[] = [];
    const announce = createRoadmapAnnouncer({
      publish: (_id, event) => {
        announced.push(event);
      },
    });
    // As the server wires it: the collaboration server is looked up when the ids are given.
    const give = createTaskIdGiver((id, change) => collab.changePlan(id, change));
    const collab: Collab = createCollab({
      db: test.db,
      auth: test.auth,
      onPlanStored: (id, doc) => {
        stores += 1;
        announce(id, doc);
        give(id, doc);
      },
    });
    const tasksOf = async () =>
      readRoadmap(await collab.readPlanSections(projectId)).milestones.flatMap(
        (milestone) => milestone.tasks,
      );

    try {
      await collab.changePlan(projectId, (doc) => {
        writePlanSection(doc, 'milestones', planNodesFromMarkdown(MILESTONES), 'de');
        writePlanSection(doc, 'scope', planNodesFromMarkdown('- Mitgliederliste'), 'de');
      });
      await until(async () => (await tasksOf()).every((task) => task.id !== null));

      const tasks = await tasksOf();
      expect(tasks.map((task) => task.text)).toEqual(['Login', 'Export']);
      expect(new Set(tasks.map((task) => task.id)).size).toBe(2);
      // Only the milestones hold tasks.
      const { scope } = await collab.readPlanSections(projectId);
      expect(listItems(scope ?? []).map(taskIdOf)).toEqual([null]);

      // Stored once as it was written and once with the ids; nothing follows.
      await until(() => stores === 2);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(stores).toBe(2);
      // The roadmap is announced for the new tasks, and again once they can be assigned.
      expect(announced).toEqual([{ type: 'roadmap' }, { type: 'roadmap' }]);
      // What is stored is what the next person who opens the plan gets.
      const stored = await collab.changePlan(projectId, (doc) =>
        listItems(readPlanSections(doc).milestones ?? []).map((item) => [
          listItemText(item),
          taskIdOf(item),
        ]),
      );
      expect(stored).toEqual(tasks.map((task) => [task.text, task.id]));
      // Opening it stored it again, and it needed nothing.
      expect(stores).toBe(3);
      expect(announced).toHaveLength(2);
    } finally {
      await collab.close();
    }
  });
});
