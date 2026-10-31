import { defineConfig } from 'tsup';

/** Worker bundle: internal `@eh/*` workspaces are bundled, external packages stay external. */
export default defineConfig({
  entry: ['src/main.ts', 'src/cli.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  splitting: false,
  sourcemap: false,
  noExternal: [/^@eh\//]
});
