import { Inject } from '@nestjs/common';
import {
  ArgumentsHost,
  CallHandler,
  CanActivate,
  Catch,
  createParamDecorator,
  ExceptionFilter,
  ExecutionContext as NestContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
  HttpException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { Observable, map } from 'rxjs';
import { DomainError, ExecutionContext } from '../../../platform/contracts';
import { IdentityService } from '../../../modules/identity/identity.service';

export const Public = () => SetMetadata('orgo.public', true);
export type ContextRequest = Request & { orgoContext?: ExecutionContext };
export const ORGO_SESSION_COOKIE = 'orgo_session';
export function sessionCookieOptions() {
  const publicUrl = process.env.ORGO_PUBLIC_URL?.trim() ?? '';
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: publicUrl.startsWith('https://'),
    path: '/',
    maxAge: 8 * 3600 * 1000,
  };
}
export function sessionToken(req: Request): string | undefined {
  const authorization = req.headers.authorization;
  if (authorization?.startsWith('Bearer ') && authorization.length <= 500)
    return authorization.slice(7);
  const raw = req.headers.cookie ?? '';
  for (const part of raw.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === ORGO_SESSION_COOKIE) {
      const value = rest.join('=');
      return value ? decodeURIComponent(value) : undefined;
    }
  }
  return undefined;
}
export const Ctx = createParamDecorator(
  (_data: unknown, host: NestContext) =>
    host.switchToHttp().getRequest<ContextRequest>().orgoContext,
);
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(IdentityService) private readonly identity: IdentityService,
  ) {}
  async canActivate(host: NestContext) {
    if (
      this.reflector.getAllAndOverride<boolean>('orgo.public', [
        host.getHandler(),
        host.getClass(),
      ])
    )
      return true;
    const req = host.switchToHttp().getRequest<ContextRequest>();
    const token = sessionToken(req);
    if (!token)
      throw new DomainError('UNAUTHENTICATED', 'Authentication required', 401);
    req.orgoContext = await this.identity.authenticate(token, {
      organization: req.get('X-Organization-ID'),
      correlation: req.get('X-Correlation-ID'),
      idempotency: req.get('Idempotency-Key'),
    });
    host
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('X-Correlation-ID', req.orgoContext.correlationId);
    return true;
  }
}
@Injectable()
export class Envelope implements NestInterceptor {
  intercept(_host: NestContext, next: CallHandler): Observable<unknown> {
    return next
      .handle()
      .pipe(map((data) => ({ ok: true, data: data ?? null, error: null })));
  }
}
@Catch()
export class Errors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    let status = 500,
      code = 'INTERNAL_ERROR',
      message = 'An internal error occurred',
      details: unknown = {};
    if (error instanceof DomainError) {
      status = error.status;
      code = error.code;
      message = error.message;
      details = error.details;
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      code = `HTTP_${status}`;
      message = error.message;
    } else if (typeof error === 'object' && error && 'code' in error) {
      if (error.code === 'P2002') {
        status = 409;
        code = 'CONFLICT';
        message = 'Record already exists';
      }
      if (error.code === 'P2003') {
        status = 409;
        code = 'REFERENCE_CONFLICT';
        message = 'Invalid or referenced record';
      }
      if (error.code === 'P2025') {
        status = 404;
        code = 'NOT_FOUND';
        message = 'Record not found';
      }
    }
    const req = host.switchToHttp().getRequest<ContextRequest>();
    if (status >= 500)
      console.error(
        JSON.stringify({
          event: 'http.failure',
          correlation_id: req.orgoContext?.correlationId,
          code,
        }),
      );
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(status)
      .json({ ok: false, data: null, error: { code, message, details } });
  }
}
