/**
 * AuthModule — wires every auth-related provider for DI.
 *
 * Note: JwtAuthGuard / RolesGuard / ScopeGuard are registered at the
 * APP_GUARD level in `app.module.ts` so every controller (auth + future
 * domain controllers) is protected by default; `@Public()` opts out.
 */

import { Module } from '@nestjs/common';

import { AppConfigService } from '../../core/config/app-config.service';
import { SystemConfigModule } from '../../core/system-config/system-config.module';
import { AuditModule } from '../audit/audit.module';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { ScopeGuard } from './guards/scope.guard';
import { ConsoleSmsProvider } from './providers/console-sms-provider';
import { Msg91SmsProvider } from './providers/msg91-sms-provider';
import { SMS_PROVIDER_TOKEN } from './providers/sms-provider.interface';
import { DeviceSessionService } from './services/device-session.service';
import { ImpersonationService } from './services/impersonation.service';
import { JwtService } from './services/jwt.service';
import { OtpService } from './services/otp.service';
import { TokenRotationService } from './services/token-rotation.service';
import { ViewSwitchService } from './services/view-switch.service';

@Module({
  imports: [SystemConfigModule, AuditModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtService,
    OtpService,
    TokenRotationService,
    DeviceSessionService,
    ViewSwitchService,
    ImpersonationService,

    // SMS provider — pick by env. `MSG91_AUTH_KEY` presence selects prod
    // path; everything else falls back to the console stub.
    ConsoleSmsProvider,
    Msg91SmsProvider,
    {
      provide: SMS_PROVIDER_TOKEN,
      useFactory: (
        config: AppConfigService,
        console_: ConsoleSmsProvider,
        msg91: Msg91SmsProvider,
      ) => (config.raw.MSG91_AUTH_KEY ? msg91 : console_),
      inject: [AppConfigService, ConsoleSmsProvider, Msg91SmsProvider],
    },

    // Guards as plain providers — APP_GUARD registration happens in
    // app.module.ts so we can place them once for the whole app.
    JwtAuthGuard,
    RolesGuard,
    ScopeGuard,
  ],
  exports: [
    JwtService,
    AuthService,
    JwtAuthGuard,
    RolesGuard,
    ScopeGuard,
    DeviceSessionService,
    TokenRotationService,
  ],
})
export class AuthModule {}
