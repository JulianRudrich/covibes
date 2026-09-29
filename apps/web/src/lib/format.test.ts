import { describe, expect, it } from 'vitest';

import {
  formatClockTime,
  formatLongDate,
  formatRelativeTime,
  initialsOf,
  isSameLocalDay,
} from './format';

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

// Built from local dates so the tests hold in every time zone.
function local(year: number, month: number, day: number, hours = 0, minutes = 0): string {
  return new Date(year, month, day, hours, minutes).toISOString();
}

describe('formatClockTime', () => {
  it('shows hours and minutes with two digits in German', () => {
    expect(formatClockTime(local(2026, 8, 28, 14, 5), 'de')).toBe('14:05');
    expect(formatClockTime(local(2026, 8, 28, 9, 5), 'de')).toBe('09:05');
  });

  it('follows the clock convention of the language', () => {
    expect(formatClockTime(local(2026, 8, 28, 14, 5), 'en')).toMatch(/^2:05\sPM$/);
  });
});

describe('isSameLocalDay', () => {
  it('compares calendar days in local time', () => {
    expect(isSameLocalDay(local(2026, 8, 28, 0, 1), local(2026, 8, 28, 23, 59))).toBe(true);
    expect(isSameLocalDay(local(2026, 8, 28, 23, 59), local(2026, 8, 29, 0, 1))).toBe(false);
  });

  it('does not mix up the same day in another month or year', () => {
    expect(isSameLocalDay(local(2026, 8, 28), local(2026, 9, 28))).toBe(false);
    expect(isSameLocalDay(local(2026, 8, 28), local(2025, 8, 28))).toBe(false);
  });

  it('accepts timestamps and dates as well', () => {
    const noon = new Date(2026, 8, 28, 12);
    expect(isSameLocalDay(local(2026, 8, 28, 8), noon.getTime())).toBe(true);
    expect(isSameLocalDay(noon, local(2026, 8, 27, 12))).toBe(false);
  });
});

describe('formatLongDate', () => {
  it('writes the date out in the language', () => {
    expect(formatLongDate(local(2026, 8, 28, 14, 5), 'de')).toBe('28. September 2026');
    expect(formatLongDate(local(2026, 8, 28, 14, 5), 'en')).toBe('September 28, 2026');
  });
});
