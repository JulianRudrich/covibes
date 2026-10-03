import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { PLAN_TASK_ATTRIBUTE, type PlanNode } from './plan';
import { readPlanSections, writePlanSection } from './plan-doc';
import { planNodesFromMarkdown } from './plan-markdown';
import { readRoadmap, withAssignees } from './plan-roadmap';
import {
  carryTaskIds,
  ensureTaskIds,
  listItemText,
  needsTaskIds,
  TASK_IDS_ORIGIN,
  taskIdOf,
  withoutTaskIds,
} from './plan-tasks';

/** Ids that are easy to read in a failing test: 00000000-0000-4000-8000-00000000000N. */
function counter(start = 1) {
  let next = start;
  return () => `00000000-0000-4000-8000-${String(next++).padStart(12, '0')}`;
}
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const MILESTONES = [
  '### Meilenstein 1: Grundgerüst',
  '',
  '- Projekt aufsetzen',
  '  - mit Vorlage',
  '- Login per E-Mail-Link',
  '',
  '### Meilenstein 2: Mitglieder',
  '',
  '1. Tabelle anlegen',
].join('\n');

function planWith(sections: Record<string, string>) {
  const doc = new Y.Doc();
  for (const [section, markdown] of Object.entries(sections)) {
    writePlanSection(doc, section as 'scope', planNodesFromMarkdown(markdown), 'de');
  }
  return doc;
}

function items(nodes: readonly PlanNode[]): PlanNode[] {
  return nodes.flatMap((node) => [
    ...(node.type === 'listItem' ? [node] : []),
    ...items(node.content ?? []),
  ]);
}

const idsOf = (doc: Y.Doc, section: 'milestones' | 'scope' = 'milestones') =>
  items(readPlanSections(doc)[section] ?? []).map((item) => [listItemText(item), taskIdOf(item)]);

describe('ensureTaskIds', () => {
  it('gives every list item of the milestones an id, and those of other sections none', () => {
    const doc = planWith({ scope: '- Mitgliederliste', milestones: MILESTONES });
    const origins: unknown[] = [];
    doc.on('afterTransaction', (transaction: Y.Transaction) => {
      origins.push(transaction.origin);
    });

    expect(needsTaskIds(doc)).toBe(true);
    expect(ensureTaskIds(doc, counter())).toBe(4);
    expect(needsTaskIds(doc)).toBe(false);

    expect(idsOf(doc)).toEqual([
      ['Projekt aufsetzen', ID(1)],
      ['mit Vorlage', ID(2)],
      ['Login per E-Mail-Link', ID(3)],
      ['Tabelle anlegen', ID(4)],
    ]);
    expect(idsOf(doc, 'scope')).toEqual([['Mitgliederliste', null]]);
    expect(origins).toEqual([TASK_IDS_ORIGIN]);
  });

  it('leaves the ids that are there and changes nothing when all have one', () => {
    const doc = planWith({ milestones: MILESTONES });
    ensureTaskIds(doc, counter());
    const before = Y.encodeStateVector(doc);

    expect(ensureTaskIds(doc, counter(50))).toBe(0);

    expect(Y.encodeStateVector(doc)).toEqual(before);
    expect(idsOf(doc)[0]).toEqual(['Projekt aufsetzen', ID(1)]);
  });

  it('gives a pasted copy and an item with a broken id a new one; the first keeps its id', () => {
    const nodes = planNodesFromMarkdown('### M1\n\n- Login\n- Login\n- Export');
    // The first two carry the same id, like a copy and its original; the last one is broken.
    items(nodes).forEach((item, index) => {
      item.attrs = { [PLAN_TASK_ATTRIBUTE]: index < 2 ? ID(7) : 'kaputt' };
    });
    const doc = new Y.Doc();
    writePlanSection(doc, 'milestones', nodes, 'de');

    expect(ensureTaskIds(doc, counter(20))).toBe(2);

    expect(idsOf(doc)).toEqual([
      ['Login', ID(7)],
      ['Login', ID(20)],
      ['Export', ID(21)],
    ]);
  });

  it('never gives an id twice, also when the source of ids repeats itself', () => {
    const doc = planWith({ milestones: '### M1\n\n- A\n- B\n- C' });
    const repeating = [ID(1), ID(1), ID(1), ID(2), ID(2), ID(3)];
    let call = 0;

    ensureTaskIds(doc, () => repeating[call++] ?? ID(99));

    expect(idsOf(doc).map(([, id]) => id)).toEqual([ID(1), ID(2), ID(3)]);
  });

  it('does nothing for a plan without the section', () => {
    expect(ensureTaskIds(planWith({ scope: '- Liste' }), counter())).toBe(0);
    expect(ensureTaskIds(new Y.Doc(), counter())).toBe(0);
  });

  it('takes the section as the roadmap reads it, also with a section heading twice', () => {
    // A second heading "scope" stands inside the milestones, e.g. pasted there. It starts no
    // section of its own: the roadmap reads it as a milestone, and the list after it as its tasks.
    const doc = planWith({ scope: 'Nur für den Verein.', milestones: '- Login' });
    const fragment = doc.getXmlFragment('default');
    const heading = new Y.XmlElement('heading');
    heading.setAttribute('section', 'scope');
    heading.setAttribute('level', 2 as unknown as string);
    const list = new Y.XmlElement('bulletList');
    const item = new Y.XmlElement('listItem');
    const paragraph = new Y.XmlElement('paragraph');
    paragraph.insert(0, [new Y.XmlText('Export')]);
    item.insert(0, [paragraph]);
    list.insert(0, [item]);
    fragment.push([heading, list]);
    expect(
      readRoadmap(readPlanSections(doc)).milestones.flatMap((milestone) =>
        milestone.tasks.map((task) => task.text),
      ),
    ).toEqual(['Export']);

    expect(ensureTaskIds(doc, counter())).toBe(2);

    expect(
      readRoadmap(readPlanSections(doc)).milestones.flatMap((milestone) =>
        milestone.tasks.map((task) => task.id),
      ),
    ).toEqual([ID(2)]);
    expect(needsTaskIds(doc)).toBe(false);
  });

  it('fails instead of trying forever when the source only gives one id', () => {
    const doc = planWith({ milestones: '### M1\n\n- A\n- B' });

    expect(() => ensureTaskIds(doc, () => ID(1))).toThrow('keeps giving ids that are taken');
    expect(() => carryTaskIds([], planNodesFromMarkdown('- A\n- B'), () => ID(1))).toThrow();
  });
});

