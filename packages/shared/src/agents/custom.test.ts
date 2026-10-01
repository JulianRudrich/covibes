import { describe, expect, it } from 'vitest';

import {
  agentInitials,
  agentKeySchema,
  createCustomAgentInputSchema,
  customAgentNameSchema,
  isCatalogAgentName,
  isCustomAgentKey,
  mentionHandle,
  teamMentionNames,
  updateCustomAgentInputSchema,
} from './custom';
import { parseMentions, splitMentions } from './mentions';

const JURIST = '11111111-1111-4111-8111-111111111111';
const WRITER = '22222222-2222-4222-8222-222222222222';

describe('agent keys (spec 19)', () => {
  it('are catalog keys or the id of a custom agent', () => {
    expect(agentKeySchema.safeParse('critic').success).toBe(true);
    expect(agentKeySchema.safeParse(JURIST).success).toBe(true);
    expect(agentKeySchema.safeParse('jurist').success).toBe(false);
    expect(agentKeySchema.safeParse('ABCDEF12-1111-4111-8111-111111111111').success).toBe(false);
    expect(isCustomAgentKey(JURIST)).toBe(true);
    expect(isCustomAgentKey('critic')).toBe(false);
    expect(isCustomAgentKey(null)).toBe(false);
  });
});

describe('names of custom agents', () => {
  it('are words separated by single spaces or hyphens', () => {
    for (const name of ['Jurist', 'UX Writer', 'Recht-Experte', 'Ärztin 2', 'a_b']) {
      expect(customAgentNameSchema.safeParse(name).success, name).toBe(true);
    }
    for (const name of ['X', 'Zwei  Leerzeichen', '-Start', 'Ende-', 'Mit@Zeichen', 'a.b']) {
      expect(customAgentNameSchema.safeParse(name).success, name).toBe(false);
    }
    expect(customAgentNameSchema.safeParse('x'.repeat(25)).success).toBe(false);
    expect(customAgentNameSchema.parse('  Jurist ')).toBe('Jurist');
  });

  it('cannot be a name a catalog agent answers to', () => {
    for (const name of ['Backend', 'kritiker', 'UX', 'Datenschutz']) {
      expect(isCatalogAgentName(name), name).toBe(true);
      expect(customAgentNameSchema.safeParse(name).success, name).toBe(false);
    }
    expect(isCatalogAgentName('Backend Profi')).toBe(false);
  });

  it('give the handle to mention the agent and two letters for its avatar', () => {
    expect(mentionHandle('UX Writer')).toBe('UX-Writer');
    expect(mentionHandle('Jurist')).toBe('Jurist');
    expect(agentInitials('UX Writer')).toBe('UW');
    expect(agentInitials('Recht-Experte')).toBe('RE');
    expect(agentInitials('jurist')).toBe('JU');
    expect(agentInitials('Ärztin für Daten')).toBe('ÄF');
  });
});

describe('custom agent input', () => {
  it('fills in what a new agent leaves out', () => {
    expect(
      createCustomAgentInputSchema.parse({ name: 'Jurist', role: ' Prüft Verträge ', color: 3 }),
    ).toEqual({
      name: 'Jurist',
      role: 'Prüft Verträge',
      instructions: '',
      canDraw: true,
      model: null,
      color: 3,
      projectId: null,
      template: null,
    });
    expect(
      createCustomAgentInputSchema.safeParse({ name: 'Jurist', role: 'R', color: 0 }).success,
    ).toBe(false);
    expect(
      createCustomAgentInputSchema.safeParse({
        name: 'Jurist',
        role: 'R',
        color: 1,
        template: 'moderator',
      }).success,
    ).toBe(false);
  });

  it('changes at least one field', () => {
    expect(updateCustomAgentInputSchema.parse({ canDraw: false })).toEqual({ canDraw: false });
    expect(updateCustomAgentInputSchema.parse({ projectId: null })).toEqual({ projectId: null });
    expect(updateCustomAgentInputSchema.safeParse({}).success).toBe(false);
    expect(updateCustomAgentInputSchema.safeParse({ name: 'Backend' }).success).toBe(false);
  });
});

describe('mentions in a team with custom agents', () => {
  const names = teamMentionNames(
    ['moderator', 'critic', JURIST, WRITER, '33333333-3333-4333-8333-333333333333'],
    [
      { key: JURIST, name: 'Jurist' },
      { key: WRITER, name: 'UX Writer' },
    ],
  );

  it('give catalog agents their fixed names and custom agents their handle', () => {
    expect(names).toEqual({
      moderator: ['moderator'],
      critic: ['critic', 'kritiker'],
      [JURIST]: ['jurist'],
      [WRITER]: ['ux-writer'],
    });
  });

  it('find the mentioned agents of the team, whatever the case', () => {
    expect(
      parseMentions('@Jurist und @UX-Writer, bitte. @Backend nicht, @jurist doppelt.', names),
    ).toEqual([JURIST, WRITER]);
    // "@UX" alone is not the writer, and the frontend agent is not in this team.
    expect(parseMentions('@UX Writer', names)).toEqual([]);
    expect(splitMentions('Hallo @ux-writer!', names)).toEqual([
      { kind: 'text', text: 'Hallo ' },
      { kind: 'mention', text: '@ux-writer', key: WRITER },
      { kind: 'text', text: '!' },
    ]);
  });
});
