import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Database, recordEvent, Tx } from '../../platform/database';
import {
  DomainError,
  ExecutionContext,
  parse,
  requirePermission,
  uuid,
} from '../../platform/contracts';
import { WorkService } from './work.service';
export const subjectType = z.enum(['task', 'case']);
export type SubjectType = z.infer<typeof subjectType>;
const info = {
  id: true,
  filename: true,
  media_type: true,
  byte_length: true,
  sha256: true,
  created_at: true,
  created_by: true,
} as const;
@Injectable()
export class EvidenceService {
  constructor(
    @Inject(Database) private db: Database,
    @Inject(WorkService) private work: WorkService,
  ) {}
  async authorize(
    ctx: ExecutionContext,
    type: SubjectType,
    id: string,
    tx: Tx = this.db,
  ) {
    return type === 'task'
      ? this.work.getTask(ctx, id, tx)
      : this.work.getCase(ctx, id, tx);
  }
  async upload(
    ctx: ExecutionContext,
    type: SubjectType,
    id: string,
    raw: unknown,
    tx: Tx,
  ) {
    this.work.requireAny(ctx, 'work:write');
    this.work.assertAccess(
      ctx,
      await this.authorize(ctx, type, id, tx),
      'work:write',
    );
    const input = parse(
      z
        .object({
          filename: z
            .string()
            .min(1)
            .max(200)
            .regex(/^[^/\\\x00-\x1f\x7f]+$/),
          media_type: z
            .string()
            .max(150)
            .regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/),
          content_base64: z
            .string()
            .min(4)
            .max(1400000)
            .regex(
              /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
            ),
        })
        .strict(),
      raw,
    );
    const content = Buffer.from(input.content_base64, 'base64');
    if (!content.length || content.length > 1048576)
      throw new DomainError(
        'ATTACHMENT_SIZE',
        'Each attachment must contain 1 byte to 1 MiB',
      );
    const row = await tx.workAttachment.create({
      data: {
        organization_id: ctx.organizationId,
        subject_type: type,
        subject_id: id,
        filename: input.filename,
        media_type: input.media_type,
        content,
        byte_length: content.length,
        sha256: createHash('sha256').update(content).digest('hex'),
        created_by: ctx.actorUserId,
      },
      select: info,
    });
    await recordEvent(tx, ctx, type, id, 'AttachmentAdded', row);
    return row;
  }
  async list(
    ctx: ExecutionContext,
    type: SubjectType,
    id: string,
    offset: number,
    limit: number,
  ) {
    await this.authorize(ctx, type, id);
    return this.db.workAttachment.findMany({
      where: {
        organization_id: ctx.organizationId,
        subject_type: type,
        subject_id: id,
        deleted_at: null,
      },
      select: info,
      skip: offset,
      take: limit,
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    });
  }
  async download(ctx: ExecutionContext, id: string) {
    const row = await this.db.workAttachment.findFirst({
      where: { id, organization_id: ctx.organizationId, deleted_at: null },
    });
    if (!row) throw new DomainError('NOT_FOUND', 'Attachment not found', 404);
    await this.authorize(
      ctx,
      parse(subjectType, row.subject_type),
      row.subject_id,
    );
    const { content, ...metadata } = row;
    return { ...metadata, content_base64: content.toString('base64') };
  }
  async remove(ctx: ExecutionContext, id: string, tx: Tx) {
    this.work.requireAny(ctx, 'work:write');
    const row = await tx.workAttachment.findFirst({
      where: { id, organization_id: ctx.organizationId },
    });
    if (!row) throw new DomainError('NOT_FOUND', 'Attachment not found', 404);
    this.work.assertAccess(
      ctx,
      await this.authorize(
        ctx,
        parse(subjectType, row.subject_type),
        row.subject_id,
        tx,
      ),
      'work:write',
    );
    await tx.workAttachment.update({
      where: { id },
      data: { deleted_at: new Date() },
    });
    await recordEvent(
      tx,
      ctx,
      row.subject_type,
      row.subject_id,
      'AttachmentRemoved',
      { attachment_id: id, sha256: row.sha256 },
    );
    return { id, removed: true };
  }
  async timeline(
    ctx: ExecutionContext,
    type: SubjectType,
    id: string,
    offset: number,
    limit: number,
  ) {
    await this.authorize(ctx, type, id);
    const where = {
      organization_id: ctx.organizationId,
      aggregate_type: type,
      aggregate_id: id,
    };
    const [items, total] = await Promise.all([
      this.db.workEvent.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      }),
      this.db.workEvent.count({ where }),
    ]);
    return { items, total };
  }
  async relate(
    ctx: ExecutionContext,
    type: SubjectType,
    id: string,
    raw: unknown,
    tx: Tx,
  ) {
    this.work.requireAny(ctx, 'work:write');
    const input = parse(
      z
        .object({
          target_type: subjectType,
          target_id: uuid,
          kind: z.enum(['related', 'blocks', 'duplicates', 'follows']),
        })
        .strict(),
      raw,
    );
    this.work.assertAccess(
      ctx,
      await this.authorize(ctx, type, id, tx),
      'work:write',
    );
    await this.authorize(ctx, input.target_type, input.target_id, tx);
    if (type === input.target_type && id === input.target_id)
      throw new DomainError('SELF_REFERENCE', 'Work cannot relate to itself');
    const row = await tx.workRelation.create({
      data: {
        organization_id: ctx.organizationId,
        source_type: type,
        source_id: id,
        ...input,
      },
    });
    await recordEvent(tx, ctx, type, id, 'WorkRelated', {
      relation_id: row.id,
      ...input,
    });
    return row;
  }
  async relations(
    ctx: ExecutionContext,
    type: SubjectType,
    id: string,
    offset: number,
    limit: number,
  ) {
    await this.authorize(ctx, type, id);
    const candidates = await this.db.workRelation.findMany({
      where: {
        organization_id: ctx.organizationId,
        OR: [
          { source_type: type, source_id: id },
          { target_type: type, target_id: id },
        ],
      },
      take: limit,
      skip: offset,
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    });
    const items = [];
    for (const row of candidates) {
      try {
        await this.authorize(
          ctx,
          parse(subjectType, row.source_type),
          row.source_id,
        );
        await this.authorize(
          ctx,
          parse(subjectType, row.target_type),
          row.target_id,
        );
        items.push(row);
      } catch (e) {
        if (!(e instanceof DomainError && e.status === 404)) throw e;
      }
    }
    return {
      items,
      next_offset: candidates.length === limit ? offset + limit : null,
    };
  }
}
