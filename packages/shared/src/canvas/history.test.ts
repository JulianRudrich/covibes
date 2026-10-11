import { describe, expect, it } from 'vitest';

import {
  diffBoard,
  HISTORY_MAX_ITEMS,
  mergeItems,
  sameActor,
  type HistoryActor,
  type HistoryWindow,
} from './history';
import type { Author, CanvasEdge, CanvasNode } from './model';

const OLGA = '11111111-1111-4111-8111-111111111111';
const ALEX = '22222222-2222-4222-8222-222222222222';
const olga: Author = { kind: 'human', userId: OLGA };
const alex: Author = { kind: 'human', userId: ALEX };
const moderator: Author = { kind: 'agent', agentKey: 'moderator' };
const AT = '2026-10-11T08:00:00.000Z';

let next = 0;
const id = () => {
  next += 1;
  return `aaaaaaaa-aaaa-4aaa-8aaa-${String(next).padStart(12, '0')}`;
};

function block(label: string, author: Author = olga, overrides: Partial<CanvasNode> = {}) {
  const node: CanvasNode = {
    id: id(),
    type: 'block',
    blockType: 'service',
    position: { x: 0, y: 0 },
    size: { width: 180, height: 96 },
    label,
    subtitle: '',
    frameId: null,
    diagramType: null,
    fields: [],
    createdBy: author,
    lastChangedBy: author,
    lastChangedAt: AT,
    ...overrides,
  };
  return node;
}

function arrow(from: CanvasNode, to: CanvasNode, author: Author = olga): CanvasEdge {
  return {
    id: id(),
    source: from.id,
    target: to.id,
    sourceHandle: null,
    targetHandle: null,
    label: '',
    createdBy: author,
    lastChangedBy: author,
    lastChangedAt: AT,
  };
}

/** Who was at work: people whose changes arrived, and whether the server changed the board. */
function at(
  work: { humans?: string[]; service?: boolean; removedBy?: [string, HistoryActor][] } = {},
): HistoryWindow {
  return {
    humans: new Set(work.humans ?? []),
    service: work.service ?? false,
    removedBy: new Map(work.removedBy ?? []),
  };
}

const board = (nodes: CanvasNode[], edges: CanvasEdge[] = []) => ({ nodes, edges });

describe('diffBoard', () => {
  it('finds nothing between two equal boards, also when only the stamps differ', () => {
    const api = block('API');
    const later = { ...api, lastChangedBy: alex, lastChangedAt: '2026-10-11T09:00:00.000Z' };

    expect(diffBoard(board([api]), board([api]), at({ humans: [OLGA] }))).toEqual([]);
    expect(diffBoard(board([api]), board([later]), at({ humans: [ALEX] }))).toEqual([]);
  });

  it('lists what an agent added as one group, arrows by what they connect', () => {
    const web = block('Web-App', moderator);
    const api = block('API', moderator);
    const line = arrow(web, api, moderator);

    const groups = diffBoard(board([]), board([web, api], [line]), at({ service: true }));

    expect(groups).toHaveLength(1);
    expect(groups[0]?.actor).toEqual(moderator);
    expect(groups[0]?.items.map((item) => [item.kind, item.label, item.action])).toEqual([
      ['block', 'Web-App', 'added'],
      ['block', 'API', 'added'],
      ['edge', 'Web-App → API', 'added'],
    ]);
    expect(groups[0]?.items[0]).toMatchObject({ id: web.id, before: null, after: web });
  });

  it('tells a move from another change', () => {
    const api = block('API');
    const moved = { ...api, position: { x: 240, y: 80 }, frameId: id() };
    const renamed = { ...api, label: 'Schnittstelle' };
    const both = { ...moved, label: 'Schnittstelle' };
    const resized = { ...api, size: { width: 300, height: 200 } };
    const actionAfter = (after: CanvasNode) =>
      diffBoard(board([api]), board([after]), at({ humans: [OLGA] }))[0]?.items[0]?.action;

    expect(actionAfter(moved)).toBe('moved');
    expect(actionAfter(renamed)).toBe('changed');
    expect(actionAfter(both)).toBe('changed');
    expect(actionAfter(resized)).toBe('changed');
  });

  it('keeps how a changed element was before and after', () => {
    const api = block('API');
    const renamed = { ...api, label: 'Schnittstelle' };

    const [group] = diffBoard(board([api]), board([renamed]), at({ humans: [OLGA] }));

    expect(group?.items).toEqual([
      {
        id: api.id,
        kind: 'block',
        label: 'Schnittstelle',
        action: 'changed',
        before: api,
        after: renamed,
      },
    ]);
  });

  it('attributes a removed element to who made it disappear, named by what it was', () => {
    const web = block('Web-App', moderator);
    const api = block('API', moderator);
    const line = arrow(web, api, moderator);

    const groups = diffBoard(
      board([web, api], [line]),
      board([web]),
      at({
        humans: [OLGA, ALEX],
        removedBy: [
          [api.id, alex],
          [line.id, alex],
        ],
      }),
    );

    expect(groups).toEqual([
      {
        actor: alex,
        items: [
          expect.objectContaining({ label: 'API', action: 'removed', before: api, after: null }),
          expect.objectContaining({ kind: 'edge', label: 'Web-App → API', action: 'removed' }),
        ],
      },
    ]);
  });

  it('attributes a removal nobody was seen making to the one person at work, else to nobody', () => {
    const api = block('API');
    const actorWith = (humans: string[]) =>
      diffBoard(board([api]), board([]), at({ humans }))[0]?.actor;

    expect(actorWith([OLGA])).toEqual(olga);
    expect(actorWith([OLGA, ALEX])).toEqual({ kind: 'unknown' });
    expect(actorWith([])).toEqual({ kind: 'unknown' });
  });

  it('groups by author when several were at work', () => {
    const api = block('API', olga);
    const note = block('Notiz', alex);
    const drawn = block('Gateway', moderator);
    const moved = { ...api, position: { x: 100, y: 0 }, lastChangedBy: alex };

    const groups = diffBoard(
      board([api]),
      board([moved, note, drawn]),
      at({ humans: [OLGA, ALEX], service: true }),
    );

    expect(groups.map((group) => [group.actor, group.items.map((item) => item.label)])).toEqual([
      [alex, ['API', 'Notiz']],
      [moderator, ['Gateway']],
    ]);
  });

  it('gives an element that came back through an undo to the person who undid', () => {
    // Olga removed the moderator's block and takes that back: the block returns as it was, with
    // the moderator as its author, and the server changed nothing itself.
    const gateway = block('Gateway', moderator);

    const [group] = diffBoard(board([]), board([gateway]), at({ humans: [OLGA] }));

    expect(group?.actor).toEqual(olga);
    // With an agent at work at the same time the element says who it is by.
    expect(
      diffBoard(board([]), board([gateway]), at({ humans: [OLGA], service: true }))[0]?.actor,
    ).toEqual(moderator);
    // And with two people at work, each element is believed.
    const byAlex = block('Notiz', alex);
    expect(diffBoard(board([]), board([byAlex]), at({ humans: [OLGA, ALEX] }))[0]?.actor).toEqual(
      alex,
    );
  });

  it('believes the element when nobody was seen at work', () => {
    const api = block('API', olga);

    expect(diffBoard(board([]), board([api]), at())[0]?.actor).toEqual(olga);
  });
});

