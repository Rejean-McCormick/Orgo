import { ProcessManager } from './process-manager.service';
import { RoutingService } from './routing.service';
import { Inject } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  ExecutionContext,
  parse,
  uuid,
  text,
  label,
  priority,
} from '../../platform/contracts';
import { Tx } from '../../platform/database';
import { WorkService } from '../work/public';
import { OperationsService } from '../integrations/operations.service';
import { CommunicationsService } from '../communications/communications.service';
import { ResolvedAction } from './workflow.contract';
import { resolveInput } from './evaluator';

@Injectable()
export class ActionExecutor {
  constructor(
    @Inject(ProcessManager) private readonly processes: ProcessManager,
    @Inject(RoutingService) private readonly routing: RoutingService,
    @Inject(WorkService) private readonly work: WorkService,
    @Inject(OperationsService) private readonly operations: OperationsService,
    @Inject(CommunicationsService)
    private readonly communications: CommunicationsService,
  ) {}
  async execute(
    ctx: ExecutionContext,
    actions: ResolvedAction[],
    initial: Record<string, unknown>,
    instanceId: string,
    tx: Tx,
  ) {
    const bindings = { ...initial };
    const results: unknown[] = [];
    for (const item of actions) {
      const input = resolveInput(item.action.input, bindings);
      const target = item.action.target
        ? parse(uuid, resolveInput(item.action.target, bindings))
        : undefined;
      switch (item.action.type) {
        case 'CREATE_CASE': {
          const row = await this.work.createCase(ctx, input, tx);
          bindings.case = row.id;
          results.push({ case_id: row.id });
          break;
        }
        case 'CREATE_TASK': {
          const row = await this.work.createTask(ctx, input, tx);
          bindings.task = row.id;
          results.push({ task_id: row.id });
          break;
        }
        case 'UPDATE_TASK':
        case 'ESCALATE': {
          const id = parse(uuid, target ?? bindings.task);
          const row = await this.work.getTask(ctx, id, tx);
          const update = parse(
            z
              .object({
                status: text.optional(),
                reason: z.string().max(2000).optional(),
              })
              .strict(),
            input,
          );
          results.push(
            await this.work.changeTaskStatus(
              ctx,
              id,
              item.action.type === 'ESCALATE'
                ? 'ESCALATED'
                : parse(text, update.status),
              row.revision,
              tx,
              update.reason,
            ),
          );
          break;
        }
        case 'ASSIGN_TASK':
        case 'ROUTE': {
          const id = parse(uuid, target ?? bindings.task);
          const row = await this.work.getTask(ctx, id, tx);
          const data = parse(z.record(z.unknown()), input);
          if (item.action.type === 'ROUTE' && Object.keys(data).length === 0) {
            results.push(await this.routing.apply(ctx, id, tx));
            break;
          }
          results.push(
            await this.work.assign(
              ctx,
              id,
              { ...data, revision: row.revision },
              tx,
            ),
          );
          break;
        }
        case 'ADD_LABEL': {
          const id = parse(uuid, target ?? bindings.task);
          const data = parse(z.object({ label }).strict(), input);
          results.push(await this.work.addLabel(ctx, id, data.label, tx));
          break;
        }
        case 'SET_METADATA':
        case 'ATTACH_TEMPLATE': {
          const id = parse(uuid, target ?? bindings.task);
          const row = await this.work.getTask(ctx, id, tx);
          const data =
            item.action.type === 'SET_METADATA'
              ? { metadata: parse(z.record(z.unknown()), input) }
              : {
                  metadata: parse(
                    z.object({ template_id: text }).strict(),
                    input,
                  ),
                };
          results.push(
            await this.work.patchTask(ctx, id, data, row.revision, tx),
          );
          break;
        }
        case 'NOTIFY':
          results.push(await this.communications.request(ctx, input, tx));
          break;
        case 'START_PROCESS':
          results.push(await this.processes.create(ctx, input, tx));
          break;
        case 'REQUEST_INTEGRATION':
          results.push(
            await this.operations.request(
              ctx,
              input,
              `${instanceId}:${item.ruleId}:${item.actionIndex}`,
              tx,
            ),
          );
          break;
      }
    }
    return { bindings, results };
  }
}
