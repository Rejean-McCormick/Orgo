import { Inject } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { Database } from '../../platform/database';
import {
  correlation,
  DomainError,
  ExecutionContext,
} from '../../platform/contracts';

const scrypt = promisify(scryptCallback);
export const tokenHash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${key.toString('hex')}`;
}
export async function passwordMatches(password: string, stored: string) {
  const [scheme, salt, digest] = stored.split(':');
  if (scheme !== 'scrypt' || !salt || !digest) return false;
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(digest, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
@Injectable()
export class IdentityService {
  constructor(@Inject(Database) private readonly db: Database) {}
  async login(organization: string, email: string, password: string) {
    const user = await this.db.userAccount.findFirst({
      where: {
        email: email.toLowerCase(),
        auth_provider: 'local',
        organization: { slug: organization, status: 'active' },
        status: 'active',
      },
    });
    // Do equivalent KDF work even for an unknown account; do not reveal account existence.
    const fallback = `scrypt:00000000000000000000000000000000:${'00'.repeat(64)}`;
    const valid = await passwordMatches(
      password,
      user?.password_hash ?? fallback,
    );
    if (!user || !valid)
      throw new DomainError('UNAUTHENTICATED', 'Invalid credentials', 401);
    return this.session(user.organization_id, user.id);
  }
  async session(organizationId: string, userId: string) {
    const context = await this.forUser(organizationId, userId);
    const token = randomBytes(32).toString('base64url');
    const expires = new Date(Date.now() + 8 * 3600000);
    const now = new Date();
    await this.db.$transaction([
      this.db.userAccount.updateMany({
        where: {
          id: userId,
          organization_id: organizationId,
          status: 'active',
        },
        data: { last_login_at: now },
      }),
      this.db.loginSession.create({
        data: {
          organization_id: organizationId,
          user_id: userId,
          token_hash: tokenHash(token),
          created_at: now,
          expires_at: expires,
        },
      }),
    ]);
    return {
      token,
      expires_at: expires.toISOString(),
      context,
    };
  }
  async forUser(
    organizationId: string,
    userId: string,
    correlationId?: string,
  ): Promise<ExecutionContext> {
    const user = await this.db.userAccount.findFirst({
      where: {
        id: userId,
        organization_id: organizationId,
        status: 'active',
        organization: { status: 'active' },
      },
      include: {
        role_assignments: {
          where: {
            revoked_at: null,
          },
          include: {
            role: {
              include: { role_permissions: { include: { permission: true } } },
            },
          },
        },
      },
    });
    if (!user)
      throw new DomainError(
        'UNAUTHENTICATED',
        'Inactive identity or organization',
        401,
      );
    const assignments = user.role_assignments.filter(
      (a) =>
        a.role.organization_id === organizationId &&
        (!a.scope_type || a.scope_type === 'global'),
    );
    return {
      organizationId,
      workGrants: user.role_assignments
        .filter(
          (a) =>
            a.role.organization_id === organizationId &&
            a.scope_type &&
            a.scope_type !== 'global' &&
            a.scope_reference,
        )
        .map((a) => ({
          scope_type: a.scope_type!,
          scope_reference: a.scope_reference!,
          role_id: a.role_id,
          permissions: a.role.role_permissions
            .map((p) => p.permission.code)
            .filter((p) => p.startsWith('work:')),
        })),
      actorUserId: user.id,
      actorType: 'user',
      source: 'api',
      roleIds: assignments.map((a) => a.role_id),
      permissions: [
        ...new Set(
          assignments.flatMap((a) =>
            a.role.role_permissions.map((p) => p.permission.code),
          ),
        ),
      ],
      correlationId: correlation(correlationId),
    };
  }
  async authenticate(
    token: string,
    headers: {
      organization?: string;
      correlation?: string;
      idempotency?: string;
    },
  ): Promise<ExecutionContext> {
    const digest = tokenHash(token);
    const session = await this.db.loginSession.findUnique({
      where: { token_hash: digest },
    });
    let ctx: ExecutionContext;
    if (session && !session.terminated_at && session.expires_at > new Date())
      ctx = await this.forUser(
        session.organization_id,
        session.user_id,
        headers.correlation,
      );
    else {
      const api = await this.db.apiToken.findUnique({
        where: { token_hash: digest },
        include: { organization: true },
      });
      if (!api)
        throw new DomainError(
          'UNAUTHENTICATED',
          'Invalid or expired token',
          401,
        );
      ctx = await this.forApiToken(api.id, headers.correlation);
    }
    if (headers.organization && headers.organization !== ctx.organizationId)
      throw new DomainError(
        'TENANT_MISMATCH',
        'Token cannot access the requested organization',
        403,
      );
    return { ...ctx, idempotencyKey: headers.idempotency };
  }
  async forApiToken(
    id: string,
    correlationId?: string,
  ): Promise<ExecutionContext> {
    const api = await this.db.apiToken.findUnique({
      where: { id },
      include: { organization: true },
    });
    if (
      !api?.organization_id ||
      api.organization?.status !== 'active' ||
      (api.expires_at && api.expires_at <= new Date())
    )
      throw new DomainError('UNAUTHENTICATED', 'Invalid or expired token', 401);
    return {
      organizationId: api.organization_id,
      actorUserId: null,
      apiTokenId: api.id,
      actorType: 'system',
      permissions: api.scopes,
      roleIds: [],
      source: 'api',
      correlationId: correlation(correlationId),
    };
  }
  async logout(token: string) {
    await this.db.loginSession.updateMany({
      where: { token_hash: tokenHash(token), terminated_at: null },
      data: { terminated_at: new Date(), terminated_reason: 'logout' },
    });
    return { logged_out: true };
  }
}
