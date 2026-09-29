import { readFileSync } from 'node:fs';

/**
 * Prompts are versioned Markdown files in `prompts/` (code standards). They resolve relative to
 * this module: in development and tests that is `src/agents/`, in the build `dist/`, where tsup
 * copies the folder (`tsup.config.ts`).
 */
const PROMPTS_DIR = new URL('./prompts/', import.meta.url);

/** Reads a prompt once at startup, so a missing file stops the worker instead of a run. */
export function loadPrompt(name: string): string {
  const prompt = readFileSync(new URL(`${name}.md`, PROMPTS_DIR), 'utf8').trim();
  if (prompt.length === 0) throw new Error(`The prompt "${name}" is empty`);
  return prompt;
}
