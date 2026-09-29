import { describe, expect, it } from 'vitest';

import { collabUrl } from '@web/features/canvas/board-connection';

describe('collabUrl', () => {
  it('uses the own origin with ws during development', () => {
    expect(collabUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe(
      'ws://localhost:5173/api/collab',
    );
  });

  it('uses wss behind HTTPS', () => {
    expect(collabUrl({ protocol: 'https:', host: 'covibes.example.org' })).toBe(
      'wss://covibes.example.org/api/collab',
    );
  });
});
