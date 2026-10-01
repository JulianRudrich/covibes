import { randomUUID } from 'node:crypto';

import {
  addBlock,
  applyOperations,
  readEdges,
  readNodes,
  type CanvasOperationInput,
  type VariantsOperation,
} from '@covibes/shared';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import type { DecisionContext, DecisionWriter } from '@server/tasks/run-decisions';
import { memoryBoards } from '@server/test-boards';
import { proposeVariantsTool } from '@server/tools/propose-variants';

const BOARD_ID = randomUUID();
const MODERATOR = { kind: 'agent', agentKey: 'moderator' } as const;

/** A decision writer that only keeps what `propose_variants` needs. */
function variantsWriter(initial: Partial<DecisionContext> = {}) {
  const context: DecisionContext = {
    criteria: [],
    decisions: [...(initial.decisions ?? [])],
    pending: [],
    votes: [],
    openVariants: [...(initial.openVariants ?? [])],
  };
  const proposed: VariantsOperation[] = [];
  const opened: string[] = [];
  const unused = () => Promise.reject(new Error('Not used by propose_variants'));
  const writer: DecisionWriter = {
    load: () => Promise.resolve(context),
    addCriteria: unused,
    removeCriteria: unused,
    decide: unused,
    propose: unused,
    compare: unused,
    startVote: unused,
    open: (topic) => {
      opened.push(topic);
      return Promise.resolve(true);
    },
    proposeVariants: (_boardId, operation) => {
      proposed.push(operation);
      return Promise.resolve();
    },
  };
  return { writer, proposed, opened };
}

const MONOLITH = {
  name: 'Monolith',
  summary: 'Ein Dienst für alles, einfach zu betreiben.',
  diagramType: 'architecture',
  blocks: [
    { key: 'web', title: 'Web-App', type: 'app' },
    { key: 'api', title: 'Server', subtitle: 'API und Echtzeit' },
    { key: 'db', title: 'PostgreSQL', type: 'database' },
  ],
  connections: [
    { from: 'web', to: 'api', label: 'REST' },
    { from: 'API', to: 'db' },
  ],
};

const REALTIME = {
  name: 'Echtzeit-Dienst',
  summary: 'Ein eigener Dienst für Live-Daten, skaliert getrennt.',
  diagramType: 'architecture',
  blocks: [
    { key: 'web', title: 'Web-App', type: 'app' },
    { key: 'api', title: 'API' },
    { key: 'live', title: 'Echtzeit-Dienst' },
    { key: 'db', title: 'PostgreSQL', type: 'database' },
  ],
  connections: [
    { from: 'web', to: 'api' },
    { from: 'web', to: 'live', label: 'WebSocket' },
    { from: 'api', to: 'db' },
  ],
};

/** The board as it would be after adopting a variant. */
function adopted(operations: readonly CanvasOperationInput[], base?: Y.Doc) {
  const doc = new Y.Doc();
  if (base) Y.applyUpdate(doc, Y.encodeStateAsUpdate(base));
  applyOperations(doc, operations, MODERATOR);
  return doc;
}

function frameOf(doc: Y.Doc) {
  const frame = readNodes(doc).find((node) => node.type === 'frame');
  if (!frame) throw new Error('No frame');
  return frame;
}

