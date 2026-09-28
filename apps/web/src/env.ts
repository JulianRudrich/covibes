import { defineEnv } from '@covibes/shared';
import { z } from 'zod';

// The web app reaches the server through `/api` on its own origin, so it needs no secrets or URLs.
export const webEnvSchema = z.object({
  VITE_APP_URL: z.url().optional(),
});

export type WebEnv = z.output<typeof webEnvSchema>;

export const webEnv: WebEnv = defineEnv(webEnvSchema, import.meta.env);
