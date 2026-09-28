import { defineConfig } from 'tsup';

export default defineConfig({
  // `index`: the server. `setup`: roles and migrations before a start in Docker (spec 02b).
  entry: ['src/index.ts', 'src/setup.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  sourcemap: true,
  clean: true,
  // The workspace packages ship TypeScript source without their own build step, so they are
  // bundled into the server; that is why they are only devDependencies.
  noExternal: ['@covibes/shared', '@covibes/db'],
});
