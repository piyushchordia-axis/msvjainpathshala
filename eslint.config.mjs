// Jain Pathshala — root ESLint flat config.
// Per-app overrides (Next.js, Expo, NestJS) layer on top of this in their own
// eslint.config.mjs files; this file defines the universal baseline:
//   - TypeScript parsing + recommended rules
//   - import-order with the @jp/* monorepo paths grouped as "internal"
//   - unused-imports auto-fix (allows underscore-prefixed escape hatch)
//
// Refs: SPEC.md §19 step 1; CLAUDE.md "Build process rules".

import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import unusedImports from 'eslint-plugin-unused-imports';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // Global ignores — must be in its own object per flat-config rules.
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/.expo/**',
      '**/coverage/**',
      '**/*.d.ts',
      'apps/ai/**', // Python service; linted by ruff, not ESLint
      'jp-design-system/**', // Vendored design system; not application source
      '.claude/**', // Local Claude tooling — not project source
      '.husky/**', // Git hooks; shell scripts only
      'infra/terraform/**', // .tf / .tfvars — handled by terraform fmt
    ],
  },

  // Baseline JS recommended.
  js.configs.recommended,

  // TypeScript recommended (non-type-aware — type-aware lint per package
  // when each tsconfig.json lands in later steps).
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    plugins: {
      import: importPlugin,
      'unused-imports': unusedImports,
    },
    rules: {
      // --- Style ---
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',

      // --- TS ---
      '@typescript-eslint/no-unused-vars': 'off', // handled by unused-imports
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      // --- Imports ---
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],
      'import/order': [
        'error',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
            'object',
            'type',
          ],
          pathGroups: [{ pattern: '@jp/**', group: 'internal', position: 'before' }],
          pathGroupsExcludedImportTypes: ['type'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import/no-duplicates': 'error',
    },
    settings: {
      'import/resolver': {
        node: { extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'] },
        typescript: { project: ['./tsconfig.base.json'] },
      },
    },
  },

  // Config files (CJS) — relax module checks.
  {
    files: ['**/*.cjs', '**/*.config.{js,cjs}'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
