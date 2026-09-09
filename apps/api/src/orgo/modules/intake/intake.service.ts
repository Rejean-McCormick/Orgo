import type { Signal } from '@prisma/client';
import { Inject } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  Database,
  enqueue,
  json,
  lock,
  recordEvent,
  Tx,
} from '../../platform/database';
import {
  category,
  DomainError,
  ExecutionContext,
  hash,
  label,
  parse,
  requirePermission,
  severity,
  source,
  text,
  uuid,
} from '../../platform/contracts';
import { WorkflowService } from '../orchestration/public';
import { WorkService } from '../work/public';

export const signalInput = z
  .object({
    source,
    external_reference: z.string().min(1).max(500).optional(),
    type: text,
    category,
    classification: z.string().max(200).optional(),
    severity: severity.default('MODERATE'),
    label,
    title: text,
    description: z.string().max(20000).default(''),
    payload: z.record(z.unknown()).default({}),
    case_id: uuid.optional(),
    workflow_version_id: uuid.optional(),
  })
  .strict();
export function signalJson(row: Signal) {
  const { id, request_hash, ...rest } = row;
  return { signal_id: id, ...rest };
}
@Injectable()
export class IntakeService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(WorkflowService) private readonly workflow: WorkflowService,
    @Inject(WorkService) private readonly work: WorkService,
  ) {}
  async accept(ctx: ExecutionContext, raw: unknown, tx: Tx) {
    requirePermission(ctx, 'signals:write');
    const input = parse(signalInput, raw);
    if (input.case_id) await this.work.getCase(ctx, input.case_id, tx);
    if (input.workflow_version_id) {
      requirePermission(ctx, 'workflows:execute');
      await this.workflow.version(ctx, input.workflow_version_id, tx);
    }
    if (input.external_reference) {
      await lock(
        tx,
        `${ctx.organizationId}:signal:${input.source}:${input.external_reference}`,
      );
      const existing = await tx.signal.findFirst({
        where: {
          organization_id: ctx.organizationId,
          source: input.source,
          external_reference: input.external_reference,
        },
      });
      if (existing) {
        if (existing.request_hash !== hash(input))
          throw new DomainError(
            'EXTERNAL_REFERENCE_CONFLICT',
            'External reference already contains different input',
            409,
          );
        return existing;
      }
    }
    const { workflow_version_id, ...fields } = input;
    const row = await tx.signal.create({
      data: {
        ...fields,
        payload: json(input.payload),
        organization_id: ctx.organizationId,
        idempotency_key: ctx.idempotencyKey!,
        request_hash: hash(input),
        correlation_id: ctx.correlationId,
      },
    });
    await recordEvent(tx, ctx, 'signal', row.id, 'SignalReceived', {
      source: input.source,
    });
    if (input.case_id)
      await recordEvent(tx, ctx, 'case', input.case_id, 'SignalLinked', {
        signal_id: row.id,
      });
    if (workflow_version_id)
      await this.queue(ctx, row.id, workflow_version_id, tx);
    return row;
  }
  async queue(
    ctx: ExecutionContext,
    signalId: string,
    versionId: string,
    tx: Tx,
  ) {
    requirePermission(ctx, 'workflows:execute');
    const signal = await this.get(ctx, signalId, tx);
    if (signal.status !== 'RECEIVED')
      throw new DomainError(
        'SIGNAL_PROCESSED',
        'Signal already processed',
        409,
      );
    await this.workflow.version(ctx, versionId, tx);
    return enqueue(tx, ctx, 'signal', signalId, {
      workflow_version_id: versionId,
      actor_user_id: ctx.actorUserId,
      api_token_id: ctx.apiTokenId ?? null,
    });
  }
  async get(ctx: ExecutionContext, id: string, tx: Tx = this.db) {
    requirePermission(ctx, 'signals:read');
    const row = await tx.signal.findFirst({
      where: { id, organization_id: ctx.organizationId },
    });
    if (!row) throw new DomainError('NOT_FOUND', 'Signal not found', 404);
    if (row.case_id) await this.work.getCase(ctx, row.case_id, tx);
    return row;
  }
  async process(
    ctx: ExecutionContext,
    signalId: string,
    versionId: string,
    tx: Tx,
  ) {
    await lock(tx, `${ctx.organizationId}:process-signal:${signalId}`);
    const signal = await this.get(ctx, signalId, tx);
    if (signal.status === 'PROCESSED') return signal;
    const result = await this.workflow.execute(
      { ...ctx, source: signal.source },
      versionId,
      {
        organizationId: ctx.organizationId,
        source: signal.source === 'email' ? 'EMAIL' : 'API',
        type: signal.type,
        category: signal.category,
        severity: signal.severity,
        label: signal.label,
        title: signal.title,
        description: signal.description,
        metadata: signal.payload as Record<string, unknown>,
      },
      {
        case: signal.case_id ?? undefined,
        'signal.id': signal.id,
        'signal.source': signal.source,
        'signal.title': signal.title,
        'signal.description': signal.description,
        'signal.label': signal.label,
        'signal.type': signal.type,
        'signal.category': signal.category,
        'signal.severity': signal.severity,
        'signal.payload': signal.payload,
      },
      tx,
      signal.id,
    );
    const resultingCase =
      typeof result.bindings.case === 'string'
        ? result.bindings.case
        : signal.case_id;
    if (resultingCase) await this.work.getCase(ctx, resultingCase, tx);
    for (const r of result.results) {
      const ref = z.object({ task_id: uuid }).safeParse(r);
      if (ref.success)
        await tx.signalTask.upsert({
          where: {
            signal_id_task_id: {
              signal_id: signalId,
              task_id: ref.data.task_id,
            },
          },
          create: {
            organization_id: ctx.organizationId,
            signal_id: signalId,
            task_id: ref.data.task_id,
          },
          update: {},
        });
    }
    const row = await tx.signal.update({
      where: { id: signalId },
      data: {
        status: 'PROCESSED',
        processed_at: new Date(),
        case_id: resultingCase,
      },
    });
    await recordEvent(tx, ctx, 'signal', row.id, 'SignalProcessed', {
      workflow_instance_id: result.instance_id,
    });
    if (resultingCase && resultingCase !== signal.case_id)
      await recordEvent(tx, ctx, 'case', resultingCase, 'SignalLinked', {
        signal_id: signalId,
      });
    return row;
  }
}
