import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { addEdge } from './edges';
import { diffBoard, type BoardState, type HistoryItem } from './history';
import {
  addBlock,
  addFrame,
  addNote,
  moveNodes,
  readEdges,
  readNodes,
  removeNodes,
  updateNode,
  type Author,
} from './model';
import { revertItems } from './revert';

const OLGA: Author = { kind: 'human', userId: '11111111-1111-4111-8111-111111111111' };
const ALEX: Author = { kind: 'human', userId: '22222222-2222-4222-8222-222222222222' };
const MODERATOR: Author = { kind: 'agent', agentKey: 'moderator' };

let next = 0;
const id = () => {
  next += 1;
  return `aaaaaaaa-aaaa-4aaa-8aaa-${String(next).padStart(12, '0')}`;
};

const read = (doc: Y.Doc): BoardState => ({ nodes: readNodes(doc), edges: readEdges(doc) });

/** What a change did to a board, as the history keeps it. */
function entryOf(doc: Y.Doc, change: () => void): HistoryItem[] {
  const before = read(doc);
  change();
  return diffBoard(before, read(doc), {
    humans: new Set(),
    service: true,
    removedBy: new Map(),
  }).flatMap((group) => group.items);
}

/** The board with one stamp of who changed what last on everything, to compare two states. */
function shape(doc: Y.Doc) {
  const plain = <T extends { id: string }>(element: T) => ({
    ...element,
    lastChangedBy: OLGA,
    lastChangedAt: '',
  });
  return {
    nodes: readNodes(doc)
      .map(plain)
      .sort((a, b) => a.id.localeCompare(b.id)),
    edges: readEdges(doc)
      .map(plain)
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function block(doc: Y.Doc, label: string, author: Author = OLGA, x = 0) {
  return addBlock(doc, { id: id(), blockType: 'service', position: { x, y: 0 }, label }, author);
}

describe('revertItems', () => {
  it('removes what the entry added: blocks and the arrows between them', () => {
    const doc = new Y.Doc();
    const kept = block(doc, 'Bleibt');
    const before = shape(doc);
    const items = entryOf(doc, () => {
      const web = block(doc, 'Web-App', MODERATOR, 300);
      const api = block(doc, 'API', MODERATOR, 600);
      addEdge(doc, { id: id(), source: web.id, target: api.id }, MODERATOR);
    });

    const result = revertItems(doc, items, OLGA);

    expect(shape(doc)).toEqual(before);
    expect(readNodes(doc).map((node) => node.id)).toEqual([kept.id]);
    expect(result.reverted).toHaveLength(3);
    expect([...result.removed].sort()).toEqual([...result.reverted].sort());
    expect(result.kept).toEqual([]);
  });

  it('brings back what the entry removed, as it was and made by who made it', () => {
    const doc = new Y.Doc();
    const web = block(doc, 'Web-App', MODERATOR);
    const api = block(doc, 'API', MODERATOR, 300);
    const line = addEdge(doc, { id: id(), source: web.id, target: api.id }, MODERATOR);
    const before = shape(doc);
    const items = entryOf(doc, () => {
      removeNodes(doc, [api.id], ALEX);
    });
    expect(readEdges(doc)).toEqual([]);

    const result = revertItems(doc, items, OLGA);

    expect(shape(doc)).toEqual(before);
    const restored = readNodes(doc).find((node) => node.id === api.id);
    expect(restored).toMatchObject({ createdBy: MODERATOR, lastChangedBy: OLGA });
    expect(readEdges(doc)[0]).toMatchObject({
      id: line.id,
      createdBy: MODERATOR,
      lastChangedBy: OLGA,
    });
    expect([...result.reverted].sort()).toEqual([api.id, line.id].sort());
    expect(result.removed).toEqual([]);
  });

  it('sets back what the entry moved or changed', () => {
    const doc = new Y.Doc();
    const api = block(doc, 'API');
    const web = block(doc, 'Web-App', OLGA, 300);
    const before = shape(doc);
    const items = entryOf(doc, () => {
      moveNodes(doc, [[api.id, { x: 500, y: 240 }]], ALEX);
      updateNode(doc, web.id, { label: 'Portal', subtitle: 'für Mitglieder' }, ALEX);
    });

    const result = revertItems(doc, items, OLGA);

    expect(shape(doc)).toEqual(before);
    expect([...result.reverted].sort()).toEqual([api.id, web.id].sort());
    expect(readNodes(doc).every((node) => node.lastChangedBy.kind === 'human')).toBe(true);
  });

  it('leaves alone what was changed since, and says so', () => {
    const doc = new Y.Doc();
    const moved = block(doc, 'Verschoben');
    let added = '';
    let renamed = '';
    const items = entryOf(doc, () => {
      added = block(doc, 'Neu', MODERATOR, 300).id;
      renamed = block(doc, 'Auch neu', MODERATOR, 600).id;
      moveNodes(doc, [[moved.id, { x: 0, y: 400 }]], MODERATOR);
    });
    // Someone built on it: the new block was renamed, the moved one moved again.
    updateNode(doc, renamed, { label: 'Umbenannt' }, ALEX);
    moveNodes(doc, [[moved.id, { x: 40, y: 440 }]], ALEX);
    const since = shape(doc);

    const result = revertItems(doc, items, OLGA);

    expect(result.reverted).toEqual([added]);
    expect([...result.kept].sort()).toEqual([moved.id, renamed].sort());
    expect(shape(doc)).toEqual({
      ...since,
      nodes: since.nodes.filter((node) => node.id !== added),
    });
  });

  it('keeps an added block that an arrow of someone else touches now', () => {
    const doc = new Y.Doc();
    const existing = block(doc, 'Datenbank');
    let api = '';
    const items = entryOf(doc, () => {
      api = block(doc, 'API', MODERATOR, 300).id;
    });
    const line = addEdge(doc, { id: id(), source: api, target: existing.id }, ALEX);

    const result = revertItems(doc, items, OLGA);

    expect(result).toEqual({ reverted: [], kept: [api], removed: [] });
    expect(readNodes(doc).map((node) => node.id)).toContain(api);
    expect(readEdges(doc).map((edge) => edge.id)).toEqual([line.id]);
  });

  it('keeps a block whose own arrow was changed since', () => {
    const doc = new Y.Doc();
    const existing = block(doc, 'Datenbank');
    let api = '';
    let line = '';
    const items = entryOf(doc, () => {
      api = block(doc, 'API', MODERATOR, 300).id;
      line = addEdge(doc, { id: id(), source: api, target: existing.id }, MODERATOR).id;
    });
    // Someone labelled the arrow: it is theirs now, and so is what it hangs on.
    getEdge(doc, line).set('label', 'SQL');

    const result = revertItems(doc, items, OLGA);

    expect([...result.kept].sort()).toEqual([api, line].sort());
    expect(result.reverted).toEqual([]);
    expect(readEdges(doc)).toHaveLength(1);
  });

  it('touches nothing that someone is editing', () => {
    const doc = new Y.Doc();
    const api = block(doc, 'API');
    let added = '';
    const items = entryOf(doc, () => {
      updateNode(doc, api.id, { label: 'Schnittstelle' }, MODERATOR);
      added = block(doc, 'Neu', MODERATOR, 300).id;
    });

    const result = revertItems(doc, items, OLGA, new Set([api.id, added]));

    expect(result).toEqual({ reverted: [], kept: [api.id, added], removed: [] });
    expect(
      readNodes(doc)
        .map((node) => node.label)
        .sort(),
    ).toEqual(['Neu', 'Schnittstelle']);
  });

  it('brings an arrow back only between its blocks, and only where no other runs', () => {
    const doc = new Y.Doc();
    const web = block(doc, 'Web-App');
    const api = block(doc, 'API', OLGA, 300);
    const data = block(doc, 'Datenbank', OLGA, 600);
    const first = addEdge(doc, { id: id(), source: web.id, target: api.id }, OLGA);
    const second = addEdge(doc, { id: id(), source: api.id, target: data.id }, OLGA);
    const items = entryOf(doc, () => {
      // Removing the block in the middle takes both arrows with it.
      removeNodes(doc, [api.id], ALEX);
    });
    const arrows = items.filter((item) => item.kind === 'edge');

    // Without their block the arrows cannot come back.
    expect(revertItems(doc, arrows, OLGA)).toEqual({
      reverted: [],
      kept: [first.id, second.id],
      removed: [],
    });

    // With the block back, one of them finds another arrow in its place.
    revertItems(
      doc,
      items.filter((item) => item.kind !== 'edge'),
      OLGA,
    );
    const other = addEdge(doc, { id: id(), source: web.id, target: api.id }, ALEX);
    const result = revertItems(doc, arrows, OLGA);

    expect(result).toEqual({ reverted: [second.id], kept: [first.id], removed: [] });
    expect(
      readEdges(doc)
        .map((edge) => edge.id)
        .sort(),
    ).toEqual([other.id, second.id].sort());
  });

  it('brings a frame back with what it held, and lets go of what an added frame holds', () => {
    const doc = new Y.Doc();
    const frame = addFrame(doc, { id: id(), position: { x: 0, y: 0 }, title: 'Architektur' }, OLGA);
    const inside = addBlock(
      doc,
      {
        id: id(),
        blockType: 'service',
        position: { x: 40, y: 60 },
        label: 'API',
        frameId: frame.id,
      },
      OLGA,
    );
    const before = shape(doc);
    const removal = entryOf(doc, () => {
      removeNodes(doc, [frame.id], ALEX);
    });
    expect(readNodes(doc)[0]).toMatchObject({ id: inside.id, frameId: null });

    revertItems(doc, removal, OLGA);

    expect(shape(doc)).toEqual(before);

    // An added frame goes; a block that was put into it stays, outside of any frame.
    const other = new Y.Doc();
    let added = '';
    const addition = entryOf(other, () => {
      added = addFrame(other, { id: id(), position: { x: 0, y: 0 }, title: 'Neu' }, MODERATOR).id;
    });
    const member = addBlock(
      other,
      {
        id: id(),
        blockType: 'service',
        position: { x: 40, y: 60 },
        label: 'Web',
        frameId: added,
      },
      ALEX,
    );
    expect(revertItems(other, addition, OLGA).removed).toEqual([added]);
    expect(readNodes(other)).toEqual([expect.objectContaining({ id: member.id, frameId: null })]);
  });

  it('puts a block that comes back outside of a frame that is gone', () => {
    const doc = new Y.Doc();
    const frame = addFrame(doc, { id: id(), position: { x: 0, y: 0 }, title: 'Architektur' }, OLGA);
    const inside = addBlock(
      doc,
      {
        id: id(),
        blockType: 'service',
        position: { x: 40, y: 60 },
        label: 'API',
        frameId: frame.id,
      },
      OLGA,
    );
    const items = entryOf(doc, () => {
      removeNodes(doc, [inside.id], ALEX);
    });
    removeNodes(doc, [frame.id], ALEX);

    revertItems(doc, items, OLGA);

    expect(readNodes(doc)).toEqual([expect.objectContaining({ id: inside.id, frameId: null })]);
  });

  it('counts what is already as it was before as neither set back nor kept', () => {
    const doc = new Y.Doc();
    const note = addNote(doc, { id: id(), position: { x: 0, y: 0 }, text: 'Offene Frage' }, OLGA);
    const removal = entryOf(doc, () => {
      removeNodes(doc, [note.id], ALEX);
    });
    let added = '';
    const addition = entryOf(doc, () => {
      added = block(doc, 'Neu', MODERATOR).id;
    });

    // Taken back once, there is nothing left to take back.
    expect(revertItems(doc, removal, OLGA).reverted).toEqual([note.id]);
    expect(revertItems(doc, removal, OLGA)).toEqual({ reverted: [], kept: [], removed: [] });
    removeNodes(doc, [added], ALEX);
    expect(revertItems(doc, addition, OLGA)).toEqual({ reverted: [], kept: [], removed: [] });

    // And so it is with a block someone already put back where it was.
    const api = block(doc, 'API');
    const move = entryOf(doc, () => {
      moveNodes(doc, [[api.id, { x: 500, y: 240 }]], MODERATOR);
    });
    moveNodes(doc, [[api.id, { x: 0, y: 0 }]], ALEX);
    expect(revertItems(doc, move, OLGA)).toEqual({ reverted: [], kept: [], removed: [] });
    expect(readNodes(doc).find((node) => node.id === api.id)?.lastChangedBy).toEqual(ALEX);
  });

  it('is undone by taking the taking back back', () => {
    const doc = new Y.Doc();
    block(doc, 'Bleibt');
    const items = entryOf(doc, () => {
      const web = block(doc, 'Web-App', MODERATOR, 300);
      const api = block(doc, 'API', MODERATOR, 600);
      addEdge(doc, { id: id(), source: web.id, target: api.id }, MODERATOR);
    });
    const drawn = shape(doc);

    const takingBack = entryOf(doc, () => {
      revertItems(doc, items, OLGA);
    });
    expect(readNodes(doc)).toHaveLength(1);
    const result = revertItems(doc, takingBack, ALEX);

    expect(shape(doc)).toEqual(drawn);
    expect(result.reverted).toHaveLength(3);
    // The moderator's elements are the moderator's again, brought back by Alex.
    expect(
      readNodes(doc)
        .filter((node) => node.label !== 'Bleibt')
        .map((node) => [node.createdBy, node.lastChangedBy]),
    ).toEqual([
      [MODERATOR, ALEX],
      [MODERATOR, ALEX],
    ]);
  });
});

function getEdge(doc: Y.Doc, edgeId: string): Y.Map<unknown> {
  const edge = doc.getMap<Y.Map<unknown>>('edges').get(edgeId);
  if (!edge) throw new Error('No such edge');
  return edge;
}
