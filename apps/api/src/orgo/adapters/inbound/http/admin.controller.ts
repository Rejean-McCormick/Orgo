import { Inject } from '@nestjs/common';
import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import {
  Commands,
  Database,
  json,
  recordEvent,
} from '../../../platform/database';
import {
  DomainError,
  ExecutionContext,
  parse,
  requirePermission,
  text,
  uuid,
} from '../../../platform/contracts';
import { passwordHash } from '../../../modules/identity/identity.service';
import { DomainsService } from '../../../modules/domains/domains.service';
import { Ctx } from './boundary';
const profileInput = z
  .object({
    version: z.number().int().min(0),
    profile_code: text,
    reactivity_profile: z
      .object({
        default_seconds: z.number().int().min(1).max(31536000),
        priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
      })
      .strict(),
    transparency_profile: z.record(z.unknown()).default({}),
    pattern_sensitivity_profile: z.record(z.unknown()).default({}),
    retention_profile: z.record(z.unknown()).default({}),
  })
  .strict();

@Controller()
export class AdminController {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(Commands) private readonly commands: Commands,
    @Inject(DomainsService) private readonly domains: DomainsService,
  ) {}
  @Get('organizations') async organizations(@Ctx() ctx: ExecutionContext) {
    return this.db.organization.findMany({ where: { id: ctx.organizationId } });
  }
  @Get('people') people(@Ctx() ctx: ExecutionContext) {
    requirePermission(ctx, 'people:read');
    return this.db.personProfile.findMany({
      where: {
        organization_id: ctx.organizationId,
        ...(!ctx.permissions.includes('*') &&
        !ctx.permissions.includes('work:restricted')
          ? { confidentiality_level: 'normal' as const }
          : {}),
      },
      take: 100,
      orderBy: { full_name: 'asc' },
    });
  }
  @Post('people') person(@Ctx() ctx: ExecutionContext, @Body() body: unknown) {
    requirePermission(ctx, 'people:write');
    const input = parse(
      z
        .object({
          full_name: text,
          primary_contact_email: z.string().email().optional(),
          external_reference: z.string().max(200).optional(),
          confidentiality_level: z
            .enum(['normal', 'sensitive', 'highly_sensitive'])
            .default('normal'),
        })
        .strict(),
      body,
    );
    if (input.confidentiality_level !== 'normal')
      requirePermission(ctx, 'work:restricted');
    return this.commands.run(ctx, 'person.create', input, async (tx) => {
      const row = await tx.personProfile.create({
        data: { ...input, organization_id: ctx.organizationId },
      });
      await recordEvent(tx, ctx, 'person', row.id, 'PersonCreated', {});
      return row;
    });
  }
  @Get('users') users(@Ctx() ctx: ExecutionContext) {
    requirePermission(ctx, 'people:read');
    return this.db.userAccount.findMany({
      where: { organization_id: ctx.organizationId },
      select: { id: true, display_name: true, status: true },
      take: 100,
      orderBy: { display_name: 'asc' },
    });
  }
  @Post('users') async user(
    @Ctx() ctx: ExecutionContext,
    @Body() body: unknown,
  ) {
    requirePermission(ctx, 'identity:manage');
    const input = parse(
      z
        .object({
          email: z.string().email().max(300),
          display_name: text,
          password: z.string().min(12).max(200),
        })
        .strict(),
      body,
    );
    const digest = await passwordHash(input.password);
    return this.commands.run(
      ctx,
      'user.create',
      { email: input.email, display_name: input.display_name },
      async (tx) => {
        const row = await tx.userAccount.create({
          data: {
            organization_id: ctx.organizationId,
            email: input.email.toLowerCase(),
            display_name: input.display_name,
            password_hash: digest,
            status: 'active',
            auth_provider: 'local',
          },
        });
        await recordEvent(tx, ctx, 'user', row.id, 'UserCreated', {});
        return { id: row.id, email: row.email, display_name: row.display_name };
      },
    );
  }
  @Get('roles') roles(@Ctx() ctx: ExecutionContext) {
    requirePermission(ctx, 'identity:manage');
    return this.db.role.findMany({
      where: { organization_id: ctx.organizationId },
      include: { role_permissions: { include: { permission: true } } },
    });
  }
  @Post('roles') role(@Ctx() ctx: ExecutionContext, @Body() body: unknown) {
    requirePermission(ctx, 'identity:manage');
    const input = parse(
      z
        .object({
          code: text,
          display_name: text,
          permissions: z
            .array(z.string().regex(/^(\*|[a-z]+:[a-z]+)$/))
            .max(100),
        })
        .strict(),
      body,
    );
    return this.commands.run(ctx, 'role.create', input, async (tx) => {
      const role = await tx.role.create({
        data: {
          organization_id: ctx.organizationId,
          code: input.code,
          display_name: input.display_name,
          description: '',
          is_system_role: false,
        },
      });
      for (const code of new Set(input.permissions)) {
        const permission = await tx.permission.upsert({
          where: { code },
          create: { code, description: code },
          update: {},
        });
        await tx.rolePermission.create({
          data: {
            role_id: role.id,
            permission_id: permission.id,
            granted_by_user_id: ctx.actorUserId,
            granted_at: new Date(),
          },
        });
      }
      await recordEvent(tx, ctx, 'role', role.id, 'RoleCreated', {
        permissions: input.permissions,
      });
      return role;
    });
  }
  @Put('users/:id/roles') userRoles(
    @Ctx() ctx: ExecutionContext,
    @Param('id') raw: string,
    @Body() body: unknown,
  ) {
    requirePermission(ctx, 'identity:manage');
    const id = parse(uuid, raw);
    const input = parse(
      z.object({ role_ids: z.array(uuid).max(30) }).strict(),
      body,
    );
    return this.commands.run(ctx, `user.roles:${id}`, input, async (tx) => {
      if (
        !(await tx.userAccount.findFirst({
          where: { id, organization_id: ctx.organizationId },
        }))
      )
        throw new DomainError('NOT_FOUND', 'User not found', 404);
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
      await tx.userRoleAssignment.updateMany({
        where: {
          user_id: id,
          revoked_at: null,
          OR: [{ scope_type: null }, { scope_type: 'global' }],
        },
        data: { revoked_at: new Date() },
      });
      for (const role of roles)
        await tx.userRoleAssignment.create({
          data: {
            user_id: id,
            role_id: role.id,
            scope_type: 'global',
            assigned_at: new Date(),
            assigned_by_user_id: ctx.actorUserId,
          },
        });
      await recordEvent(tx, ctx, 'user', id, 'UserRolesChanged', {
        role_ids: input.role_ids,
      });
      return { id, role_ids: input.role_ids };
    });
  }
  @Get('config/profile') profile(@Ctx() ctx: ExecutionContext) {
    requirePermission(ctx, 'config:read');
    return this.db.organizationProfile.findUnique({
      where: { organization_id: ctx.organizationId },
    });
  }
  @Put('config/profile') setProfile(
    @Ctx() ctx: ExecutionContext,
    @Body() body: unknown,
  ) {
    requirePermission(ctx, 'config:write');
    const input = parse(profileInput, body);
    return this.commands.run(ctx, 'profile.update', input, async (tx) => {
      const data = {
        profile_code: input.profile_code,
        reactivity_profile: json(input.reactivity_profile),
        transparency_profile: json(input.transparency_profile),
        pattern_sensitivity_profile: json(input.pattern_sensitivity_profile),
        retention_profile: json(input.retention_profile),
      };
      const exists = await tx.organizationProfile.findUnique({
        where: { organization_id: ctx.organizationId },
      });
      if (!exists && input.version === 0)
        return tx.organizationProfile.create({
          data: { ...data, organization_id: ctx.organizationId, version: 1 },
        });
      const changed = await tx.organizationProfile.updateMany({
        where: { organization_id: ctx.organizationId, version: input.version },
        data: { ...data, version: { increment: 1 } },
      });
      if (!changed.count)
        throw new DomainError(
          'REVISION_CONFLICT',
          'Profile changed; reload before retrying',
          409,
        );
      await recordEvent(
        tx,
        ctx,
        'organization',
        ctx.organizationId,
        'ProfileChanged',
        { version: input.version + 1 },
      );
      return tx.organizationProfile.findUnique({
        where: { organization_id: ctx.organizationId },
      });
    });
  }
  @Get('maintenance/assets') assets(@Ctx() ctx: ExecutionContext) {
    requirePermission(ctx, 'maintenance:read');
    return this.db.maintenanceAsset.findMany({
      where: { organization_id: ctx.organizationId },
      take: 100,
    });
  }
  @Post('maintenance/assets') asset(
    @Ctx() ctx: ExecutionContext,
    @Body() body: unknown,
  ) {
    requirePermission(ctx, 'maintenance:write');
    const input = parse(
      z
        .object({
          name: text,
          category: text,
          external_id: text.optional(),
          location: z.record(z.unknown()).optional(),
        })
        .strict(),
      body,
    );
    return this.commands.run(ctx, 'asset.create', input, (tx) =>
      tx.maintenanceAsset.create({
        data: {
          ...input,
          location: input.location ? json(input.location) : undefined,
          organization_id: ctx.organizationId,
        },
      }),
    );
  }
  @Post('maintenance/tasks') maintenance(
    @Ctx() ctx: ExecutionContext,
    @Body() body: unknown,
  ) {
    return this.commands.run(ctx, 'maintenance.create', body, (tx) =>
      this.domains.maintenance(ctx, body, tx),
    );
  }
  @Post('hr/cases') hr(@Ctx() ctx: ExecutionContext, @Body() body: unknown) {
    return this.commands.run(ctx, 'hr.create', body, (tx) =>
      this.domains.hr(ctx, body, tx),
    );
  }
  @Get('education/groups') groups(@Ctx() ctx: ExecutionContext) {
    requirePermission(ctx, 'education:read');
    return this.db.learningGroup.findMany({
      where: { organization_id: ctx.organizationId },
      take: 100,
    });
  }
  @Post('education/groups') group(
    @Ctx() ctx: ExecutionContext,
    @Body() body: unknown,
  ) {
    requirePermission(ctx, 'education:write');
    const input = parse(
      z
        .object({
          code: text,
          name: text,
          description: z.string().max(20000).optional(),
        })
        .strict(),
      body,
    );
    return this.commands.run(ctx, 'group.create', input, (tx) =>
      tx.learningGroup.create({
        data: { ...input, organization_id: ctx.organizationId },
      }),
    );
  }
  @Post('education/tasks') education(
    @Ctx() ctx: ExecutionContext,
    @Body() body: unknown,
  ) {
    return this.commands.run(ctx, 'education.create', body, (tx) =>
      this.domains.education(ctx, body, tx),
    );
  }
}
