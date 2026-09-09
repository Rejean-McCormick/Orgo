import { Inject, Body, Controller, Post, Get, Param } from '@nestjs/common';
import { z } from 'zod';
import { Commands, Database, json } from '../../../platform/database';
import {
  ExecutionContext,
  DomainError,
  hash,
  label,
  parse,
  severity,
  text,
  uuid,
} from '../../../platform/contracts';
import { IntakeService } from '../../../modules/intake/intake.service';
import { Ctx } from './boundary';

/** The authenticated transport establishes tenancy. Sender/recipient addresses never do. */
@Controller('ingress')
export class IngressController {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(Commands) private readonly commands: Commands,
    @Inject(IntakeService) private readonly intake: IntakeService,
  ) {}
  @Post('email') email(
    @Ctx() original: ExecutionContext,
    @Body() body: unknown,
  ) {
    const input = parse(
      z
        .object({
          attachments: z
            .array(
              z
                .object({
                  filename: z
                    .string()
                    .min(1)
                    .max(200)
                    .regex(/^[^/\\\x00-\x1f\x7f]+$/),
                  media_type: z.string().min(1).max(150),
                  content_base64: z
                    .string()
                    .max(1400000)
                    .regex(
                      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
                    ),
                })
                .strict(),
            )
            .max(30)
            .default([]),
          message_id: text,
          from: z.string().email(),
          to: z.array(z.string().email()).min(1).max(100),
          subject: text,
          text: z.string().max(100000),
          label,
          type: text.default('general'),
          severity: severity.default('MODERATE'),
          case_id: uuid.optional(),
          workflow_version_id: uuid.optional(),
        })
        .strict(),
      body,
    );
    if (
      input.attachments.reduce(
        (sum, a) => sum + Buffer.from(a.content_base64, 'base64').length,
        0,
      ) > 1048576
    )
      throw new DomainError(
        'EMAIL_ATTACHMENTS_TOO_LARGE',
        'Email attachments exceed 1 MiB in total',
      );
    const ctx = {
      ...original,
      source: 'email' as const,
      idempotencyKey: original.idempotencyKey ?? input.message_id,
    };
    return this.commands.run(ctx, 'email.accept', input, async (tx) => {
      const signal = await this.intake.accept(
        ctx,
        {
          source: 'email',
          external_reference: input.message_id,
          title: input.subject,
          description: input.text.slice(0, 20000),
          payload: {
            from: input.from,
            to: input.to,
            text: input.text,
            attachment_hashes: input.attachments.map((a) => hash(a)),
          },
          type: input.type,
          category: 'request',
          label: input.label,
          severity: input.severity,
          case_id: input.case_id,
          workflow_version_id: input.workflow_version_id,
        },
        tx,
      );
      await tx.inboxEmail.upsert({
        where: { signal_id: signal.id },
        create: {
          organization_id: ctx.organizationId,
          signal_id: signal.id,
          envelope: json(input),
        },
        update: {},
      });
      return signal;
    });
  }
  @Get('email/:signalId') async envelope(
    @Ctx() ctx: ExecutionContext,
    @Param('signalId') raw: string,
  ) {
    const id = parse(uuid, raw);
    await this.intake.get(ctx, id);
    const row = await this.db.inboxEmail.findFirst({
      where: { signal_id: id, organization_id: ctx.organizationId },
    });
    if (!row) throw new DomainError('NOT_FOUND', 'Email not found', 404);
    const input = row.envelope as Record<string, unknown>;
    return {
      ...input,
      attachments: (input.attachments as Record<string, unknown>[]).map(
        (a, index) => ({
          index,
          filename: a.filename,
          media_type: a.media_type,
          byte_length: Buffer.from(String(a.content_base64), 'base64').length,
        }),
      ),
    };
  }
  @Get('email/:signalId/attachments/:index') async attachment(
    @Ctx() ctx: ExecutionContext,
    @Param('signalId') raw: string,
    @Param('index') rawIndex: string,
  ) {
    const id = parse(uuid, raw),
      index = parse(z.coerce.number().int().min(0).max(29), rawIndex);
    await this.intake.get(ctx, id);
    const row = await this.db.inboxEmail.findFirst({
      where: { signal_id: id, organization_id: ctx.organizationId },
    });
    const attachment = row
      ? (row.envelope as { attachments: unknown[] }).attachments[index]
      : undefined;
    if (!attachment)
      throw new DomainError('NOT_FOUND', 'Email attachment not found', 404);
    return attachment;
  }
  @Post('webhook') webhook(
    @Ctx() ctx: ExecutionContext,
    @Body() body: unknown,
  ) {
    // Per-organization API token authentication and the same strict Signal boundary.
    return this.commands.run(ctx, 'webhook.accept', body, (tx) =>
      this.intake.accept(ctx, body, tx),
    );
  }
}