describe('propose_variants', () => {
  it('draws each variant as an arranged diagram in its own frame, side by side', async () => {
    const { boards, doc } = memoryBoards();
    const { writer, proposed, opened } = variantsWriter();
    const tool = proposeVariantsTool({
      boards,
      boardId: BOARD_ID,
      author: MODERATOR,
      decisions: writer,
    });

    const answer = await tool.run({ topic: 'Architektur', variants: [MONOLITH, REALTIME] });

    // Nothing is on the board until a variant is adopted.
    expect(readNodes(doc(BOARD_ID))).toEqual([]);
    expect(opened).toEqual(['Architektur']);
    const [operation, ...more] = proposed;
    expect(more).toEqual([]);
    expect(operation).toMatchObject({
      op: 'variants',
      topic: 'Architektur',
      variants: [
        { name: 'Monolith', summary: MONOLITH.summary },
        { name: 'Echtzeit-Dienst', summary: REALTIME.summary },
      ],
    });
    expect(answer).toContain('Proposed the variants A "Monolith", B "Echtzeit-Dienst"');

    const [first, second] = (operation?.variants ?? []).map((variant) =>
      adopted(variant.operations),
    );
    if (!first || !second) throw new Error('The variants are missing');
    const monolith = readNodes(first);
    expect(monolith.filter((node) => node.type === 'block').map((node) => node.label)).toEqual([
      'Web-App',
      'Server',
      'PostgreSQL',
    ]);
    const frame = frameOf(first);
    expect(frame).toMatchObject({ label: 'Architektur: Monolith', diagramType: 'architecture' });
    expect(monolith.filter((node) => node.type === 'block')).toSatisfy((blocks: typeof monolith) =>
      blocks.every(
        (block) =>
          block.frameId === frame.id &&
          block.createdBy.kind === 'agent' &&
          block.position.x >= frame.position.x &&
          block.position.y >= frame.position.y &&
          block.position.x + block.size.width <= frame.position.x + frame.size.width &&
          block.position.y + block.size.height <= frame.position.y + frame.size.height,
      ),
    );
    expect(readEdges(first).map((edge) => edge.label)).toEqual(['REST', '']);
    // Arranged: the blocks no longer sit on the staggered start positions.
    expect(
      new Set(monolith.map((node) => `${String(node.position.x)},${String(node.position.y)}`)).size,
    ).toBe(monolith.length);
    expect(readEdges(second)).toHaveLength(3);

    // The second frame lies right of the first, with the tops aligned and room in between.
    const other = frameOf(second);
    expect(other.position.y).toBe(frame.position.y);
    expect(other.position.x).toBe(frame.position.x + frame.size.width + 80);
    // Its blocks moved along with it.
    expect(
      readNodes(second)
        .filter((node) => node.type === 'block')
        .every(
          (block) =>
            block.position.x >= other.position.x &&
            block.position.x + block.size.width <= other.position.x + other.size.width &&
            block.position.y >= other.position.y &&
            block.position.y + block.size.height <= other.position.y + other.size.height,
        ),
    ).toBe(true);
  });

  it('places the variants clear of what is on the board already', async () => {
    const { boards, doc } = memoryBoards();
    const existing = randomUUID();
    addBlock(
      doc(BOARD_ID),
      { id: existing, position: { x: 300, y: 300 }, label: 'Bestand' },
      MODERATOR,
    );
    const { writer, proposed } = variantsWriter();
    const tool = proposeVariantsTool({
      boards,
      boardId: BOARD_ID,
      author: MODERATOR,
      decisions: writer,
    });

    await tool.run({ topic: 'Architektur', variants: [MONOLITH, REALTIME] });

    for (const variant of proposed[0]?.variants ?? []) {
      const board = adopted(variant.operations, doc(BOARD_ID));
      const frame = frameOf(board);
      const block = readNodes(board).find((node) => node.id === existing);
      const covers =
        block !== undefined &&
        frame.position.x < block.position.x + block.size.width &&
        block.position.x < frame.position.x + frame.size.width &&
        frame.position.y < block.position.y + block.size.height &&
        block.position.y < frame.position.y + frame.size.height;
      expect(covers).toBe(false);
      expect(block?.frameId).toBeNull();
    }
    expect(proposed[0]?.variants).toHaveLength(2);
  });

  it('proposes nothing for a decided topic or one whose variants wait already', async () => {
    const { boards } = memoryBoards();
    const { writer, proposed } = variantsWriter({
      decisions: [
        {
          id: randomUUID(),
          topic: 'Architektur',
          status: 'decided',
          value: 'Monolith',
          reasoning: '',
        },
      ],
      openVariants: [{ topic: 'Hosting', names: ['A', 'B'] }],
    });
    const tool = proposeVariantsTool({
      boards,
      boardId: BOARD_ID,
      author: MODERATOR,
      decisions: writer,
    });

    expect(await tool.run({ topic: 'architektur', variants: [MONOLITH, REALTIME] })).toContain(
      '"Architektur" is decided already: Monolith',
    );
    expect(await tool.run({ topic: 'hosting', variants: [MONOLITH, REALTIME] })).toContain(
      'wait for the team already',
    );
    expect(proposed).toEqual([]);
  });

  it('refuses variants with the same name and connections to unknown blocks', async () => {
    const { boards } = memoryBoards();
    const { writer, proposed } = variantsWriter();
    const tool = proposeVariantsTool({
      boards,
      boardId: BOARD_ID,
      author: MODERATOR,
      decisions: writer,
    });

    await expect(
      tool.run({ topic: 'Architektur', variants: [MONOLITH, { ...REALTIME, name: 'monolith' }] }),
    ).rejects.toThrow('Two variants are called');
    await expect(
      tool.run({
        topic: 'Architektur',
        variants: [MONOLITH, { ...REALTIME, connections: [{ from: 'web', to: 'cache' }] }],
      }),
    ).rejects.toThrow('names a block that is not in it');
    await expect(tool.run({ topic: 'Architektur', variants: [MONOLITH] })).rejects.toThrow();
    expect(proposed).toEqual([]);
  });
});
