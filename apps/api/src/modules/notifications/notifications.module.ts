/**
 * NotificationsModule — producer-side wiring for Step 12.
 *
 *   - In-app feed controller + service
 *   - Device-token registration controller + service
 *   - Push / SMS-notice / Email provider DI factories (Console stub in dev,
 *     real implementations when credentials are configured)
 *   - RecipientResolver — exported so the fanout worker (worker process)
 *     can DI-inject it from QueueProcessorsModule.
 *
 * The matching @Processor classes for `notifications.fanout`,
 * `notifications.push`, `notifications.sms`, and `notifications.email`
 * live under `apps/api/src/queues/processors/` and are loaded only by the
 * worker entrypoint.
 */

import { Global, Module } from '@nestjs/common';

import { AppConfigService } from '../../core/config/app-config.service';
import {
  DeviceTokensRepository,
  NotificationsRepository,
  SmsLogsRepository,
  UsersRepository,
} from '../../db/repositories';

import { DeviceTokensService } from './device-tokens.service';
import { NotificationsController } from './notifications.controller';
import { RecipientResolver } from './notifications.recipients';
import { NotificationsService } from './notifications.service';
import { ConsoleEmailProvider } from './providers/console-email.provider';
import { ConsolePushProvider } from './providers/console-push.provider';
import { ConsoleSmsNoticeProvider } from './providers/console-sms-notice.provider';
import { EMAIL_PROVIDER_TOKEN } from './providers/email-provider.interface';
import { FcmPushProvider } from './providers/fcm-push.provider';
import { Msg91SmsNoticeProvider } from './providers/msg91-sms-notice.provider';
import { PUSH_PROVIDER_TOKEN } from './providers/push-provider.interface';
import { ResendEmailProvider } from './providers/resend-email.provider';
import { SMS_NOTICE_PROVIDER_TOKEN } from './providers/sms-notice-provider.interface';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [
    // services
    NotificationsService,
    DeviceTokensService,
    RecipientResolver,

    // repos
    NotificationsRepository,
    DeviceTokensRepository,
    SmsLogsRepository,
    UsersRepository,

    // provider classes (registered so factories can inject them)
    ConsolePushProvider,
    FcmPushProvider,
    ConsoleSmsNoticeProvider,
    Msg91SmsNoticeProvider,
    ConsoleEmailProvider,
    ResendEmailProvider,

    // Push: FCM in prod when configured, Console otherwise.
    {
      provide: PUSH_PROVIDER_TOKEN,
      useFactory: (
        config: AppConfigService,
        console_: ConsolePushProvider,
        fcm: FcmPushProvider,
      ) => {
        const sa = config.notifications.fcm.serviceAccountJson;
        if (!sa) return console_;
        try {
          JSON.parse(sa);
        } catch {
          return console_;
        }
        return fcm;
      },
      inject: [AppConfigService, ConsolePushProvider, FcmPushProvider],
    },

    // SMS notice: MSG91 when both auth key + template id are set.
    {
      provide: SMS_NOTICE_PROVIDER_TOKEN,
      useFactory: (
        config: AppConfigService,
        console_: ConsoleSmsNoticeProvider,
        msg91: Msg91SmsNoticeProvider,
      ) => {
        const sms = config.notifications.sms;
        return sms.authKey && sms.noticeTemplateId ? msg91 : console_;
      },
      inject: [AppConfigService, ConsoleSmsNoticeProvider, Msg91SmsNoticeProvider],
    },

    // Email: Resend in prod when configured, Console otherwise.
    {
      provide: EMAIL_PROVIDER_TOKEN,
      useFactory: (
        config: AppConfigService,
        console_: ConsoleEmailProvider,
        resend: ResendEmailProvider,
      ) => (config.notifications.email.apiKey ? resend : console_),
      inject: [AppConfigService, ConsoleEmailProvider, ResendEmailProvider],
    },
  ],
  exports: [
    NotificationsService,
    DeviceTokensService,
    RecipientResolver,
    NotificationsRepository,
    DeviceTokensRepository,
    SmsLogsRepository,
    PUSH_PROVIDER_TOKEN,
    SMS_NOTICE_PROVIDER_TOKEN,
    EMAIL_PROVIDER_TOKEN,
  ],
})
export class NotificationsModule {}
