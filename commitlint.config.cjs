/**
 * Jain Pathshala — commitlint config (Conventional Commits).
 *
 * Allowed types match CLAUDE.md "Build process rules → After completing a step":
 *   feat, fix, chore, test, docs, refactor, perf, build, ci, style, revert.
 *
 * Subject line is sentence-case (matches our UI tone — no SHOUTING).
 * Bodies / footers are unconstrained so the per-step Co-Authored-By trailer
 * documented in CLAUDE.md fits.
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'chore',
        'test',
        'docs',
        'refactor',
        'perf',
        'build',
        'ci',
        'style',
        'revert',
      ],
    ],
    'subject-case': [2, 'always', ['sentence-case', 'lower-case']],
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
};
