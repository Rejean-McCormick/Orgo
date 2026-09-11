import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { z } from 'zod';
import { Commands, Database, recordEvent } from '../../../platform/database';
import {
  DomainError,
  ExecutionContext,
  parse,
  requirePermission,
  uuid,
} from '../../../platform/contracts';
import { OidcService } from '../../../modules/identity/oidc.service';
import { IdentityAdmin } from '../../../modules/identity/identity-admin.service';
import { Ctx, Public } from './boundary';

const secureSsoCookie = () => {
  try {
    return (
      !process.env.ORGO_PUBLIC_URL ||
      new URL(process.env.ORGO_PUBLIC_URL).protocol === 'https:'
    );
  } catch {
    return true;
  }
};
@Controller()
export class SsoController {
  constructor(
    @Inject(OidcService) private oidc: OidcService,
    @Inject(IdentityAdmin) private admin: IdentityAdmin,
    @Inject(Commands) private commands: Commands,
    @Inject(Database) private db: Database,
  ) {}
  @Public() @Get('auth/sso/config') config() {
    return {
      available: !!(
        process.env.OIDC_ISSUER &&
        process.env.OIDC_CLIENT_ID &&
        process.env.ORGO_PUBLIC_URL
      ),
      display_name: process.env.OIDC_DISPLAY_NAME?.trim() || 'SSO',
      local_login_available: true,
      identity_key: 'issuer+subject',
    };
  }
  @Public() @Post('auth/sso/start') async start(
    @Body() raw: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = parse(
      z.object({ organization: z.string().min(1).max(100) }).strict(),
      raw,
    );
    await this.admin.throttle(`sso:${req.ip ?? 'unknown'}`, 10);
    const result = await this.oidc.start(input.organization);
    const secureCookie = secureSsoCookie();
    res.cookie('orgo_sso', result.browser, {
      httpOnly: true,
      secure: secureCookie,
      sameSite: 'lax',
      path: '/api/v3/auth/sso',
      maxAge: 600000,
    });
    return { authorization_url: result.authorization_url };
  }
  @Public() @Post('auth/sso/complete') async complete(
    @Body() raw: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.admin.throttle(`sso-complete:${req.ip ?? 'unknown'}`, 10);
    const input = parse(
      z
        .object({
          state: z.string().min(40).max(100),
          code: z.string().min(1).max(4000),
        })
        .strict(),
      raw,
    );
    const cookie = req.headers.cookie
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith('orgo_sso='))
      ?.slice('orgo_sso='.length);
    const secureCookie = secureSsoCookie();
    res.clearCookie('orgo_sso', {
      httpOnly: true,
      secure: secureCookie,
      sameSite: 'lax',
      path: '/api/v3/auth/sso',
    });
    if (!cookie)
      throw new DomainError(
        'SSO_BROWSER_REQUIRED',
        'Restart SSO from this browser',
        401,
      );
    return this.oidc.complete(input.code, input.state, cookie);
  }
  @Get('identity/sso') links(@Ctx() ctx: ExecutionContext) {
    requirePermission(ctx, 'identity:manage');
    return this.db.ssoIdentity.findMany({
      where: { organization_id: ctx.organizationId },
      take: 100,
    });
  }
  @Post('identity/sso') link(
    @Ctx() ctx: ExecutionContext,
    @Body() raw: unknown,
  ) {
    requirePermission(ctx, 'identity:manage');
    const input = parse(
      z
        .object({ user_id: uuid, subject: z.string().trim().min(1).max(1000) })
        .strict(),
      raw,
    );
    const issuer = process.env.OIDC_ISSUER;
    if (!issuer)
      throw new DomainError('SSO_UNAVAILABLE', 'Configure OIDC_ISSUER', 503);
    return this.commands.run(ctx, 'sso.link', input, async (tx) => {
      if (
        !(await tx.userAccount.findFirst({
          where: { id: input.user_id, organization_id: ctx.organizationId },
        }))
      )
        throw new DomainError('NOT_FOUND', 'User not found', 404);
      const existing = await tx.ssoIdentity.findUnique({
        where: {
          organization_id_issuer_subject: {
            organization_id: ctx.organizationId,
            issuer,
            subject: input.subject,
          },
        },
      });
      if (existing) {
        if (existing.user_id === input.user_id) return existing;
        throw new DomainError(
          'SSO_IDENTITY_CONFLICT',
          'This federated identity is already linked to another user',
          409,
        );
      }
      const row = await tx.ssoIdentity.create({
        data: { organization_id: ctx.organizationId, issuer, ...input },
      });
      await recordEvent(tx, ctx, 'user', input.user_id, 'SsoIdentityLinked', {
        identity_id: row.id,
        issuer,
      });
      return row;
    });
  }
  @Delete('identity/sso/:id') unlink(
    @Ctx() ctx: ExecutionContext,
    @Param('id') raw: string,
  ) {
    requirePermission(ctx, 'identity:manage');
    const id = parse(uuid, raw);
    return this.commands.run(ctx, `sso.unlink:${id}`, {}, async (tx) => {
      const row = await tx.ssoIdentity.findFirst({
        where: { id, organization_id: ctx.organizationId },
      });
      if (!row)
        throw new DomainError('NOT_FOUND', 'SSO mapping not found', 404);
      await tx.ssoIdentity.delete({ where: { id } });
      await tx.loginSession.updateMany({
        where: { user_id: row.user_id, terminated_at: null },
        data: { terminated_at: new Date(), terminated_reason: 'forced' },
      });
      await recordEvent(tx, ctx, 'user', row.user_id, 'SsoIdentityRemoved', {
        identity_id: id,
      });
      return { removed: true };
    });
  }
}
