import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/**/test/**/*.test.ts',
      'apps/**/test/**/*.test.ts',
      'apps/**/test/**/*.test.tsx',
      'tools/**/test/**/*.test.ts'
    ],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 180_000,
    globalSetup: ['./vitest.setup.ts'],    fileParallelism: false,
    sequence: { concurrent: false },
    reporters: ['default']
  }
});

