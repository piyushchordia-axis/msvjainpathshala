/**
 * DonationsController — SPEC §6.21 + Step 21.
 *
 *   Public / donor-facing
 *     POST /v1/donations/initiate                any (jwt optional)
 *     POST /v1/donations/verify                  any (jwt optional)
 *     POST /v1/donations/webhook                 Razorpay-signed
 *     GET  /v1/donations/me                      jwt (donor history)
 *     GET  /v1/donations/campaigns               public listing
 *
 *   Admin
 *     GET  /v1/admin/donations                   super_admin, city_admin
 *     POST /v1/admin/donation-campaigns          super_admin, city_admin
 *     PATCH /v1/admin/platform-settings/80g      super_admin
 *     GET  /v1/admin/platform-settings           super_admin
 *
 * The webhook endpoint is `@Public()` so JWT bypass; signature verification
 * happens inside the service. Idempotent on `event_id` via
 * `donation_webhook_events`.
 */

import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { z } from 'zod';

import { AppError, ERROR_CODES } from '@jp/shared';

import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { DonationsRepository } from '../../db/repositories/donations.repository';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

import { DonationsService } from './donations.service';
import { PlatformSettingsService } from './platform-settings.service';

const createOrderSchema = z.object({
  amount_paise: z.number().int().min(100).max(10_00_00_000),
  currency: z.string().length(3).default('INR'),
  purpose: z.enum(['general', 'shivir', 'scholarship', 'infrastructure']),
  campaign_id: z.string().uuid().nullable().optional(),
  frequency: z.enum(['one_time', 'recurring']).default('one_time'),
  donor: z.object({
    name: z.string().min(1).max(200),
    email: z.string().email().nullable().optional(),
    phone: z
      .string()
      .regex(/^\+\d{8,15}$/, 'phone must be E.164 (+91…)')
      .nullable()
      .optional(),
    pan: z
      .string()
      .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'PAN must be 5 letters + 4 digits + 1 letter')
      .nullable()
      .optional(),
  }),
  notes: z.string().max(500).nullable().optional(),
});

const verifySchema = z.object({
  razorpay_order_id: z.string().min(4),
  razorpay_payment_id: z.string().min(4),
  razorpay_signature: z.string().min(4),
});

const webhookSchema = z.object({
  event: z.string().min(1),
  event_id: z.string().min(1).optional(),
  payload: z
    .object({
      payment: z
        .object({
          entity: z
            .object({
              id: z.string(),
              order_id: z.string(),
              amount: z.number().int(),
              created_at: z.number().int().optional(),
            })
            .passthrough(),
        })
        .passthrough()
        .optional(),
    })
    .passthrough(),
  created_at: z.number().int().optional(),
});

const createCampaignSchema = z.object({
  name: z.string().min(2).max(180),
  description: z.string().max(2000).nullable().optional(),
  city_id: z.string().uuid().nullable().optional(),
  target_amount_paise: z.number().int().min(0).nullable().optional(),
  starts_at: z.string().datetime().nullable().optional(),
  ends_at: z.string().datetime().nullable().optional(),
  is_public: z.boolean().default(true),
  progress_bar_visible: z.boolean().default(true),
});

const eightyGToggleSchema = z
  .object({
    enabled: z.boolean(),
    eighty_g_registration_number: z.string().max(50).nullable().optional(),
    eighty_g_trust_name: z.string().max(200).nullable().optional(),
    eighty_g_trust_address: z.string().max(500).nullable().optional(),
    eighty_g_section: z.string().max(10).optional(),
  })
  .superRefine((val, ctx) => {
    if (
      val.enabled &&
      (!val.eighty_g_registration_number || !val.eighty_g_trust_name || !val.eighty_g_trust_address)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Enabling 80G requires registration_number, trust_name, and trust_address (CLAUDE.md Q3)',
      });
    }
  });

@Controller('/v1')
export class DonationsController {
  private readonly logger = new Logger(DonationsController.name);

  constructor(
    private readonly donations: DonationsService,
    private readonly settings: PlatformSettingsService,
    private readonly repo: DonationsRepository,
  ) {}

  // ===========================================================================
  // Donor-facing
  // ===========================================================================

  @Public()
  @Post('/donations/initiate')
  @HttpCode(201)
  async initiate(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Body(new ZodValidationPipe(createOrderSchema)) body: z.infer<typeof createOrderSchema>,
    @Req() req: { ip?: string },
  ) {
    return this.donations.createOrder(
      { user_id: user?.sub, role: user?.role, ip: req.ip ?? null },
      body,
    );
  }

