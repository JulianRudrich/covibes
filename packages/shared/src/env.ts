import type { z } from 'zod';

export class EnvValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid environment variables:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

/**
 * Validates environment variables against a Zod schema and names every
 * missing or invalid variable at once, so a misconfigured deployment fails
 * fast with a single readable message instead of crashing later.
 */
export function defineEnv<TSchema extends z.ZodType>(
  schema: TSchema,
  source: Record<string, unknown>,
): z.output<TSchema> {
  const result = schema.safeParse(source);
  if (result.success) {
    return result.data;
  }
  const issues = result.error.issues.map((issue) => {
    const name = issue.path.map(String).join('.') || '(root)';
    return `${name}: ${issue.message}`;
  });
  throw new EnvValidationError(issues);
}
