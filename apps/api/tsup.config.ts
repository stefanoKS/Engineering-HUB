import { defineConfig } from 'tsup';

/**
 * Production bundle. The internal `@eh/*` packages are TypeScript-only workspaces, so they are
 * bundled into the artifact instead of being resolved at runtime from a source directory that a
 * runtime image does not contain.
 */
export default defineConfig({
  entry: ['src/main.ts', 'src/migrate.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  splitting: false,
  sourcemap: false,
  noExternal: [/^@eh\//]
});
