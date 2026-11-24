import {
  addBlock,
  getNodesMap,
  moveNodePositions,
  type Author,
  type CanvasNode,
} from '@covibes/shared';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { observeBoardProjection } from '@web/features/canvas/document-projection';
import { toFlowNodes, type FlowLocks } from '@web/features/canvas/flow-mapping';

const AUTHOR: Author = { kind: 'human', userId: '00000000-0000-4000-8000-000000000001' };
const LOCKS: FlowLocks = { locks: new Map(), ownClientId: 1 };
const idOf = (index: number) =>
  `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`;

describe('incremental board projection', () => {
  it('revalidates and projects only the moved entry on a 500-block board', () => {
    const doc = new Y.Doc();
    for (let index = 0; index < 500; index++)
      addBlock(
        doc,
        {
          id: idOf(index),
          label: `Block ${String(index)}`,
          position: { x: (index % 20) * 300, y: Math.floor(index / 20) * 200 },
        },
        AUTHOR,
      );
    const snapshots: Array<{ nodes: CanvasNode[]; changedNodes: ReadonlySet<string> }> = [];
    const view = observeBoardProjection(doc, (snapshot) => {
      snapshots.push(snapshot);
    });
    const before = snapshots[0];
    if (!before) throw new Error('No initial snapshot');
    const flow = toFlowNodes(before.nodes, [], LOCKS);
    moveNodePositions(doc, [[idOf(250), { x: 40, y: 60 }]], AUTHOR);
    const after = snapshots.at(-1);
    if (!after) throw new Error('No changed snapshot');
    expect([...after.changedNodes]).toEqual([idOf(250)]);
    for (let index = 0; index < 500; index++) {
      if (index !== 250) expect(after.nodes[index]).toBe(before.nodes[index]);
    }
    const next = toFlowNodes(after.nodes, flow, LOCKS, after.changedNodes);
    const previousById = new Map(flow.map((node) => [node.id, node]));
    expect(next.filter((node) => node !== previousById.get(node.id))).toHaveLength(1);
    expect(next.find((node) => node.id === idOf(250))?.position).toEqual({ x: 40, y: 60 });
    view.stop();
    doc.destroy();
  });

  it('drops removed or invalid entries and detaches its observers', () => {
    const doc = new Y.Doc();
    addBlock(doc, { id: idOf(0), label: 'Service', position: { x: 0, y: 0 } }, AUTHOR);
    const snapshots: Array<{ nodes: CanvasNode[] }> = [];
    const view = observeBoardProjection(doc, (snapshot) => {
      snapshots.push(snapshot);
    });
    getNodesMap(doc).get(idOf(0))?.set('position', { x: NaN, y: 0 });
    expect(snapshots.at(-1)?.nodes).toEqual([]);
    view.stop();
    const count = snapshots.length;
    getNodesMap(doc).delete(idOf(0));
    expect(snapshots).toHaveLength(count);
    doc.destroy();
  });
});
