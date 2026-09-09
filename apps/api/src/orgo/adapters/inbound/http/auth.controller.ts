import { IdentityAdmin } from '../../../modules/identity/identity-admin.service';
import { Inject } from '@nestjs/common';
import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import {
  DomainError,
  ExecutionContext,
  parse,
} from '../../../platform/contracts';
import { IdentityService } from '../../../modules/identity/identity.service';
import { Ctx, Public } from './boundary';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(IdentityAdmin) private readonly admin: IdentityAdmin,
    @Inject(IdentityService) private readonly identity: IdentityService,
  ) {}
  @Public()
  @Post('login')
  async login(@Body() raw: unknown, @Req() req: Request) {
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
    return this.identity.login(input.organization, input.email, input.password);
  }
  @Get('me') me(@Ctx() ctx: ExecutionContext) {
    return ctx;
  }
  @Post('logout') logout(@Req() req: Request) {
    return this.identity.logout(req.headers.authorization!.slice(7));
  }
}
