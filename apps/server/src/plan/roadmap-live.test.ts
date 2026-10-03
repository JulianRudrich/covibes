import { randomUUID } from 'node:crypto';

import {
  planNodesFromMarkdown,
  writePlanSection,
  type LiveEvent,
  type PlanSection,
} from '@covibes/shared';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { createRoadmapAnnouncer } from '@server/plan/roadmap-live';

function setup(remembered?: number) {
  const published: { projectId: string; event: LiveEvent }[] = [];
  const announce = createRoadmapAnnouncer(
    {
      publish: (projectId, event) => {
        published.push({ projectId, event });
      },
    },
    remembered,
  );
  return { announce, published };
}

function planWith(sections: Partial<Record<PlanSection, string>>) {
  const doc = new Y.Doc();
  for (const [section, markdown] of Object.entries(sections)) {
    writePlanSection(doc, section as PlanSection, planNodesFromMarkdown(markdown), 'de');
  }
  return doc;
}

const MILESTONES = [
  '### Meilenstein 1: Grundgerüst (2 Wochen)',
  'Die App läuft.',
  '- Login',
  '### Meilenstein 2: Mitglieder',
  '- Mitgliederliste',
].join('\n\n');

describe('the roadmap announcer', () => {
  it('announces the first plan it sees of a project', () => {
    const { announce, published } = setup();
    const projectId = randomUUID();

    announce(projectId, planWith({}));

    expect(published).toEqual([{ projectId, event: { type: 'roadmap' } }]);
  });

  it('announces only what changes the roadmap, per project', () => {
    const { announce, published } = setup();
    const [first, second] = [randomUUID(), randomUUID()];
    announce(first, planWith({ milestones: MILESTONES }));
    announce(second, planWith({ milestones: MILESTONES }));

    // Another section, the same roadmap: nothing to say.
    announce(first, planWith({ scope: 'Nur für den Verein', milestones: MILESTONES }));
    expect(published).toHaveLength(2);

    // A task more, and a time from the costs: both change what the roadmap shows.
    announce(first, planWith({ milestones: `${MILESTONES}\n- Beiträge` }));
    announce(
      first,
      planWith({ milestones: `${MILESTONES}\n- Beiträge`, costs: '- Meilenstein 2: 3 Wochen' }),
    );

    expect(published.map((entry) => entry.projectId)).toEqual([first, second, first, first]);
    expect(published.every((entry) => entry.event.type === 'roadmap')).toBe(true);
  });

  it('remembers only so many projects and announces a forgotten one once more', () => {
    const { announce, published } = setup(2);
    const [first, second, third] = [randomUUID(), randomUUID(), randomUUID()];
    const plan = planWith({ milestones: MILESTONES });
    announce(first, plan);
    announce(second, plan);
    // The third project takes the place of the first, which was announced longest ago.
    announce(third, plan);
    expect(published).toHaveLength(3);

    announce(second, plan);
    announce(third, plan);
    expect(published).toHaveLength(3);

    announce(first, plan);
    expect(published.map((entry) => entry.projectId)).toEqual([first, second, third, first]);
  });
});
