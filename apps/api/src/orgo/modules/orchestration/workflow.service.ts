import { Inject } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { load, dump, JSON_SCHEMA } from 'js-yaml';
import { Database, json, lock, recordEvent, Tx } from '../../platform/database';
import {
  DomainError,
  ExecutionContext,
  hash,
  parse,
  requirePermission,
} from '../../platform/contracts';
import { evaluate } from './evaluator';
import { workflowSchema, WorkflowContext } from './workflow.contract';
import { ActionExecutor } from './actions';

@Injectable()
export class WorkflowService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(ActionExecutor) private readonly executor: ActionExecutor,
  ) {}
  async publish(ctx: ExecutionContext, code: string, raw: unknown, tx: Tx) {
    requirePermission(ctx, 'workflows:write');
    const content = parse(workflowSchema, raw);
    const digest = hash(content);
    await lock(tx, `${ctx.organizationId}:workflow:${code}`);
    let definition = await tx.workflowDefinition.findUnique({
      where: {
        organization_id_code: { organization_id: ctx.organizationId, code },
      },
    });
    const previous = definition
      ? await tx.workflowVersion.findFirst({
          where: { workflow_definition_id: definition.id },
          orderBy: { version: 'desc' },
        })
      : null;
    if (previous?.content_hash === digest) return previous;
    const version = (previous?.version ?? 0) + 1;
    if (!definition)
      definition = await tx.workflowDefinition.create({
        data: {
          organization_id: ctx.organizationId,
          code,
          name: code,
          description: '',
          definition_blob: json(content),
          version,
          is_active: true,
        },
      });
    else
      await tx.workflowDefinition.update({
        where: { id: definition.id },
        data: { version, definition_blob: json(content) },
      });
    const row = await tx.workflowVersion.create({
      data: {
        workflow_definition_id: definition.id,
        version,
        content: json(content),
        content_hash: digest,
      },
    });
    await recordEvent(tx, ctx, 'workflow', definition.id, 'WorkflowPublished', {
      version_id: row.id,
      version,
      content_hash: digest,
    });
    return row;
  }
  parseYaml(raw: string) {
    if (Buffer.byteLength(raw) > 250000)
      throw new DomainError(
        'WORKFLOW_TOO_LARGE',
        'Workflow import exceeds 250 KB',
      );
    try {
      return parse(workflowSchema, load(raw, { schema: JSON_SCHEMA }));
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError('INVALID_YAML', 'Invalid workflow YAML');
    }
  }
  async version(ctx: ExecutionContext, id: string, tx: Tx = this.db) {
    const row = await tx.workflowVersion.findFirst({
      where: { id, definition: { organization_id: ctx.organizationId } },
    });
    if (!row)
      throw new DomainError('NOT_FOUND', 'Workflow version not found', 404);
    return row;
  }
  async simulate(
    ctx: ExecutionContext,
    versionId: string,
    context: WorkflowContext,
  ) {
    requirePermission(ctx, 'workflows:read');
    const version = await this.version(ctx, versionId);
    return {
      version_id: version.id,
      content_hash: version.content_hash,
      actions: evaluate(parse(workflowSchema, version.content), {
        ...context,
        organizationId: ctx.organizationId,
      }),
    };
  }
  async export(ctx: ExecutionContext, versionId: string) {
    requirePermission(ctx, 'workflows:read');
    return dump((await this.version(ctx, versionId)).content, { noRefs: true });
  }
  async execute(
    ctx: ExecutionContext,
    versionId: string,
    context: WorkflowContext,
    bindings: Record<string, unknown>,
    tx: Tx,
    signalId?: string,
  ) {
    requirePermission(ctx, 'workflows:execute');
    const version = await this.version(ctx, versionId, tx);
    const definition = await tx.workflowDefinition.findUniqueOrThrow({
      where: { id: version.workflow_definition_id },
    });
    if (!definition.is_active)
      throw new DomainError('WORKFLOW_DISABLED', 'Workflow is disabled', 409);
    const actions = evaluate(parse(workflowSchema, version.content), {
      ...context,
      organizationId: ctx.organizationId,
    });
    const instance = await tx.workflowInstance.create({
      data: {
        organization_id: ctx.organizationId,
        workflow_definition_id: definition.id,
        workflow_version_id: version.id,
        signal_id: signalId,
        status: 'running',
        current_state: 'APPLYING_ACTIONS',
        started_at: new Date(),
        resolved_actions: json(actions),
      },
    });
    const result = await this.executor.execute(
      { ...ctx, causationId: instance.id },
      actions,
      bindings,
      instance.id,
      tx,
    );
    // Completion means internal actions applied and external intents durably queued, not remotely approved.
    await tx.workflowInstance.update({
      where: { id: instance.id },
      data: {
        status: 'completed',
        current_state: 'ACTIONS_COMMITTED',
        completed_at: new Date(),
        task_id:
          typeof result.bindings.task === 'string'
            ? result.bindings.task
            : undefined,
      },
    });
    await recordEvent(tx, ctx, 'workflow', instance.id, 'WorkflowExecuted', {
      version_id: version.id,
      action_count: actions.length,
    });
    return { instance_id: instance.id, ...result };
  }
}
