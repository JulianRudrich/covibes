import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  addBlock,
  addFrame,
  getNodesMap,
  moveNodePositions,
  moveNodes,
  placeNodes,
  readNodes,
  type Author,
} from './model';

const ID = '00000000-0000-4000-8000-000000000001';
const FRAME = '00000000-0000-4000-8000-000000000002';
const FIRST: Author = { kind: 'human', userId: '00000000-0000-4000-8000-0000000000aa' };
const SECOND: Author = { kind: 'human', userId: '00000000-0000-4000-8000-0000000000bb' };
function board() {
  const doc = new Y.Doc();
  addBlock(doc, { id: ID, label: 'Service', position: { x: 0, y: 0 } }, FIRST);
  return doc;
}

describe('position-only drag updates (spec 48)', () => {
  it('keeps provenance until the final drop, which stamps exactly once', () => {
    const doc = board();
    const before = readNodes(doc)[0];
    let stamps = 0;
    getNodesMap(doc)
      .get(ID)
      ?.observe((event) => {
        if (event.keysChanged.has('lastChangedAt')) stamps++;
      });
    for (let step = 0; step < 300; step++)
      moveNodePositions(doc, [[ID, { x: step, y: step }]], SECOND);
    expect(readNodes(doc)[0]).toMatchObject({
      position: { x: 299, y: 299 },
      lastChangedBy: FIRST,
      lastChangedAt: before?.lastChangedAt,
    });
    expect(stamps).toBe(0);
    moveNodes(doc, [[ID, { x: 300, y: 300 }]], SECOND);
    expect(stamps).toBe(1);
    expect(readNodes(doc)[0]?.lastChangedBy).toEqual(SECOND);
    doc.destroy();
  });

  it('keeps encoded document growth bounded across 300 intermediate positions', () => {
    const lean = board();
    const baseline = Y.encodeStateAsUpdate(lean).byteLength;
    const old = board();
    const oldBaseline = Y.encodeStateAsUpdate(old).byteLength;
    for (let step = 1; step <= 300; step++) {
      moveNodePositions(lean, [[ID, { x: step, y: step }]], SECOND);
      moveNodes(old, [[ID, { x: step, y: step }]], SECOND);
    }
    moveNodes(lean, [[ID, { x: 300, y: 300 }]], SECOND);
    const growth = Y.encodeStateAsUpdate(lean).byteLength - baseline;
    const repeatedAttribution = Y.encodeStateAsUpdate(old).byteLength - oldBaseline;
    expect(growth).toBeLessThan(1024);
    expect(repeatedAttribution).toBeGreaterThan(growth * 5);
    lean.destroy();
    old.destroy();
  });

  it('carries frame children without repeatedly stamping them', () => {
    const doc = board();
    addFrame(doc, { id: FRAME, title: 'System', position: { x: 0, y: 0 } }, SECOND);
    placeNodes(doc, [ID], SECOND);
    const before = readNodes(doc).find((node) => node.id === ID);
    moveNodePositions(doc, [[FRAME, { x: 100, y: 200 }]], SECOND);
    expect(readNodes(doc).find((node) => node.id === ID)).toMatchObject({
      position: { x: 100, y: 200 },
      lastChangedBy: before?.lastChangedBy,
      lastChangedAt: before?.lastChangedAt,
    });
    doc.destroy();
  });
});
