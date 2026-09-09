import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { RbacModule } from '../../backbone/rbac/rbac.module';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { AuthGuard } from './auth.guard';

/**
 * AuthModule
 *
 * Responsibilities:
 *  - Configure JWT- and Passport-based authentication.
 *  - Expose AuthService for validating credentials and tokens.
 *  - Register JwtStrategy for attaching user/org context to requests.
 *  - Integrate with RBAC (RbacModule) for permission checks.
 */
@Module({
  imports: [
    // Make environment/config available (ENVIRONMENT, secrets, etc.).
    ConfigModule,

    // Configure Passport to use JWT as the default strategy.
    PassportModule.register({
      defaultStrategy: 'jwt',
      session: false,
      property: 'user', // request.user
    }),

    // JWT configuration is driven by env/config via ConfigService.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService): JwtModuleOptions => {
        const secret =
          config.get<string>('ORGO_JWT_SECRET') ||
          config.get<string>('security.jwt.secret') ||
          'change-me-in-prod';

        const expiresInEnv =
          config.get<string | number>('ORGO_ACCESS_TOKEN_TTL_SECONDS') ||
          config.get<string | number>('security.jwt.accessTokenTtlSeconds') ||
          3600;

        // Ensure expiresIn is a number or string acceptable to @nestjs/jwt
        const expiresIn =
          typeof expiresInEnv === 'number'
            ? expiresInEnv
            : parseInt(String(expiresInEnv), 10) || 3600;

        return {
          secret,
          signOptions: {
            expiresIn,
          },
        };
      },
    }),

    // RBAC services (role/permission checks).
    RbacModule,
  ],
  providers: [
    AuthService,
    JwtStrategy,
    AuthGuard,
  ],
  exports: [
    AuthService,
    JwtModule,
    PassportModule,
    AuthGuard,
  ],
})
export class AuthModule {}
