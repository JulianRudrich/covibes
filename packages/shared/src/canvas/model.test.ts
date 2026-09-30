import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { addEdge } from './edges';
import {
  addBlock,
  addFrame,
  addNote,
  authorOrigin,
  BLOCK_SIZE,
  blockSize,
  boardDocumentName,
  boardIdFromDocumentName,
  DIAGRAM_BLOCK_TYPES,
  DIAGRAM_TYPES,
  getEdgesMap,
  getNodesMap,
  moveNode,
  moveNodes,
  newBlockType,
  placeNodes,
  readEdges,
  readNodes,
  removeNodes,
  resizeFrame,
  updateNode,
  type Author,
} from './model';

const OLGA: Author = { kind: 'human', userId: '11111111-1111-4111-8111-111111111111' };
const MODERATOR: Author = { kind: 'agent', agentKey: 'moderator' };
const BLOCK_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ID = '33333333-3333-4333-8333-333333333333';
const EDGE_ID = '44444444-4444-4444-8444-444444444444';
const NOTE_ID = '55555555-5555-4555-8555-555555555555';
const FRAME_ID = '66666666-6666-4666-8666-666666666666';

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

describe('block types', () => {
  it('accepts the known types and keeps unknown stored ones readable', () => {
    const doc = new Y.Doc();
    addBlock(
      doc,
      { id: BLOCK_ID, position: { x: 0, y: 0 }, label: 'DB', blockType: 'database' },
      OLGA,
    );
    expect(readNodes(doc)[0]?.blockType).toBe('database');

    expect(() =>
      addBlock(
        doc,
        { id: OTHER_ID, position: { x: 0, y: 0 }, label: 'Queue', blockType: 'queue' as never },
        OLGA,
      ),
    ).toThrow();

    // A later version may know more types; this one still reads the block.
    getNodesMap(doc).get(BLOCK_ID)?.set('blockType', 'queue');
    expect(readNodes(doc)[0]?.blockType).toBe('queue');
  });
});

describe('updateNode', () => {
  it('changes texts and type and records who changed it', () => {
    const doc = new Y.Doc();
    addBlock(doc, { id: BLOCK_ID, position: { x: 0, y: 0 }, label: 'API' }, OLGA);
    const origins: unknown[] = [];
    doc.on('afterTransaction', (transaction: Y.Transaction) => {
      origins.push(transaction.origin);
    });

    expect(updateNode(doc, BLOCK_ID, { label: ' Gateway ', blockType: 'service' }, MODERATOR)).toBe(
      true,
    );

    expect(readNodes(doc)[0]).toMatchObject({
      label: 'Gateway',
      subtitle: '',
      blockType: 'service',
      createdBy: OLGA,
      lastChangedBy: MODERATOR,
    });
    expect(origins).toEqual(['agent:moderator']);
  });

  it('clears the type and the subtitle', () => {
    const doc = new Y.Doc();
    addBlock(
      doc,
      {
        id: BLOCK_ID,
        position: { x: 0, y: 0 },
        label: 'API',
        subtitle: 'REST',
        blockType: 'service',
      },
      OLGA,
    );

    updateNode(doc, BLOCK_ID, { subtitle: '', blockType: null }, OLGA);

    expect(readNodes(doc)[0]).toMatchObject({ label: 'API', subtitle: '', blockType: null });
  });

  it('refuses an empty title, unknown types and missing blocks', () => {
    const doc = new Y.Doc();
    addBlock(doc, { id: BLOCK_ID, position: { x: 0, y: 0 }, label: 'API' }, OLGA);

    expect(() => updateNode(doc, BLOCK_ID, { label: '  ' }, OLGA)).toThrow();
    expect(() => updateNode(doc, BLOCK_ID, { blockType: 'queue' as never }, OLGA)).toThrow();
    expect(updateNode(doc, OTHER_ID, { label: 'Nope' }, OLGA)).toBe(false);
    expect(readNodes(doc)[0]?.label).toBe('API');
  });
});

