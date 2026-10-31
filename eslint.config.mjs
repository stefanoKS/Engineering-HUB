import tseslint from 'typescript-eslint';

export default [
  { ignores: ['node_modules/**', 'coverage/**', '**/dist/**', '**/.vite/**', 'deploy/data/**'] },
  {
    files: ['src/**/*.gs', 'dashboard-app/**/*.gs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script'
    },
    rules: {
      'constructor-super': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-dupe-args': 'error',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'error',
      'valid-typeof': 'error'
    }
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: { ecmaVersion: 2022 },
    rules: {
      'no-dupe-args': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      'valid-typeof': 'error'
    }
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['**/*.ts', '**/*.tsx']
  })),
  {
    files: ['apps/**/*.{ts,tsx}', 'packages/**/*.ts', 'tools/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['error'] }],
      eqeqeq: ['error', 'always']
    }
  },
  {
    files: ['**/*.test.{ts,tsx}', '**/test/**/*.ts'],
    rules: { 'no-console': 'off' }
  }
];

