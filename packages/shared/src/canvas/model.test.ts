import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  addBlock,
  authorOrigin,
  boardDocumentName,
  boardIdFromDocumentName,
  getEdgesMap,
  getNodesMap,
  moveNode,
  readEdges,
  readNodes,
  type Author,
} from './model';

const OLGA: Author = { kind: 'human', userId: '11111111-1111-4111-8111-111111111111' };
const MODERATOR: Author = { kind: 'agent', agentKey: 'moderator' };
const BLOCK_ID = '22222222-2222-4222-8222-222222222222';

function syncedPair() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.on('update', (update: Uint8Array) => {
    Y.applyUpdate(b, update);
  });
  return { a, b };
}

describe('addBlock', () => {
  it('creates a block with author and fixed size', () => {
    const doc = new Y.Doc();
    const node = addBlock(
      doc,
      { id: BLOCK_ID, position: { x: 40, y: 60 }, label: ' Web-App ' },
      OLGA,
    );

    expect(node).toMatchObject({
      id: BLOCK_ID,
      type: 'block',
      label: 'Web-App',
      subtitle: '',
      blockType: null,
      frameId: null,
      size: { width: 180, height: 96 },
      createdBy: OLGA,
      lastChangedBy: OLGA,
    });
    expect(readNodes(doc)).toEqual([node]);
  });

  it('reaches another copy of the document', () => {
    const { a, b } = syncedPair();
    addBlock(a, { id: BLOCK_ID, position: { x: 0, y: 0 }, label: 'Server' }, MODERATOR);

    expect(readNodes(b).map((node) => [node.label, node.createdBy])).toEqual([
      ['Server', MODERATOR],
    ]);
  });

  it('marks the transaction with the author', () => {
    const doc = new Y.Doc();
    const origins: unknown[] = [];
    doc.on('afterTransaction', (transaction: Y.Transaction) => {
      origins.push(transaction.origin);
    });
    addBlock(doc, { id: BLOCK_ID, position: { x: 0, y: 0 }, label: 'Server' }, OLGA);

    expect(origins).toEqual([authorOrigin(OLGA)]);
    expect(authorOrigin(MODERATOR)).toBe('agent:moderator');
  });

  it('rejects invalid input and duplicate ids', () => {
    const doc = new Y.Doc();
    const valid = { id: BLOCK_ID, position: { x: 0, y: 0 }, label: 'Server' };

    expect(() => addBlock(doc, { ...valid, label: '   ' }, OLGA)).toThrow();
    expect(() => addBlock(doc, { ...valid, id: 'not-a-uuid' }, OLGA)).toThrow();
    expect(() => addBlock(doc, { ...valid, position: { x: Number.NaN, y: 0 } }, OLGA)).toThrow();
    expect(() =>
      addBlock(doc, valid, { kind: 'agent', agentKey: 'unknown' } as unknown as Author),
    ).toThrow();
    expect(readNodes(doc)).toEqual([]);

    addBlock(doc, valid, OLGA);
    expect(() => addBlock(doc, valid, OLGA)).toThrow(/already exists/);
  });
});

describe('moveNode', () => {
  it('moves a block and records who changed it', () => {
    const { a, b } = syncedPair();
    addBlock(a, { id: BLOCK_ID, position: { x: 0, y: 0 }, label: 'Server' }, OLGA);

    expect(moveNode(a, BLOCK_ID, { x: 120, y: -30 }, MODERATOR)).toBe(true);
    const [node] = readNodes(b);
    expect(node?.position).toEqual({ x: 120, y: -30 });
    expect(node?.createdBy).toEqual(OLGA);
    expect(node?.lastChangedBy).toEqual(MODERATOR);
  });

  it('ignores unknown blocks and rejects invalid positions', () => {
    const doc = new Y.Doc();
    expect(moveNode(doc, BLOCK_ID, { x: 1, y: 1 }, OLGA)).toBe(false);

    addBlock(doc, { id: BLOCK_ID, position: { x: 0, y: 0 }, label: 'Server' }, OLGA);
    expect(() => moveNode(doc, BLOCK_ID, { x: Infinity, y: 0 }, OLGA)).toThrow();
    expect(readNodes(doc)[0]?.position).toEqual({ x: 0, y: 0 });
  });
});

describe('snapshots', () => {
  it('leave out entries that do not match the schema', () => {
    const doc = new Y.Doc();
    addBlock(doc, { id: BLOCK_ID, position: { x: 0, y: 0 }, label: 'Server' }, OLGA);
    const broken = new Y.Map<unknown>();
    broken.set('id', 'broken');
    getNodesMap(doc).set('broken', broken);
    getEdgesMap(doc).set('broken', new Y.Map<unknown>());

    expect(readNodes(doc).map((node) => node.id)).toEqual([BLOCK_ID]);
    expect(readEdges(doc)).toEqual([]);
  });
});

describe('document names', () => {
  it('maps boards to documents and back', () => {
    expect(boardDocumentName(BLOCK_ID)).toBe(`board:${BLOCK_ID}`);
    expect(boardIdFromDocumentName(`board:${BLOCK_ID}`)).toBe(BLOCK_ID);
    expect(boardIdFromDocumentName(`plan:${BLOCK_ID}`)).toBeUndefined();
    expect(boardIdFromDocumentName('board:../../etc')).toBeUndefined();
  });
});
