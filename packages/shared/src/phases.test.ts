import { describe, expect, it } from 'vitest';

import { nextPhase, phaseStatuses, setPhaseInputSchema, toPhase } from './phases';

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

describe('nextPhase', () => {
  it('names the phase that follows, and none after the last', () => {
    expect(nextPhase('brainstorming')).toBe('decide');
    expect(nextPhase('architecture')).toBe('plan');
    expect(nextPhase('plan')).toBeUndefined();
  });
});

describe('toPhase', () => {
  it('reads a stored phase and starts over with one it does not know', () => {
    expect(toPhase('architecture')).toBe('architecture');
    expect(toPhase('launch')).toBe('brainstorming');
    expect(toPhase(undefined)).toBe('brainstorming');
  });
});

describe('setPhaseInputSchema', () => {
  it('takes one of the four phases', () => {
    expect(setPhaseInputSchema.safeParse({ phase: 'decide' }).success).toBe(true);
    expect(setPhaseInputSchema.safeParse({ phase: 'launch' }).success).toBe(false);
    expect(setPhaseInputSchema.safeParse({}).success).toBe(false);
  });
});