  @Public()
  @Post('/donations/verify')
  @HttpCode(200)
  async verify(@Body(new ZodValidationPipe(verifySchema)) body: z.infer<typeof verifySchema>) {
    return this.donations.verifyAndCapture({
      order_id: body.razorpay_order_id,
      payment_id: body.razorpay_payment_id,
      signature: body.razorpay_signature,
    });
  }

  @Public()
  @Post('/donations/webhook')
  @HttpCode(200)
  async webhook(
    @Req() req: { rawBody?: Buffer; body?: unknown },
    @Headers('x-razorpay-signature') signatureHeader: string,
    @Body(new ZodValidationPipe(webhookSchema)) body: z.infer<typeof webhookSchema>,
  ) {
    if (!signatureHeader) {
      throw new AppError({
        code: ERROR_CODES.ERR_DONATION_WEBHOOK_SIGNATURE,
        message: 'Missing x-razorpay-signature',
        statusCode: 401,
      });
    }
    const rawBody = req.rawBody?.toString('utf8') ?? JSON.stringify(req.body ?? body);
    const eventId = body.event_id ?? `${body.event}:${body.created_at ?? Date.now()}`;
    return this.donations.handleWebhook(rawBody, signatureHeader, {
      event_id: eventId,
      event_type: body.event,
      payload: body.payload as {
        payment?: {
          entity?: { id: string; order_id: string; amount: number; created_at?: number };
        };
      },
    });
  }

  // Alias the SPEC path:
  @Public()
  @Post('/webhooks/razorpay')
  @HttpCode(200)
  async webhookAlias(
    @Req() req: { rawBody?: Buffer; body?: unknown },
    @Headers('x-razorpay-signature') signatureHeader: string,
    @Body(new ZodValidationPipe(webhookSchema)) body: z.infer<typeof webhookSchema>,
  ) {
    return this.webhook(req, signatureHeader, body);
  }

  @Get('/donations/me')
  async listMine(@CurrentUser() user: CurrentUserPayload | undefined) {
    if (!user) {
      throw new AppError({
        code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
        message: 'Not authenticated',
        statusCode: 401,
      });
    }
    const items = await this.donations.listForDonor(user.sub);
    return { items };
  }

  @Public()
  @Get('/donations/campaigns')
  async listCampaigns(@Query('limit') limit?: string) {
    const n = Math.max(1, Math.min(50, Number(limit) || 20));
    const items = await this.repo.listPublicCampaigns(n);
    return { items };
  }

  // ===========================================================================
  // Admin
  // ===========================================================================

  @Roles('city_admin')
  @Get('/admin/donations')
  async adminList(@Query('status') status?: string) {
    const items = await this.repo.listForAdmin(
      status === 'created' || status === 'captured' || status === 'failed' || status === 'refunded'
        ? { status }
        : {},
    );
    return { items };
  }

  @Roles('city_admin')
  @Post('/admin/donation-campaigns')
  @HttpCode(201)
  async adminCreateCampaign(
    @CurrentUser() _user: CurrentUserPayload | undefined,
    @Body(new ZodValidationPipe(createCampaignSchema))
    body: z.infer<typeof createCampaignSchema>,
  ) {
    const created = await this.repo.createCampaign({
      name: body.name,
      description: body.description ?? null,
      city_id: body.city_id ?? null,
      target_amount_paise: body.target_amount_paise ?? null,
      starts_at: body.starts_at ? new Date(body.starts_at) : null,
      ends_at: body.ends_at ? new Date(body.ends_at) : null,
      is_public: body.is_public,
      progress_bar_visible: body.progress_bar_visible,
    });
    return created;
  }

  // ----- Platform settings ----------------------------------------------
  @Roles('super_admin')
  @Get('/admin/platform-settings')
  async getSettings() {
    return this.settings.get();
  }

  @Roles('super_admin')
  @Patch('/admin/platform-settings/80g')
  @HttpCode(200)
  async patch80g(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Body(new ZodValidationPipe(eightyGToggleSchema)) body: z.infer<typeof eightyGToggleSchema>,
  ) {
    if (!user) {
      throw new AppError({
        code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
        message: 'Not authenticated',
        statusCode: 401,
      });
    }
    return this.settings.update(
      { user_id: user.sub, role: user.role },
      {
        eighty_g_enabled: body.enabled,
        eighty_g_registration_number: body.eighty_g_registration_number,
        eighty_g_trust_name: body.eighty_g_trust_name,
        eighty_g_trust_address: body.eighty_g_trust_address,
        eighty_g_section: body.eighty_g_section,
      },
    );
  }

  // Admin can also look up a specific donation
  @Roles('city_admin')
  @Get('/admin/donations/:id')
  async adminGet(@Param('id') id: string) {
    return this.donations.getById(id);
  }
}
