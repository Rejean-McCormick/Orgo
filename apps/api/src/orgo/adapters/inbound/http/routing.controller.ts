import { Inject, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Database, Commands } from '../../../platform/database';
import {
  ExecutionContext,
  parse,
  requirePermission,
  uuid,
} from '../../../platform/contracts';
import { RoutingService } from '../../../modules/orchestration/routing.service';
import { Ctx } from './boundary';
@Controller('routing')
export class RoutingController {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(Commands) private readonly commands: Commands,
    @Inject(RoutingService) private readonly routing: RoutingService,
  ) {}
  @Get('rules') list(@Ctx() ctx: ExecutionContext) {
    requirePermission(ctx, 'routing:read');
    return this.db.routingRule.findMany({
      where: { organization_id: ctx.organizationId },
      take: 100,
      orderBy: { weight: 'desc' },
    });
  }
  @Post('rules') create(@Ctx() ctx: ExecutionContext, @Body() body: unknown) {
    return this.commands.run(ctx, 'routing.create', body, (tx) =>
      this.routing.create(ctx, body, tx),
    );
  }
  @Post('tasks/:id') route(
    @Ctx() ctx: ExecutionContext,
    @Param('id') raw: string,
  ) {
    const id = parse(uuid, raw);
    return this.commands.run(ctx, `routing.apply:${id}`, {}, (tx) =>
      this.routing.apply(ctx, id, tx),
    );
  }
}
