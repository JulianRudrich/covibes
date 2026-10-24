import { describe, expect, it } from 'vitest';

import { nodeLocks, presentUsers, remoteCursors } from './awareness';

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

describe('presentUsers', () => {
  it('names everyone else on the board once, also without a cursor', () => {
    const states = new Map<number, Record<string, unknown>>([
      [1, { user: { id: 'me', name: 'Me' }, cursor: { x: 1, y: 1 } }],
      [2, { user: { id: 'sam', name: 'Sam' }, cursor: null }],
      [3, { user: { id: 'me', name: 'Me' } }],
      [4, { user: { id: 'alex', name: 'Alex' }, cursor: { x: 5, y: 5 } }],
      [5, { user: { id: 'sam', name: 'Sam' }, cursor: { x: 2, y: 2 } }],
      [6, { cursor: { x: 3, y: 3 } }],
    ]);

    expect(presentUsers(states, OWN)).toEqual(['alex', 'sam']);
  });
});

describe('nodeLocks', () => {
  const block = 'block-1';

  it('names who edits which node', () => {
    const states = new Map<number, Record<string, unknown>>([
      [2, { user: { id: 'sam', name: 'Sam' }, editing: { nodeId: block, since: 100 } }],
      [3, { user: { id: 'kim', name: 'Kim' }, cursor: { x: 1, y: 1 } }],
    ]);

    expect(nodeLocks(states)).toEqual(
      new Map([[block, { clientId: 2, userId: 'sam', name: 'Sam', since: 100 }]]),
    );
  });

  it('gives a node to whoever started first, then to the lower client id', () => {
    const states = new Map<number, Record<string, unknown>>([
      [5, { user: { id: 'kim', name: 'Kim' }, editing: { nodeId: block, since: 200 } }],
      [4, { user: { id: 'sam', name: 'Sam' }, editing: { nodeId: block, since: 100 } }],
      [7, { user: { id: 'ada', name: 'Ada' }, editing: { nodeId: 'block-2', since: 50 } }],
      [6, { user: { id: 'bob', name: 'Bob' }, editing: { nodeId: 'block-2', since: 50 } }],
    ]);

    const locks = nodeLocks(states);
    expect(locks.get(block)?.name).toBe('Sam');
    expect(locks.get('block-2')?.name).toBe('Bob');
  });

  it('ignores clients that edit nothing and malformed locks', () => {
    const states = new Map<number, Record<string, unknown>>([
      [2, { user: { id: 'sam', name: 'Sam' }, editing: null }],
      [3, { user: { id: 'kim', name: 'Kim' }, editing: { nodeId: block, since: -1 } }],
      [4, { editing: { nodeId: block, since: 1 } }],
    ]);

    expect(nodeLocks(states).size).toBe(0);
  });
});
