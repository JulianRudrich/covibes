import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  sourcemap: true,
  clean: true,
  // The shared package ships TypeScript source without its own build step,
  // so it must be bundled into the server instead of resolved at runtime.
  noExternal: ['@covibes/shared'],
});