describe('notes and frames', () => {
  it('adds a note with its size and author', () => {
    const doc = new Y.Doc();
    const note = addNote(
      doc,
      { id: NOTE_ID, position: { x: 10, y: 20 }, text: ' Offline? ' },
      OLGA,
    );

    expect(note).toMatchObject({
      type: 'sticky',
      label: 'Offline?',
      size: { width: 176, height: 124 },
      frameId: null,
      createdBy: OLGA,
    });
    expect(readNodes(doc)).toEqual([note]);
  });

  it('adds a frame in the default size and refuses one that is too small', () => {
    const doc = new Y.Doc();
    const frame = addFrame(
      doc,
      { id: FRAME_ID, position: { x: 0, y: 0 }, title: 'Architektur' },
      OLGA,
    );

    expect(frame).toMatchObject({
      type: 'frame',
      label: 'Architektur',
      size: { width: 480, height: 320 },
    });
    expect(() =>
      addFrame(
        doc,
        {
          id: OTHER_ID,
          position: { x: 0, y: 0 },
          title: 'Klein',
          size: { width: 100, height: 400 },
        },
        OLGA,
      ),
    ).toThrow();
  });

  it('lets notes and frames change only their text', () => {
    const doc = new Y.Doc();
    addNote(doc, { id: NOTE_ID, position: { x: 0, y: 0 }, text: 'Idee' }, OLGA);

    expect(updateNode(doc, NOTE_ID, { label: 'Bessere Idee' }, MODERATOR)).toBe(true);
    expect(readNodes(doc)[0]).toMatchObject({ label: 'Bessere Idee', lastChangedBy: MODERATOR });
    expect(() => updateNode(doc, NOTE_ID, { subtitle: 'x' }, OLGA)).toThrow();
    expect(() => updateNode(doc, NOTE_ID, { blockType: 'database' }, OLGA)).toThrow();
    expect(() => updateNode(doc, NOTE_ID, { fields: [] }, OLGA)).toThrow();
    expect(() => updateNode(doc, NOTE_ID, { diagramType: 'flow' }, OLGA)).toThrow();
  });
});

describe('diagram types', () => {
  it('gives a frame a type, changes and clears it; only frames have one', () => {
    const doc = new Y.Doc();
    addFrame(
      doc,
      { id: FRAME_ID, position: { x: 0, y: 0 }, title: 'Ideen', diagramType: 'mindmap' },
      OLGA,
    );
    expect(readNodes(doc)[0]?.diagramType).toBe('mindmap');

    expect(updateNode(doc, FRAME_ID, { diagramType: 'datamodel' }, MODERATOR)).toBe(true);
    expect(readNodes(doc)[0]).toMatchObject({ diagramType: 'datamodel', lastChangedBy: MODERATOR });
    updateNode(doc, FRAME_ID, { diagramType: null }, OLGA);
    expect(readNodes(doc)[0]?.diagramType).toBeNull();

    expect(() => updateNode(doc, FRAME_ID, { diagramType: 'roadmap' as never }, OLGA)).toThrow();
    addBlock(doc, { id: BLOCK_ID, position: { x: 0, y: 0 }, label: 'API' }, OLGA);
    expect(() => updateNode(doc, BLOCK_ID, { diagramType: 'flow' }, OLGA)).toThrow();
    expect(() => updateNode(doc, FRAME_ID, { fields: [] }, OLGA)).toThrow();
  });

  it('reads documents from before diagram types and a type from a later version', () => {
    const doc = new Y.Doc();
    addFrame(doc, { id: FRAME_ID, position: { x: 0, y: 0 }, title: 'Alt' }, OLGA);
    addBlock(doc, { id: BLOCK_ID, position: { x: 40, y: 60 }, label: 'API' }, OLGA);
    for (const fields of getNodesMap(doc).values()) {
      fields.delete('diagramType');
      fields.delete('fields');
    }
    expect(readNodes(doc).map(({ diagramType, fields }) => ({ diagramType, fields }))).toEqual([
      { diagramType: null, fields: [] },
      { diagramType: null, fields: [] },
    ]);

    getNodesMap(doc).get(FRAME_ID)?.set('diagramType', 'roadmap');
    expect(node(doc, FRAME_ID).diagramType).toBe('roadmap');
  });

  it('picks the type of a new block from the diagram', () => {
    expect(newBlockType('mindmap', [])).toBe('topic');
    expect(newBlockType('mindmap', [{ blockType: 'idea' }])).toBe('topic');
    expect(newBlockType('mindmap', [{ blockType: 'topic' }])).toBe('idea');
    expect(newBlockType('datamodel', [])).toBe('entity');
    expect(newBlockType('flow', [])).toBe('step');
    expect(newBlockType('sitemap', [])).toBe('page');
    expect(newBlockType('architecture', [])).toBeNull();
    expect(newBlockType(null, [])).toBeNull();
    expect(newBlockType('roadmap', [])).toBeNull();
    // Every diagram offers the type it gives new blocks.
    for (const diagram of DIAGRAM_TYPES) {
      const type = newBlockType(diagram, []);
      if (type) expect(DIAGRAM_BLOCK_TYPES[diagram]).toContain(type);
    }
  });
});

