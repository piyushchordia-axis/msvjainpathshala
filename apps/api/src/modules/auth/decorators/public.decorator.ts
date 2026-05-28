/**
 * `@Public()` — marks a route as not requiring authentication.
 *
 * The JwtAuthGuard reads this metadata and short-circuits before checking
 * the Authorization header. Used on /v1/auth/otp/send, /v1/auth/otp/verify,
 * /v1/auth/refresh, plus the health endpoints.
 */

import { SetMetadata } from '@nestjs/common';

export const PUBLIC_KEY = 'jp.public';
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_KEY, true);
