/**
 * NotificationsController — in-app feed + device-token endpoints.
 *
 * Routes (SPEC §6.22 + Step 12 prompt):
 *   GET    /v1/notifications?cursor=&limit=20
 *   POST   /v1/notifications/:id/read
 *   POST   /v1/notifications/read-all
 *   GET    /v1/notifications/unread-count
 *   PATCH  /v1/users/me/notification-preferences
 *   POST   /v1/device-tokens
 *   DELETE /v1/device-tokens/:id
 *
 * Everything except device-token registration runs through the global
 * JwtAuthGuard. Device tokens are registered post-login — the JWT we
 * just minted already authenticates the caller.
 */

import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { AppError, ERROR_CODES, notificationPreferencesSchema } from '@jp/shared';

import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { DrizzleService } from '../../core/database/drizzle.service';
import { UsersRepository } from '../../db/repositories';
import { users as usersTable } from '../../db/schema';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';

import { DeviceTokensService } from './device-tokens.service';
import { NotificationsService } from './notifications.service';

const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  only_unread: z
    .union([z.literal('1'), z.literal('0'), z.literal('true'), z.literal('false')])
    .transform((v) => v === '1' || v === 'true')
    .optional(),
});

const registerDeviceTokenSchema = z.object({
  platform: z.enum(['ios', 'android', 'web']),
  token: z.string().min(8).max(4096),
  device_id: z.string().min(1).max(128).optional(),
});

@Controller('/v1')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly deviceTokens: DeviceTokensService,
    private readonly users: UsersRepository,
    private readonly drizzle: DrizzleService,
  ) {}

  private requireUser(user: CurrentUserPayload | undefined): CurrentUserPayload {
    if (!user) {
      throw new AppError({
        code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
        message: 'Not authenticated',
        statusCode: 401,
      });
    }
    return user;
  }

  // -- GET /v1/notifications --------------------------------------------
  @Get('/notifications')
  async list(@Query() query: unknown, @CurrentUser() user: CurrentUserPayload | undefined) {
    const u = this.requireUser(user);
    const parsed = listQuerySchema.parse(query);
    const result = await this.notifications.list(u.sub, parsed);
    return {
      items: result.items.map(toFeedItem),
      next_cursor: result.next_cursor,
    };
  }

  // -- POST /v1/notifications/:id/read ----------------------------------
  @Post('/notifications/:id/read')
  @HttpCode(200)
  async markRead(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload | undefined) {
    const u = this.requireUser(user);
    const row = await this.notifications.markRead(u.sub, id);
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Notification not found',
        statusCode: 404,
      });
    }
    return { notification: toFeedItem(row) };
  }

  // -- POST /v1/notifications/read-all ----------------------------------
  @Post('/notifications/read-all')
  @HttpCode(200)
  async markAllRead(@CurrentUser() user: CurrentUserPayload | undefined) {
    const u = this.requireUser(user);
    const count = await this.notifications.markAllRead(u.sub);
    return { marked_read: count };
  }

  // -- GET /v1/notifications/unread-count -------------------------------
  @Get('/notifications/unread-count')
  async unreadCount(@CurrentUser() user: CurrentUserPayload | undefined) {
    const u = this.requireUser(user);
    return { unread_count: await this.notifications.unreadCount(u.sub) };
  }

  // -- PATCH /v1/users/me/notification-preferences ----------------------
  @Patch('/users/me/notification-preferences')
  @HttpCode(200)
  async updatePreferences(
    @Body(new ZodValidationPipe(notificationPreferencesSchema.partial()))
    body: Partial<z.infer<typeof notificationPreferencesSchema>>,
    @CurrentUser() user: CurrentUserPayload | undefined,
  ) {
    const u = this.requireUser(user);
    const row = await this.users.findById(u.sub);
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'User not found',
        statusCode: 404,
      });
    }
    const current = row.notification_preferences ?? {
      push: true,
      sms: true,
      email: true,
      in_app: true,
    };
    const next = { ...current, ...body };
    await this.drizzle.db
      .update(usersTable)
      .set({ notification_preferences: next, updated_at: new Date(), updated_by: u.sub })
      .where(eq(usersTable.id, u.sub));
    return { notification_preferences: next };
  }

  // -- POST /v1/device-tokens -------------------------------------------
  @Post('/device-tokens')
  @HttpCode(201)
  async registerDeviceToken(
    @Body(new ZodValidationPipe(registerDeviceTokenSchema))
    body: z.infer<typeof registerDeviceTokenSchema>,
    @CurrentUser() user: CurrentUserPayload | undefined,
  ) {
    const u = this.requireUser(user);
    const row = await this.deviceTokens.register({
      user_id: u.sub,
      platform: body.platform,
      token: body.token,
      ...(body.device_id ? { device_id: body.device_id } : {}),
    });
    return {
      device_token: {
        id: row.id,
        platform: row.platform,
        last_seen_at: row.last_seen_at,
      },
    };
  }

  // -- DELETE /v1/device-tokens/:id -------------------------------------
  @Delete('/device-tokens/:id')
  @HttpCode(204)
  async deleteDeviceToken(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload | undefined,
  ): Promise<void> {
    const u = this.requireUser(user);
    const ok = await this.deviceTokens.deleteById(u.sub, id);
    if (!ok) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Device token not found',
        statusCode: 404,
      });
    }
  }
}

function toFeedItem(row: {
  id: string;
  kind: string;
  title_en: string;
  title_hi: string;
  body_en: string;
  body_hi: string;
  data: unknown;
  is_read: boolean;
  channel: string;
  status: string;
  source_entity_kind: string | null;
  source_entity_id: string | null;
  created_at: Date;
}) {
  return {
    id: row.id,
    kind: row.kind,
    title_en: row.title_en,
    title_hi: row.title_hi,
    body_en: row.body_en,
    body_hi: row.body_hi,
    data: row.data ?? null,
    is_read: row.is_read,
    channel: row.channel,
    status: row.status,
    source_entity_kind: row.source_entity_kind,
    source_entity_id: row.source_entity_id,
    created_at: row.created_at.toISOString(),
  };
}
