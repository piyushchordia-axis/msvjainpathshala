/**
 * Expo Go landing page — served by Next.js on port 3001 at `/expo`.
 *
 * Open via nginx:
 *   https://pathshala.enaacreations.com/expo
 *   https://pathshala-admin.enaacreations.com/expo
 *
 * Tunnel URL resolution: see `@/lib/expo-dev-link`.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { renderExpoLandingHtml, resolveExpoDeepLink } from '@/lib/expo-dev-link';

export const dynamic = 'force-dynamic';

const TEMPLATE_PATH = path.join(process.cwd(), 'src/templates/expo-landing.html');

export async function GET(): Promise<Response> {
  const [template, link] = await Promise.all([
    readFile(TEMPLATE_PATH, 'utf8'),
    resolveExpoDeepLink(),
  ]);

  const html = renderExpoLandingHtml(template, link);

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
