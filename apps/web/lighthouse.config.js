/**
 * Lighthouse CI config — Step 23 / SPEC.md §17.
 *
 * Run locally:
 *   npx lhci autorun --config apps/web/lighthouse.config.js
 *
 * Budgets are tuned for the user-side surfaces:
 *   - Public site routes: < 250 KB gzipped JS, LCP < 2.5s on 3G Fast.
 *   - Admin panels:       < 600 KB gzipped JS, LCP < 4s on 3G Fast.
 *
 * Cypress-style assertions live under `assert.assertions`. Hard failures
 * fail the CI job (`error`); warnings show up but don't break the build.
 */

module.exports = {
  ci: {
    collect: {
      url: [
        'http://localhost:3001/',
        'http://localhost:3001/centres',
        'http://localhost:3001/donate',
        'http://localhost:3001/admin/login',
      ],
      numberOfRuns: 3,
      settings: {
        throttling: {
          rttMs: 150,
          throughputKbps: 1638.4,
          requestLatencyMs: 562,
          downloadThroughputKbps: 1474.56,
          uploadThroughputKbps: 675,
          cpuSlowdownMultiplier: 4,
        },
        preset: 'desktop',
      },
    },
    assert: {
      assertions: {
        'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
        'total-blocking-time': ['warn', { maxNumericValue: 300 }],
        'resource-summary:script:size': ['error', { maxNumericValue: 250 * 1024 }],
        'resource-summary:image:size': ['warn', { maxNumericValue: 500 * 1024 }],
        'categories:accessibility': ['error', { minScore: 0.95 }],
        'categories:performance': ['warn', { minScore: 0.8 }],
        'categories:seo': ['warn', { minScore: 0.9 }],
      },
    },
    upload: {
      target: 'temporary-public-storage',
    },
  },
};
