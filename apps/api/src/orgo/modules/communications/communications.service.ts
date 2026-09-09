import { Inject } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { enqueue, json, Tx } from '../../platform/database';
import {
  DomainError,
  ExecutionContext,
  parse,
  requirePermission,
  text,
  uuid,
} from '../../platform/contracts';
import { WorkService } from '../work/public';

export const notificationInput = z
  .object({
    channel: z.enum(['email', 'in_app', 'sms', 'webhook']),
    recipient_user_id: uuid.optional(),
    recipient_address: z.string().min(1).max(500).optional(),
    related_task_id: uuid.optional(),
    subject: text,
    body: z.string().min(1).max(20000),
  })
  .strict();
@Injectable()
export class CommunicationsService {
  constructor(@Inject(WorkService) private readonly work: WorkService) {}
  async request(ctx: ExecutionContext, raw: unknown, tx: Tx) {
    requirePermission(ctx, 'notifications:write');
    const input = parse(notificationInput, raw);
    if (input.related_task_id)
      await this.work.getTask(ctx, input.related_task_id, tx);
    const user = input.recipient_user_id
      ? await tx.userAccount.findFirst({
          where: {
            id: input.recipient_user_id,
            organization_id: ctx.organizationId,
            status: 'active',
          },
        })
      : null;
    if (input.recipient_user_id && !user)
      throw new DomainError(
        'INVALID_RECIPIENT',
        'Recipient is not an active organization user',
      );
    const address =
      input.recipient_address ??
      (input.channel === 'email' ? user?.email : undefined);
    if (input.channel === 'email' && address)
      parse(z.string().email(), address);
    if (input.channel === 'sms')
      parse(z.string().regex(/^\+[1-9][0-9]{6,14}$/), address);
    if (input.channel === 'webhook') parse(z.string().min(1).max(500), address);
    if (
      (input.channel === 'email' && !address) ||
      (input.channel === 'in_app' && !user)
    )
      throw new DomainError(
        'INVALID_RECIPIENT',
        'A channel-compatible recipient is required',
      );
    const row = await tx.notification.create({
      data: {
        organization_id: ctx.organizationId,
        channel: input.channel,
        recipient_user_id: user?.id,
        recipient_address: address,
        related_task_id: input.related_task_id,
        status: 'queued',
        queued_at: new Date(),
        payload: json({ subject: input.subject, body: input.body }),
      },
    });
    await enqueue(tx, ctx, 'notification', row.id, {});
    return row;
  }
}
