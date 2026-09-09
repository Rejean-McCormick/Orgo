import { Inject } from '@nestjs/common';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { DomainError, ExecutionContext, hash } from './contracts';

export type Tx = Prisma.TransactionClient;
export function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value));
}
@Injectable()
export class Database
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}

export async function lock(tx: Tx, key: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
}
@Injectable()
export class Commands {
  constructor(@Inject(Database) private readonly db: Database) {}
  async run<T>(
    ctx: ExecutionContext,
    operation: string,
    input: unknown,
    execute: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    if (!ctx.idempotencyKey || ctx.idempotencyKey.length > 200)
      throw new DomainError(
        'IDEMPOTENCY_KEY_REQUIRED',
        'Provide Idempotency-Key (1–200 characters)',
      );
    const key = ctx.idempotencyKey;
    const requestHash = hash({
      actor: ctx.actorUserId,
      work_grants: ctx.workGrants ?? [],
      token: ctx.apiTokenId,
      permissions: [...ctx.permissions].sort(),
      roles: [...ctx.roleIds].sort(),
      input,
    });
    return this.db.$transaction(
      async (tx) => {
        await lock(tx, `${ctx.organizationId}:${operation}:${key}`);
        const where = {
          organization_id_operation_key: {
            organization_id: ctx.organizationId,
            operation,
            key,
          },
        };
        const existing = await tx.idempotencyRecord.findUnique({ where });
        if (existing) {
          if (existing.request_hash !== requestHash)
            throw new DomainError(
              'IDEMPOTENCY_CONFLICT',
              'Key already used for a different command',
              409,
            );
          return existing.response as T;
        }
        const response = await execute(tx);
        await tx.idempotencyRecord.create({
          data: {
            organization_id: ctx.organizationId,
            operation,
            key,
            request_hash: requestHash,
            response: json(response),
          },
        });
        return response;
      },
      { timeout: 15000, maxWait: 10000 },
    );
  }
}
export async function recordEvent(
  tx: Tx,
  ctx: ExecutionContext,
  aggregateType: string,
  aggregateId: string,
  eventType: string,
  payload: unknown,
) {
  const event = await tx.workEvent.create({
    data: {
      organization_id: ctx.organizationId,
      aggregate_type: aggregateType,
      aggregate_id: aggregateId,
      event_type: eventType,
      actor_user_id: ctx.actorUserId,
      correlation_id: ctx.correlationId,
      causation_id: ctx.causationId,
      payload: json(payload),
    },
  });
  await tx.activityLog.create({
    data: {
      organization_id: ctx.organizationId,
      user_id: ctx.actorUserId,
      actor_type: ctx.actorType,
      action: eventType,
      target_type: aggregateType,
      target_id: aggregateId,
      details: { event_id: event.id, correlation_id: ctx.correlationId },
    },
  });
  return event;
}
export async function enqueue(
  tx: Tx,
  ctx: ExecutionContext,
  type: string,
  aggregateId: string,
  payload: unknown,
) {
  return tx.outboxMessage.create({
    data: {
      organization_id: ctx.organizationId,
      type,
      aggregate_id: aggregateId,
      payload: json(payload),
      correlation_id: ctx.correlationId,
      causation_id: ctx.causationId,
    },
  });
}
