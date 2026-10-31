import { defineConfig } from 'tsup';

/** Migration CLI bundle. It runs from a container without the TypeScript workspace sources. */
export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  splitting: false,
  sourcemap: false,
  noExternal: [/^@eh\//]
});
