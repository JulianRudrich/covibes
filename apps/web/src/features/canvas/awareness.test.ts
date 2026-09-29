import { describe, expect, it } from 'vitest';

import { remoteCursors } from '@web/features/canvas/awareness';

const OWN = { clientId: 1, userId: 'me' };

describe('remoteCursors', () => {
  it('returns the cursors of other users', () => {
    const states = new Map<number, Record<string, unknown>>([
      [2, { user: { id: 'sam', name: 'Sam' }, cursor: { x: 10, y: 20 } }],
    ]);

    expect(remoteCursors(states, OWN)).toEqual([
      { clientId: 2, userId: 'sam', name: 'Sam', position: { x: 10, y: 20 } },
    ]);
  });

  it('leaves out the own client and other tabs of the same user', () => {
    const states = new Map<number, Record<string, unknown>>([
      [1, { user: { id: 'me', name: 'Me' }, cursor: { x: 1, y: 1 } }],
      [3, { user: { id: 'me', name: 'Me' }, cursor: { x: 2, y: 2 } }],
    ]);

    expect(remoteCursors(states, OWN)).toEqual([]);
  });

  it('leaves out clients without a cursor on the canvas', () => {
    const states = new Map<number, Record<string, unknown>>([
      [2, { user: { id: 'sam', name: 'Sam' }, cursor: null }],
      [4, { user: { id: 'kim', name: 'Kim' } }],
    ]);

    expect(remoteCursors(states, OWN)).toEqual([]);
  });

  it('ignores malformed states', () => {
    const states = new Map<number, Record<string, unknown>>([
      [2, { user: { id: 'sam' }, cursor: { x: 1, y: 1 } }],
      [3, { user: { id: 'kim', name: 'Kim' }, cursor: { x: 'left', y: 1 } }],
      [4, {}],
    ]);

    expect(remoteCursors(states, OWN)).toEqual([]);
  });
});
