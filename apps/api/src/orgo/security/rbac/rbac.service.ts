import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../core/database/database.service';

/**
 * Identity for which permissions are being evaluated.
 *
 * One of `userId` or `apiTokenId` must be present. `organizationId` is required
 * and enforces multi‑tenant scoping as per Docs 1–2.
 */
export interface RbacSubject {
  organizationId: string;
  userId?: string;
  apiTokenId?: string;
}

/**
 * Optional resource context. This is intentionally minimal for now but leaves
 * room for richer, resource‑aware policies (task/case visibility, ownership, etc.).
 */
export interface RbacResourceContext {
  type: 'task' | 'case' | 'workflow' | 'config' | string;
  id?: string;
  organizationId?: string;
  ownerUserId?: string;
  ownerRoleId?: string;
  visibility?: 'PUBLIC' | 'INTERNAL' | 'RESTRICTED' | 'ANONYMISED' | string;
  // Domain‑specific details can be added as needed.
  [key: string]: unknown;
}

export interface CheckPermissionOptions {
  /**
   * Optional resource for more advanced policies. Currently only used
   * to enforce same‑org access when `requireSameOrg` is true.
   */
  resource?: RbacResourceContext;

  /**
   * Enforce that the subject org must match the resource org (if provided).
   * Defaults to true to respect multi‑tenant isolation.
   */
  requireSameOrg?: boolean;

  /**
   * When true, the method throws `ForbiddenException` instead of returning `false`.
   * Defaults to false (boolean result only).
   */
  throwOnError?: boolean;

  /**
   * Optional free‑form reason, useful for logging / diagnostics.
   */
  reason?: string;
}

export type RequirePermissionOptions = Omit<CheckPermissionOptions, 'throwOnError'>;

