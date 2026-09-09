import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Database, json, lock, recordEvent, Tx } from '../../platform/database';
import {
  DomainError,
  ExecutionContext,
  parse,
  requirePermission,
  text,
  uuid,
} from '../../platform/contracts';
import { WorkService } from '../work/public';
@Injectable()
export class DomainManagement {
  constructor(
    @Inject(Database) private db: Database,
    @Inject(WorkService) private work: WorkService,
  ) {}
  async person(ctx: ExecutionContext, id: string, tx: Tx) {
    const row = await tx.personProfile.findFirst({
      where: { id, organization_id: ctx.organizationId },
    });
    if (!row) throw new DomainError('NOT_FOUND', 'Person not found', 404);
    if (row.confidentiality_level !== 'normal')
      requirePermission(ctx, 'work:restricted');
    return row;
  }
  async calendar(ctx: ExecutionContext, from: Date, to: Date) {
    requirePermission(ctx, 'maintenance:read');
    return this.db.maintenanceCalendarSlot.findMany({
      where: {
        organization_id: ctx.organizationId,
        start_at: { lt: to },
        end_at: { gt: from },
      },
      orderBy: { start_at: 'asc' },
      take: 500,
    });
  }
  async schedule(ctx: ExecutionContext, raw: unknown, tx: Tx) {
    requirePermission(ctx, 'maintenance:write');
    const input = parse(
      z
        .object({
          asset_id: uuid.optional(),
          title: text,
          description: z.string().max(20000).optional(),
          start_at: z.string().datetime({ offset: true }),
          end_at: z.string().datetime({ offset: true }),
        })
        .strict(),
      raw,
    );
    const start = new Date(input.start_at),
      end = new Date(input.end_at);
    if (end <= start)
      throw new DomainError('INVALID_INTERVAL', 'End must follow start');
    if (input.asset_id) {
      await lock(tx, `asset.calendar:${input.asset_id}`);
      if (
        !(await tx.maintenanceAsset.findFirst({
          where: { id: input.asset_id, organization_id: ctx.organizationId },
        }))
      )
        throw new DomainError('NOT_FOUND', 'Asset not found', 404);
      if (
        await tx.maintenanceCalendarSlot.findFirst({
          where: {
            asset_id: input.asset_id,
            organization_id: ctx.organizationId,
            status: { not: 'cancelled' },
            start_at: { lt: end },
            end_at: { gt: start },
          },
        })
      )
        throw new DomainError(
          'SCHEDULE_CONFLICT',
          'Asset already has a reservation in this interval',
          409,
        );
    }
    const row = await tx.maintenanceCalendarSlot.create({
      data: {
        ...input,
        start_at: start,
        end_at: end,
        organization_id: ctx.organizationId,
        status: 'planned',
      },
    });
    await recordEvent(
      tx,
      ctx,
      'maintenance_slot',
      row.id,
      'MaintenanceScheduled',
      { asset_id: input.asset_id },
    );
    return row;
  }
  async slotStatus(ctx: ExecutionContext, id: string, raw: unknown, tx: Tx) {
    requirePermission(ctx, 'maintenance:write');
    const input = parse(
      z
        .object({
          status: z.enum(['in_progress', 'completed', 'cancelled']),
          updated_at: z.string().datetime({ offset: true }),
        })
        .strict(),
      raw,
    );
    const row = await tx.maintenanceCalendarSlot.findFirst({
      where: { id, organization_id: ctx.organizationId },
    });
    if (!row) throw new DomainError('NOT_FOUND', 'Slot not found', 404);
    const next: Record<string, string[]> = {
      planned: ['in_progress', 'cancelled'],
      in_progress: ['completed', 'cancelled'],
    };
    if (!next[row.status]?.includes(input.status))
      throw new DomainError(
        'INVALID_TRANSITION',
        'Invalid calendar transition',
        409,
      );
    const changed = await tx.maintenanceCalendarSlot.updateMany({
      where: { id, updated_at: new Date(input.updated_at) },
      data: { status: input.status },
    });
    if (!changed.count)
      throw new DomainError('REVISION_CONFLICT', 'Slot changed; reload', 409);
    await recordEvent(
      tx,
      ctx,
      'maintenance_slot',
      id,
      'MaintenanceStatusChanged',
      { status: input.status },
    );
    return tx.maintenanceCalendarSlot.findUnique({ where: { id } });
  }
  async hrCase(ctx: ExecutionContext, id: string, tx: Tx = this.db) {
    requirePermission(ctx, 'hr:read');
    requirePermission(ctx, 'work:restricted');
    const row = await tx.hrCase.findFirst({
      where: { id, organization_id: ctx.organizationId },
      include: { participants: true },
    });
    if (!row) throw new DomainError('NOT_FOUND', 'HR case not found', 404);
    await this.work.getCase(ctx, row.case_id, tx);
    return row;
  }
  async participant(ctx: ExecutionContext, id: string, raw: unknown, tx: Tx) {
    requirePermission(ctx, 'hr:write');
    const row = await this.hrCase(ctx, id, tx);
    if (['resolved', 'dismissed'].includes(row.status))
      throw new DomainError(
        'CASE_CLOSED',
        'Reopen the HR case before adding participants',
        409,
      );
    const input = parse(
      z
        .object({
          person_id: uuid,
          role: z.enum([
            'complainant',
            'respondent',
            'witness',
            'advocate',
            'other',
          ]),
          notes: z.string().max(5000).optional(),
        })
        .strict(),
      raw,
    );
    await this.person(ctx, input.person_id, tx);
    await lock(tx, `hr.participant:${id}:${input.person_id}:${input.role}`);
    const existing = await tx.hrCaseParticipant.findFirst({
      where: { hr_case_id: id, person_id: input.person_id, role: input.role },
    });
    if (existing) return existing;
    const member = await tx.hrCaseParticipant.create({
      data: { hr_case_id: id, ...input },
    });
    await recordEvent(tx, ctx, 'case', row.case_id, 'HrParticipantAdded', {
      participant_id: member.id,
      role: input.role,
    });
    return member;
  }
  async review(ctx: ExecutionContext, id: string, raw: unknown, tx: Tx) {
    requirePermission(ctx, 'hr:write');
    const row = await this.hrCase(ctx, id, tx);
    const input = parse(
      z
        .object({
          status: z.enum(['open', 'under_review', 'resolved', 'dismissed']),
          reason: z.string().min(1).max(5000),
          updated_at: z.string().datetime({ offset: true }),
        })
        .strict(),
      raw,
    );
    const allowed: Record<string, string[]> = {
      open: ['under_review', 'dismissed'],
      under_review: ['open', 'resolved', 'dismissed'],
      resolved: ['open'],
      dismissed: ['open'],
    };
    if (!allowed[row.status]?.includes(input.status))
      throw new DomainError(
        'INVALID_TRANSITION',
        'Invalid HR review transition',
        409,
      );
    const changed = await tx.hrCase.updateMany({
      where: { id, updated_at: new Date(input.updated_at) },
      data: {
        status: input.status,
        closed_at: ['resolved', 'dismissed'].includes(input.status)
          ? new Date()
          : null,
      },
    });
    if (!changed.count)
      throw new DomainError(
        'REVISION_CONFLICT',
        'HR case changed; reload',
        409,
      );
    // HR review outcome is distinct from the operational Case lifecycle.
    await recordEvent(tx, ctx, 'case', row.case_id, 'HrReviewRecorded', {
      status: input.status,
      reason: input.reason,
    });
    return this.hrCase(ctx, id, tx);
  }
  async members(ctx: ExecutionContext, id: string) {
    requirePermission(ctx, 'education:read');
    if (
      !(await this.db.learningGroup.findFirst({
        where: { id, organization_id: ctx.organizationId },
      }))
    )
      throw new DomainError('NOT_FOUND', 'Group not found', 404);
    return this.db.learningGroupMembership.findMany({
      where: {
        learning_group_id: id,
        person: {
          organization_id: ctx.organizationId,
          ...(!ctx.permissions.includes('*') &&
          !ctx.permissions.includes('work:restricted')
            ? { confidentiality_level: 'normal' as const }
            : {}),
        },
      },
      include: { person: { select: { id: true, full_name: true } } },
      take: 500,
      orderBy: { created_at: 'asc' },
    });
  }
  async membership(ctx: ExecutionContext, id: string, raw: unknown, tx: Tx) {
    requirePermission(ctx, 'education:write');
    const input = parse(
      z
        .object({
          person_id: uuid,
          role: z.enum([
            'student',
            'player',
            'parent',
            'coach',
            'teacher',
            'mentor',
          ]),
        })
        .strict(),
      raw,
    );
    if (
      !(await tx.learningGroup.findFirst({
        where: { id, organization_id: ctx.organizationId },
      }))
    )
      throw new DomainError('NOT_FOUND', 'Group not found', 404);
    await this.person(ctx, input.person_id, tx);
    await lock(tx, `membership:${id}:${input.person_id}:${input.role}`);
    const old = await tx.learningGroupMembership.findFirst({
      where: { learning_group_id: id, ...input },
    });
    if (old) return old;
    const row = await tx.learningGroupMembership.create({
      data: { learning_group_id: id, ...input },
    });
    await recordEvent(tx, ctx, 'learning_group', id, 'MembershipAdded', {
      membership_id: row.id,
      ...input,
    });
    return row;
  }
  async removeMember(ctx: ExecutionContext, id: string, tx: Tx) {
    requirePermission(ctx, 'education:write');
    const row = await tx.learningGroupMembership.findFirst({
      where: { id, learning_group: { organization_id: ctx.organizationId } },
    });
    if (!row) throw new DomainError('NOT_FOUND', 'Membership not found', 404);
    await this.person(ctx, row.person_id, tx);
    await tx.learningGroupMembership.delete({ where: { id } });
    await recordEvent(
      tx,
      ctx,
      'learning_group',
      row.learning_group_id,
      'MembershipRemoved',
      { membership_id: id },
    );
    return { id, removed: true };
  }
  async wellbeing(ctx: ExecutionContext, raw: unknown, tx: Tx) {
    requirePermission(ctx, 'hr:write');
    requirePermission(ctx, 'work:restricted');
    const input = parse(
      z
        .object({
          person_id: uuid,
          case_id: uuid.optional(),
          score: z.number().int().min(0).max(10),
          comment: z.string().max(5000).optional(),
          tags: z.array(text).max(30).default([]),
        })
        .strict(),
      raw,
    );
    await this.person(ctx, input.person_id, tx);
    if (input.case_id) await this.work.getCase(ctx, input.case_id, tx);
    const row = await tx.wellbeingCheckin.create({
      data: { organization_id: ctx.organizationId, ...input },
    });
    await recordEvent(tx, ctx, 'person', input.person_id, 'WellbeingRecorded', {
      checkin_id: row.id,
    });
    return row;
  }
}
