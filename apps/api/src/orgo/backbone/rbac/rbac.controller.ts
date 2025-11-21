import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { AuthGuard } from '../../security/auth.guard';
import { RbacService } from './rbac.service';

/**
 * Auth context attached by AuthGuard.validateAccessToken.
 * See Doc 4 – Authentication & RBAC. :contentReference[oaicite:0]{index=0}
 */
interface AuthenticatedUserContext {
  userId: string;
  organizationId: string;
  roles?: string[];
  permissions?: string[];
}

/**
 * Minimal request shape we rely on; transport (Express/Fastify) is abstracted.
 */
interface AuthenticatedRequest {
  user: AuthenticatedUserContext;
  // Allow other properties without tying to a specific HTTP framework.
  [key: string]: unknown;
}

/**
 * Standard result envelope (aligned with Core Services spec). :contentReference[oaicite:1]{index=1}
 */
export interface StandardResult<T = any> {
  ok: boolean;
  data: T | null;
  error: { code: string; message: string; details?: any } | null;
}

/**
 * DTOs
 */

export class CreateRoleDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  displayName!: string;

  @IsString()
  @IsOptional()
  description?: string;
}

export class UpdateRoleDto {
  @IsString()
  @IsOptional()
  displayName?: string;

  @IsString()
  @IsOptional()
  description?: string;
}

/**
 * Atomic permission codes, e.g. "task.view_sensitive", "workflow.edit_rules". :contentReference[oaicite:2]{index=2}
 */
export class AssignPermissionsToRoleDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  permissionCodes!: string[];
}

/**
 * User → Role assignments with optional scope (team, location, etc.). :contentReference[oaicite:3]{index=3}
 */
export class AssignRolesToUserDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  roleIds!: string[];

  @IsOptional()
  @IsString()
  @IsIn(['global', 'team', 'location', 'unit', 'custom'])
  scopeType?: string;

  @IsOptional()
  @IsString()
  scopeReference?: string;
}

/**
 * Permission check payload: primarily by permission code, with optional
 * resource/action context for audit/troubleshooting. :contentReference[oaicite:4]{index=4}
 */
export class CheckPermissionDto {
  @IsString()
  @IsNotEmpty()
  permissionCode!: string;

  @IsOptional()
  @IsString()
  resource?: string;

  @IsOptional()
  @IsString()
  action?: string;
}

@Controller('rbac')
@UseGuards(AuthGuard)
export class RbacController {
  constructor(private readonly rbacService: RbacService) {}

  /**
   * List roles available in the caller's organization (including any global/system roles
   * that apply to this org). Roles map to the `roles` table in Doc 1. :contentReference[oaicite:5]{index=5}
   */
  @Get('roles')
  async listRoles(@Req() req: AuthenticatedRequest): Promise<StandardResult> {
    const { organizationId } = req.user;
    const roles = await this.rbacService.listRolesForOrganization(organizationId);
    return this.buildOkResult(roles);
  }

  /**
   * Create a new org-scoped Role (roles.organization_id = caller org). :contentReference[oaicite:6]{index=6}
   */
  @Post('roles')
  async createRole(
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateRoleDto,
  ): Promise<StandardResult> {
    const { organizationId, userId } = req.user;
    const role = await this.rbacService.createRole(organizationId, body, userId);
    return this.buildOkResult(role);
  }

  /**
   * Fetch a single Role by id, scoped to the caller's organization (plus any
   * applicable global/system role). :contentReference[oaicite:7]{index=7}
   */
  @Get('roles/:roleId')
  async getRole(
    @Req() req: AuthenticatedRequest,
    @Param('roleId') roleId: string,
  ): Promise<StandardResult> {
    const { organizationId } = req.user;
    const role = await this.rbacService.getRoleById(organizationId, roleId);
    return this.buildOkResult(role);
  }

  /**
   * Update an existing Role's display metadata. System roles and foreign-org
   * roles must be protected inside RbacService. :contentReference[oaicite:8]{index=8}
   */
  @Patch('roles/:roleId')
  async updateRole(
    @Req() req: AuthenticatedRequest,
    @Param('roleId') roleId: string,
    @Body() body: UpdateRoleDto,
  ): Promise<StandardResult> {
    const { organizationId, userId } = req.user;
    const role = await this.rbacService.updateRole(organizationId, roleId, body, userId);
    return this.buildOkResult(role);
  }

  /**
   * Optional hard-delete endpoint for roles. Implementations may treat this as
   * a soft-delete or disallow deletion for system/built-in roles.
   */
  @Delete('roles/:roleId')
  async deleteRole(
    @Req() req: AuthenticatedRequest,
    @Param('roleId') roleId: string,
  ): Promise<StandardResult> {
    const { organizationId, userId } = req.user;
    const result = await this.rbacService.deleteRole(organizationId, roleId, userId);
    return this.buildOkResult(result);
  }

