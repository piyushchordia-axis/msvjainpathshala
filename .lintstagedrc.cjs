/**
 * Jain Pathshala — lint-staged config.
 *
 * Runs on pre-commit (wired via Husky). Keep tasks fast — heavy checks
 * (typecheck, integration tests) live in CI, not pre-commit.
 */
module.exports = {
  '*.{ts,tsx,js,jsx,mjs,cjs}': ['eslint --fix', 'prettier --write'],
  '*.{json,md,mdx,yml,yaml,css}': ['prettier --write'],
};