describe('entity fields', () => {
  const FIELDS = [
    { name: 'id', type: 'uuid' },
    { name: 'email', type: 'text' },
  ];

  it('stores the fields of an entity and grows the block with them', () => {
    const doc = new Y.Doc();
    addBlock(
      doc,
      {
        id: BLOCK_ID,
        position: { x: 0, y: 0 },
        label: 'Nutzer',
        blockType: 'entity',
        fields: [
          { name: ' id ', type: ' uuid ' },
          { name: 'email', type: 'text' },
        ],
      },
      OLGA,
    );
    expect(readNodes(doc)[0]).toMatchObject({
      fields: FIELDS,
      size: { width: 180, height: 96 + 8 + 2 * 22 },
    });

    updateNode(doc, BLOCK_ID, { fields: [{ name: 'id' }] }, MODERATOR);
    expect(readNodes(doc)[0]).toMatchObject({
      fields: [{ name: 'id', type: '' }],
      size: { width: 180, height: 96 + 8 + 22 },
    });
    // Another type shows no fields and has the usual size; the fields stay for a way back.
    updateNode(doc, BLOCK_ID, { blockType: 'service' }, OLGA);
    expect(readNodes(doc)[0]).toMatchObject({ size: BLOCK_SIZE, fields: [{ name: 'id' }] });
    updateNode(doc, BLOCK_ID, { blockType: 'entity' }, OLGA);
    expect(readNodes(doc)[0]?.size.height).toBe(96 + 8 + 22);
  });

  it('shows at most 8 fields and a row for the rest', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      name: `f${String(index)}`,
      type: '',
    }));
    expect(blockSize('entity', many)).toEqual({ width: 180, height: 96 + 8 + 9 * 22 });
    expect(blockSize('entity', [])).toEqual(BLOCK_SIZE);
    expect(blockSize('service', many)).toEqual(BLOCK_SIZE);
  });

  it('refuses fields without a name, too long ones and more than 20', () => {
    const doc = new Y.Doc();
    const block = {
      id: BLOCK_ID,
      position: { x: 0, y: 0 },
      label: 'Nutzer',
      blockType: 'entity',
    } as const;
    expect(() =>
      addBlock(doc, { ...block, fields: [{ name: ' ', type: 'text' }] }, OLGA),
    ).toThrow();
    expect(() => addBlock(doc, { ...block, fields: [{ name: 'x'.repeat(41) }] }, OLGA)).toThrow();
    const tooMany = Array.from({ length: 21 }, (_, index) => ({ name: `f${String(index)}` }));
    expect(() => addBlock(doc, { ...block, fields: tooMany }, OLGA)).toThrow();
    expect(readNodes(doc)).toEqual([]);
  });
});

/** A frame at 0, 0 (480 × 320) with a block inside and a block outside. */
function docWithFrame() {
  const doc = new Y.Doc();
  addFrame(doc, { id: FRAME_ID, position: { x: 0, y: 0 }, title: 'Architektur' }, OLGA);
  addBlock(doc, { id: BLOCK_ID, position: { x: 40, y: 60 }, label: 'API' }, OLGA);
  addBlock(doc, { id: OTHER_ID, position: { x: 700, y: 60 }, label: 'DB' }, OLGA);
  placeNodes(doc, [BLOCK_ID, OTHER_ID], OLGA);
  return doc;
}

