import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { z } from 'zod';
import { Commands, Database, recordEvent } from '../../../platform/database';
import {
  DomainError,
  ExecutionContext,
  pageQuery,
  parse,
  requirePermission,
  text,
  uuid,
} from '../../../platform/contracts';
import { WorkService } from '../../../modules/work/public';
import { CommunicationsService } from '../../../modules/communications/communications.service';
import { renderTemplate } from '../../../modules/communications/templates';
import { Ctx } from './boundary';
function csvCell(value: unknown) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
@Controller()
export class ProductOperationsController {
  constructor(
    @Inject(Database) private db: Database,
    @Inject(Commands) private commands: Commands,
    @Inject(WorkService) private work: WorkService,
    @Inject(CommunicationsService)
    private communications: CommunicationsService,
  ) {}
  @Get('communications/templates') templates(@Ctx() ctx: ExecutionContext) {
    requirePermission(ctx, 'notifications:write');
    return this.db.notificationTemplate.findMany({
      where: { organization_id: ctx.organizationId },
      take: 100,
      orderBy: { code: 'asc' },
    });
  }
  @Put('communications/templates/:code') template(
    @Ctx() ctx: ExecutionContext,
    @Param('code') raw: string,
    @Body() body: unknown,
  ) {
    requirePermission(ctx, 'notifications:write');
    const code = parse(text, raw),
      input = parse(
        z
          .object({
            version: z.number().int().min(0),
            channel: z.enum(['email', 'in_app', 'sms', 'webhook']),
            subject_template: text,
            body_template: z.string().min(1).max(20000),
            is_active: z.boolean().default(true),
          })
          .strict(),
        body,
      );
    return this.commands.run(
      ctx,
      `template.save:${code}`,
      input,
      async (tx) => {
        const old = await tx.notificationTemplate.findUnique({
          where: {
            organization_id_code: { organization_id: ctx.organizationId, code },
          },
        });
        const { version, ...fields } = input;
        let row;
        if (!old && version === 0)
          row = await tx.notificationTemplate.create({
            data: {
              ...fields,
              code,
              organization_id: ctx.organizationId,
              version: 1,
            },
          });
        else {
          const changed = await tx.notificationTemplate.updateMany({
            where: { organization_id: ctx.organizationId, code, version },
            data: { ...fields, version: { increment: 1 } },
          });
          if (!changed.count)
            throw new DomainError(
              'REVISION_CONFLICT',
              'Template changed; reload',
              409,
            );
          row = await tx.notificationTemplate.findUniqueOrThrow({
            where: {
              organization_id_code: {
                organization_id: ctx.organizationId,
                code,
              },
            },
          });
        }
        await recordEvent(
          tx,
          ctx,
          'notification_template',
          row.id,
          'TemplatePublished',
          { version: row.version },
        );
        return row;
      },
    );
  }
  @Post('communications/templates/:code/send') sendTemplate(
    @Ctx() ctx: ExecutionContext,
    @Param('code') raw: string,
    @Body() body: unknown,
  ) {
    requirePermission(ctx, 'notifications:write');
    const code = parse(text, raw),
      input = parse(
        z
          .object({
            variables: z.record(z.string().max(10000)).default({}),
            recipient_user_id: uuid.optional(),
            recipient_address: z.string().min(1).max(500).optional(),
            related_task_id: uuid.optional(),
          })
          .strict(),
        body,
      );
    return this.commands.run(
      ctx,
      `template.send:${code}`,
      input,
      async (tx) => {
        const template = await tx.notificationTemplate.findFirst({
          where: { organization_id: ctx.organizationId, code, is_active: true },
        });
        if (!template)
          throw new DomainError('NOT_FOUND', 'Template not found', 404);
        const { variables, ...recipient } = input;
        const row = await this.communications.request(
          ctx,
          {
            ...recipient,
            channel: template.channel,
            subject: renderTemplate(
              template.subject_template ?? code,
              variables,
            ),
            body: renderTemplate(template.body_template, variables),
          },
          tx,
        );
        await tx.notification.update({
          where: { id: row.id },
          data: { template_id: template.id },
        });
        return row;
      },
    );
  }
  @Put('notifications/:id/read') read(
    @Ctx() ctx: ExecutionContext,
    @Param('id') raw: string,
  ) {
    requirePermission(ctx, 'notifications:read');
    const id = parse(uuid, raw);
    return this.commands.run(ctx, `notification.read:${id}`, {}, async (tx) => {
      if (!ctx.actorUserId)
        throw new DomainError('USER_REQUIRED', 'User session required', 403);
      const changed = await tx.notification.updateMany({
        where: {
          id,
          organization_id: ctx.organizationId,
          recipient_user_id: ctx.actorUserId,
        },
        data: { read_at: new Date() },
      });
      if (!changed.count)
        throw new DomainError('NOT_FOUND', 'Notification not found', 404);
      return { id, read: true };
    });
  }
  @Get('reports/tasks.csv') async exportTasks(
    @Ctx() ctx: ExecutionContext,
    @Query() raw: unknown,
    @Res() res: Response,
  ) {
    requirePermission(ctx, 'insights:read');
    this.work.requireAny(ctx, 'work:read');
    const q = parse(
      z
        .object({
          offset: z.coerce.number().int().min(0).default(0),
          limit: z.coerce.number().int().min(1).max(5000).default(1000),
        })
        .strict(),
      raw,
    );
    const items = await this.db.task.findMany({
      where: this.work.taskScope(ctx),
      skip: q.offset,
      take: q.limit,
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        label: true,
        owner_user_id: true,
        created_at: true,
        due_at: true,
      },
    });
    const fields = [
      'id',
      'title',
      'status',
      'priority',
      'label',
      'owner_user_id',
      'created_at',
      'due_at',
    ] as const;
    res
      .type('text/csv')
      .setHeader(
        'Content-Disposition',
        'attachment; filename="orgo-tasks.csv"',
      );
    res.send(
      '\uFEFF' +
        [
          fields.join(','),
          ...items.map((row) =>
            fields
              .map((k) =>
                csvCell(
                  row[k] instanceof Date
                    ? (row[k] as Date).toISOString()
                    : row[k],
                ),
              )
              .join(','),
          ),
        ].join('\r\n'),
    );
  }
  @Get('system/overview') async system(@Ctx() ctx: ExecutionContext) {
    requirePermission(ctx, 'system:manage');
    const [outbox, processes, workers, oldest] = await Promise.all([
      this.db.outboxMessage.groupBy({
        by: ['status'],
        where: { organization_id: ctx.organizationId },
        _count: { _all: true },
      }),
      this.db.durableProcess.groupBy({
        by: ['status'],
        where: { organization_id: ctx.organizationId },
        _count: { _all: true },
      }),
      this.db.workerHeartbeat.findMany({
        where: { last_seen_at: { gte: new Date(Date.now() - 86400000) } },
        orderBy: { last_seen_at: 'desc' },
        take: 100,
      }),
      this.db.outboxMessage.findFirst({
        where: { organization_id: ctx.organizationId, status: 'PENDING' },
        orderBy: { available_at: 'asc' },
        select: { available_at: true },
      }),
    ]);
    return {
      outbox,
      processes,
      workers: workers.map((w) => ({
        ...w,
        healthy: Date.now() - w.last_seen_at.getTime() < 90000,
      })),
      oldest_pending_seconds: oldest
        ? Math.max(0, (Date.now() - oldest.available_at.getTime()) / 1000)
        : 0,
    };
  }
  @Get('system/metrics') async metrics(
    @Ctx() ctx: ExecutionContext,
    @Res() res: Response,
  ) {
    const data = await this.system(ctx);
    const lines = [
      '# TYPE orgo_outbox_messages gauge',
      ...data.outbox.map(
        (r) => `orgo_outbox_messages{status="${r.status}"} ${r._count._all}`,
      ),
      '# TYPE orgo_processes gauge',
      ...data.processes.map(
        (r) => `orgo_processes{status="${r.status}"} ${r._count._all}`,
      ),
      '# TYPE orgo_worker_healthy gauge',
      `orgo_worker_healthy ${data.workers.filter((w) => w.healthy).length}`,
      '# TYPE orgo_oldest_pending_seconds gauge',
      `orgo_oldest_pending_seconds ${data.oldest_pending_seconds}`,
    ];
    res.type('text/plain; version=0.0.4').send(lines.join('\n') + '\n');
  }
  @Post('system/retention') retention(
    @Ctx() ctx: ExecutionContext,
    @Body() body: unknown,
  ) {
    requirePermission(ctx, 'system:manage');
    const input = parse(
      z
        .object({
          days: z.number().int().min(30).max(3650),
          purge_deleted_attachments: z.boolean().default(false),
        })
        .strict(),
      body,
    );
    return this.commands.run(ctx, 'system.retention', input, async (tx) => {
      const before = new Date(Date.now() - input.days * 86400000);
      const outbox = await tx.outboxMessage.deleteMany({
        where: {
          organization_id: ctx.organizationId,
          status: 'SUCCEEDED',
          completed_at: { lt: before },
        },
      });
      const challenges = await tx.identityChallenge.deleteMany({
        where: {
          organization_id: ctx.organizationId,
          expires_at: { lt: before },
        },
      });
      const attachments = input.purge_deleted_attachments
        ? await tx.workAttachment.updateMany({
            where: {
              organization_id: ctx.organizationId,
              deleted_at: { lt: before },
            },
            data: { content: Buffer.alloc(0) },
          })
        : { count: 0 };
      await recordEvent(
        tx,
        ctx,
        'organization',
        ctx.organizationId,
        'RetentionApplied',
        {
          ...input,
          outbox: outbox.count,
          challenges: challenges.count,
          attachments: attachments.count,
        },
      );
      return {
        outbox: outbox.count,
        challenges: challenges.count,
        attachments: attachments.count,
      };
    });
  }
}
