import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  Commands,
  Database,
  enqueue,
  json,
  lock,
  recordEvent,
  Tx,
} from '../../platform/database';
import {
  DomainError,
  ExecutionContext,
  parse,
  requirePermission,
  text,
  uuid,
} from '../../platform/contracts';
import { passwordHash, passwordMatches, tokenHash } from './identity.service';
@Injectable()
export class IdentityAdmin {
  constructor(
    @Inject(Database) private db: Database,
    @Inject(Commands) private commands: Commands,
  ) {}
  async throttle(key: string, limit = 10, seconds = 60) {
    const now = new Date(),
      start = new Date(
        Math.floor(now.getTime() / (seconds * 1000)) * seconds * 1000,
      );
    const count = await this.db.$transaction(async (tx) => {
      await lock(tx, `rate:${key}`);
      const previous = await tx.rateLimitBucket.findUnique({ where: { key } });
      return tx.rateLimitBucket.upsert({
        where: { key },
        create: { key, window_start: start, count: 1 },
        update: {
          window_start: start,
          count:
            previous?.window_start.getTime() === start.getTime()
              ? previous.count + 1
              : 1,
        },
      });
    });
    if (count.count > limit)
      throw new DomainError(
        'RATE_LIMITED',
        'Too many requests; retry later',
        429,
      );
  }
  async tokens(ctx: ExecutionContext) {
    requirePermission(ctx, 'identity:manage');
    return this.db.apiToken.findMany({
      where: { organization_id: ctx.organizationId },
      select: {
        id: true,
        name: true,
        scopes: true,
        expires_at: true,
        last_used_at: true,
        created_at: true,
      },
      orderBy: { created_at: 'desc' },
      take: 100,
    });
  }
  async issueToken(ctx: ExecutionContext, raw: unknown) {
    requirePermission(ctx, 'identity:manage');
    const input = parse(
      z
        .object({
          name: text,
          scopes: z
            .array(z.string().regex(/^(\*|[a-z]+:[a-z]+)$/))
            .min(1)
            .max(100),
          expires_at: z.string().datetime({ offset: true }),
        })
        .strict(),
      raw,
    );
    for (const permission of input.scopes) requirePermission(ctx, permission);
    const expires = new Date(input.expires_at);
    if (
      expires <= new Date() ||
      expires.getTime() > Date.now() + 366 * 86400000
    )
      throw new DomainError(
        'TOKEN_EXPIRY',
        'Token expiration must be within one year',
      );
    const secret = randomBytes(32).toString('base64url'),
      digest = tokenHash(secret);
    const row = await this.commands.run(
      ctx,
      'identity.token.issue',
      input,
      async (tx) => {
        const row = await tx.apiToken.create({
          data: {
            organization_id: ctx.organizationId,
            name: input.name,
            scopes: input.scopes,
            expires_at: expires,
            created_by_user_id: ctx.actorUserId,
            token_hash: digest,
          },
          select: { id: true, name: true, expires_at: true },
        });
        await recordEvent(tx, ctx, 'api_token', row.id, 'ApiTokenCreated', {
          name: input.name,
          scopes: input.scopes,
        });
        return row;
      },
    );
    const saved = await this.db.apiToken.findFirst({
      where: { id: row.id, organization_id: ctx.organizationId },
    });
    // Secrets never enter idempotency response storage. A lost response requires revocation and reissuance.
    return { ...row, token: saved?.token_hash === digest ? secret : null };
  }
  async revoke(ctx: ExecutionContext, id: string, tx: Tx) {
    requirePermission(ctx, 'identity:manage');
    const changed = await tx.apiToken.updateMany({
      where: { id, organization_id: ctx.organizationId },
      data: { expires_at: new Date() },
    });
    if (!changed.count)
      throw new DomainError('NOT_FOUND', 'Token not found', 404);
    await recordEvent(tx, ctx, 'api_token', id, 'ApiTokenRevoked', {});
    return { id, revoked: true };
  }
  async challenge(
    ctx: ExecutionContext,
    userId: string,
    kind: 'invite' | 'reset',
    tx: Tx,
  ) {
    const user = await tx.userAccount.findFirst({
      where: {
        id: userId,
        organization_id: ctx.organizationId,
        status: { in: ['active', 'invited'] },
        auth_provider: 'local',
      },
    });
    if (!user) return;
    const base = process.env.ORGO_PUBLIC_URL;
    if (!base)
      throw new DomainError(
        'PUBLIC_URL_REQUIRED',
        'Configure ORGO_PUBLIC_URL to send account links',
        503,
      );
    const url = new URL(base);
    if (
      url.protocol !== 'https:' &&
      !(
        process.env.NODE_ENV !== 'production' &&
        ['localhost', '127.0.0.1'].includes(url.hostname)
      )
    )
      throw new DomainError(
        'PUBLIC_URL_INVALID',
        'Account links require HTTPS',
        503,
      );
    await lock(tx, `challenge:${user.id}`);
    const secret = randomBytes(32).toString('base64url');
    await tx.identityChallenge.updateMany({
      where: { user_id: user.id, consumed_at: null },
      data: { consumed_at: new Date() },
    });
    await tx.identityChallenge.create({
      data: {
        organization_id: ctx.organizationId,
        user_id: user.id,
        kind,
        token_hash: tokenHash(secret),
        expires_at: new Date(Date.now() + 3600000),
      },
    });
    url.pathname = '/account';
    url.search = '';
    url.hash = `token=${secret}`;
    const message = await tx.notification.create({
      data: {
        organization_id: ctx.organizationId,
        recipient_user_id: user.id,
        recipient_address: user.email,
        channel: 'email',
        status: 'queued',
        queued_at: new Date(),
        payload: json({
          subject:
            kind === 'invite'
              ? 'Votre accès Orgo'
              : 'Réinitialisation du mot de passe Orgo',
          body: `Utilisez ce lien dans l’heure pour définir votre mot de passe : ${url.toString()}\nSi vous n’avez pas demandé cet accès, ignorez ce message.`,
        }),
      },
    });
    await enqueue(tx, ctx, 'notification', message.id, {});
    await recordEvent(tx, ctx, 'user', user.id, 'IdentityChallengeIssued', {
      kind,
    });
  }
  async invite(ctx: ExecutionContext, raw: unknown, tx: Tx) {
    requirePermission(ctx, 'identity:manage');
    const input = parse(
      z
        .object({
          email: z.string().email().max(300),
          display_name: text,
          role_ids: z.array(uuid).max(30).default([]),
        })
        .strict(),
      raw,
    );
    const roles = await tx.role.findMany({
      where: {
        organization_id: ctx.organizationId,
        id: { in: input.role_ids },
      },
    });
    if (roles.length !== new Set(input.role_ids).size)
      throw new DomainError(
        'INVALID_ROLES',
        'All roles must belong to this organization',
      );
    const user = await tx.userAccount.create({
      data: {
        organization_id: ctx.organizationId,
        email: input.email.toLowerCase(),
        display_name: input.display_name,
        status: 'invited',
        auth_provider: 'local',
      },
    });
    for (const role of roles)
      await tx.userRoleAssignment.create({
        data: {
          user_id: user.id,
          role_id: role.id,
          scope_type: 'global',
          assigned_at: new Date(),
          assigned_by_user_id: ctx.actorUserId,
        },
      });
    await this.challenge(ctx, user.id, 'invite', tx);
    await recordEvent(tx, ctx, 'user', user.id, 'UserInvited', {});
    return { id: user.id, email: user.email, status: user.status };
  }
  async recover(organization: string, email: string) {
    const user = await this.db.userAccount.findFirst({
      where: {
        email: email.toLowerCase(),
        status: 'active',
        auth_provider: 'local',
        organization: { slug: organization, status: 'active' },
      },
    });
    if (user) {
      const ctx: ExecutionContext = {
        organizationId: user.organization_id,
        actorUserId: null,
        actorType: 'system',
        permissions: [],
        roleIds: [],
        source: 'api',
        correlationId: crypto.randomUUID(),
      };
      try {
        await this.db.$transaction((tx) =>
          this.challenge(ctx, user.id, 'reset', tx),
        );
      } catch (error) {
        if (
          error instanceof DomainError &&
          ['PUBLIC_URL_REQUIRED', 'PUBLIC_URL_INVALID'].includes(error.code)
        )
          console.error(
            JSON.stringify({ event: 'identity.recovery_unconfigured' }),
          );
        else throw error;
      }
    }
    return { accepted: true };
  }
  async consume(raw: unknown) {
    const input = parse(
        z
          .object({
            token: z.string().min(40).max(100),
            password: z.string().min(12).max(200),
          })
          .strict(),
        raw,
      ),
      digest = await passwordHash(input.password);
    return this.db.$transaction(async (tx) => {
      await lock(tx, `challenge.consume:${tokenHash(input.token)}`);
      const challenge = await tx.identityChallenge.findUnique({
        where: { token_hash: tokenHash(input.token) },
      });
      if (
        !challenge ||
        challenge.consumed_at ||
        challenge.expires_at <= new Date()
      )
        throw new DomainError(
          'INVALID_CHALLENGE',
          'Link invalid or expired',
          400,
        );
      const user = await tx.userAccount.findFirst({
        where: {
          id: challenge.user_id,
          organization_id: challenge.organization_id,
          status: { in: ['active', 'invited'] },
          auth_provider: 'local',
          organization: { status: 'active' },
        },
      });
      if (!user)
        throw new DomainError(
          'INVALID_CHALLENGE',
          'Link invalid or expired',
          400,
        );
      await tx.userAccount.update({
        where: { id: user.id },
        data: { password_hash: digest, status: 'active' },
      });
      await tx.identityChallenge.updateMany({
        where: { user_id: user.id, consumed_at: null },
        data: { consumed_at: new Date() },
      });
      await tx.loginSession.updateMany({
        where: { user_id: user.id, terminated_at: null },
        data: { terminated_at: new Date(), terminated_reason: 'forced' },
      });
      await recordEvent(
        tx,
        {
          organizationId: user.organization_id,
          actorUserId: user.id,
          actorType: 'user',
          permissions: [],
          roleIds: [],
          source: 'api',
          correlationId: crypto.randomUUID(),
        },
        'user',
        user.id,
        'PasswordReset',
        {},
      );
      return { changed: true };
    });
  }
  async changePassword(ctx: ExecutionContext, raw: unknown) {
    if (!ctx.actorUserId)
      throw new DomainError('USER_REQUIRED', 'A user session is required', 403);
    const input = parse(
      z
        .object({
          current_password: z.string().max(200),
          new_password: z.string().min(12).max(200),
        })
        .strict(),
      raw,
    );
    const user = await this.db.userAccount.findFirstOrThrow({
      where: { id: ctx.actorUserId, organization_id: ctx.organizationId },
    });
    if (
      !(await passwordMatches(input.current_password, user.password_hash ?? ''))
    )
      throw new DomainError(
        'INVALID_PASSWORD',
        'Current password is incorrect',
        403,
      );
    const digest = await passwordHash(input.new_password);
    return this.db.$transaction(async (tx) => {
      const changed = await tx.userAccount.updateMany({
        where: {
          id: user.id,
          password_hash: user.password_hash,
          status: 'active',
        },
        data: { password_hash: digest },
      });
      if (!changed.count)
        throw new DomainError(
          'IDENTITY_CHANGED',
          'Identity changed; sign in again',
          409,
        );
      await tx.loginSession.updateMany({
        where: { user_id: user.id, terminated_at: null },
        data: { terminated_at: new Date(), terminated_reason: 'forced' },
      });
      await tx.identityChallenge.updateMany({
        where: { user_id: user.id, consumed_at: null },
        data: { consumed_at: new Date() },
      });
      await recordEvent(tx, ctx, 'user', user.id, 'PasswordChanged', {});
      return { changed: true, login_required: true };
    });
  }
}
