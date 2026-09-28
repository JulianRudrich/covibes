import { describe, expect, it } from 'vitest';

import { phaseStatuses } from './phases';

describe('phaseStatuses', () => {
  it('marks earlier phases done and later phases upcoming', () => {
    expect(phaseStatuses('architecture')).toEqual([
      { phase: 'brainstorming', status: 'done' },
      { phase: 'decide', status: 'done' },
      { phase: 'architecture', status: 'active' },
      { phase: 'plan', status: 'upcoming' },
    ]);
  });

  it('has no done phases at the start', () => {
    expect(phaseStatuses('brainstorming').map((entry) => entry.status)).toEqual([
      'active',
      'upcoming',
      'upcoming',
      'upcoming',
    ]);
  });
});
