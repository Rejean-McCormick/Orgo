import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Database, json, lock, recordEvent, Tx } from '../../platform/database';
import {
  DomainError,
  ExecutionContext,
  hash,
  parse,
  requirePermission,
  text,
  uuid,
} from '../../platform/contracts';
import { WorkService } from '../work/public';
import { IdentityService } from '../identity/identity.service';
import {
  OperationsService,
  providers,
} from '../integrations/operations.service';
const external = z
  .object({
    provider: z.enum(providers),
    operation: text,
    request: z.record(z.unknown()).default({}),
  })
  .strict();
export const processPlan = z
  .array(
    z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('integration'),
          title: text,
          request: external,
          expect: z
            .record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
            .default({}),
          timeout_seconds: z.number().int().min(60).max(2592000).default(86400),
          compensation: external.optional(),
        })
        .strict(),
      z
        .object({
          kind: z.literal('approval'),
          title: text,
          permission: z
            .string()
            .regex(/^[a-z]+:[a-z]+$/)
            .default('workflows:approve'),
        })
        .strict(),
      z
        .object({
          kind: z.literal('timer'),
          title: text,
          seconds: z.number().int().min(1).max(2592000),
        })
        .strict(),
    ]),
  )
  .min(1)
  .max(50);
const createInput = z
  .object({
    title: text,
    subject_type: z.enum(['task', 'case']),
    subject_id: uuid,
    steps: processPlan,
  })
  .strict();
