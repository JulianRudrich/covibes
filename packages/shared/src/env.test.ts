import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { defineEnv, EnvValidationError } from './env';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3001),
});

describe('defineEnv', () => {
  it('returns parsed values with defaults applied', () => {
    const env = defineEnv(schema, { DATABASE_URL: 'postgres://localhost/covibes' });

    expect(env).toEqual({ DATABASE_URL: 'postgres://localhost/covibes', PORT: 3001 });
  });

  it('coerces string values from the environment', () => {
    const env = defineEnv(schema, { DATABASE_URL: 'x', PORT: '8080' });

    expect(env.PORT).toBe(8080);
  });

  it('names a missing required variable', () => {
    expect(() => defineEnv(schema, {})).toThrow(EnvValidationError);
    expect(() => defineEnv(schema, {})).toThrow(/DATABASE_URL/);
  });

  it('names every invalid variable at once', () => {
    try {
      defineEnv(schema, { PORT: 'abc' });
      expect.unreachable('defineEnv should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const issues = (error as EnvValidationError).issues.join('\n');
      expect(issues).toMatch(/DATABASE_URL/);
      expect(issues).toMatch(/PORT/);
    }
  });
});
