import { describe, expect, it } from 'vitest';

import { formatRelativeTime, initialsOf } from './format';

const NOW = Date.parse('2026-09-28T12:00:00Z');

describe('formatRelativeTime', () => {
  it('describes recent and older changes in German', () => {
    expect(formatRelativeTime('2026-09-28T11:59:40Z', 'de', NOW)).toBe('jetzt');
    expect(formatRelativeTime('2026-09-28T11:55:00Z', 'de', NOW)).toBe('vor 5 Minuten');
    expect(formatRelativeTime('2026-09-27T12:00:00Z', 'de', NOW)).toBe('gestern');
  });

  it('follows the language', () => {
    expect(formatRelativeTime('2026-09-28T10:00:00Z', 'en', NOW)).toBe('2 hours ago');
  });
});

describe('initialsOf', () => {
  it('takes the first letters of up to two words', () => {
    expect(initialsOf('olga')).toBe('O');
    expect(initialsOf('Olga Owner Smith')).toBe('OO');
    expect(initialsOf('   ')).toBe('?');
  });
});
