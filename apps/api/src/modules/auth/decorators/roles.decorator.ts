/**
 * `@Roles(...)` — declare the roles permitted to invoke a route.
 *
 * RolesGuard reads this metadata and asserts the actor's role satisfies
 * one of the listed roles (hierarchy-aware via `roleSatisfiesAny`).
 *
 * Example:
 *   @Roles('sanchalak', 'city_admin')
 *   @Post('/v1/batches')
 */

import { SetMetadata } from '@nestjs/common';

import type { Role } from '@jp/shared';

export const ROLES_KEY = 'jp.roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
