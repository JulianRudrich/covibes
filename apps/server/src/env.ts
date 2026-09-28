import { defineEnv } from '@covibes/shared';
import { z } from 'zod';

export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  // Local development stays on this machine; the container sets HOST=0.0.0.0 (spec 02b).
  HOST: z.string().min(1).default('127.0.0.1'),
});

export type ServerEnv = z.output<typeof serverEnvSchema>;

export function loadServerEnv(source: Record<string, unknown> = process.env): ServerEnv {
  return defineEnv(serverEnvSchema, source);
}