  /**
   * List all defined Permission codes (from the `permissions` table). :contentReference[oaicite:9]{index=9}
   */
  @Get('permissions')
  async listPermissions(): Promise<StandardResult> {
    const permissions = await this.rbacService.listPermissions();
    return this.buildOkResult(permissions);
  }

  /**
   * List Permission codes currently granted to a Role via role_permissions. :contentReference[oaicite:10]{index=10}
   */
  @Get('roles/:roleId/permissions')
  async listRolePermissions(
    @Req() req: AuthenticatedRequest,
    @Param('roleId') roleId: string,
  ): Promise<StandardResult> {
    const { organizationId } = req.user;
    const permissions = await this.rbacService.getPermissionsForRole(organizationId, roleId);
    return this.buildOkResult(permissions);
  }

  /**
   * Grant one or more Permission codes to a Role (insert into role_permissions). :contentReference[oaicite:11]{index=11}
   */
  @Post('roles/:roleId/permissions')
  async assignPermissionsToRole(
    @Req() req: AuthenticatedRequest,
    @Param('roleId') roleId: string,
    @Body() body: AssignPermissionsToRoleDto,
  ): Promise<StandardResult> {
    const { organizationId, userId } = req.user;
    const result = await this.rbacService.assignPermissionsToRole(
      organizationId,
      roleId,
      body.permissionCodes,
      userId,
    );
    return this.buildOkResult(result);
  }

  /**
   * Revoke a Permission from a Role by permission code.
   */
  @Delete('roles/:roleId/permissions/:permissionCode')
  async revokePermissionFromRole(
    @Req() req: AuthenticatedRequest,
    @Param('roleId') roleId: string,
    @Param('permissionCode') permissionCode: string,
  ): Promise<StandardResult> {
    const { organizationId, userId } = req.user;
    const result = await this.rbacService.revokePermissionFromRole(
      organizationId,
      roleId,
      permissionCode,
      userId,
    );
    return this.buildOkResult(result);
  }

  /**
   * List roles currently assigned to a user within the caller's organization,
   * including scope information from user_role_assignments. :contentReference[oaicite:12]{index=12}
   */
  @Get('users/:userId/roles')
  async listUserRoles(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
  ): Promise<StandardResult> {
    const { organizationId } = req.user;
    const roles = await this.rbacService.getRolesForUser(organizationId, userId);
    return this.buildOkResult(roles);
  }

  /**
   * Assign one or more Roles to a user in the caller's organization, with an
   * optional scope (team/location/unit/custom). :contentReference[oaicite:13]{index=13}
   */
  @Post('users/:userId/roles')
  async assignRolesToUser(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() body: AssignRolesToUserDto,
  ): Promise<StandardResult> {
    const { organizationId, userId: actorUserId } = req.user;
    const result = await this.rbacService.assignRolesToUser(
      organizationId,
      userId,
      body.roleIds,
      body.scopeType,
      body.scopeReference,
      actorUserId,
    );
    return this.buildOkResult(result);
  }

  /**
   * Revoke a specific Role from a user in the caller's organization.
   */
  @Delete('users/:userId/roles/:roleId')
  async revokeRoleFromUser(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Param('roleId') roleId: string,
  ): Promise<StandardResult> {
    const { organizationId, userId: actorUserId } = req.user;
    const result = await this.rbacService.revokeRoleFromUser(
      organizationId,
      userId,
      roleId,
      actorUserId,
    );
    return this.buildOkResult(result);
  }

  /**
   * Return the current caller's effective access profile: roles and permission
   * codes derived from roles + scopes + org/profile guardrails. :contentReference[oaicite:14]{index=14}
   */
  @Get('me')
  async getCurrentUserAccessProfile(
    @Req() req: AuthenticatedRequest,
  ): Promise<StandardResult> {
    const { organizationId, userId } = req.user;
    const roles = await this.rbacService.getRolesForUser(organizationId, userId);
    const permissions =
      await this.rbacService.getEffectivePermissionsForUser(organizationId, userId);

    return this.buildOkResult({
      organization_id: organizationId,
      user_id: userId,
      roles,
      permissions,
    });
  }

  /**
   * Check whether the current caller has a given permission. This is primarily
   * an introspection endpoint; actual enforcement should happen inside guards
   * and services via RbacService.checkPermission. :contentReference[oaicite:15]{index=15}
   */
  @Post('check')
  @HttpCode(HttpStatus.OK)
  async checkPermission(
    @Req() req: AuthenticatedRequest,
    @Body() body: CheckPermissionDto,
  ): Promise<StandardResult<{ allowed: boolean }>> {
    const { organizationId, userId } = req.user;

    const allowed = await this.rbacService.checkPermissionForUser({
      organizationId,
      userId,
      permissionCode: body.permissionCode,
      resource: body.resource,
      action: body.action,
    });

    return this.buildOkResult({ allowed });
  }

  /**
   * Helper to construct the standard { ok, data, error } envelope.
   */
  private buildOkResult<T>(data: T): StandardResult<T> {
    return {
      ok: true,
      data,
      error: null,
    };
  }
}
