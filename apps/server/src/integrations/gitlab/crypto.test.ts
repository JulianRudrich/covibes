import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  openToken,
  readState,
  sealToken,
  signState,
  STATE_LIFETIME_MS,
} from '@server/integrations/gitlab/crypto';

const KEY = 'a-token-key-with-at-least-32-characters';
const OTHER_KEY = 'another-key-with-at-least-32-characters';

describe('sealing a token', () => {
  it('gives a form that holds nothing of the token and opens to it again', () => {
    const sealed = sealToken(KEY, 'glpat-secret-token');

    expect(sealed).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(sealed).not.toContain('glpat');
    expect(openToken(KEY, sealed)).toBe('glpat-secret-token');
  });

  it('never gives the same form twice', () => {
    expect(sealToken(KEY, 'same')).not.toBe(sealToken(KEY, 'same'));
  });

  it('does not open under another key, after a change or in an unknown form', () => {
    const sealed = sealToken(KEY, 'glpat-secret-token');
    const [version, nonce, ciphertext, tag] = sealed.split('.') as [string, string, string, string];
    const flipped = `${ciphertext.slice(0, -1)}${ciphertext.endsWith('A') ? 'B' : 'A'}`;

    expect(() => openToken(OTHER_KEY, sealed)).toThrow();
    expect(() => openToken(KEY, [version, nonce, flipped, tag].join('.'))).toThrow();
    expect(() => openToken(KEY, ['v2', nonce, ciphertext, tag].join('.'))).toThrow();
    expect(() => openToken(KEY, 'glpat-secret-token')).toThrow();
  });
});

describe('the state of an OAuth flow', () => {
  const asked = { projectId: randomUUID(), userId: randomUUID() };

  it('says which project and person it was signed for', () => {
    const state = signState(KEY, asked);

    expect(readState(KEY, state)).toEqual(asked);
    // Two flows of the same person never share a state.
    expect(signState(KEY, asked)).not.toBe(state);
  });

  it('holds for ten minutes', () => {
    const now = Date.now();
    const state = signState(KEY, asked, now);

    expect(readState(KEY, state, now + STATE_LIFETIME_MS - 1)).toEqual(asked);
    expect(readState(KEY, state, now + STATE_LIFETIME_MS)).toBeUndefined();
  });

  it('is refused when it is forged, signed with another key or damaged', () => {
    const state = signState(KEY, asked);
    const [payload, signature] = state.split('.') as [string, string];
    const forged = Buffer.from(
      JSON.stringify({
        ...asked,
        userId: randomUUID(),
        expiresAt: Date.now() + 60_000,
        nonce: 'x',
      }),
    ).toString('base64url');

    expect(readState(KEY, `${forged}.${signature}`)).toBeUndefined();
    expect(readState(OTHER_KEY, state)).toBeUndefined();
    expect(readState(KEY, payload)).toBeUndefined();
    expect(readState(KEY, `${state}.more`)).toBeUndefined();
    expect(readState(KEY, '')).toBeUndefined();
    expect(readState(KEY, 'not.a-state')).toBeUndefined();
  });
});
