import { describe, expect, it } from 'vitest';

import { PROJECT_NAME_MAX_LENGTH, projectIdSchema, projectNameSchema } from './projects';

describe('projectNameSchema', () => {
  it('trims the name', () => {
    expect(projectNameSchema.parse('  Covibes V1  ')).toBe('Covibes V1');
  });

  it('rejects empty and whitespace-only names', () => {
    expect(projectNameSchema.safeParse('').success).toBe(false);
    expect(projectNameSchema.safeParse('   ').success).toBe(false);
  });

  it('accepts the maximum length and rejects longer names', () => {
    expect(projectNameSchema.safeParse('x'.repeat(PROJECT_NAME_MAX_LENGTH)).success).toBe(true);
    expect(projectNameSchema.safeParse('x'.repeat(PROJECT_NAME_MAX_LENGTH + 1)).success).toBe(
      false,
    );
  });
});

describe('projectIdSchema', () => {
  it('accepts UUIDs only', () => {
    expect(projectIdSchema.safeParse('0b6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de').success).toBe(true);
    expect(projectIdSchema.safeParse('demo').success).toBe(false);
  });
});
