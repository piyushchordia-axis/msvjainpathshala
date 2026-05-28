/**
 * next-intl typed navigation helpers. Use these instead of `next/link` /
 * `useRouter` so locale segments are added automatically.
 */

import { createNavigation } from 'next-intl/navigation';

import { routing } from './routing';

export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