@Injectable()
export class ProcessManager {
  constructor(
    @Inject(Database) private db: Database,
    @Inject(WorkService) private work: WorkService,
    @Inject(OperationsService) private operations: OperationsService,
    @Inject(IdentityService) private identity: IdentityService,
  ) {}
  async access(
    ctx: ExecutionContext,
    type: string,
    id: string,
    tx: Tx = this.db,
  ) {
    return type === 'task'
      ? this.work.getTask(ctx, id, tx)
      : this.work.getCase(ctx, id, tx);
  }
  async get(ctx: ExecutionContext, id: string, tx: Tx = this.db) {
    requirePermission(ctx, 'workflows:read');
    const row = await tx.durableProcess.findFirst({
      where: { id, organization_id: ctx.organizationId },
    });
    if (!row) throw new DomainError('NOT_FOUND', 'Process not found', 404);
    await this.access(ctx, row.subject_type, row.subject_id, tx);
    return row;
  }
  async create(ctx: ExecutionContext, raw: unknown, tx: Tx) {
    requirePermission(ctx, 'workflows:execute');
    const input = parse(createInput, raw);
    await this.access(ctx, input.subject_type, input.subject_id, tx);
    if (!ctx.actorUserId && !ctx.apiTokenId)
      throw new DomainError(
        'IDENTITY_REQUIRED',
        'A resumable principal is required',
      );
    const row = await tx.durableProcess.create({
      data: {
        organization_id: ctx.organizationId,
        title: input.title,
        subject_type: input.subject_type,
        subject_id: input.subject_id,
        plan: json(input.steps),
        plan_hash: hash(input.steps),
        actor_user_id: ctx.actorUserId,
        api_token_id: ctx.apiTokenId,
        correlation_id: ctx.correlationId,
      },
    });
    await recordEvent(
      tx,
      ctx,
      input.subject_type,
      input.subject_id,
      'ProcessStarted',
      { process_id: row.id, plan_hash: row.plan_hash },
    );
    return row;
  }
  async advance(ctx: ExecutionContext, id: string, tx: Tx) {
    await lock(tx, `process:${id}`);
    const row = await tx.durableProcess.findFirstOrThrow({
      where: { id, organization_id: ctx.organizationId },
    });
    if (!['RUNNING', 'WAITING_EXTERNAL', 'WAITING_TIMER'].includes(row.status))
      return;
    requirePermission(ctx, 'workflows:execute');
    await this.access(ctx, row.subject_type, row.subject_id, tx);
    await tx.durableProcess.update({
      where: { id },
      data: { updated_at: new Date() },
    });
    const steps = parse(processPlan, row.plan),
      step = steps[row.step_index];
    const results = parse(z.array(z.record(z.unknown())), row.results);
    const update = async (data: Record<string, unknown>) =>
      tx.durableProcess.update({
        where: { id },
        data: { ...data, revision: { increment: 1 } },
      });
    if (!step) {
      await update({
        status: 'COMPLETED',
        completed_at: new Date(),
        wake_at: null,
      });
      await recordEvent(
        tx,
        ctx,
        row.subject_type,
        row.subject_id,
        'ProcessCompleted',
        { process_id: id },
      );
      return;
    }
    const finish = async (result: unknown) => {
      results.push({ step: row.step_index, result });
      await update({
        step_index: row.step_index + 1,
        status: 'RUNNING',
        operation_id: null,
        wake_at: null,
        results: json(results),
        error: null,
      });
      await recordEvent(
        tx,
        ctx,
        row.subject_type,
        row.subject_id,
        'ProcessStepCompleted',
        { process_id: id, step: row.step_index },
      );
    };
    if (step.kind === 'approval') {
      await update({ status: 'WAITING_HUMAN' });
      return;
    }
    if (step.kind === 'timer') {
      if (
        row.status === 'WAITING_TIMER' &&
        row.wake_at &&
        row.wake_at <= new Date()
      )
        await finish({ elapsed: true });
      else if (row.status === 'RUNNING')
        await update({
          status: 'WAITING_TIMER',
          wake_at: new Date(Date.now() + step.seconds * 1000),
        });
      return;
    }
    if (row.operation_id) {
      const op = await tx.integrationOperation.findFirstOrThrow({
        where: { id: row.operation_id, organization_id: ctx.organizationId },
      });
      if (op.status === 'SUCCEEDED') {
        const data =
          op.receipt &&
          typeof op.receipt === 'object' &&
          !Array.isArray(op.receipt)
            ? op.receipt.data
            : undefined;
        const accepted = Object.entries(step.expect).every(
          ([path, expected]) => {
            let value: unknown = data;
            for (const key of path.split('.')) {
              if (
                !value ||
                typeof value !== 'object' ||
                !Object.prototype.hasOwnProperty.call(value, key)
              )
                return false;
              value = (value as Record<string, unknown>)[key];
            }
            return value === expected;
          },
        );
        if (!accepted) {
          await update({ status: 'BLOCKED', error: 'RECEIPT_REJECTED' });
          return;
        }
        await finish({ operation_id: op.id, receipt: op.receipt });
      } else if (
        op.status === 'FAILED' ||
        (row.wake_at && row.wake_at <= new Date())
      )
        await update({
          status: 'BLOCKED',
          error:
            op.status === 'FAILED' ? 'EXTERNAL_FAILED' : 'EXTERNAL_TIMEOUT',
        });
      return;
    }
    const op = await this.operations.request(
      ctx,
      {
        ...step.request,
        subject_type: row.subject_type,
        subject_id: row.subject_id,
      },
      `${id}:${row.step_index}`,
      tx,
    );
    await update({
      operation_id: op.id,
      status: 'WAITING_EXTERNAL',
      wake_at: new Date(Date.now() + step.timeout_seconds * 1000),
    });
  }
  async decide(ctx: ExecutionContext, id: string, raw: unknown, tx: Tx) {
    requirePermission(ctx, 'workflows:execute');
    const input = parse(
      z
        .object({
          revision: z.number().int().min(0),
          decision: z.enum(['approve', 'reject', 'retry', 'cancel']),
          reason: z.string().min(1).max(2000),
        })
        .strict(),
      raw,
    );
    await lock(tx, `process:${id}`);
    const row = await this.get(ctx, id, tx);
    if (row.revision !== input.revision)
      throw new DomainError(
        'REVISION_CONFLICT',
        'Process changed; reload',
        409,
      );
    const steps = parse(processPlan, row.plan),
      step = steps[row.step_index];
    let data: Record<string, unknown> = {};
    if (input.decision === 'approve' || input.decision === 'reject') {
      if (row.status !== 'WAITING_HUMAN' || step?.kind !== 'approval')
        throw new DomainError(
          'NOT_WAITING',
          'No human decision is pending',
          409,
        );
      requirePermission(ctx, step.permission);
      data =
        input.decision === 'approve'
          ? {
              status: 'RUNNING',
              step_index: row.step_index + 1,
              results: json([
                ...parse(z.array(z.unknown()), row.results),
                {
                  step: row.step_index,
                  result: {
                    approved_by: ctx.actorUserId,
                    reason: input.reason,
                  },
                },
              ]),
            }
          : { status: 'BLOCKED', error: 'HUMAN_REJECTED' };
    } else if (input.decision === 'retry') {
      if (row.status !== 'BLOCKED')
        throw new DomainError(
          'NOT_BLOCKED',
          'Only blocked processes can resume',
          409,
        );
      if (row.operation_id) {
        const op = await tx.integrationOperation.findFirstOrThrow({
          where: { id: row.operation_id, organization_id: ctx.organizationId },
        });
        // Preserve operation identity even after a timeout: never create a second external intent.
        if (op.status === 'FAILED') {
          const redriven = await tx.outboxMessage.updateMany({
            where: {
              organization_id: ctx.organizationId,
              aggregate_id: op.id,
              type: 'integration',
              status: 'DEAD',
            },
            data: {
              status: 'PENDING',
              attempts: 0,
              available_at: new Date(),
              last_error: null,
            },
          });
          if (!redriven.count)
            throw new DomainError(
              'RECEIPT_FAILED',
              'Provider returned a final failure; create a deliberate new process to retry externally',
              409,
            );
          await tx.integrationOperation.update({
            where: { id: op.id },
            data: { status: 'PENDING', error: null, completed_at: null },
          });
        }
      }
      data = {
        status: row.operation_id ? 'WAITING_EXTERNAL' : 'RUNNING',
        error: null,
        wake_at: new Date(
          Date.now() +
            (step?.kind === 'integration' ? step.timeout_seconds : 86400) *
              1000,
        ),
      };
    } else {
      if (['COMPLETED', 'CANCELLED'].includes(row.status))
        throw new DomainError(
          'PROCESS_TERMINAL',
          'Process is already terminal',
          409,
        );
      data = { status: 'CANCELLED', completed_at: new Date(), wake_at: null };
    }
    const result = await tx.durableProcess.update({
      where: { id },
      data: { ...data, revision: { increment: 1 } },
    });
    await recordEvent(
      tx,
      ctx,
      row.subject_type,
      row.subject_id,
      'ProcessDecision',
      { process_id: id, ...input },
    );
    return result;
  }
  async compensate(ctx: ExecutionContext, id: string, tx: Tx) {
    await lock(tx, `process:${id}`);
    const row = await this.get(ctx, id, tx);
    await lock(tx, `compensation:${id}`);
    const prior = await tx.durableProcess.findFirst({
      where: { organization_id: ctx.organizationId, compensates_id: id },
    });
    if (prior) return prior;
    if (!['BLOCKED', 'CANCELLED', 'COMPLETED'].includes(row.status))
      throw new DomainError(
        'PROCESS_ACTIVE',
        'Stop or complete the process before compensation',
        409,
      );
    if (row.operation_id) {
      const pending = await tx.integrationOperation.findUnique({
        where: { id: row.operation_id },
      });
      if (pending && ['PENDING', 'RUNNING'].includes(pending.status))
        throw new DomainError(
          'EXTERNAL_PENDING',
          'Resolve the external operation before compensation',
          409,
        );
    }
    const completed = new Set(
      parse(z.array(z.object({ step: z.number() })), row.results).map(
        (r) => r.step,
      ),
    );
    if (row.operation_id) {
      const operation = await tx.integrationOperation.findUnique({
        where: { id: row.operation_id },
      });
      if (operation?.status === 'SUCCEEDED') completed.add(row.step_index);
    }
    const plan = parse(processPlan, row.plan);
    const steps = plan
      .flatMap((s, i) =>
        s.kind === 'integration' && s.compensation && completed.has(i)
          ? [
              {
                kind: 'integration' as const,
                title: `Compensate: ${s.title}`,
                request: s.compensation,
                timeout_seconds: s.timeout_seconds,
              },
            ]
          : [],
      )
      .reverse();
    if (!steps.length)
      throw new DomainError(
        'NO_COMPENSATION',
        'No completed step declares a compensation',
      );
    const child = await this.create(
      ctx,
      {
        title: `Compensation: ${row.title}`,
        subject_type: row.subject_type,
        subject_id: row.subject_id,
        steps,
      },
      tx,
    );
    return tx.durableProcess.update({
      where: { id: child.id },
      data: { compensates_id: id },
    });
  }
  async adopt(ctx: ExecutionContext, id: string, raw: unknown, tx: Tx) {
    requirePermission(ctx, 'workflows:manage');
    requirePermission(ctx, 'workflows:execute');
    const input = parse(
      z
        .object({
          revision: z.number().int().min(0),
          reason: z.string().min(1).max(2000),
        })
        .strict(),
      raw,
    );
    await lock(tx, `process:${id}`);
    const row = await this.get(ctx, id, tx);
    if (row.status !== 'BLOCKED' || row.revision !== input.revision)
      throw new DomainError(
        'REVISION_CONFLICT',
        'Only the current blocked revision can be adopted',
        409,
      );
    if (!ctx.actorUserId && !ctx.apiTokenId)
      throw new DomainError(
        'IDENTITY_REQUIRED',
        'A resumable identity is required',
      );
    const updated = await tx.durableProcess.update({
      where: { id },
      data: {
        actor_user_id: ctx.actorUserId,
        api_token_id: ctx.apiTokenId ?? null,
        revision: { increment: 1 },
      },
    });
    await recordEvent(
      tx,
      ctx,
      row.subject_type,
      row.subject_id,
      'ProcessAdopted',
      { process_id: id, reason: input.reason },
    );
    return updated;
  }
  async tick() {
    const batch = await this.db.durableProcess.findMany({
      where: {
        status: { in: ['RUNNING', 'WAITING_EXTERNAL', 'WAITING_TIMER'] },
      },
      orderBy: { updated_at: 'asc' },
      take: 30,
    });
    for (const row of batch) {
      try {
        const ctx = row.actor_user_id
          ? await this.identity.forUser(
              row.organization_id,
              row.actor_user_id,
              row.correlation_id,
            )
          : row.api_token_id
            ? await this.identity.forApiToken(
                row.api_token_id,
                row.correlation_id,
              )
            : null;
        if (!ctx || ctx.organizationId !== row.organization_id)
          throw new DomainError(
            'IDENTITY_UNAVAILABLE',
            'Process identity unavailable',
            403,
          );
        await this.db.$transaction((tx) => this.advance(ctx, row.id, tx), {
          timeout: 15000,
        });
      } catch (e) {
        if (!(e instanceof DomainError)) throw e;
        await this.db.durableProcess.updateMany({
          where: { id: row.id, revision: row.revision },
          data: {
            status: 'BLOCKED',
            error: e.code,
            revision: { increment: 1 },
          },
        });
      }
    }
  }
}
