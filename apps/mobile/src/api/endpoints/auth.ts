/**
 * Auth endpoint wrappers.
 *
 * Shapes match the backend controllers from Step 5 and the new
 * PATCH /v1/auth/me from Step 8. `verifyOtpAndIssue` returns the canonical
 * `{ user, tokens, default_view_context? }` shape; everything else mirrors
 * the GET /v1/auth/me payload.
 */

import { authStore } from '@/storage/stores/auth.store';

import { api, setRefreshHandler, unwrap } from '../client';

import type { Role } from '@jp/shared';

export interface AuthUser {
  id: string;
  phone: string;
  role: Role;
  full_name: string;
  preferred_language: 'en' | 'hi';
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  access_expires_at: string;
  refresh_expires_at: string;
}

export interface OtpSendResponse {
  otp_token: string;
  expires_in_seconds: number;
}

export interface OtpVerifyResponse {
  user: AuthUser;
  tokens: AuthTokens;
  default_view_context?: 'parent';
}

export const authApi = {
  async otpSend(phone: string): Promise<OtpSendResponse> {
    return unwrap<OtpSendResponse>(api.post('/v1/auth/otp/send', { phone }));
  },

  /**
   * Verify the OTP. The verify body is `{otp_token, code, device}` matching
   * the single shared `otpVerifySchema` from `@jp/shared` — the backend
   * resolves the phone via the opaque token issued by /otp/send and matches
   * the code against the Redis-stored hash (SPEC §7.1 step 2).
   */
  async otpVerify(input: {
    otp_token: string;
    code: string;
    device_id: string;
    platform: 'ios' | 'android' | 'web';
  }): Promise<OtpVerifyResponse> {
    return unwrap<OtpVerifyResponse>(
      api.post('/v1/auth/otp/verify', {
        otp_token: input.otp_token,
        code: input.code,
        device: { device_id: input.device_id, platform: input.platform },
      }),
    );
  },

  async refresh(refreshToken: string): Promise<AuthTokens> {
    return unwrap<AuthTokens>(api.post('/v1/auth/refresh', { refresh_token: refreshToken }));
  },

  /**
   * GET /v1/auth/me returns the user fields FLAT inside `data` (id, phone,
   * role, full_name, preferred_language, view_context, scope, …) — NOT
   * nested under a `user` key. The web client and the controller's
   * integration tests both expect the flat shape. Earlier wrapper code
   * deconstructed `{ user }` and silently received `undefined`.
   */
  async me(): Promise<AuthUser> {
    return unwrap<AuthUser>(api.get('/v1/auth/me'));
  },

  /** PATCH /v1/auth/me returns `{ user: {...} }` — different from GET. */
  async updateMe(patch: { preferred_language?: 'en' | 'hi' }): Promise<{ user: AuthUser }> {
    return unwrap<{ user: AuthUser }>(api.patch('/v1/auth/me', patch));
  },

  async logout(): Promise<void> {
    // Send an explicit empty body — `logoutSchema` is `z.object({...})` and
    // some Nest pipe configurations reject `undefined` rather than coercing
    // it to `{}`.
    await api.post('/v1/auth/logout', {}).catch(() => undefined);
    await authStore.logout();
  },

  /**
   * The backend's `switchViewSchema` (packages/shared/src/schemas/auth.ts)
   * uses `view_context`, not `target`. An older wrapper sent `target` and
   * was 422'd on every call.
   */
  async switchView(
    viewContext: 'parent' | 'student',
    studentId?: string,
  ): Promise<OtpVerifyResponse> {
    return unwrap<OtpVerifyResponse>(
      api.post(
        '/v1/auth/switch-view',
        studentId
          ? { view_context: viewContext, student_id: studentId }
          : { view_context: viewContext },
      ),
    );
  },
};

// ---- Wire single-flight refresh into the client ---------------------------
setRefreshHandler(async () => {
  const refresh = await authStore.getRefreshToken();
  if (!refresh) {
    throw new Error('no refresh token');
  }
  const tokens = await authApi.refresh(refresh);
  authStore.setAccessToken(tokens.access_token);
  await authStore.setRefreshToken(tokens.refresh_token);
  const snap = authStore.getSnapshot();
  if (snap) {
    authStore.setSnapshot({
      ...snap,
      access_expires_at: tokens.access_expires_at,
      refresh_expires_at: tokens.refresh_expires_at,
    });
  }
  return tokens.access_token;
});
