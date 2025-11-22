// apps/api/src/orgo/security/auth/auth.guard.ts

import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

/**
 * Shape of the authenticated user context attached to the request.
 *
 * Mirrors the interface used in RbacController:
 *   - userId:         authenticated user identifier (JWT sub)
 *   - organizationId: tenant identifier (from header or token)
 *   - roles:          optional list of role codes
 *   - permissions:    optional list of permission codes
 */
export interface AuthenticatedUserContext {
  userId: string;
  organizationId: string;
  roles?: string[];
  permissions?: string[];
}

/**
 * Minimal extension of Express Request used internally by the guard.
 * Controllers may use their own request interfaces; this stays local.
 */
interface RequestWithAuth extends Request {
  user?: AuthenticatedUserContext;
  userId?: string;
  organizationId?: string;
}

/**
 * JWT payload shape for access tokens.
 * Only fields used by the guard are modelled explicitly.
 */
interface AccessTokenPayload {
  sub?: string | number;
  email?: string | null;
  type?: string; // 'access' | 'refresh' | other
  // Optional org claims for future compatibility
  organizationId?: string;
  organization_id?: string;
  orgId?: string;
  org_id?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

/**
 * AuthGuard
 *
 * Responsibilities (Doc 4 – Authentication & RBAC):
 *  - Validate bearer access tokens on incoming API requests.
 *  - Enforce that a tenant context is present (multi‑tenant scoping).
 *  - Attach a canonical AuthenticatedUserContext to request.user.
 *  - Mirror userId/organizationId onto request for legacy controllers.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(private readonly jwtService: JwtService) {}

  /**
   * Main NestJS guard entry point.
   *
   * - Extracts and validates the access token.
   * - Resolves organizationId (header or token claim).
   * - Attaches { userId, organizationId, roles?, permissions? } to request.user.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithAuth>();

    const authContext = await this.validateAccessToken(request);

    // Attach canonical auth context for downstream controllers/guards.
    request.user = authContext;

    // Also mirror onto top-level properties for controllers that expect them
    // (e.g. RequestWithContext in person-profile.controller).
    request.userId = authContext.userId;
    request.organizationId = authContext.organizationId;

    return true;
  }

  /**
   * Validate an access token for a given HTTP request and build the
   * AuthenticatedUserContext.
   *
   * This is the canonical "Authenticate API request" hook referenced in
   * the functional inventory (Doc 4).
   */
  public async validateAccessToken(
    req: RequestWithAuth,
  ): Promise<AuthenticatedUserContext> {
    const token = this.extractBearerToken(req);

    let payload: AccessTokenPayload;

    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown JWT verification error';
      this.logger.debug(`Access token verification failed: ${message}`);
      throw new UnauthorizedException('Invalid or expired access token.');
    }

    if (payload.type && payload.type !== 'access') {
      this.logger.debug(
        `Rejected JWT with non-access type "${payload.type ?? 'undefined'}".`,
      );
      throw new UnauthorizedException('Invalid token type (expected access token).');
    }

    const userId =
      typeof payload.sub === 'string' || typeof payload.sub === 'number'
        ? String(payload.sub)
        : undefined;

    if (!userId) {
      throw new UnauthorizedException(
        'Access token payload is missing subject (sub).',
      );
    }

    const organizationId = this.resolveOrganizationId(req, payload);

    const authContext: AuthenticatedUserContext = {
      userId,
      organizationId,
    };

    // If the token already carries roles/permissions, surface them.
    // This is optional and can be expanded later without breaking callers.
    if (Array.isArray((payload as any).roles)) {
      authContext.roles = (payload as any).roles.map((r: unknown) => String(r));
    }

    if (Array.isArray((payload as any).permissions)) {
      authContext.permissions = (payload as any).permissions.map((p: unknown) =>
        String(p),
      );
    }

    return authContext;
  }

  /**
   * Extracts a Bearer token from the Authorization header.
   *
   * Expected format:
   *   Authorization: Bearer <jwt>
   */
  private extractBearerToken(req: Request): string {
    const header = this.getHeader(req, 'authorization');

    if (!header) {
      throw new UnauthorizedException('Missing Authorization header.');
    }

    const parts = header.split(' ').filter(Boolean);

    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
      throw new UnauthorizedException(
        'Invalid Authorization header format (expected "Bearer <token>").',
      );
    }

    const token = parts[1]?.trim();
    if (!token) {
      throw new UnauthorizedException('Access token is missing.');
    }

    return token;
  }

  /**
   * Resolves the organization identifier for the current request.
   *
   * Precedence:
   *   1. X-Organization-Id header
   *   2. X-Org-Id header (legacy alias)
   *   3. JWT claims: organizationId | organization_id | orgId | org_id
   *
   * If both header and token claim are present and differ, the request
   * is rejected to prevent cross-tenant confusion.
   */
  private resolveOrganizationId(
    req: Request,
    payload: AccessTokenPayload,
  ): string {
    const headerOrgRaw =
      this.getHeader(req, 'x-organization-id') ||
      this.getHeader(req, 'x-org-id');

    const headerOrg = headerOrgRaw?.trim() || undefined;

    const claimOrgRaw =
      payload.organizationId ||
      payload.organization_id ||
      payload.orgId ||
      payload.org_id ||
      undefined;

    const claimOrg = claimOrgRaw?.trim() || undefined;

    if (headerOrg && claimOrg && headerOrg !== claimOrg) {
      this.logger.warn(
        `Organization mismatch between header and token: header="${headerOrg}", token="${claimOrg}".`,
      );
      throw new UnauthorizedException(
        'Organization context does not match authenticated token.',
      );
    }

    const resolved = headerOrg || claimOrg;

    if (!resolved) {
      throw new BadRequestException(
        'Missing organization identifier (expected X-Org-Id or X-Organization-Id header, or token claim).',
      );
    }

    return resolved;
  }

  /**
   * Helper to read a header value in a case-insensitive way and
   * normalize string[] → string.
   */
  private getHeader(req: Request, name: string): string | undefined {
    const headerName = name.toLowerCase();
    const value = req.headers[headerName];

    if (Array.isArray(value)) {
      return value[0];
    }

    return value as string | undefined;
  }
}
