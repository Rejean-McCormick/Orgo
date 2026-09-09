import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  ExecutionContext,
  parse,
  requirePermission,
  category,
  priority,
  text,
  uuid,
  label,
} from '../../platform/contracts';
import { Database, recordEvent, Tx } from '../../platform/database';
import { WorkService } from '../work/public';
export const routingInput = z
  .object({
    name: text,
    task_type: text.optional(),
    task_category: category.optional(),
    label_codes: z.array(label).max(100).default([]),
    priority_min: priority.optional(),
    target_role_id: uuid.optional(),
    target_user_id: uuid.optional(),
    is_fallback: z.boolean().default(false),
    weight: z.number().int().min(0).max(10000).default(100),
  })
  .strict()
  .refine(
    (v) => v.target_role_id || v.target_user_id,
    'A routing target is required',
  );
const rank = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
@Injectable()
export class RoutingService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(WorkService) private readonly work: WorkService,
  ) {}
  async create(ctx: ExecutionContext, raw: unknown, tx: Tx) {
    requirePermission(ctx, 'routing:write');
    const input = parse(routingInput, raw);
    await this.work.validateOwners(
      ctx,
      {
        owner_user_id: input.target_user_id,
        owner_role_id: input.target_role_id,
      },
      tx,
    );
    const row = await tx.routingRule.create({
      data: { ...input, organization_id: ctx.organizationId },
    });
    await recordEvent(tx, ctx, 'routing', row.id, 'RoutingRuleCreated', {});
    return row;
  }
  async apply(ctx: ExecutionContext, taskId: string, tx: Tx) {
    requirePermission(ctx, 'work:assign');
    const task = await this.work.getTask(ctx, taskId, tx);
    const rules = await tx.routingRule.findMany({
      where: { organization_id: ctx.organizationId },
      orderBy: [{ is_fallback: 'asc' }, { weight: 'desc' }, { id: 'asc' }],
    });
    const rule = rules.find(
      (r) =>
        (!r.task_type || r.task_type === task.type) &&
        (!r.task_category || r.task_category === task.category) &&
        (!r.label_codes.length ||
          r.label_codes.some(
            (prefix) =>
              task.label === prefix || task.label.startsWith(`${prefix}.`),
          )) &&
        (!r.priority_min || rank[task.priority] >= rank[r.priority_min]),
    );
    if (!rule) return { task_id: taskId, routed: false };
    await this.work.assign(
      ctx,
      taskId,
      {
        owner_user_id: rule.target_user_id,
        owner_role_id: rule.target_role_id,
        revision: task.revision,
        reason: `Routing rule ${rule.id}`,
      },
      tx,
    );
    return { task_id: taskId, routed: true, rule_id: rule.id };
  }
}
