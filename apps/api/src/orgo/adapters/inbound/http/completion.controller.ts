import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { Commands, Database, recordEvent } from '../../../platform/database';
import {
  DomainError,
  ExecutionContext,
  pageQuery,
  parse,
  requirePermission,
  uuid,
} from '../../../platform/contracts';
import {
  EvidenceService,
  subjectType,
} from '../../../modules/work/evidence.service';
import { ProcessManager } from '../../../modules/orchestration/process-manager.service';
import { IdentityAdmin } from '../../../modules/identity/identity-admin.service';
import { DomainManagement } from '../../../modules/domains/domain-management.service';
import { OperationsService } from '../../../modules/integrations/operations.service';
import { Ctx, Public } from './boundary';
@Controller()
export class CompletionController {
  constructor(
    @Inject(Database) private db: Database,
    @Inject(Commands) private commands: Commands,
    @Inject(EvidenceService) private evidence: EvidenceService,
    @Inject(ProcessManager) private processes: ProcessManager,
    @Inject(IdentityAdmin) private identity: IdentityAdmin,
    @Inject(DomainManagement) private domains: DomainManagement,
    @Inject(OperationsService) private integrations: OperationsService,
  ) {}
  @Get('work/:type/:id/attachments') attachments(
    @Ctx() ctx: ExecutionContext,
    @Param('type') type: string,
    @Param('id') id: string,
    @Query() raw: unknown,
  ) {
    const q = parse(pageQuery, raw);
    return this.evidence.list(
      ctx,
      parse(subjectType, type),
      parse(uuid, id),
      q.offset,
      q.limit,
    );
  }
  @Post('work/:type/:id/attachments') upload(
    @Ctx() ctx: ExecutionContext,
    @Param('type') rawType: string,
    @Param('id') rawId: string,
    @Body() body: unknown,
  ) {
    const type = parse(subjectType, rawType),
      id = parse(uuid, rawId);
    return this.commands.run(
      ctx,
      `attachment.upload:${type}:${id}`,
      body,
      (tx) => this.evidence.upload(ctx, type, id, body, tx),
    );
  }
  @Get('attachments/:id') download(
    @Ctx() ctx: ExecutionContext,
    @Param('id') id: string,
  ) {
    return this.evidence.download(ctx, parse(uuid, id));
  }
  @Delete('attachments/:id') remove(
    @Ctx() ctx: ExecutionContext,
    @Param('id') raw: string,
  ) {
    const id = parse(uuid, raw);
    return this.commands.run(ctx, `attachment.remove:${id}`, {}, (tx) =>
      this.evidence.remove(ctx, id, tx),
    );
  }
  @Get('work/:type/:id/timeline') timeline(
    @Ctx() ctx: ExecutionContext,
    @Param('type') type: string,
    @Param('id') id: string,
    @Query() raw: unknown,
  ) {
    const q = parse(pageQuery, raw);
    return this.evidence.timeline(
      ctx,
      parse(subjectType, type),
      parse(uuid, id),
      q.offset,
      q.limit,
    );
  }
  @Get('work/:type/:id/relations') relations(
    @Ctx() ctx: ExecutionContext,
    @Param('type') type: string,
    @Param('id') id: string,
    @Query() raw: unknown,
  ) {
    const q = parse(pageQuery, raw);
    return this.evidence.relations(
      ctx,
      parse(subjectType, type),
      parse(uuid, id),
      q.offset,
      q.limit,
    );
  }
  @Post('work/:type/:id/relations') relate(
    @Ctx() ctx: ExecutionContext,
    @Param('type') rawType: string,
    @Param('id') raw: string,
    @Body() body: unknown,
  ) {
    const type = parse(subjectType, rawType),
      id = parse(uuid, raw);
    return this.commands.run(ctx, `work.relate:${type}:${id}`, body, (tx) =>
      this.evidence.relate(ctx, type, id, body, tx),
    );
  }
  @Post('processes') process(
    @Ctx() ctx: ExecutionContext,
    @Body() body: unknown,
  ) {
    return this.commands.run(ctx, 'process.create', body, (tx) =>
      this.processes.create(ctx, body, tx),
    );
  }
  @Get('processes') async processesList(
    @Ctx() ctx: ExecutionContext,
    @Query() raw: unknown,
  ) {
    requirePermission(ctx, 'workflows:read');
    const q = parse(pageQuery, raw);
    const candidates = await this.db.durableProcess.findMany({
      where: { organization_id: ctx.organizationId, status: q.status },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: q.limit,
      skip: q.offset,
    });
    const items = [];
    for (const row of candidates) {
      try {
        await this.processes.access(ctx, row.subject_type, row.subject_id);
        items.push(row);
      } catch (e) {
        if (!(e instanceof DomainError && e.status === 404)) throw e;
      }
    }
    return {
      items,
      next_offset: candidates.length === q.limit ? q.offset + q.limit : null,
    };
  }
  @Get('processes/:id') getProcess(
    @Ctx() ctx: ExecutionContext,
    @Param('id') id: string,
  ) {
    return this.processes.get(ctx, parse(uuid, id));
  }
  @Post('processes/:id/decision') decision(
    @Ctx() ctx: ExecutionContext,
    @Param('id') raw: string,
    @Body() body: unknown,
  ) {
    const id = parse(uuid, raw);
    return this.commands.run(ctx, `process.decision:${id}`, body, (tx) =>
      this.processes.decide(ctx, id, body, tx),
    );
  }
  @Post('processes/:id/adopt') adopt(
    @Ctx() ctx: ExecutionContext,
    @Param('id') raw: string,
    @Body() body: unknown,
  ) {
    const id = parse(uuid, raw);
    return this.commands.run(ctx, `process.adopt:${id}`, body, (tx) =>
      this.processes.adopt(ctx, id, body, tx),
    );
  }
  @Post('processes/:id/compensate') compensate(
    @Ctx() ctx: ExecutionContext,
    @Param('id') raw: string,
  ) {
    const id = parse(uuid, raw);
    return this.commands.run(ctx, `process.compensate:${id}`, {}, (tx) =>
      this.processes.compensate(ctx, id, tx),
    );
  }
  @Post('integration-operations/:id/receipt') receipt(
    @Ctx() ctx: ExecutionContext,
    @Param('id') raw: string,
    @Body() body: unknown,
  ) {
    const id = parse(uuid, raw);
    return this.commands.run(ctx, `integration.receipt:${id}`, body, (tx) =>
      this.integrations.callback(ctx, id, body, tx),
    );
  }
  @Get('identity/tokens') tokens(@Ctx() ctx: ExecutionContext) {
    return this.identity.tokens(ctx);
  }
  @Post('identity/tokens') issue(
    @Ctx() ctx: ExecutionContext,
    @Body() body: unknown,
  ) {
    return this.identity.issueToken(ctx, body);
  }
  @Delete('identity/tokens/:id') revoke(
    @Ctx() ctx: ExecutionContext,
    @Param('id') raw: string,
  ) {
    const id = parse(uuid, raw);
    return this.commands.run(ctx, `identity.token.revoke:${id}`, {}, (tx) =>
      this.identity.revoke(ctx, id, tx),
    );
  }
  @Post('identity/users/:id/invite') invite(
    @Ctx() ctx: ExecutionContext,
    @Param('id') raw: string,
  ) {
    requirePermission(ctx, 'identity:manage');
    const id = parse(uuid, raw);
    return this.commands.run(ctx, `identity.invite:${id}`, {}, async (tx) => {
      await this.identity.challenge(ctx, id, 'invite', tx);
      return { accepted: true };
    });
  }
  @Put('identity/users/:id/status') status(
    @Ctx() ctx: ExecutionContext,
    @Param('id') raw: string,
    @Body() body: unknown,
  ) {
    requirePermission(ctx, 'identity:manage');
    const id = parse(uuid, raw),
      input = parse(
        z.object({ status: z.enum(['active', 'disabled']) }).strict(),
        body,
      );
    if (id === ctx.actorUserId)
      throw new DomainError(
        'SELF_DISABLE',
        'Use another administrator to change your status',
      );
    return this.commands.run(
      ctx,
      `identity.status:${id}`,
      input,
      async (tx) => {
        const changed = await tx.userAccount.updateMany({
          where: { id, organization_id: ctx.organizationId },
          data: { status: input.status },
        });
        if (!changed.count)
          throw new DomainError('NOT_FOUND', 'User not found', 404);
        await tx.loginSession.updateMany({
          where: { user_id: id, terminated_at: null },
          data: { terminated_at: new Date(), terminated_reason: 'forced' },
        });
        await recordEvent(tx, ctx, 'user', id, 'UserStatusChanged', input);
        return { id, ...input };
      },
    );
  }
  @Post('auth/password') password(
    @Ctx() ctx: ExecutionContext,
    @Body() body: unknown,
  ) {
    return this.identity.changePassword(ctx, body);
  }
  @Public() @Post('auth/recover') async recover(
    @Body() raw: unknown,
    @Req() req: Request,
  ) {
    const input = parse(
      z
        .object({
          organization: z.string().min(1).max(100),
          email: z.string().email().max(300),
        })
        .strict(),
      raw,
    );
    await this.identity.throttle(`recover:${req.ip ?? 'unknown'}`, 5, 600);
    await this.identity.throttle(
      `recover-account:${input.organization}:${input.email.toLowerCase()}`,
      3,
      3600,
    );
    return this.identity.recover(input.organization, input.email);
  }
  @Public() @Post('auth/reset') async reset(
    @Body() raw: unknown,
    @Req() req: Request,
  ) {
    await this.identity.throttle(`reset:${req.ip ?? 'unknown'}`, 10, 600);
    return this.identity.consume(raw);
  }
  @Get('maintenance/calendar') calendar(
    @Ctx() ctx: ExecutionContext,
    @Query() raw: unknown,
  ) {
    const q = parse(
      z
        .object({
          from: z.string().datetime({ offset: true }),
          to: z.string().datetime({ offset: true }),
        })
        .strict(),
      raw,
    );
    if (
      new Date(q.to) <= new Date(q.from) ||
      Date.parse(q.to) - Date.parse(q.from) > 366 * 86400000
    )
      throw new DomainError('INVALID_RANGE', 'Choose up to one year');
    return this.domains.calendar(ctx, new Date(q.from), new Date(q.to));
  }
  @Post('maintenance/calendar') schedule(
    @Ctx() ctx: ExecutionContext,
    @Body() body: unknown,
  ) {
    return this.commands.run(ctx, 'maintenance.schedule', body, (tx) =>
      this.domains.schedule(ctx, body, tx),
    );
  }
  @Put('maintenance/calendar/:id/status') calendarStatus(
    @Ctx() ctx: ExecutionContext,
    @Param('id') raw: string,
    @Body() body: unknown,
  ) {
    const id = parse(uuid, raw);
    return this.commands.run(ctx, `maintenance.slot:${id}`, body, (tx) =>
      this.domains.slotStatus(ctx, id, body, tx),
    );
  }
  @Get('hr/cases') hrList(@Ctx() ctx: ExecutionContext, @Query() raw: unknown) {
    requirePermission(ctx, 'hr:read');
    requirePermission(ctx, 'work:restricted');
    const q = parse(pageQuery, raw);
    return this.db.hrCase.findMany({
      where: { organization_id: ctx.organizationId },
      take: q.limit,
      skip: q.offset,
      orderBy: { created_at: 'desc' },
    });
  }
  @Get('hr/cases/:id') hrCase(
    @Ctx() ctx: ExecutionContext,
    @Param('id') id: string,
  ) {
    return this.domains.hrCase(ctx, parse(uuid, id));
  }
  @Post('hr/cases/:id/participants') participant(
    @Ctx() ctx: ExecutionContext,
    @Param('id') raw: string,
    @Body() body: unknown,
  ) {
    const id = parse(uuid, raw);
    return this.commands.run(ctx, `hr.participant:${id}`, body, (tx) =>
      this.domains.participant(ctx, id, body, tx),
    );
  }
  @Put('hr/cases/:id/review') review(
    @Ctx() ctx: ExecutionContext,
    @Param('id') raw: string,
    @Body() body: unknown,
  ) {
    const id = parse(uuid, raw);
    return this.commands.run(ctx, `hr.review:${id}`, body, (tx) =>
      this.domains.review(ctx, id, body, tx),
    );
  }
  @Post('hr/wellbeing') wellbeing(
    @Ctx() ctx: ExecutionContext,
    @Body() body: unknown,
  ) {
    return this.commands.run(ctx, 'hr.wellbeing', body, (tx) =>
      this.domains.wellbeing(ctx, body, tx),
    );
  }
  @Get('education/groups/:id/members') members(
    @Ctx() ctx: ExecutionContext,
    @Param('id') id: string,
  ) {
    return this.domains.members(ctx, parse(uuid, id));
  }
  @Post('education/groups/:id/members') addMember(
    @Ctx() ctx: ExecutionContext,
    @Param('id') raw: string,
    @Body() body: unknown,
  ) {
    const id = parse(uuid, raw);
    return this.commands.run(ctx, `education.membership:${id}`, body, (tx) =>
      this.domains.membership(ctx, id, body, tx),
    );
  }
  @Delete('education/members/:id') removeMember(
    @Ctx() ctx: ExecutionContext,
    @Param('id') raw: string,
  ) {
    const id = parse(uuid, raw);
    return this.commands.run(ctx, `education.member.remove:${id}`, {}, (tx) =>
      this.domains.removeMember(ctx, id, tx),
    );
  }
  @Get('identity/users/:id/scopes') scopes(
    @Ctx() ctx: ExecutionContext,
    @Param('id') raw: string,
  ) {
    requirePermission(ctx, 'identity:manage');
    return this.db.userRoleAssignment.findMany({
      where: {
        user_id: parse(uuid, raw),
        user: { organization_id: ctx.organizationId },
        revoked_at: null,
        scope_type: { in: ['team', 'location', 'unit', 'custom'] },
      },
      include: { role: { select: { id: true, display_name: true } } },
    });
  }
  @Post('identity/users/:id/scopes') scope(
    @Ctx() ctx: ExecutionContext,
    @Param('id') raw: string,
    @Body() body: unknown,
  ) {
    requirePermission(ctx, 'identity:manage');
    const id = parse(uuid, raw),
      input = parse(
        z
          .object({
            role_id: uuid,
            scope_type: z.enum(['team', 'location', 'unit', 'custom']),
            scope_reference: z.string().min(1).max(200),
          })
          .strict(),
        body,
      );
    return this.commands.run(ctx, `identity.scope:${id}`, input, async (tx) => {
      const user = await tx.userAccount.findFirst({
          where: { id, organization_id: ctx.organizationId },
        }),
        role = await tx.role.findFirst({
          where: { id: input.role_id, organization_id: ctx.organizationId },
          include: { role_permissions: { include: { permission: true } } },
        });
      if (!user || !role)
        throw new DomainError('NOT_FOUND', 'User or role not found', 404);
      if (!role.role_permissions.some((p) => p.permission.code === 'work:read'))
        throw new DomainError(
          'SCOPE_ROLE_INVALID',
          'A scoped role must explicitly grant work:read',
        );
      const row = await tx.userRoleAssignment.create({
        data: {
          ...input,
          user_id: id,
          assigned_at: new Date(),
          assigned_by_user_id: ctx.actorUserId,
        },
      });
      await recordEvent(tx, ctx, 'user', id, 'ScopedRoleAssigned', {
        assignment_id: row.id,
        ...input,
      });
      return row;
    });
  }
  @Delete('identity/scopes/:id') revokeScope(
    @Ctx() ctx: ExecutionContext,
    @Param('id') raw: string,
  ) {
    requirePermission(ctx, 'identity:manage');
    const id = parse(uuid, raw);
    return this.commands.run(
      ctx,
      `identity.scope.revoke:${id}`,
      {},
      async (tx) => {
        const row = await tx.userRoleAssignment.findFirst({
          where: {
            id,
            user: { organization_id: ctx.organizationId },
            role: { organization_id: ctx.organizationId },
          },
        });
        if (!row)
          throw new DomainError('NOT_FOUND', 'Assignment not found', 404);
        await tx.userRoleAssignment.update({
          where: { id },
          data: { revoked_at: new Date() },
        });
        await recordEvent(tx, ctx, 'user', row.user_id, 'ScopedRoleRevoked', {
          assignment_id: id,
        });
        return { revoked: true };
      },
    );
  }
  @Post('identity/invitations') inviteNew(
    @Ctx() ctx: ExecutionContext,
    @Body() body: unknown,
  ) {
    return this.commands.run(ctx, 'identity.invite.new', body, (tx) =>
      this.identity.invite(ctx, body, tx),
    );
  }
}
