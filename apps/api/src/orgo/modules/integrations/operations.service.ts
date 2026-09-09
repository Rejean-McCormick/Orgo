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
  ExecutionContext,
  parse,
  requirePermission,
  text,
  uuid,
  DomainError,
  hash,
} from '../../platform/contracts';
import { WorkService } from '../work/public';

export const providers = ['kristal', 'konnaxion', 'architect', 'koa'] as const;
export const operationInput = z
  .object({
    provider: z.enum(providers),
    operation: text,
    subject_type: z.enum(['task', 'case']),
    subject_id: uuid,
    request: z.record(z.unknown()).default({}),
  })
  .strict();
@Injectable()
export class OperationsService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(WorkService) private readonly work: WorkService,
  ) {}
  async request(ctx: ExecutionContext, raw: unknown, key: string, tx: Tx) {
    requirePermission(ctx, 'integrations:write');
    const input = parse(operationInput, raw);
    if (input.subject_type === 'task')
      await this.work.getTask(ctx, input.subject_id, tx);
    else await this.work.getCase(ctx, input.subject_id, tx);
    const operation = await tx.integrationOperation.create({
      data: {
        organization_id: ctx.organizationId,
        provider: input.provider,
        operation: input.operation,
        subject_type: input.subject_type,
        subject_id: input.subject_id,
        idempotency_key: key,
        correlation_id: ctx.correlationId,
        request_metadata: json(input.request),
      },
    });
    await enqueue(tx, ctx, 'integration', operation.id, {});
    await recordEvent(
      tx,
      ctx,
      input.subject_type,
      input.subject_id,
      'IntegrationRequested',
      { operation_id: operation.id, provider: input.provider },
    );
    return operation;
  }
  async callback(ctx: ExecutionContext, id: string, raw: unknown, tx: Tx) {
    requirePermission(ctx, 'integrations:callback');
    const input = parse(
      z
        .object({
          status: z.enum(['succeeded', 'failed']),
          external_reference: z.string().max(1000).optional(),
          data: z.record(z.unknown()).default({}),
          error: z.string().max(1000).optional(),
        })
        .strict(),
      raw,
    );
    await lock(tx, `integration:${id}`);
    const op = await tx.integrationOperation.findFirst({
      where: { id, organization_id: ctx.organizationId },
    });
    if (!op) throw new DomainError('NOT_FOUND', 'Operation not found', 404);
    requirePermission(ctx, `${op.provider}:callback`);
    if (['SUCCEEDED', 'FAILED'].includes(op.status)) {
      if (hash(op.receipt) !== hash(input))
        throw new DomainError(
          'RECEIPT_CONFLICT',
          'A different terminal receipt already exists',
          409,
        );
      return { id, status: op.status };
    }
    const row = await tx.integrationOperation.update({
      where: { id },
      data: {
        status: input.status === 'succeeded' ? 'SUCCEEDED' : 'FAILED',
        receipt: json(input),
        external_reference: input.external_reference,
        error:
          input.status === 'failed'
            ? (input.error ?? 'PROVIDER_REJECTED')
            : null,
        completed_at: new Date(),
      },
    });
    await recordEvent(
      tx,
      ctx,
      op.subject_type,
      op.subject_id,
      'IntegrationReceiptReceived',
      { operation_id: id, status: row.status },
    );
    return { id, status: row.status };
  }
  async get(ctx: ExecutionContext, id: string) {
    requirePermission(ctx, 'integrations:read');
    const op = await this.db.integrationOperation.findFirst({
      where: { organization_id: ctx.organizationId, id },
    });
    if (!op) throw new DomainError('NOT_FOUND', 'Operation not found', 404);
    if (op.subject_type === 'task') await this.work.getTask(ctx, op.subject_id);
    else await this.work.getCase(ctx, op.subject_id);
    return op;
  }
}