@Injectable()
export class RbacService {
  private readonly logger = new Logger(RbacService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Convenience accessor to the Prisma client. The client type is deliberately
   * `any` here so that schema evolution / mapping does not make this service
   * brittle; the actual Prisma model names are defined in the schema.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private get prisma(): any {
    return this.databaseService.getPrismaClient();
  }

  /**
   * Main enforcement hook used by guards/controllers.
   *
   * Returns true if the subject has the requested permission in the given
   * organization (via roles and/or API token scopes), otherwise false.
   *
   * If `options.throwOnError` is true, throws `ForbiddenException` instead
   * of returning false.
   */
  async checkPermission(
    subject: RbacSubject,
    permissionCode: string,
    options: CheckPermissionOptions = {},
  ): Promise<boolean> {
    const { requireSameOrg = true, resource, throwOnError = false, reason } = options;

    if (!subject.organizationId) {
      this.logger.warn('RBAC check without organizationId; denying.', {
        permissionCode,
        subject,
        reason,
      });

      if (throwOnError) {
        throw new ForbiddenException('Missing organization context for permission check.');
      }
      return false;
    }

    if (!subject.userId && !subject.apiTokenId) {
      this.logger.warn('RBAC check without userId/apiTokenId; denying.', {
        permissionCode,
        subject,
        reason,
      });

      if (throwOnError) {
        throw new ForbiddenException('Missing subject identity for permission check.');
      }
      return false;
    }

    if (
      requireSameOrg &&
      resource?.organizationId &&
      resource.organizationId !== subject.organizationId
    ) {
      this.logger.warn('Cross‑organization resource access attempted; denying.', {
        permissionCode,
        subjectOrg: subject.organizationId,
        resourceOrg: resource.organizationId,
        reason,
      });

      if (throwOnError) {
        throw new ForbiddenException('Cross‑organization access is not allowed.');
      }
      return false;
    }

    const effectivePermissions = await this.getEffectivePermissionsForSubject(subject);

    const allowed = this.isPermissionGranted(permissionCode, effectivePermissions);

    if (!allowed) {
      this.logger.debug('Permission denied.', {
        permissionCode,
        subject,
        resource,
        reason,
      });

      if (throwOnError) {
        throw new ForbiddenException('You do not have permission to perform this action.');
      }
    }

    return allowed;
  }

  /**
   * Variant of `checkPermission` that always throws on failure.
   *
   * Intended for use in service methods where a missing permission is an error
   * rather than a branching condition.
   */
  async requirePermission(
    subject: RbacSubject,
    permissionCode: string,
    options: RequirePermissionOptions = {},
  ): Promise<void> {
    await this.checkPermission(subject, permissionCode, { ...options, throwOnError: true });
  }

  /**
   * Returns a de‑duplicated list of all permission codes that currently apply
   * to a subject (roles + API token scopes).
   *
   * This is useful for attaching to a request context or debugging RBAC issues.
   */
  async getEffectivePermissionsForSubject(subject: RbacSubject): Promise<Set<string>> {
    const permissionCodes = new Set<string>();

    if (subject.userId) {
      const rolePermissions = await this.getUserPermissionCodes(subject.organizationId, subject.userId);
      for (const code of rolePermissions) {
        permissionCodes.add(code);
      }
    }

    if (subject.apiTokenId) {
      const tokenPermissions = await this.getApiTokenPermissionCodes(
        subject.organizationId,
        subject.apiTokenId,
      );
      for (const code of tokenPermissions) {
        permissionCodes.add(code);
      }
    }

    return permissionCodes;
  }

  /**
   * Helper returning a plain array to make it convenient for controllers/guards
   * that want to serialise permissions into request context.
   */
  async listEffectivePermissionsForSubject(subject: RbacSubject): Promise<string[]> {
    const set = await this.getEffectivePermissionsForSubject(subject);
    return Array.from(set);
  }

  /**
   * Fetch permission codes granted to a user via role assignments in the given org.
   *
   * This respects:
   *  - user_role_assignments scoped by organization_id and not revoked,
   *  - roles that are either global (organization_id IS NULL) or match the org,
   *  - role_permissions linking roles to permissions.
   */
  private async getUserPermissionCodes(
    organizationId: string,
    userId: string,
  ): Promise<Set<string>> {
    const result = new Set<string>();

    // NOTE: Model/field names here assume a conventional Prisma mapping from
    // the Doc 1 schema; adapt them to your actual Prisma schema as needed.
    const assignments = await this.prisma.userRoleAssignment.findMany({
      where: {
        userId,
        organizationId,
        revokedAt: null,
      },
      include: {
        role: {
          include: {
            rolePermissions: {
              include: {
                permission: true,
              },
            },
          },
        },
      },
    });

    for (const assignment of assignments ?? []) {
      const role = assignment.role;
      if (!role) {
        continue;
      }

      // Allow global/system roles (organizationId null) and org‑local roles.
      if (role.organizationId && role.organizationId !== organizationId) {
        continue;
      }

      for (const rp of role.rolePermissions ?? []) {
        const permission = rp.permission;
        if (permission?.code) {
          result.add(permission.code);
        }
      }
    }

    return result;
  }

  /**
   * Fetch permission codes granted directly via an API token's scopes.
   *
   * This respects:
   *  - token organization_id matching the subject organization,
   *  - revoked_at being null,
   *  - expires_at not in the past.
   *
   * `scopes` is assumed to be a JSONB field holding an array of permission codes
   * or patterns (e.g. `["task.view", "task.edit", "task.*"]`).
   */
  private async getApiTokenPermissionCodes(
    organizationId: string,
    apiTokenId: string,
  ): Promise<Set<string>> {
    const result = new Set<string>();

    const token = await this.prisma.apiToken.findFirst({
      where: {
        id: apiTokenId,
        organizationId,
        revokedAt: null,
      },
    });

    if (!token) {
      return result;
    }

    const now = new Date();
    if (token.expiresAt && token.expiresAt <= now) {
      return result;
    }

    const scopes = this.normalizeScopes(token.scopes);
    for (const scope of scopes) {
      result.add(scope);
    }

    return result;
  }

  /**
   * Normalises the `scopes` JSONB field on `api_tokens` into an array of
   * string permission codes.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private normalizeScopes(scopes: any): string[] {
    if (!scopes) {
      return [];
    }

    if (Array.isArray(scopes)) {
      return scopes.filter((s): s is string => typeof s === 'string');
    }

    if (typeof scopes === 'object' && Array.isArray(scopes.codes)) {
      return scopes.codes.filter((s: unknown): s is string => typeof s === 'string');
    }

    return [];
  }

  /**
   * Evaluates whether `permissionCode` is granted given a set of effective
   * permissions. Supports:
   *
   *  - exact matches, e.g. `task.view_sensitive`,
   *  - global wildcard `*`,
   *  - prefix wildcards like `task.*` or `workflow.edit_*` (treated as simple
   *    `<prefix>.*` matches on dot‑separated segments).
   */
  private isPermissionGranted(permissionCode: string, effective: Set<string>): boolean {
    if (effective.has(permissionCode)) {
      return true;
    }

    // Global wildcard: everything is allowed.
    if (effective.has('*')) {
      return true;
    }

    // Support simple dotted prefix wildcards: "task.*", "workflow.*", etc.
    const segments = permissionCode.split('.');
    if (segments.length > 1) {
      let prefix = '';
      for (let i = 0; i < segments.length - 1; i += 1) {
        prefix = i === 0 ? segments[0] : `${prefix}.${segments[i]}`;
        const wildcard = `${prefix}.*`;
        if (effective.has(wildcard)) {
          return true;
        }
      }
    }

    return false;
  }
}
