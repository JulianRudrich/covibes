import { describe, expect, it } from 'vitest';

import { greetingKey } from './greeting';

describe('the greeting of the project list (spec 36c)', () => {
  it('says good morning until 11, hello during the day and good evening from 18', () => {
    expect(greetingKey(6)).toBe('projects.greeting.morning');
    expect(greetingKey(10)).toBe('projects.greeting.morning');
    expect(greetingKey(11)).toBe('projects.greeting.day');
    expect(greetingKey(17)).toBe('projects.greeting.day');
    expect(greetingKey(18)).toBe('projects.greeting.evening');
    expect(greetingKey(0)).toBe('projects.greeting.morning');
  });
});
