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
   * Verify the OTP. The verify body is `{phone, code, device}` — the backend
   * controller (auth.controller.ts otpVerifySendShape) resolves the active
   * attempt by phone, not by otp_token. The shared schema in @jp/shared has
   * an aspirational otp_token-binding version, but that's not the one wired
   * up; the controller's local schema is the source of truth.
   */
  async otpVerify(input: {
    phone: string;
    code: string;
    device_id: string;
    platform: 'ios' | 'android' | 'web';
  }): Promise<OtpVerifyResponse> {
    return unwrap<OtpVerifyResponse>(
      api.post('/v1/auth/otp/verify', {
        phone: input.phone,
        code: input.code,
        device: { device_id: input.device_id, platform: input.platform },
      }),
    );
  },

  async refresh(refreshToken: string): Promise<AuthTokens> {
    return unwrap<AuthTokens>(api.post('/v1/auth/refresh', { refresh_token: refreshToken }));
  },

  async me(): Promise<{ user: AuthUser }> {
    return unwrap<{ user: AuthUser }>(api.get('/v1/auth/me'));
  },

  async updateMe(patch: { preferred_language?: 'en' | 'hi' }): Promise<{ user: AuthUser }> {
    return unwrap<{ user: AuthUser }>(api.patch('/v1/auth/me', patch));
  },

  async logout(): Promise<void> {
    await api.post('/v1/auth/logout').catch(() => undefined);
    await authStore.logout();
  },

  async switchView(target: 'parent' | 'student', studentId?: string): Promise<OtpVerifyResponse> {
    return unwrap<OtpVerifyResponse>(
      api.post('/v1/auth/switch-view', studentId ? { target, student_id: studentId } : { target }),
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
