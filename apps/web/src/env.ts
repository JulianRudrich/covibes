import { defineEnv } from '@covibes/shared';
import { z } from 'zod';

export const webEnvSchema = z.object({
  VITE_APP_URL: z.url().optional(),
});

export type WebEnv = z.output<typeof webEnvSchema>;

export const webEnv: WebEnv = defineEnv(webEnvSchema, import.meta.env);
