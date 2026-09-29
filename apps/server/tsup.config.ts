import { cp } from 'node:fs/promises';

import { defineConfig } from 'tsup';

export default defineConfig({
  // `index`: the server. `setup`: roles and migrations before a start in Docker (spec 02b).
  // `worker`: the agent runs (spec 07).
  entry: ['src/index.ts', 'src/setup.ts', 'src/worker.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  sourcemap: true,
  clean: true,
  // The workspace packages ship TypeScript source without their own build step, so they are
  // bundled into the server; that is why they are only devDependencies.
  noExternal: ['@covibes/shared', '@covibes/db'],
  // Prompts stay Markdown files; `src/agents/prompts.ts` reads them next to the bundle.
  onSuccess: () => cp('src/agents/prompts', 'dist/prompts', { recursive: true }),
});
