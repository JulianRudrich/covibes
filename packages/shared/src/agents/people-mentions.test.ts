import { describe, expect, it } from 'vitest';

import { markNotificationsReadInputSchema } from '../notifications';

import { memberHandle, parsePeopleMentions, peopleMentionNames } from './mentions';

const ALEX = { userId: 'user-alex', name: 'Alex Berg' };
const SAM = { userId: 'user-sam', name: 'sam.smith' };
const ZOE = { userId: 'user-zoe', name: 'Zoë Müller-Lüdenscheidt' };

describe('memberHandle', () => {
  it('writes a name as one word, with hyphens for everything that is not a letter or digit', () => {
    expect(memberHandle('Alex Berg')).toBe('Alex-Berg');
    expect(memberHandle('sam.smith')).toBe('sam-smith');
    expect(memberHandle("  Dr. O'Neil  ")).toBe('Dr-O-Neil');
    expect(memberHandle('Zoë Müller-Lüdenscheidt')).toBe('Zoë-Müller-Lüdenscheidt');
    expect(memberHandle('olga_2')).toBe('olga_2');
  });

  it('is empty for a name without a letter or digit', () => {
    expect(memberHandle('…')).toBe('');
    expect(memberHandle(' - ')).toBe('');
    expect(peopleMentionNames([{ userId: 'x', name: '!!' }, ALEX])).toEqual({
      'user:user-alex': ['alex-berg'],
    });
  });
});

describe('parsePeopleMentions', () => {
  it('finds the mentioned people, each once, whatever the case', () => {
    expect(
      parsePeopleMentions(
        '@alex-berg und @Sam-Smith, danke @Alex-Berg! @Zoë-Müller-Lüdenscheidt?',
        [ALEX, SAM, ZOE],
      ),
    ).toEqual(['user-alex', 'user-sam', 'user-zoe']);
  });

  it('ignores names nobody has, addresses and code', () => {
    expect(
      parsePeopleMentions('@Alex mail@Alex-Berg.de `@Alex-Berg` a@Alex-Berg @Alex-Bergmann', [
        ALEX,
      ]),
    ).toEqual([]);
  });

  it('leaves a name to the agent that answers to it', () => {
    const backend = { userId: 'user-backend', name: 'Backend' };

    expect(parsePeopleMentions('@Backend und @Alex-Berg', [backend, ALEX])).toEqual([
      'user-backend',
      'user-alex',
    ]);
    expect(
      parsePeopleMentions('@Backend und @Alex-Berg', [backend, ALEX], { backend: ['backend'] }),
    ).toEqual(['user-alex']);
  });

  it('mentions everyone who shares a handle', () => {
    expect(
      parsePeopleMentions('@Sam', [
        { userId: 'one', name: 'Sam' },
        { userId: 'two', name: 'sam' },
        ALEX,
      ]),
    ).toEqual(['one', 'two']);
  });
});

describe('markNotificationsReadInputSchema', () => {
  it('takes single notifications, the mentions of a project, or all', () => {
    const id = '11111111-1111-4111-8111-111111111111';

    expect(markNotificationsReadInputSchema.safeParse({ ids: [id] }).success).toBe(true);
    expect(markNotificationsReadInputSchema.safeParse({ projectId: id }).success).toBe(true);
    expect(markNotificationsReadInputSchema.safeParse({ all: true }).success).toBe(true);
    for (const input of [
      {},
      { ids: [] },
      { ids: ['x'] },
      { all: false },
      { all: true, ids: [id] },
    ]) {
      expect(markNotificationsReadInputSchema.safeParse(input).success, JSON.stringify(input)).toBe(
        false,
      );
    }
  });
});
