import { Inject } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { json, Tx } from '../../platform/database';
import {
  DomainError,
  ExecutionContext,
  parse,
  requirePermission,
  text,
  uuid,
} from '../../platform/contracts';
import { WorkService, createTaskInput, createCaseInput } from '../work/public';

@Injectable()
export class DomainsService {
  constructor(@Inject(WorkService) private readonly work: WorkService) {}
  async maintenance(ctx: ExecutionContext, raw: unknown, tx: Tx) {
    requirePermission(ctx, 'maintenance:write');
    const input = parse(
      z.object({ task: createTaskInput, asset_id: uuid.optional() }).strict(),
      raw,
    );
    if (
      input.asset_id &&
      !(await tx.maintenanceAsset.findFirst({
        where: { id: input.asset_id, organization_id: ctx.organizationId },
      }))
    )
      throw new DomainError('NOT_FOUND', 'Asset not found', 404);
    const task = await this.work.createTask(
      ctx,
      { ...input.task, type: 'maintenance' },
      tx,
    );
    const link = await tx.maintenanceTaskLink.create({
      data: {
        organization_id: ctx.organizationId,
        task_id: task.id,
        asset_id: input.asset_id,
        link_type: 'maintenance',
      },
    });
    return { task_id: task.id, link };
  }
  async hr(ctx: ExecutionContext, raw: unknown, tx: Tx) {
    requirePermission(ctx, 'hr:write');
    requirePermission(ctx, 'work:restricted');
    const input = parse(
      z
        .object({
          case: createCaseInput,
          task: createTaskInput,
          case_code: text,
          subject_person_id: uuid.optional(),
        })
        .strict(),
      raw,
    );
    if (
      input.subject_person_id &&
      !(await tx.personProfile.findFirst({
        where: {
          id: input.subject_person_id,
          organization_id: ctx.organizationId,
        },
      }))
    )
      throw new DomainError('NOT_FOUND', 'Person not found', 404);
    const parent = await this.work.createCase(
      ctx,
      { ...input.case, visibility: 'RESTRICTED' },
      tx,
    );
    const task = await this.work.createTask(
      ctx,
      {
        ...input.task,
        case_id: parent.id,
        visibility: 'RESTRICTED',
        type: 'hr_case',
      },
      tx,
    );
    const extension = await tx.hrCase.create({
      data: {
        organization_id: ctx.organizationId,
        case_id: parent.id,
        primary_task_id: task.id,
        case_code: input.case_code,
        subject_person_id: input.subject_person_id,
        status: 'open',
        confidentiality_level: 'highly_sensitive',
        opened_at: new Date(),
        metadata: json({}),
      },
    });
    await tx.hrCaseTaskLink.create({
      data: {
        hr_case_id: extension.id,
        task_id: task.id,
        link_type: 'primary',
      },
    });
    return { case_id: parent.id, task_id: task.id, hr_case_id: extension.id };
  }
  async education(ctx: ExecutionContext, raw: unknown, tx: Tx) {
    requirePermission(ctx, 'education:write');
    const input = parse(
      z
        .object({
          task: createTaskInput,
          learning_group_id: uuid.optional(),
          person_id: uuid.optional(),
          context_note: z.string().max(2000).optional(),
        })
        .strict(),
      raw,
    );
    if (
      input.learning_group_id &&
      !(await tx.learningGroup.findFirst({
        where: {
          id: input.learning_group_id,
          organization_id: ctx.organizationId,
        },
      }))
    )
      throw new DomainError('NOT_FOUND', 'Learning group not found', 404);
    if (
      input.person_id &&
      !(await tx.personProfile.findFirst({
        where: { id: input.person_id, organization_id: ctx.organizationId },
      }))
    )
      throw new DomainError('NOT_FOUND', 'Person not found', 404);
    const task = await this.work.createTask(
      ctx,
      { ...input.task, type: 'education_support' },
      tx,
    );
    const link = await tx.educationTaskLink.create({
      data: {
        task_id: task.id,
        learning_group_id: input.learning_group_id,
        person_id: input.person_id,
        context_note: input.context_note,
      },
    });
    return { task_id: task.id, link };
  }
}
