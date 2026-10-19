import { IdentityAdmin } from '../../../modules/identity/identity-admin.service';
import { Inject } from '@nestjs/common';
import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { z } from 'zod';
import {
  DomainError,
  ExecutionContext,
  parse,
} from '../../../platform/contracts';
import { IdentityService } from '../../../modules/identity/identity.service';
import { localLoginAllowed, localAutoLoginAllowedForTenant } from '../../../modules/identity/tandem-sso-policy';
import { localAutoLoginAllowed } from '../../../modules/identity/local-autologin-policy';
import {
  Ctx,
  ORGO_SESSION_COOKIE,
  Public,
  sessionCookieOptions,
  sessionToken,
} from './boundary';


@Controller('auth')
export class AuthController {
  constructor(
    @Inject(IdentityAdmin) private readonly admin: IdentityAdmin,
    @Inject(IdentityService) private readonly identity: IdentityService,
  ) {}
  @Public()
  @Post('login')
  async login(
    @Body() raw: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = parse(
      z
        .object({
          organization: z.string().min(1).max(100),
          email: z.string().email().max(300),
          password: z.string().min(1).max(200),
        })
        .strict(),
      raw,
    );
    await this.admin.throttle(`login:${req.ip ?? 'unknown'}`, 10, 60);
    if (!localLoginAllowed(input.organization, input.email))
      throw new DomainError('SSO_REQUIRED', 'Sign in with the shared identity provider for this organization', 403);
    const result = await this.identity.login(
      input.organization,
      input.email,
      input.password,
    );
    res.cookie(ORGO_SESSION_COOKIE, result.token, sessionCookieOptions());
    return result;
  }
  @Public()
  @Post('local-auto-login')
  async localAutoLogin(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!localAutoLoginAllowed(process.env, req.socket.remoteAddress))
      throw new DomainError('NOT_FOUND', 'Local auto-login is disabled', 404);
    const organization = process.env.ORGO_ORGANIZATION?.trim() || 'orgo';
    if (!localAutoLoginAllowedForTenant(organization))
      throw new DomainError('NOT_FOUND', 'Local auto-login is unavailable in tandem SSO mode', 404);
    const email = process.env.ORGO_ADMIN_EMAIL?.trim() || 'admin@example.test';
    const result = await this.identity.localSession(organization, email);
    res.cookie(ORGO_SESSION_COOKIE, result.token, sessionCookieOptions());
    return { expires_at: result.expires_at, context: result.context };
  }
  @Get('me') me(@Ctx() ctx: ExecutionContext) {
    return ctx;
  }
  @Post('logout')
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = sessionToken(req);
    if (token) await this.identity.logout(token);
    res.clearCookie(ORGO_SESSION_COOKIE, {
      httpOnly: true,
      sameSite: 'lax',
      secure: sessionCookieOptions().secure,
      path: '/',
    });
    return { logged_out: true };
  }
}
