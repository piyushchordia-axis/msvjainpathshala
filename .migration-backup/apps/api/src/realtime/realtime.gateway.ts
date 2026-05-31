/**
 * RealtimeGateway — Socket.IO server with JWT auth + Redis adapter.
 *
 * Boots only when `SOCKETIO_ENABLED=true` (default in dev) and the HTTP
 * server is started (`Realtime.attach(httpServer)` happens in src/main.ts
 * after Nest creates the listener).
 *
 * Multi-instance support: `@socket.io/redis-adapter` so a notice
 * emitted on task A reaches a client connected to task B. Pub/sub uses
 * the dedicated `socketIoAdapterClient` + `socketIoAdapterSubClient`
 * pair on RedisService — sharing with bullmq's connection would
 * deadlock (CLAUDE.md "Common pitfalls" note).
 *
 * Auth: client sends `{ auth: { token } }` on connect — we verify the
 * RS256 JWT and bounce the connection on failure. The verified user is
 * attached to `socket.data.user` for downstream room joins.
 *
 * Namespaces are wired via `namespace(/regex/)` so dynamic ids
 * (`/shivirs/abc-123`) work — Socket.IO matches against the regex and
 * the matched id is available via `socket.nsp.name`.
 */

import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server, type Namespace, type Socket } from 'socket.io';

import { AppConfigService } from '../core/config/app-config.service';
import { RedisService } from '../core/redis/redis.service';
import { JwtService } from '../modules/auth/services/jwt.service';

import { NAMESPACES, type AdminDashboardActivity, type RealtimeEnvelope } from './realtime.types';

import type { Server as HttpServer } from 'node:http';

interface AttachedSocket extends Socket {
  data: {
    user?: {
      sub: string;
      role: string;
      city_id?: string;
    };
  };
}

@Injectable()
export class RealtimeGateway implements OnApplicationShutdown {
  private readonly logger = new Logger(RealtimeGateway.name);
  private io: Server | null = null;

  constructor(
    private readonly config: AppConfigService,
    private readonly redis: RedisService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Wire up Socket.IO on the given HTTP server. Idempotent — safe to call
   * from src/main.ts after `app.listen()`.
   */
  attach(httpServer: HttpServer): void {
    if (!this.config.socketio.enabled) {
      this.logger.log('Socket.IO disabled by config — skipping attach()');
      return;
    }
    if (this.io) return;

    const explicit = new Set(this.config.socketio.corsOrigins);
    const isDev = this.config.isDevelopment;
    const corsOrigin = (
      origin: string | undefined,
      cb: (err: Error | null, allow?: boolean) => void,
    ): void => {
      if (!origin) return cb(null, true);
      if (explicit.has(origin)) return cb(null, true);
      if (isDev) {
        try {
          const u = new URL(origin);
          if (
            u.hostname === 'localhost' ||
            u.hostname === '127.0.0.1' ||
            u.hostname === '0.0.0.0'
          ) {
            return cb(null, true);
          }
        } catch {
          // fall through to reject
        }
      }
      return cb(null, false);
    };

    this.io = new Server(httpServer, {
      cors: { origin: corsOrigin, credentials: true },
      transports: ['websocket', 'polling'],
    });

    // Multi-instance Redis adapter (SPEC §9.3, CLAUDE.md "Socket.IO without
    // Redis adapter in multi-task deploy").
    this.io.adapter(
      createAdapter(this.redis.socketIoAdapterClient, this.redis.socketIoAdapterSubClient),
    );

    // Dynamic namespaces — match `/shivirs/<id>`, `/push-quizzes/<id>`,
    // `/admin-dashboard/<scope>`. The auth + room-join logic is shared
    // across all three (the body of `bindNamespace`).
    this.bindNamespace(/^\/shivirs\/[\w-]+$/);
    this.bindNamespace(/^\/push-quizzes\/[\w-]+$/);
    this.bindNamespace(/^\/admin-dashboard\/[\w-]+$/);

    this.logger.log(
      'Socket.IO ready (namespaces: /shivirs/:id, /push-quizzes/:id, /admin-dashboard/:scope)',
    );
  }

  private bindNamespace(pattern: RegExp): Namespace {
    const nsp = this.io!.of(pattern);
    nsp.use(async (socket, next) => {
      try {
        const token = (socket.handshake.auth?.['token'] as string | undefined) ?? '';
        if (!token) {
          return next(new Error('Missing auth token'));
        }
        const claims = await this.jwt.verifyAccess(token);
        // /admin-dashboard/:scope is super_admin / state_admin / city_admin only.
        const nsName = socket.nsp.name;
        if (nsName.startsWith('/admin-dashboard/')) {
          const allowed = ['super_admin', 'state_admin', 'city_admin'];
          if (!allowed.includes(claims.role)) {
            return next(new Error('Forbidden for this namespace'));
          }
        }
        (socket as AttachedSocket).data.user = {
          sub: claims.sub,
          role: claims.role,
          ...(claims.scope?.city_id ? { city_id: claims.scope.city_id } : {}),
        };
        next();
      } catch (err) {
        next(err instanceof Error ? err : new Error('Auth failed'));
      }
    });
    nsp.on('connection', (socket) => {
      const a = socket as AttachedSocket;
      this.logger.log(`socket connected ns=${socket.nsp.name} user=${a.data.user?.sub ?? '?'}`);
      socket.on('disconnect', (reason) => {
        this.logger.log(`socket disconnected ns=${socket.nsp.name} reason=${reason}`);
      });
    });
    return nsp;
  }

  /** Used by domain modules to push live updates to admin dashboards. */
  emitToAdminDashboard(cityId: string, activity: AdminDashboardActivity): void {
    if (!this.io) return;
    const envelope: RealtimeEnvelope<AdminDashboardActivity> = {
      event: activity.event,
      emitted_at: new Date().toISOString(),
      data: activity,
    };
    this.io.of(`${NAMESPACES.ADMIN_DASHBOARD}/${cityId}`).emit('activity', envelope);
  }

  /** Generic emit helper for namespaces. */
  emit<T>(namespacePath: string, event: string, data: T): void {
    if (!this.io) return;
    const envelope: RealtimeEnvelope<T> = {
      event,
      emitted_at: new Date().toISOString(),
      data,
    };
    this.io.of(namespacePath).emit(event, envelope);
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.io) return;
    await new Promise<void>((resolve) => this.io!.close(() => resolve()));
    this.io = null;
  }
}
