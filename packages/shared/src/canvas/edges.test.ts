import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { addEdge, EdgeRuleError, edgeProblem, removeEdges, updateEdgeLabel } from './edges';
import { addBlock, addNote, readEdges, type Author } from './model';

const OLGA: Author = { kind: 'human', userId: '11111111-1111-4111-8111-111111111111' };
const MODERATOR: Author = { kind: 'agent', agentKey: 'moderator' };
const API = '22222222-2222-4222-8222-222222222222';
const DB = '33333333-3333-4333-8333-333333333333';
const NOTE = '44444444-4444-4444-8444-444444444444';
const EDGE = '55555555-5555-4555-8555-555555555555';
const EDGE_2 = '66666666-6666-4666-8666-666666666666';

function board() {
  const doc = new Y.Doc();
  addBlock(doc, { id: API, position: { x: 0, y: 0 }, label: 'API' }, OLGA);
  addBlock(doc, { id: DB, position: { x: 0, y: 200 }, label: 'DB' }, OLGA);
  addNote(doc, { id: NOTE, position: { x: 300, y: 0 }, text: 'Idee' }, OLGA);
  return doc;
}

describe('addEdge', () => {
  it('connects two blocks with a label and records the author', () => {
    const doc = board();

    const edge = addEdge(doc, { id: EDGE, source: API, target: DB, label: ' SQL ' }, MODERATOR);

    expect(edge).toMatchObject({
      source: API,
      target: DB,
      label: 'SQL',
      sourceHandle: null,
      targetHandle: null,
      createdBy: MODERATOR,
      lastChangedBy: MODERATOR,
    });
    expect(readEdges(doc)).toEqual([edge]);
  });

  it('allows one connection per direction', () => {
    const doc = board();
    addEdge(doc, { id: EDGE, source: API, target: DB }, OLGA);

    expect(edgeProblem(doc, API, DB)).toBe('duplicate');
    expect(edgeProblem(doc, DB, API)).toBeNull();
    addEdge(doc, { id: EDGE_2, source: DB, target: API }, OLGA);
    expect(readEdges(doc)).toHaveLength(2);
  });

  it('refuses notes, a block itself and missing blocks', () => {
    const doc = board();

    expect(edgeProblem(doc, API, NOTE)).toBe('not_block');
    expect(edgeProblem(doc, API, API)).toBe('self');
    expect(edgeProblem(doc, API, EDGE)).toBe('missing');
    expect(() => addEdge(doc, { id: EDGE, source: API, target: NOTE }, OLGA)).toThrow(
      EdgeRuleError,
    );
    expect(() => addEdge(doc, { id: EDGE, source: API, target: API }, OLGA)).toThrow(
      'A block cannot be connected to itself',
    );
    expect(readEdges(doc)).toEqual([]);
  });

  it('refuses labels longer than 40 characters', () => {
    const doc = board();

    expect(() =>
      addEdge(doc, { id: EDGE, source: API, target: DB, label: 'x'.repeat(41) }, OLGA),
    ).toThrow();
  });
});

describe('updateEdgeLabel and removeEdges', () => {
  it('changes the label, and clears it', () => {
    const doc = board();
    addEdge(doc, { id: EDGE, source: API, target: DB }, OLGA);

    expect(updateEdgeLabel(doc, EDGE, 'REST', MODERATOR)).toBe(true);
    expect(readEdges(doc)[0]).toMatchObject({ label: 'REST', lastChangedBy: MODERATOR });

    updateEdgeLabel(doc, EDGE, '  ', OLGA);
    expect(readEdges(doc)[0]?.label).toBe('');
    expect(updateEdgeLabel(doc, EDGE_2, 'REST', OLGA)).toBe(false);
  });

  it('removes edges and ignores unknown ones', () => {
    const doc = board();
    addEdge(doc, { id: EDGE, source: API, target: DB }, OLGA);

    removeEdges(doc, [EDGE, EDGE_2], OLGA);

    expect(readEdges(doc)).toEqual([]);
  });
});