describe('carryTaskIds', () => {
  const before = carryTaskIds(
    [],
    planNodesFromMarkdown(
      [
        '### Meilenstein 1',
        '',
        '- Projekt aufsetzen',
        '- Login per E-Mail-Link in der API bauen',
        '- Verwaltete PostgreSQL-Datenbank mit Backups anlegen',
      ].join('\n'),
    ),
    counter(),
  );

  it('keeps the id of a task that reads the same, wherever it stands now', () => {
    const after = carryTaskIds(
      before,
      planNodesFromMarkdown('### Meilenstein 2\n\n- Login per E-Mail-Link in der API bauen'),
      counter(50),
    );

    expect(items(after).map(taskIdOf)).toEqual([ID(2)]);
  });

  it('gives a reworded task the id of the most similar one, and new tasks new ids', () => {
    const after = carryTaskIds(
      before,
      planNodesFromMarkdown(
        [
          '### Meilenstein 1',
          '',
          // Reworded: most of its words stayed.
          '- PostgreSQL-Datenbank mit Backups anlegen (verwaltet oder auf dem Vereinsserver)',
          '- Projekt aufsetzen',
          // New: it shares too little with any task from before.
          '- Abnahme mit dem Vorstand',
        ].join('\n'),
      ),
      counter(50),
    );

    expect(items(after).map((item) => [listItemText(item), taskIdOf(item)])).toEqual([
      ['PostgreSQL-Datenbank mit Backups anlegen (verwaltet oder auf dem Vereinsserver)', ID(3)],
      ['Projekt aufsetzen', ID(1)],
      ['Abnahme mit dem Vorstand', ID(50)],
    ]);
  });

  it('gives an id to one task only: the same text first, then the best match', () => {
    const after = carryTaskIds(
      before,
      planNodesFromMarkdown(
        '### M\n\n- Login per E-Mail-Link in der API\n- Login per E-Mail-Link in der API bauen',
      ),
      counter(50),
    );

    // The second one reads the same as before and keeps the id; the similar one is new.
    expect(items(after).map(taskIdOf)).toEqual([ID(50), ID(2)]);
  });

  it('leaves what it was given unchanged', () => {
    const after = planNodesFromMarkdown('### M\n\n- Projekt aufsetzen');
    const copy = structuredClone(after);

    carryTaskIds(before, after, counter(50));

    expect(after).toEqual(copy);
  });
});

describe('withoutTaskIds', () => {
  it('takes the ids out and leaves everything else', () => {
    const withIds = carryTaskIds(
      [],
      planNodesFromMarkdown('### Meilenstein 1\n\n- Projekt **aufsetzen**\n  - mit Vorlage'),
      counter(),
    );
    const heading = withIds[0];
    if (heading) heading.attrs = { ...heading.attrs, section: 'milestones' };

    const plain = withoutTaskIds(withIds);

    expect(items(plain).map(taskIdOf)).toEqual([null, null]);
    expect(items(plain).every((item) => item.attrs === undefined)).toBe(true);
    expect(plain[0]?.attrs).toEqual({
      ...planNodesFromMarkdown('### X')[0]?.attrs,
      section: 'milestones',
    });
    expect(JSON.stringify(plain)).not.toContain(PLAN_TASK_ATTRIBUTE);
    expect(JSON.stringify(withIds)).toContain(PLAN_TASK_ATTRIBUTE);
  });
});

describe('the roadmap with tasks (spec 26b)', () => {
  it('reads the ids of the tasks and puts their assignees on them', () => {
    const doc = planWith({ milestones: MILESTONES });
    ensureTaskIds(doc, counter());
    const roadmap = readRoadmap(readPlanSections(doc));

    expect(roadmap.milestones.map((milestone) => milestone.tasks)).toEqual([
      [
        { id: ID(1), text: 'Projekt aufsetzen', assignee: null },
        { id: ID(3), text: 'Login per E-Mail-Link', assignee: null },
      ],
      [{ id: ID(4), text: 'Tabelle anlegen', assignee: null }],
    ]);

    const alex = { userId: ID(900), name: 'Alex Berg' };
    const assigned = withAssignees(
      roadmap,
      new Map([
        [ID(3), alex],
        // A task that left the plan shows nowhere.
        [ID(77), alex],
      ]),
    );
    expect(assigned.milestones.flatMap((milestone) => milestone.tasks)).toEqual([
      { id: ID(1), text: 'Projekt aufsetzen', assignee: null },
      { id: ID(3), text: 'Login per E-Mail-Link', assignee: alex },
      { id: ID(4), text: 'Tabelle anlegen', assignee: null },
    ]);
    // The roadmap it was given stays as it was.
    expect(roadmap.milestones[0]?.tasks[1]?.assignee).toBeNull();
  });
});