describe('mergeItems', () => {
  const window = at({ humans: [OLGA] });
  const items = (before: CanvasNode[], after: CanvasNode[]) =>
    diffBoard(board(before), board(after), window)[0]?.items ?? [];

  it('adds what the author did next', () => {
    const api = block('API');
    const web = block('Web-App');

    const merged = mergeItems(items([], [api]), items([api], [api, web]));

    expect(merged.map((item) => [item.label, item.action])).toEqual([
      ['API', 'added'],
      ['Web-App', 'added'],
    ]);
  });

  it('keeps the first "before" and the last "after" of an element', () => {
    const api = block('API');
    const moved = { ...api, position: { x: 200, y: 0 } };
    const renamed = { ...moved, label: 'Schnittstelle' };

    const merged = mergeItems(items([api], [moved]), items([moved], [renamed]));

    expect(merged).toEqual([
      expect.objectContaining({
        label: 'Schnittstelle',
        action: 'changed',
        before: api,
        after: renamed,
      }),
    ]);
    // An element that was added and then changed is still one that was added.
    const added = mergeItems(items([], [api]), items([api], [renamed]));
    expect(added).toEqual([
      expect.objectContaining({ action: 'added', before: null, after: renamed }),
    ]);
  });

  it('drops an element that ends as it began', () => {
    const api = block('API');
    const moved = { ...api, position: { x: 200, y: 0 } };

    expect(mergeItems(items([], [api]), items([api], []))).toEqual([]);
    expect(mergeItems(items([api], [moved]), items([moved], [api]))).toEqual([]);
  });

  it('holds no more elements than an entry may have', () => {
    const many = Array.from({ length: HISTORY_MAX_ITEMS + 10 }, (_, index) =>
      block(`Block ${String(index)}`),
    );

    expect(mergeItems([], items([], many))).toHaveLength(HISTORY_MAX_ITEMS);
  });
});

describe('sameActor', () => {
  it('tells people, agents and nobody apart', () => {
    expect(sameActor(olga, { kind: 'human', userId: OLGA })).toBe(true);
    expect(sameActor(olga, alex)).toBe(false);
    expect(sameActor(moderator, { kind: 'agent', agentKey: 'moderator' })).toBe(true);
    expect(sameActor(moderator, { kind: 'agent', agentKey: 'backend' })).toBe(false);
    expect(sameActor(moderator, olga)).toBe(false);
    expect(sameActor({ kind: 'unknown' }, { kind: 'unknown' })).toBe(true);
  });
});
