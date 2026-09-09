import { deliverHttpChannel } from '../../modules/communications/channels/http-delivery';
import { Inject } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { OutboxMessage } from '@prisma/client';
import { createTransport } from 'nodemailer';
import { z } from 'zod';
import { Database, json, lock, recordEvent, Tx } from '../database';
import { DomainError, ExecutionContext, parse, uuid } from '../contracts';
import { IntakeService } from '../../modules/intake/intake.service';
import { IdentityService } from '../../modules/identity/identity.service';
import { IntegrationPort, DeliveryError } from '../../integrations/port';
import { KristalAdapter } from '../../integrations/kristal/kristal.adapter';
import { KonnaxionAdapter } from '../../integrations/konnaxion/konnaxion.adapter';
import { ArchitectAdapter } from '../../integrations/architect/architect.adapter';
import { KoaAdapter } from '../../integrations/koa/koa.adapter';

export function retryDelay(attempt: number, random = Math.random) {
  return (
    Math.min(3600000, 1000 * 2 ** Math.min(attempt, 12)) *
    (0.5 + random() * 0.5)
  );
}
@Injectable()
export class OutboxWorker {
  readonly adapters: Record<string, IntegrationPort> = {
    kristal: new KristalAdapter(),
    konnaxion: new KonnaxionAdapter(),
    architect: new ArchitectAdapter(),
    koa: new KoaAdapter(),
  };
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(IntakeService) private readonly intake: IntakeService,
    @Inject(IdentityService) private readonly identity: IdentityService,
  ) {}
  async claim(): Promise<OutboxMessage | undefined> {
    const token = randomUUID();
    const rows = await this.db.$queryRaw<OutboxMessage[]>`
      WITH candidate AS (
        SELECT id FROM outbox_messages
        WHERE (status = 'PENDING' AND available_at <= now()) OR (status = 'PROCESSING' AND locked_until < now())
        ORDER BY available_at, id FOR UPDATE SKIP LOCKED LIMIT 1
      ) UPDATE outbox_messages AS message SET status = 'PROCESSING', attempts = attempts + 1,
        locked_until = now() + interval '60 seconds', lock_token = ${token}::uuid
      FROM candidate WHERE message.id = candidate.id RETURNING message.*`;
    return rows[0];
  }
  private context(message: OutboxMessage): ExecutionContext {
    return {
      organizationId: message.organization_id,
      actorUserId: null,
      actorType: 'system',
      permissions: ['*'],
      roleIds: [],
      correlationId: message.correlation_id,
      causationId: message.id,
      source: 'api',
    };
  }
  private async owned(tx: Tx, message: OutboxMessage) {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM outbox_messages WHERE id = ${message.id}::uuid AND lock_token = ${message.lock_token}::uuid AND status = 'PROCESSING' FOR UPDATE`;
    return rows.length > 0;
  }
  private async complete(
    message: OutboxMessage,
    effect?: (tx: Tx) => Promise<unknown>,
  ) {
    return this.db.$transaction(
      async (tx) => {
        if (!(await this.owned(tx, message))) return false;
        if (effect) await effect(tx);
        await tx.outboxMessage.update({
          where: { id: message.id },
          data: {
            status: 'SUCCEEDED',
            completed_at: new Date(),
            lock_token: null,
            locked_until: null,
            last_error: null,
          },
        });
        return true;
      },
      { timeout: 20000 },
    );
  }
  private async deliver(message: OutboxMessage) {
    if (
      !(await this.db.organization.findFirst({
        where: { id: message.organization_id, status: 'active' },
      }))
    )
      throw new DeliveryError('ORGANIZATION_INACTIVE', false);
    if (message.attempts > 8)
      throw new DeliveryError('ATTEMPTS_EXHAUSTED', false);
    if (message.type === 'signal') {
      const input = parse(
        z.object({
          workflow_version_id: uuid,
          actor_user_id: uuid.nullable(),
          api_token_id: uuid.nullable().optional(),
        }),
        message.payload,
      );
      const ctx = input.actor_user_id
        ? await this.identity.forUser(
            message.organization_id,
            input.actor_user_id,
            message.correlation_id,
          )
        : input.api_token_id
          ? await this.identity.forApiToken(
              input.api_token_id,
              message.correlation_id,
            )
          : null;
      if (!ctx || ctx.organizationId !== message.organization_id)
        throw new DeliveryError('INTAKE_ACTOR_UNAVAILABLE', false);
      await this.complete(message, (tx) =>
        this.intake.process(
          { ...ctx, causationId: message.id },
          message.aggregate_id,
          input.workflow_version_id,
          tx,
        ),
      );
    } else if (message.type === 'integration') {
      const operation = await this.db.integrationOperation.findFirstOrThrow({
        where: {
          id: message.aggregate_id,
          organization_id: message.organization_id,
        },
      });
      if (
        operation.status === 'SUCCEEDED' ||
        operation.status === 'FAILED' ||
        (operation.receipt &&
          typeof operation.receipt === 'object' &&
          !Array.isArray(operation.receipt) &&
          operation.receipt.status === 'accepted')
      ) {
        await this.complete(message);
        return;
      }
      await this.db.integrationOperation.updateMany({
        where: { id: operation.id, status: { in: ['PENDING', 'RUNNING'] } },
        data: {
          status: 'RUNNING',
          started_at: operation.started_at ?? new Date(),
        },
      });
      const adapter = this.adapters[operation.provider];
      if (!adapter) throw new DeliveryError('UNSUPPORTED_PROVIDER', false);
      const receipt = await adapter.execute({
        operation_id: operation.id,
        organization_id: message.organization_id,
        operation: operation.operation,
        idempotency_key: `${message.organization_id}:${operation.id}`,
        correlation_id: message.correlation_id,
        subject: { type: operation.subject_type, id: operation.subject_id },
        input: operation.request_metadata,
      });
      await this.complete(message, async (tx) => {
        await lock(tx, `integration:${operation.id}`);
        const current = await tx.integrationOperation.findUniqueOrThrow({
          where: { id: operation.id },
        });
        if (['SUCCEEDED', 'FAILED'].includes(current.status)) return;
        await tx.integrationOperation.update({
          where: { id: operation.id },
          data: {
            status: receipt.status === 'accepted' ? 'RUNNING' : 'SUCCEEDED',
            receipt: json(receipt),
            external_reference: receipt.external_reference,
            completed_at: receipt.status === 'accepted' ? null : new Date(),
            error: null,
          },
        });
        await recordEvent(
          tx,
          this.context(message),
          operation.subject_type,
          operation.subject_id,
          receipt.status === 'accepted'
            ? 'IntegrationAccepted'
            : 'IntegrationSucceeded',
          { operation_id: operation.id },
        );
      });
    } else if (message.type === 'notification') {
      const notification = await this.db.notification.findFirstOrThrow({
        where: {
          id: message.aggregate_id,
          organization_id: message.organization_id,
        },
      });
      if (notification.status === 'sent') {
        await this.complete(message);
        return;
      }
      if (notification.channel === 'email') {
        if (!process.env.SMTP_URL || !process.env.SMTP_FROM)
          throw new DeliveryError('EMAIL_UNCONFIGURED');
        const payload = parse(
          z.object({ subject: z.string(), body: z.string() }),
          notification.payload,
        );
        const smtp = createTransport(process.env.SMTP_URL, {
          connectionTimeout: 10000,
          socketTimeout: 15000,
        });
        try {
          await smtp.sendMail({
            from: process.env.SMTP_FROM,
            to: notification.recipient_address!,
            subject: payload.subject,
            text: payload.body,
            messageId: `<${notification.id}@orgo.local>`,
          });
        } catch {
          throw new DeliveryError('SMTP_DELIVERY_ERROR');
        } finally {
          smtp.close();
        }
      } else if (
        notification.channel === 'sms' ||
        notification.channel === 'webhook'
      ) {
        const payload = parse(
          z.object({ subject: z.string(), body: z.string() }),
          notification.payload,
        );
        await deliverHttpChannel(notification.channel, {
          id: notification.id,
          organization_id: notification.organization_id,
          recipient: notification.recipient_address!,
          ...payload,
          correlation_id: message.correlation_id,
        });
      } else if (notification.channel !== 'in_app')
        throw new DeliveryError('CHANNEL_UNSUPPORTED', false);
      await this.complete(message, (tx) =>
        tx.notification.update({
          where: { id: notification.id },
          data: {
            status: 'sent',
            sent_at: new Date(),
            error_message: null,
            failed_at: null,
          },
        }),
      );
    } else throw new DeliveryError('UNKNOWN_MESSAGE_TYPE', false);
  }
  async handle(message: OutboxMessage) {
    const heartbeat = setInterval(() => {
      void this.db.outboxMessage
        .updateMany({
          where: {
            id: message.id,
            status: 'PROCESSING',
            lock_token: message.lock_token,
          },
          data: { locked_until: new Date(Date.now() + 60000) },
        })
        .catch(() => {});
    }, 20000);
    heartbeat.unref();
    try {
      await this.deliver(message);
    } catch (error) {
      const code =
        error instanceof DeliveryError || error instanceof DomainError
          ? error.code
          : 'DELIVERY_FAILED';
      const dead =
        message.attempts >= 8 ||
        (error instanceof DeliveryError && !error.retryable) ||
        (error instanceof DomainError && error.status < 500);
      await this.db.$transaction(async (tx) => {
        if (!(await this.owned(tx, message))) return;
        await tx.outboxMessage.update({
          where: { id: message.id },
          data: {
            status: dead ? 'DEAD' : 'PENDING',
            last_error: code,
            lock_token: null,
            locked_until: null,
            available_at: new Date(Date.now() + retryDelay(message.attempts)),
          },
        });
        if (message.type === 'integration')
          await tx.integrationOperation.updateMany({
            where: {
              id: message.aggregate_id,
              organization_id: message.organization_id,
              status: { in: ['PENDING', 'RUNNING'] },
            },
            data: {
              status: dead ? 'FAILED' : 'PENDING',
              error: code,
              completed_at: dead ? new Date() : null,
            },
          });
        if (message.type === 'notification' && dead)
          await tx.notification.updateMany({
            where: {
              id: message.aggregate_id,
              organization_id: message.organization_id,
              status: { not: 'sent' },
            },
            data: {
              status: 'failed',
              failed_at: new Date(),
              error_message: code,
            },
          });
      });
      console.error(
        JSON.stringify({
          event: 'outbox.delivery_failed',
          message_id: message.id,
          correlation_id: message.correlation_id,
          code,
          dead,
        }),
      );
    } finally {
      clearInterval(heartbeat);
    }
  }
  async tick() {
    const message = await this.claim();
    if (!message) return false;
    await this.handle(message);
    return true;
  }
}