function node(doc: Y.Doc, id: string) {
  const found = readNodes(doc).find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Node ${id} is missing`);
  return found;
}

describe('frame membership', () => {
  it('puts a node into the frame its center lies in and out again', () => {
    const doc = docWithFrame();
    expect(node(doc, BLOCK_ID).frameId).toBe(FRAME_ID);
    expect(node(doc, OTHER_ID).frameId).toBeNull();

    moveNode(doc, OTHER_ID, { x: 200, y: 180 }, OLGA);
    moveNode(doc, BLOCK_ID, { x: 900, y: 60 }, OLGA);
    placeNodes(doc, [OTHER_ID, BLOCK_ID], OLGA);

    expect(node(doc, OTHER_ID).frameId).toBe(FRAME_ID);
    expect(node(doc, BLOCK_ID).frameId).toBeNull();
  });

  it('never puts a frame into another frame', () => {
    const doc = docWithFrame();
    addFrame(doc, { id: NOTE_ID, position: { x: 100, y: 100 }, title: 'Innen' }, OLGA);

    placeNodes(doc, [NOTE_ID], OLGA);

    expect(node(doc, NOTE_ID).frameId).toBeNull();
  });

  it('moves the members along with the frame, without marking them as changed', () => {
    const doc = docWithFrame();
    const before = node(doc, BLOCK_ID);

    moveNode(doc, FRAME_ID, { x: 100, y: 50 }, MODERATOR);

    expect(node(doc, BLOCK_ID)).toMatchObject({
      position: { x: 140, y: 110 },
      lastChangedBy: before.lastChangedBy,
      lastChangedAt: before.lastChangedAt,
    });
    expect(node(doc, OTHER_ID).position).toEqual({ x: 700, y: 60 });
  });

  it('does not move a member twice when it is moved together with its frame', () => {
    const doc = docWithFrame();

    moveNodes(
      doc,
      [
        [BLOCK_ID, { x: 140, y: 110 }],
        [FRAME_ID, { x: 100, y: 50 }],
      ],
      OLGA,
    );

    expect(node(doc, BLOCK_ID).position).toEqual({ x: 140, y: 110 });
  });

  it('lets membership follow a resized frame', () => {
    const doc = docWithFrame();

    expect(resizeFrame(doc, FRAME_ID, { size: { width: 900, height: 320 } }, OLGA)).toBe(true);
    expect(node(doc, OTHER_ID).frameId).toBe(FRAME_ID);

    resizeFrame(
      doc,
      FRAME_ID,
      { position: { x: 600, y: 0 }, size: { width: 300, height: 320 } },
      OLGA,
    );
    expect(node(doc, FRAME_ID)).toMatchObject({
      position: { x: 600, y: 0 },
      size: { width: 300, height: 320 },
    });
    expect(node(doc, BLOCK_ID).frameId).toBeNull();
    expect(node(doc, OTHER_ID).frameId).toBe(FRAME_ID);
  });

  it('never takes the members of another frame when it grows over it', () => {
    const doc = docWithFrame();
    const second = '77777777-7777-4777-8777-777777777777';
    addFrame(doc, { id: second, position: { x: 660, y: 0 }, title: 'Daten' }, OLGA);
    placeNodes(doc, [OTHER_ID], OLGA);
    expect(node(doc, OTHER_ID).frameId).toBe(second);

    // The first frame grows over the second one and is now the latest change on top.
    resizeFrame(doc, FRAME_ID, { size: { width: 1400, height: 400 } }, MODERATOR);

    expect(node(doc, OTHER_ID).frameId).toBe(second);
    expect(node(doc, BLOCK_ID).frameId).toBe(FRAME_ID);
  });

  it('adds a block straight into a frame', () => {
    const doc = docWithFrame();
    const id = '88888888-8888-4888-8888-888888888888';
    // Far outside the frame: membership does not depend on where the block lies.
    addBlock(
      doc,
      { id, position: { x: 2000, y: 2000 }, label: 'Idee', frameId: FRAME_ID },
      MODERATOR,
    );
    expect(node(doc, id).frameId).toBe(FRAME_ID);
    expect(() =>
      addBlock(
        doc,
        {
          id: '99999999-9999-4999-8999-999999999999',
          position: { x: 0, y: 0 },
          label: 'X',
          frameId: BLOCK_ID,
        },
        OLGA,
      ),
    ).toThrow('does not exist');
  });

  it('refuses a frame below the minimum size and ignores other nodes', () => {
    const doc = docWithFrame();

    expect(() => resizeFrame(doc, FRAME_ID, { size: { width: 200, height: 320 } }, OLGA)).toThrow();
    expect(resizeFrame(doc, BLOCK_ID, { size: { width: 300, height: 300 } }, OLGA)).toBe(false);
  });

  it('keeps the members when the frame is removed', () => {
    const doc = docWithFrame();

    removeNodes(doc, [FRAME_ID], OLGA);

    expect(node(doc, BLOCK_ID).frameId).toBeNull();
    expect(readNodes(doc)).toHaveLength(2);
  });
});

describe('removeNodes', () => {
  it('removes the nodes and every edge that touches them', () => {
    const doc = new Y.Doc();
    addBlock(doc, { id: BLOCK_ID, position: { x: 0, y: 0 }, label: 'API' }, OLGA);
    addBlock(doc, { id: OTHER_ID, position: { x: 0, y: 200 }, label: 'DB' }, OLGA);
    addEdge(doc, { id: EDGE_ID, source: BLOCK_ID, target: OTHER_ID, label: 'SQL' }, OLGA);
    expect(readEdges(doc)).toHaveLength(1);

    removeNodes(doc, [OTHER_ID, 'unknown'], OLGA);

    expect(readNodes(doc).map((node) => node.id)).toEqual([BLOCK_ID]);
    expect(readEdges(doc)).toEqual([]);
  });

  it('does nothing for unknown ids', () => {
    const doc = new Y.Doc();
    let transactions = 0;
    doc.on('afterTransaction', () => {
      transactions += 1;
    });

    removeNodes(doc, ['unknown'], OLGA);

    expect(transactions).toBe(0);
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
