/**
 * `@RequireScope(kind, paramName)` — declares that a route operates on a
 * scoped resource (centre / batch / city) named by the given route param.
 *
 * ScopeGuard reads this metadata, resolves the resource via the matching
 * service / repository, and asserts the actor's ScopeContext covers it.
 *
 * Example:
 *   @RequireScope('centre', 'centreId')
 *   @Patch('/v1/centres/:centreId')
 */

import { SetMetadata } from '@nestjs/common';

import type { ScopeKind } from '../../../common/access/scope-rules';

export const SCOPE_KEY = 'jp.scope';

export interface ScopeMeta {
  kind: ScopeKind;
  paramName: string;
}

export const RequireScope = (kind: ScopeKind, paramName: string) =>
  SetMetadata(SCOPE_KEY, { kind, paramName } satisfies ScopeMeta);
