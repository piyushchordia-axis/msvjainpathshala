// apps/api ESLint overrides — extends the workspace root config and turns off
// `@typescript-eslint/consistent-type-imports` because Nest DI requires value
// imports for injected classes (the runtime metadata `emitDecoratorMetadata`
// generates uses the import binding directly). The rule's well-meaning
// "use import type when only used as a type" advice produces injection-time
// `Cannot read properties of undefined` errors.

import root from '../../eslint.config.mjs';

export default [
  ...root,
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
];
