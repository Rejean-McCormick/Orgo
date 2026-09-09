import { Inject } from '@nestjs/common';
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { Commands, Database } from '../../../platform/database';
import {
  ExecutionContext,
  parse,
  uuid,
  label,
  priority,
} from '../../../platform/contracts';
import { WorkService } from '../../../modules/work/public';
import { caseJson, taskJson } from '../../../modules/work/public';
import { Ctx } from './boundary';
const statusInput = z
  .object({
    status: z.string(),
    revision: z.number().int().min(0),
    reason: z.string().max(2000).optional(),
  })
  .strict();
@Controller()
export class WorkController {
  constructor(
    @Inject(WorkService) private readonly work: WorkService,
    @Inject(Commands) private readonly commands: Commands,
    @Inject(Database) private readonly db: Database,
  ) {}
  @Get('tasks') tasks(@Ctx() ctx: ExecutionContext, @Query() query: unknown) {
    return this.work.listTasks(ctx, query);
  }
  @Get('tasks/:id') async task(
    @Ctx() ctx: ExecutionContext,
    @Param('id') raw: string,
  ) {
    const id = parse(uuid, raw);
    const task = await this.work.getTask(ctx, id);
    const [comments, timeline] = await Promise.all([
      this.db.taskComment.findMany({
        where: { task_id: id },
        take: 100,
        orderBy: { created_at: 'desc' },
      }),
      this.db.workEvent.findMany({
        where: {
          organization_id: ctx.organizationId,
          aggregate_type: 'task',
          aggregate_id: id,
        },
        take: 100,
        orderBy: { created_at: 'desc' },
      }),
    ]);
    return { ...taskJson(task), comments, timeline };
  }
  @Post('tasks') createTask(
    @Ctx() ctx: ExecutionContext,
    @Body() body: unknown,
  ) {
    return this.commands.run(ctx, 'task.create', body, async (tx) =>
      taskJson(await this.work.createTask(ctx, body, tx)),
    );
  }
  @Patch('tasks/:id/status') async status(
    @Ctx() ctx: ExecutionContext,
    @Param('id') raw: string,
    @Body() body: unknown,
  ) {
    const id = parse(uuid, raw);
    const input = parse(statusInput, body);
    await this.work.getTask(ctx, id);
    return this.commands.run(ctx, `task.status:${id}`, input, async (tx) =>
      taskJson(
        await this.work.changeTaskStatus(
          ctx,
          id,
          input.status,
          input.revision,
          tx,
          input.reason,
        ),
      ),
    );
  }
  @Patch('tasks/:id/assignment') async assign(
    @Ctx() ctx: ExecutionContext,
    @Param('id') raw: string,
    @Body() body: unknown,
  ) {
    const id = parse(uuid, raw);
    await this.work.getTask(ctx, id);
    return this.commands.run(ctx, `task.assign:${id}`, body, async (tx) =>
      taskJson(await this.work.assign(ctx, id, body, tx)),
    );
  }
  @Patch('tasks/:id') async patch(
    @Ctx() ctx: ExecutionContext,
    @Param('id') raw: string,
    @Body() body: unknown,
  ) {
    const id = parse(uuid, raw);
    const { revision, ...input } = parse(
      z
        .object({
          revision: z.number().int().min(0),
          title: z.string().trim().min(1).max(500).optional(),
          description: z.string().max(20000).optional(),
          label: label.optional(),
          priority: priority.optional(),
          due_at: z.string().datetime({ offset: true }).optional(),
          metadata: z.record(z.unknown()).optional(),
        })
        .strict(),
      body,
    );
    await this.work.getTask(ctx, id);
    return this.commands.run(ctx, `task.patch:${id}`, body, async (tx) =>
      taskJson(await this.work.patchTask(ctx, id, input, revision, tx)),
    );
  }
  @Post('tasks/:id/comments') async comment(
    @Ctx() ctx: ExecutionContext,
    @Param('id') raw: string,
    @Body() body: unknown,
  ) {
    const id = parse(uuid, raw);
    const input = parse(
      z
        .object({
          body: z.string().trim().min(1).max(20000),
          visibility: z
            .enum(['internal_only', 'requester_visible', 'org_wide'])
            .default('internal_only'),
        })
        .strict(),
      body,
    );
    await this.work.getTask(ctx, id);
    return this.commands.run(ctx, `task.comment:${id}`, input, (tx) =>
      this.work.comment(ctx, id, input.body, input.visibility, tx),
    );
  }
  @Get('cases') cases(@Ctx() ctx: ExecutionContext, @Query() query: unknown) {
    return this.work.listCases(ctx, query);
  }
  @Get('cases/:id') case(
    @Ctx() ctx: ExecutionContext,
    @Param('id') raw: string,
  ) {
    return this.work.caseWorkspace(ctx, parse(uuid, raw));
  }
  @Post('cases') createCase(
    @Ctx() ctx: ExecutionContext,
    @Body() body: unknown,
  ) {
    return this.commands.run(ctx, 'case.create', body, async (tx) =>
      caseJson(await this.work.createCase(ctx, body, tx)),
    );
  }
  @Patch('cases/:id/status') async caseStatus(
    @Ctx() ctx: ExecutionContext,
    @Param('id') raw: string,
    @Body() body: unknown,
  ) {
    const id = parse(uuid, raw);
    const input = parse(statusInput, body);
    await this.work.getCase(ctx, id);
    return this.commands.run(ctx, `case.status:${id}`, input, async (tx) =>
      caseJson(
        await this.work.changeCaseStatus(
          ctx,
          id,
          input.status,
          input.revision,
          tx,
        ),
      ),
    );
  }
  @Patch('cases/:id') async patchCase(
    @Ctx() ctx: ExecutionContext,
    @Param('id') raw: string,
    @Body() body: unknown,
  ) {
    const id = parse(uuid, raw);
    await this.work.getCase(ctx, id);
    return this.commands.run(ctx, `case.patch:${id}`, body, async (tx) =>
      caseJson(await this.work.patchCase(ctx, id, body, tx)),
    );
  }
  @Patch('tasks/:id/case') async linkCase(
    @Ctx() ctx: ExecutionContext,
    @Param('id') raw: string,
    @Body() body: unknown,
  ) {
    const id = parse(uuid, raw);
    await this.work.getTask(ctx, id);
    return this.commands.run(ctx, `task.case:${id}`, body, async (tx) =>
      taskJson(await this.work.linkCase(ctx, id, body, tx)),
    );
  }
}
