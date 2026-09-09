import { Inject } from '@nestjs/common';
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
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
import { OperationsService } from '../../../modules/integrations/operations.service';
import { CommunicationsService } from '../../../modules/communications/communications.service';
import { InsightsService } from '../../../modules/insights/insights.service';
import { WorkService } from '../../../modules/work/public';
import { Ctx } from './boundary';

@Controller()
export class OperationsController {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(Commands) private readonly commands: Commands,
    @Inject(OperationsService) private readonly operations: OperationsService,
    @Inject(CommunicationsService)
    private readonly communications: CommunicationsService,
    @Inject(InsightsService) private readonly insights: InsightsService,
    @Inject(WorkService) private readonly work: WorkService,
  ) {}
  @Post('integration-operations') request(
    @Ctx() ctx: ExecutionContext,
    @Body() body: unknown,
  ) {
    return this.commands.run(ctx, 'integration.request', body, (tx) =>
      this.operations.request(ctx, body, ctx.idempotencyKey!, tx),
    );
  }
  @Get('integration-operations/:id') get(
    @Ctx() ctx: ExecutionContext,
    @Param('id') raw: string,
  ) {
    return this.operations.get(ctx, parse(uuid, raw));
  }
  @Get('integration-operations') async list(
    @Ctx() ctx: ExecutionContext,
    @Query() raw: unknown,
  ) {
    requirePermission(ctx, 'integrations:read');
    const q = parse(pageQuery, raw);
    const candidates = await this.db.integrationOperation.findMany({
      where: { organization_id: ctx.organizationId },
      take: q.limit,
      skip: q.offset,
      orderBy: { created_at: 'desc' },
    });
    const items = [];
    for (const row of candidates) {
      try {
        if (row.subject_type === 'task')
          await this.work.getTask(ctx, row.subject_id);
        else await this.work.getCase(ctx, row.subject_id);
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
  @Get('notifications') notifications(
    @Ctx() ctx: ExecutionContext,
    @Query() raw: unknown,
  ) {
    requirePermission(ctx, 'notifications:read');
    const q = parse(pageQuery, raw);
    return this.db.notification.findMany({
      where: {
        organization_id: ctx.organizationId,
        ...(q.status === 'unread' ? { read_at: null } : {}),
        recipient_user_id:
          ctx.actorUserId ?? '00000000-0000-0000-0000-000000000000',
      },
      take: q.limit,
      skip: q.offset,
      orderBy: { created_at: 'desc' },
    });
  }
  @Post('notifications') notify(
    @Ctx() ctx: ExecutionContext,
    @Body() body: unknown,
  ) {
    return this.commands.run(ctx, 'notification.request', body, (tx) =>
      this.communications.request(ctx, body, tx),
    );
  }
  @Get('outbox') outbox(@Ctx() ctx: ExecutionContext, @Query() raw: unknown) {
    requirePermission(ctx, 'system:manage');
    const q = parse(pageQuery, raw);
    return this.db.outboxMessage.findMany({
      where: {
        organization_id: ctx.organizationId,
        status: q.status
          ? parse(
              z.enum(['PENDING', 'PROCESSING', 'SUCCEEDED', 'DEAD']),
              q.status,
            )
          : undefined,
      },
      take: q.limit,
      skip: q.offset,
      orderBy: { created_at: 'desc' },
    });
  }
  @Post('outbox/:id/redrive') redrive(
    @Ctx() ctx: ExecutionContext,
    @Param('id') raw: string,
  ) {
    requirePermission(ctx, 'system:manage');
    const id = parse(uuid, raw);
    return this.commands.run(ctx, `outbox.redrive:${id}`, {}, async (tx) => {
      const row = await tx.outboxMessage.findFirst({
        where: { id, organization_id: ctx.organizationId },
      });
      if (!row) throw new DomainError('NOT_FOUND', 'Message not found', 404);
      const updated = await tx.outboxMessage.updateMany({
        where: { id, organization_id: ctx.organizationId, status: 'DEAD' },
        data: {
          status: 'PENDING',
          attempts: 0,
          available_at: new Date(),
          last_error: null,
        },
      });
      if (!updated.count)
        throw new DomainError(
          'NOT_DEAD',
          'Only dead messages can be redriven',
          409,
        );
      if (row.type === 'integration')
        await tx.integrationOperation.updateMany({
          where: {
            id: row.aggregate_id,
            organization_id: ctx.organizationId,
            status: 'FAILED',
          },
          data: { status: 'PENDING', error: null, completed_at: null },
        });
      await recordEvent(tx, ctx, 'outbox', id, 'OutboxRedriven', {});
      return { id, status: 'PENDING' };
    });
  }
  @Get('insights/overview') overview(@Ctx() ctx: ExecutionContext) {
    return this.insights.overview(ctx);
  }
  @Get('audit') audit(@Ctx() ctx: ExecutionContext, @Query() raw: unknown) {
    requirePermission(ctx, 'audit:read');
    requirePermission(ctx, 'work:restricted');
    const q = parse(pageQuery, raw);
    return this.db.activityLog.findMany({
      where: { organization_id: ctx.organizationId },
      take: q.limit,
      skip: q.offset,
      orderBy: { created_at: 'desc' },
    });
  }
}
