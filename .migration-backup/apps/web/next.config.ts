/**
 * Next.js 15 config for the Jain Pathshala web app.
 *
 * Key choices:
 *  - `@jp/*` workspace packages resolve to their built dist/index.js via
 *    a webpack alias. Their TypeScript sources use NodeNext-style `.js`
 *    import suffixes that Webpack doesn't rewrite to `.ts`, so pointing
 *    at the prebuilt output matches the runtime resolution npm consumers
 *    would see and keeps the dev server fast.
 *  - SVG handled by `@svgr/webpack` if we add it later; for Step 9 we
 *    serve the few logos as static <img> via /public.
 *  - `experimental.optimizePackageImports` for the few large UI libs we
 *    pull in (lucide, recharts).
 *  - `output: 'standalone'` is not set yet — we'll flip it on when we
 *    set up the Docker / ECS image in the deploy step.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import createNextIntlPlugin from 'next-intl/plugin';

import type { NextConfig } from 'next';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const projectDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(projectDir, '../..');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts'],
  },
  env: {
    NEXT_INTERNAL_API_BASE_URL: process.env.INTERNAL_API_BASE_URL ?? 'http://localhost:3000',
  },
  webpack(config) {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      '@jp/shared': path.join(workspaceRoot, 'packages/shared/dist/index.js'),
      '@jp/i18n': path.join(workspaceRoot, 'packages/i18n/dist/index.js'),
    };
    return config;
  },
};

export default withNextIntl(nextConfig);
