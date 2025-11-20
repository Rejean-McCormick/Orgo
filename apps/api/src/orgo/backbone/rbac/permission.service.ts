// apps/api/src/orgo/backbone/rbac/permission.service.ts

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Permission, RolePermission } from '@prisma/client';
import { PrismaService } from '../../../persistence/prisma/prisma.service';

/**
 * PermissionService
 *
 * Backbone RBAC helper for managing global permissions and their
 * assignment to roles.
 *
 * Backed by:
 *   - permissions
 *   - roles
 *   - role_permissions
 *
 * This service does NOT make authorization decisions itself; it
 * maintains the Role ↔ Permission mapping used by higher‑level
 * RBAC / auth guards.
 */
@Injectable()
export class PermissionService {
  private readonly logger = new Logger(PermissionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create (or upsert) a global permission code.
   *
   * Codes are stable identifiers like:
   *   - "task.view_sensitive"
   *   - "workflow.edit_rules"
   */
  async createPermission(
    code: string,
    description: string,
  ): Promise<Permission> {
    const normalizedCode = code?.trim();

    if (!normalizedCode) {
      throw new BadRequestException('Permission code is required');
    }

    return this.prisma.permission.upsert({
      where: { code: normalizedCode },
      update: {
        // allow description updates over time
        description: description?.trim() || normalizedCode,
      },
      create: {
        code: normalizedCode,
        description: description?.trim() || normalizedCode,
      },
    });
  }

  /**
   * Fetch a permission by its global code.
   * Returns null if not found.
   */
  async getPermissionByCode(code: string): Promise<Permission | null> {
    const normalizedCode = code?.trim();
    if (!normalizedCode) {
      return null;
    }

    return this.prisma.permission.findUnique({
      where: { code: normalizedCode },
    });
  }

  /**
   * List all permissions (global).
   */
  async listPermissions(): Promise<Permission[]> {
    return this.prisma.permission.findMany({
      orderBy: { code: 'asc' },
    });
  }

  /**
   * Assign a permission to a role (idempotent).
   *
   * - Validates that the role exists.
   * - Validates that the permission code exists.
   * - Creates or reuses a RolePermission row.
   *
   * Returns the assignment including the Permission row.
   */
  async assignPermission(params: {
    roleId: string;
    permissionCode: string;
    grantedByUserId?: string | null;
  }): Promise<RolePermission & { permission: Permission }> {
    const { roleId, permissionCode, grantedByUserId } = params;

    if (!roleId) {
      throw new BadRequestException('roleId is required');
    }
    const normalizedCode = permissionCode?.trim();
    if (!normalizedCode) {
      throw new BadRequestException('permissionCode is required');
    }

    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
    });

    if (!role) {
      throw new NotFoundException(`Role not found for id "${roleId}"`);
    }

    const permission = await this.prisma.permission.findUnique({
      where: { code: normalizedCode },
    });

    if (!permission) {
      throw new NotFoundException(
        `Permission not found for code "${normalizedCode}"`,
      );
    }

    // Idempotent: if already assigned, return existing mapping.
    const existing = await this.prisma.rolePermission.findFirst({
      where: {
        roleId: role.id,
        permissionId: permission.id,
      },
      include: {
        permission: true,
      },
    });

    if (existing) {
      return existing;
    }

    const assignment = await this.prisma.rolePermission.create({
      data: {
        roleId: role.id,
        permissionId: permission.id,
        grantedByUserId: grantedByUserId ?? null,
        grantedAt: new Date(),
      },
      include: {
        permission: true,
      },
    });

    this.logger.log(
      `Assigned permission "${permission.code}" to role "${role.code}" (${role.id})`,
    );

    return assignment;
  }

  /**
   * Revoke a permission from a role (idempotent).
   *
   * Returns:
   *   - true  → an assignment existed and was deleted
   *   - false → nothing to revoke
   */
  async revokePermission(params: {
    roleId: string;
    permissionCode: string;
  }): Promise<boolean> {
    const { roleId, permissionCode } = params;

    if (!roleId) {
      throw new BadRequestException('roleId is required');
    }
    const normalizedCode = permissionCode?.trim();
    if (!normalizedCode) {
      throw new BadRequestException('permissionCode is required');
    }

    const permission = await this.prisma.permission.findUnique({
      where: { code: normalizedCode },
    });

    if (!permission) {
      // Nothing to revoke if the permission itself does not exist.
      return false;
    }

    const existing = await this.prisma.rolePermission.findFirst({
      where: {
        roleId,
        permissionId: permission.id,
      },
    });

    if (!existing) {
      return false;
    }

    await this.prisma.rolePermission.delete({
      where: {
        id: existing.id,
      },
    });

    this.logger.log(
      `Revoked permission "${permission.code}" from role "${roleId}"`,
    );

    return true;
  }

  /**
   * Get Permission entities for a given role.
   */
  async getPermissionsForRole(roleId: string): Promise<Permission[]> {
    if (!roleId) {
      throw new BadRequestException('roleId is required');
    }

    const assignments = await this.prisma.rolePermission.findMany({
      where: { roleId },
      include: {
        permission: true,
      },
      orderBy: {
        // deterministic ordering; safe even without a composite index
        createdAt: 'asc',
      },
    });

    return assignments.map((rp) => rp.permission);
  }

  /**
   * Convenience helper: get only permission codes for a role.
   */
  async getPermissionCodesForRole(roleId: string): Promise<string[]> {
    const permissions = await this.getPermissionsForRole(roleId);
    return permissions.map((p) => p.code);
  }

  /**
   * Resolve effective permission codes for a user within an organization.
   *
   * This walks:
   *   user_role_assignments → roles → role_permissions → permissions
   *
   * Returned codes are de‑duplicated.
   */
  async getEffectivePermissionCodesForUser(params: {
    userId: string;
    organizationId: string;
  }): Promise<string[]> {
    const { userId, organizationId } = params;

    if (!userId) {
      throw new BadRequestException('userId is required');
    }
    if (!organizationId) {
      throw new BadRequestException('organizationId is required');
    }

    // Use a single SQL query via Prisma; relies only on table/column names
    // defined in the Orgo DB schema.
    const rows: Array<{ code: string }> = await this.prisma.$queryRawUnsafe(
      `
      SELECT DISTINCT p.code
      FROM user_role_assignments ura
      JOIN roles r ON ura.role_id = r.id
      JOIN role_permissions rp ON rp.role_id = r.id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE ura.user_id = $1
        AND ura.organization_id = $2
        AND ura.revoked_at IS NULL
    `,
      userId,
      organizationId,
    );

    return rows.map((row) => row.code).sort();
  }
}
