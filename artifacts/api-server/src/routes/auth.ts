import { Router, type IRouter, type Request, type Response } from 'express';
import { z } from 'zod';

const router: IRouter = Router();

const API_BASE = process.env.INTERNAL_API_BASE_URL ?? 'http://localhost:3001';

const sendBodySchema = z.object({
  phase: z.literal('send'),
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/, 'Phone must be E.164 (+91…)'),
});

const verifyBodySchema = z.object({
  phase: z.literal('verify'),
  otp_token: z.string().min(16),
  code: z.string().length(6).regex(/^\d{6}$/),
  device_id: z.string().min(1).max(128),
});

const requestBodySchema = z.discriminatedUnion('phase', [sendBodySchema, verifyBodySchema]);

function proxyError(err: unknown, res: Response): void {
  const code = (err as { code?: string }).code ?? 'ERR_INTERNAL';
  const message = err instanceof Error ? err.message : 'Internal error';
  res.status(500).json({ error: { code, message } });
}

async function backendFetch(path: string, body: unknown): Promise<{ status: number; data: unknown; headers: Headers }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, headers: res.headers };
}

router.post('/login', async (req: Request, res: Response) => {
  let parsed: z.infer<typeof requestBodySchema>;
  try {
    parsed = requestBodySchema.parse(req.body);
  } catch (err) {
    const msg =
      err instanceof z.ZodError
        ? (err.errors[0]?.message ?? 'Invalid body')
        : 'Invalid body';
    res.status(422).json({ error: { code: 'ERR_VALIDATION_FAILED', message: msg } });
    return;
  }

  try {
    if (parsed.phase === 'send') {
      const { status, data } = await backendFetch('/v1/auth/otp/send', { phone: parsed.phone });
      res.status(status).json(data);
      return;
    }

    const { status, data, headers } = await backendFetch('/v1/auth/otp/verify', {
      otp_token: parsed.otp_token,
      code: parsed.code,
      device_id: parsed.device_id,
      platform: 'web',
    });

    if (status >= 200 && status < 300) {
      const payload = data as {
        data?: {
          tokens?: {
            access_token?: string;
            refresh_token?: string;
            access_expires_at?: string;
            refresh_expires_at?: string;
          };
          user?: Record<string, unknown>;
        };
      };
      const tokens = payload?.data?.tokens;
      const user = payload?.data?.user;

      if (tokens?.access_token) {
        const accessExp = tokens.access_expires_at
          ? new Date(tokens.access_expires_at)
          : new Date(Date.now() + 15 * 60 * 1000);
        const refreshExp = tokens.refresh_expires_at
          ? new Date(tokens.refresh_expires_at)
          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        res.cookie('jp_access', tokens.access_token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          expires: accessExp,
          path: '/',
        });

        if (tokens.refresh_token) {
          res.cookie('jp_refresh', tokens.refresh_token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            expires: refreshExp,
            path: '/',
          });
        }

        if (user) {
          res.cookie('jp_user', JSON.stringify(user), {
            httpOnly: false,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            expires: refreshExp,
            path: '/',
          });
        }
      }
    }

    res.status(status).json(data);
  } catch (err) {
    proxyError(err, res);
  }
});

async function handleLogout(req: Request, res: Response): Promise<void> {
  const accessToken = req.cookies?.jp_access;

  if (accessToken) {
    await fetch(`${API_BASE}/v1/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    }).catch(() => undefined);
  }

  for (const name of ['jp_access', 'jp_refresh', 'jp_user', 'jp_imp_active', 'jp_imp_origin_name']) {
    res.clearCookie(name, { path: '/' });
  }

  res.status(204).end();
}

router.post('/logout', handleLogout);
router.delete('/logout', handleLogout);

export default router;
