import { Inject } from '@nestjs/common';
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Commands, Database } from '../../../platform/database';
import {
  ExecutionContext,
  pageQuery,
  parse,
  requirePermission,
  uuid,
} from '../../../platform/contracts';
import {
  IntakeService,
  signalJson,
} from '../../../modules/intake/intake.service';
import { WorkflowService } from '../../../modules/orchestration/public';
import { WorkService } from '../../../modules/work/public';
import { Ctx } from './boundary';
const contextSchema = z
  .object({
    source: z.enum(['EMAIL', 'API', 'SYSTEM', 'TIMER']),
    type: z.string().optional(),
    category: z.string().optional(),
    severity: z.string().optional(),
    label: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();
@Controller()
export class ProcessController {
  constructor(
    @Inject(IntakeService) private readonly intake: IntakeService,
    @Inject(WorkflowService) private readonly workflow: WorkflowService,
    @Inject(WorkService) private readonly work: WorkService,
    @Inject(Database) private readonly db: Database,
    @Inject(Commands) private readonly commands: Commands,
  ) {}
  @Get('signals') async signals(
    @Ctx() ctx: ExecutionContext,
    @Query() raw: unknown,
  ) {
    requirePermission(ctx, 'signals:read');
    const q = parse(pageQuery, raw);
    const where = {
      organization_id: ctx.organizationId,
      case_id: q.case_id,
      AND: [{ OR: [{ case_id: null }, { case: this.work.caseScope(ctx) }] }],
      status: q.status
        ? parse(z.enum(['RECEIVED', 'PROCESSED', 'REJECTED']), q.status)
        : undefined,
      ...(q.search
        ? { title: { contains: q.search, mode: 'insensitive' as const } }
        : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.signal.findMany({
        where,
        take: q.limit,
        skip: q.offset,
        orderBy: [{ received_at: 'desc' }, { id: 'desc' }],
      }),
      this.db.signal.count({ where }),
    ]);
    return {
      items: items.map(signalJson),
      total,
      limit: q.limit,
      offset: q.offset,
    };
  }
  @Get('signals/:id') async signal(
    @Ctx() ctx: ExecutionContext,
    @Param('id') id: string,
  ) {
    return signalJson(await this.intake.get(ctx, parse(uuid, id)));
  }
  @Post('signals') accept(@Ctx() ctx: ExecutionContext, @Body() body: unknown) {
    return this.commands.run(ctx, 'signal.accept', body, async (tx) =>
      signalJson(await this.intake.accept(ctx, body, tx)),
    );
  }
  @Post('signals/:id/process') process(
    @Ctx() ctx: ExecutionContext,
    @Param('id') raw: string,
    @Body() body: unknown,
  ) {
    const id = parse(uuid, raw);
    const input = parse(z.object({ workflow_version_id: uuid }).strict(), body);
    return this.commands.run(ctx, `signal.process:${id}`, input, (tx) =>
      this.intake.queue(ctx, id, input.workflow_version_id, tx),
    );
  }
  @Get('workflows') workflows(@Ctx() ctx: ExecutionContext) {
    requirePermission(ctx, 'workflows:read');
    return this.db.workflowDefinition.findMany({
      where: { organization_id: ctx.organizationId },
      include: { versions: { orderBy: { version: 'desc' } } },
      take: 100,
      orderBy: { code: 'asc' },
    });
  }
  @Post('workflows/:code/versions') publish(
    @Ctx() ctx: ExecutionContext,
    @Param('code') raw: string,
    @Body() body: unknown,
  ) {
    const code = parse(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,99}$/), raw);
    return this.commands.run(ctx, `workflow.publish:${code}`, body, (tx) =>
      this.workflow.publish(ctx, code, body, tx),
    );
  }
  @Post('workflows/:code/import') import(
    @Ctx() ctx: ExecutionContext,
    @Param('code') raw: string,
    @Body() body: unknown,
  ) {
    const code = parse(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,99}$/), raw);
    const input = parse(
      z.object({ yaml: z.string().max(250000) }).strict(),
      body,
    );
    return this.commands.run(ctx, `workflow.publish:${code}`, input, (tx) =>
      this.workflow.publish(ctx, code, this.workflow.parseYaml(input.yaml), tx),
    );
  }
  @Get('workflow-versions/:id/export') export(
    @Ctx() ctx: ExecutionContext,
    @Param('id') raw: string,
  ) {
    return this.workflow.export(ctx, parse(uuid, raw));
  }
  @Post('workflow-versions/:id/simulate') simulate(
    @Ctx() ctx: ExecutionContext,
    @Param('id') raw: string,
    @Body() body: unknown,
  ) {
    return this.workflow.simulate(ctx, parse(uuid, raw), {
      ...parse(contextSchema, body),
      organizationId: ctx.organizationId,
    });
  }
  @Post('workflow-versions/:id/execute') execute(
    @Ctx() ctx: ExecutionContext,
    @Param('id') raw: string,
    @Body() body: unknown,
  ) {
    const id = parse(uuid, raw);
    const input = parse(contextSchema, body);
    return this.commands.run(ctx, `workflow.execute:${id}`, input, (tx) =>
      this.workflow.execute(
        ctx,
        id,
        { ...input, organizationId: ctx.organizationId },
        {},
        tx,
      ),
    );
  }
}
