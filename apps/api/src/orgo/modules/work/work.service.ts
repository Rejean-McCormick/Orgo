import { Inject } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { Prisma, Task, Case } from '@prisma/client';
import { z } from 'zod';
import { Database, json, lock, recordEvent, Tx } from '../../platform/database';
import {
  DomainError,
  ExecutionContext,
  parse,
  requirePermission,
  terminalTask,
  transition,
  pageQuery,
  taskStatus,
  caseStatus,
  label,
} from '../../platform/contracts';
import {
  assignmentInput,
  CreateCase,
  CreateTask,
  createCaseInput,
  createTaskInput,
} from './work.contract';

function withSource(raw: unknown, ctx: ExecutionContext) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const input = raw as Record<string, unknown>;
  return { ...input, source: input.source ?? ctx.source };
}

const reserved = new Set([
  'access_scope_type',
  'access_scope_reference',
  'status',
  'organization_id',
  'case_id',
  'task_id',
  'priority',
  'severity',
  'visibility',
  'owner_user_id',
  'owner_role_id',
  'due_at',
  'label',
  'title',
  'description',
]);
function cleanMetadata(value: Record<string, unknown>) {
  if (Object.keys(value).some((k) => reserved.has(k)))
    throw new DomainError(
      'RESERVED_METADATA',
      'Canonical Work fields cannot be stored in metadata',
    );
  return json(value);
}
export function taskJson(row: Task) {
  const { id, ...rest } = row;
  return { task_id: id, ...rest };
}
export function caseJson(row: Case) {
  const { id, ...rest } = row;
  return { case_id: id, ...rest, severity: row.severity.toLowerCase() };
}

@Injectable()
export class WorkService {
  constructor(@Inject(Database) private readonly db: Database) {}
  requireAny(ctx: ExecutionContext, permission: string) {
    if (
      ctx.permissions.includes('*') ||
      ctx.permissions.includes(permission) ||
      (ctx.workGrants ?? []).some((g) => g.permissions.includes(permission))
    )
      return;
    requirePermission(ctx, permission);
  }
  assertAccess(
    ctx: ExecutionContext,
    row: {
      access_scope_type?: string | null;
      access_scope_reference?: string | null;
    },
    permission: string,
  ) {
    if (Boolean(row.access_scope_type) !== Boolean(row.access_scope_reference))
      throw new DomainError(
        'INVALID_SCOPE',
        'Scope type and reference must be specified together',
      );
    if (ctx.permissions.includes('*') || ctx.permissions.includes(permission))
      return;
    if (
      (ctx.workGrants ?? []).some(
        (g) =>
          g.scope_type === row.access_scope_type &&
          g.scope_reference === row.access_scope_reference &&
          g.permissions.includes(permission),
      )
    )
      return;
    throw new DomainError(
      'SCOPE_FORBIDDEN',
      `Permission outside assigned scope: ${permission}`,
      403,
    );
  }
  caseScope(ctx: ExecutionContext): Prisma.CaseWhereInput {
    const alternatives: Prisma.CaseWhereInput[] = [];
    if (ctx.permissions.includes('*') || ctx.permissions.includes('work:read'))
      alternatives.push(
        ctx.permissions.includes('*') ||
          ctx.permissions.includes('work:restricted')
          ? {}
          : { visibility: { not: 'RESTRICTED' } },
      );
    for (const grant of ctx.workGrants ?? [])
      if (grant.permissions.includes('work:read'))
        alternatives.push({
          access_scope_type: grant.scope_type,
          access_scope_reference: grant.scope_reference,
          ...(grant.permissions.includes('work:restricted')
            ? {}
            : { visibility: { not: 'RESTRICTED' as const } }),
        });
    return { organization_id: ctx.organizationId, AND: [{ OR: alternatives }] };
  }
  taskScope(ctx: ExecutionContext): Prisma.TaskWhereInput {
    const visibility = (
      restricted: boolean,
      roles: readonly string[],
    ): Prisma.TaskWhereInput =>
      restricted
        ? {}
        : {
            OR: [
              { visibility: { not: 'RESTRICTED' } },
              ...(ctx.actorUserId ? [{ owner_user_id: ctx.actorUserId }] : []),
              { owner_role_id: { in: [...roles] } },
            ],
          };
    const alternatives: Prisma.TaskWhereInput[] = [];
    if (ctx.permissions.includes('*') || ctx.permissions.includes('work:read'))
      alternatives.push(
        visibility(
          ctx.permissions.includes('*') ||
            ctx.permissions.includes('work:restricted'),
          ctx.roleIds,
        ),
      );
    for (const grant of ctx.workGrants ?? [])
      if (grant.permissions.includes('work:read'))
        alternatives.push({
          access_scope_type: grant.scope_type,
          access_scope_reference: grant.scope_reference,
          ...visibility(grant.permissions.includes('work:restricted'), [
            grant.role_id,
          ]),
        });
    return {
      organization_id: ctx.organizationId,
      AND: [
        { OR: alternatives },
        { OR: [{ case_id: null }, { case: this.caseScope(ctx) }] },
      ],
    };
  }
  async getTask(ctx: ExecutionContext, id: string, tx: Tx = this.db) {
    this.requireAny(ctx, 'work:read');
    const row = await tx.task.findFirst({
      where: { ...this.taskScope(ctx), id },
    });
    if (!row) throw new DomainError('NOT_FOUND', 'Task not found', 404);
    return row;
  }
  async getCase(ctx: ExecutionContext, id: string, tx: Tx = this.db) {
    this.requireAny(ctx, 'work:read');
    const row = await tx.case.findFirst({
      where: { ...this.caseScope(ctx), id },
    });
    if (!row) throw new DomainError('NOT_FOUND', 'Case not found', 404);
    return row;
  }
  async createCase(ctx: ExecutionContext, raw: unknown, tx: Tx) {
    this.requireAny(ctx, 'work:write');
    const input: CreateCase = parse(createCaseInput, withSource(raw, ctx));
    this.assertAccess(ctx, input, 'work:write');
    if (input.visibility === 'RESTRICTED')
      this.assertAccess(ctx, input, 'work:restricted');
    const { source, metadata, ...fields } = input;
    const row = await tx.case.create({
      data: {
        ...fields,
        location: json(fields.location),
        organization_id: ctx.organizationId,
        source_type: source,
        status: 'open',
        metadata: cleanMetadata(metadata),
      },
    });
    await recordEvent(tx, ctx, 'case', row.id, 'CaseCreated', {
      title: row.title,
    });
    return row;
  }
  async validateOwners(
    ctx: ExecutionContext,
    input: {
      owner_user_id?: string | null;
      owner_role_id?: string | null;
      requester_person_id?: string | null;
    },
    tx: Tx,
  ) {
    if (
      input.owner_user_id &&
      !(await tx.userAccount.findFirst({
        where: {
          id: input.owner_user_id,
          organization_id: ctx.organizationId,
          status: 'active',
        },
      }))
    )
      throw new DomainError(
        'INVALID_OWNER',
        'Owner must be an active user in this organization',
      );
    if (
      input.owner_role_id &&
      !(await tx.role.findFirst({
        where: { id: input.owner_role_id, organization_id: ctx.organizationId },
      }))
    )
      throw new DomainError(
        'INVALID_OWNER',
        'Role must belong to this organization',
      );
    if (
      input.requester_person_id &&
      !(await tx.personProfile.findFirst({
        where: {
          id: input.requester_person_id,
          organization_id: ctx.organizationId,
        },
      }))
    )
      throw new DomainError(
        'INVALID_REQUESTER',
        'Requester must belong to this organization',
      );
  }
  async createTask(ctx: ExecutionContext, raw: unknown, tx: Tx) {
    this.requireAny(ctx, 'work:write');
    const input: CreateTask = parse(createTaskInput, withSource(raw, ctx));
    this.assertAccess(ctx, input, 'work:write');
    if (input.visibility === 'RESTRICTED')
      this.assertAccess(ctx, input, 'work:restricted');
    if (input.case_id) {
      await lock(tx, `case:${ctx.organizationId}:${input.case_id}`);
      const parent = await this.getCase(ctx, input.case_id, tx);
      if (
        parent.access_scope_type !== (input.access_scope_type ?? null) ||
        parent.access_scope_reference !== (input.access_scope_reference ?? null)
      )
        throw new DomainError(
          'SCOPE_MISMATCH',
          'Task and parent case must have the same explicit scope',
        );
      if (parent.status === 'archived')
        throw new DomainError(
          'CASE_ARCHIVED',
          'Cannot add work to an archived case',
          409,
        );
    }
    await this.validateOwners(ctx, input, tx);
    const profile = await tx.organizationProfile.findUnique({
      where: { organization_id: ctx.organizationId },
    });
    const defaults = z
      .object({
        default_seconds: z.number().positive().optional(),
        priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
      })
      .passthrough()
      .safeParse(profile?.reactivity_profile ?? {});
    const seconds =
      input.reactivity_seconds ??
      (defaults.success ? defaults.data.default_seconds : undefined);
    const { reactivity_seconds, metadata, ...fields } = input;
    const row = await tx.task.create({
      data: {
        ...fields,
        organization_id: ctx.organizationId,
        created_by_user_id: ctx.actorUserId,
        status: 'PENDING',
        priority:
          input.priority ??
          (defaults.success ? defaults.data.priority : undefined) ??
          'MEDIUM',
        escalation_level: 0,
        reactivity_deadline_at: seconds
          ? new Date(Date.now() + seconds * 1000)
          : null,
        metadata: cleanMetadata(metadata),
      },
    });
    await this.event(tx, ctx, row, 'created', 'TaskCreated', {
      status: row.status,
    });
    if (row.owner_user_id || row.owner_role_id)
      await this.assignmentHistory(tx, row, 'Initial assignment');
    return row;
  }
  private async event(
    tx: Tx,
    ctx: ExecutionContext,
    row: Task,
    type: Prisma.TaskEventCreateInput['event_type'],
    name: string,
    value: unknown,
  ) {
    await tx.taskEvent.create({
      data: {
        task_id: row.id,
        organization_id: ctx.organizationId,
        event_type: type,
        actor_user_id: ctx.actorUserId,
        origin:
          ctx.actorType === 'system'
            ? 'system_rule'
            : ctx.source === 'email'
              ? 'email'
              : 'api',
        new_value: json(value),
        created_at: new Date(),
      },
    });
    await recordEvent(tx, ctx, 'task', row.id, name, value);
  }
  private async assignmentHistory(tx: Tx, row: Task, reason?: string) {
    await tx.taskAssignment.updateMany({
      where: { task_id: row.id, unassigned_at: null },
      data: { unassigned_at: new Date(), is_primary: false },
    });
    if (row.owner_user_id || row.owner_role_id)
      await tx.taskAssignment.create({
        data: {
          task_id: row.id,
          assigned_user_id: row.owner_user_id,
          assigned_role_id: row.owner_role_id,
          assigned_at: new Date(),
          is_primary: true,
          assignment_reason: reason,
        },
      });
  }
  async changeTaskStatus(
    ctx: ExecutionContext,
    id: string,
    next: string,
    revision: number,
    tx: Tx,
    reason?: string,
  ) {
    this.requireAny(ctx, 'work:write');
    const row = await this.getTask(ctx, id, tx);
    this.assertAccess(ctx, row, 'work:write');
    const status = parse(taskStatus, next);
    transition('task', row.status, status);
    const changed = await tx.task.updateMany({
      where: { id, organization_id: ctx.organizationId, revision },
      data: {
        status,
        revision: { increment: 1 },
        closed_at: terminalTask(status) ? new Date() : null,
        ...(status === 'ESCALATED'
          ? { escalation_level: { increment: 1 } }
          : {}),
      },
    });
    if (!changed.count)
      throw new DomainError(
        'REVISION_CONFLICT',
        'Task changed; reload before retrying',
        409,
      );
    const updated = await this.getTask(ctx, id, tx);
    await this.event(
      tx,
      ctx,
      updated,
      status === 'ESCALATED' ? 'escalated' : 'status_changed',
      'TaskStatusChanged',
      { from: row.status, to: status, reason: reason ?? null },
    );
    return updated;
  }
  async changeCaseStatus(
    ctx: ExecutionContext,
    id: string,
    next: string,
    revision: number,
    tx: Tx,
  ) {
    this.requireAny(ctx, 'work:write');
    await lock(tx, `case:${ctx.organizationId}:${id}`);
    const row = await this.getCase(ctx, id, tx);
    this.assertAccess(ctx, row, 'work:write');
    const status = parse(caseStatus, next);
    transition('case', row.status, status);
    const changed = await tx.case.updateMany({
      where: { id, organization_id: ctx.organizationId, revision },
      data: { status, revision: { increment: 1 } },
    });
    if (!changed.count)
      throw new DomainError(
        'REVISION_CONFLICT',
        'Case changed; reload before retrying',
        409,
      );
    await recordEvent(tx, ctx, 'case', id, 'CaseStatusChanged', {
      from: row.status,
      to: status,
    });
    return this.getCase(ctx, id, tx);
  }
  async assign(ctx: ExecutionContext, id: string, raw: unknown, tx: Tx) {
    this.requireAny(ctx, 'work:assign');
    const input = parse(assignmentInput, raw);
    const current = await this.getTask(ctx, id, tx);
    this.assertAccess(ctx, current, 'work:assign');
    if (terminalTask(current.status))
      throw new DomainError('TASK_TERMINAL', 'Cannot assign closed work', 409);
    await this.validateOwners(ctx, input, tx);
    const { revision, reason, ...data } = input;
    const result = await tx.task.updateMany({
      where: { id, organization_id: ctx.organizationId, revision },
      data: { ...data, revision: { increment: 1 } },
    });
    if (!result.count)
      throw new DomainError(
        'REVISION_CONFLICT',
        'Task changed; reload before retrying',
        409,
      );
    const row = await this.getTask(ctx, id, tx);
    await this.assignmentHistory(tx, row, reason);
    await this.event(tx, ctx, row, 'ownership_changed', 'TaskAssigned', data);
    return row;
  }
  async patchTask(
    ctx: ExecutionContext,
    id: string,
    data: {
      title?: string;
      description?: string;
      metadata?: Record<string, unknown>;
      label?: string;
      priority?: Task['priority'];
      due_at?: string;
    },
    revision: number,
    tx: Tx,
  ) {
    this.requireAny(ctx, 'work:write');
    const row = await this.getTask(ctx, id, tx);
    this.assertAccess(ctx, row, 'work:write');
    if (terminalTask(row.status))
      throw new DomainError(
        'TASK_TERMINAL',
        'Closed work cannot be edited',
        409,
      );
    const result = await tx.task.updateMany({
      where: { id, organization_id: ctx.organizationId, revision },
      data: {
        ...data,
        metadata: data.metadata
          ? cleanMetadata({
              ...(row.metadata as Record<string, unknown>),
              ...data.metadata,
            })
          : undefined,
        revision: { increment: 1 },
      },
    });
    if (!result.count)
      throw new DomainError(
        'REVISION_CONFLICT',
        'Task changed; reload before retrying',
        409,
      );
    const updated = await this.getTask(ctx, id, tx);
    await this.event(tx, ctx, updated, 'metadata_updated', 'TaskUpdated', data);
    return updated;
  }
  async comment(
    ctx: ExecutionContext,
    id: string,
    body: string,
    commentVisibility: 'internal_only' | 'requester_visible' | 'org_wide',
    tx: Tx,
  ) {
    this.requireAny(ctx, 'work:comment');
    const row = await this.getTask(ctx, id, tx);
    this.assertAccess(ctx, row, 'work:comment');
    const comment = await tx.taskComment.create({
      data: {
        task_id: id,
        author_user_id: ctx.actorUserId,
        body,
        visibility: commentVisibility,
      },
    });
    await this.event(tx, ctx, row, 'comment_added', 'TaskCommentAdded', {
      comment_id: comment.id,
    });
    return comment;
  }
  async addLabel(ctx: ExecutionContext, id: string, value: string, tx: Tx) {
    this.requireAny(ctx, 'work:write');
    const row = await this.getTask(ctx, id, tx);
    this.assertAccess(ctx, row, 'work:write');
    const code = parse(label, value);
    await lock(tx, `label:${ctx.organizationId}:${id}:${code}`);
    const definition = await tx.labelDefinition.upsert({
      where: {
        organization_id_code: { organization_id: ctx.organizationId, code },
      },
      create: {
        organization_id: ctx.organizationId,
        code,
        display_name: code,
        description: '',
        category: row.category,
      },
      update: {},
    });
    const existing = await tx.entityLabel.findFirst({
      where: {
        organization_id: ctx.organizationId,
        entity_type: 'task',
        entity_id: id,
        label_id: definition.id,
      },
    });
    if (existing) return existing;
    const link = await tx.entityLabel.create({
      data: {
        organization_id: ctx.organizationId,
        entity_type: 'task',
        entity_id: id,
        label_id: definition.id,
        applied_by_user_id: ctx.actorUserId,
        applied_at: new Date(),
      },
    });
    await this.event(tx, ctx, row, 'metadata_updated', 'TaskLabelAdded', {
      label: code,
    });
    return link;
  }
  async patchCase(ctx: ExecutionContext, id: string, raw: unknown, tx: Tx) {
    this.requireAny(ctx, 'work:write');
    const input = parse(
      z
        .object({
          revision: z.number().int().min(0),
          title: z.string().trim().min(1).max(500).optional(),
          description: z.string().max(20000).optional(),
          tags: z.array(z.string().min(1).max(200)).max(30).optional(),
          metadata: z.record(z.unknown()).optional(),
        })
        .strict(),
      raw,
    );
    const row = await this.getCase(ctx, id, tx);
    this.assertAccess(ctx, row, 'work:write');
    if (row.status === 'archived')
      throw new DomainError(
        'CASE_ARCHIVED',
        'Archived cases cannot be edited',
        409,
      );
    const { revision, ...fields } = input;
    const result = await tx.case.updateMany({
      where: { id, organization_id: ctx.organizationId, revision },
      data: {
        ...fields,
        metadata: fields.metadata
          ? cleanMetadata({
              ...(row.metadata as Record<string, unknown>),
              ...fields.metadata,
            })
          : undefined,
        revision: { increment: 1 },
      },
    });
    if (!result.count)
      throw new DomainError('REVISION_CONFLICT', 'Case changed; reload', 409);
    await recordEvent(tx, ctx, 'case', id, 'CaseUpdated', fields);
    return this.getCase(ctx, id, tx);
  }
  async linkCase(ctx: ExecutionContext, id: string, raw: unknown, tx: Tx) {
    this.requireAny(ctx, 'work:write');
    const input = parse(
      z
        .object({
          revision: z.number().int().min(0),
          case_id: z.string().uuid().nullable(),
        })
        .strict(),
      raw,
    );
    const row = await this.getTask(ctx, id, tx);
    this.assertAccess(ctx, row, 'work:write');
    if (terminalTask(row.status))
      throw new DomainError(
        'TASK_TERMINAL',
        'Closed tasks cannot be reparented',
        409,
      );
    const parent = input.case_id
      ? await this.getCase(ctx, input.case_id, tx)
      : null;
    if (parent) {
      await lock(tx, `case:${ctx.organizationId}:${parent.id}`);
      const current = await this.getCase(ctx, parent.id, tx);
      this.assertAccess(ctx, current, 'work:write');
      if (current.status === 'archived')
        throw new DomainError(
          'CASE_ARCHIVED',
          'Cannot attach to archived case',
          409,
        );
      if (
        parent.access_scope_type !== row.access_scope_type ||
        parent.access_scope_reference !== row.access_scope_reference
      )
        throw new DomainError(
          'SCOPE_MISMATCH',
          'Case and Task scopes must match',
        );
    }
    const previous = row.case_id
      ? await this.getCase(ctx, row.case_id, tx)
      : null;
    const result = await tx.task.updateMany({
      where: {
        id,
        organization_id: ctx.organizationId,
        revision: input.revision,
      },
      data: {
        case_id: input.case_id,
        visibility:
          previous?.visibility === 'RESTRICTED' ? 'RESTRICTED' : row.visibility,
        revision: { increment: 1 },
      },
    });
    if (!result.count)
      throw new DomainError('REVISION_CONFLICT', 'Task changed; reload', 409);
    await recordEvent(tx, ctx, 'task', id, 'TaskCaseLinked', {
      from: row.case_id,
      to: input.case_id,
    });
    return this.getTask(ctx, id, tx);
  }
  async listTasks(ctx: ExecutionContext, query: unknown) {
    this.requireAny(ctx, 'work:read');
    const q = parse(pageQuery, query);
    const where: Prisma.TaskWhereInput = {
      ...this.taskScope(ctx),
      status: q.status ? parse(taskStatus, q.status) : undefined,
      case_id: q.case_id,
      ...(q.mine === 'true'
        ? {
            owner_user_id:
              ctx.actorUserId ?? '00000000-0000-0000-0000-000000000000',
          }
        : {}),
      ...(q.search
        ? {
            OR: [
              { title: { contains: q.search, mode: 'insensitive' } },
              { label: { startsWith: q.search } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.db.$transaction([
      this.db.task.findMany({
        where,
        take: q.limit,
        skip: q.offset,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      }),
      this.db.task.count({ where }),
    ]);
    return {
      items: rows.map(taskJson),
      total,
      offset: q.offset,
      limit: q.limit,
    };
  }
  async listCases(ctx: ExecutionContext, query: unknown) {
    this.requireAny(ctx, 'work:read');
    const q = parse(pageQuery, query);
    const where: Prisma.CaseWhereInput = {
      ...this.caseScope(ctx),
      status: q.status ? parse(caseStatus, q.status) : undefined,
      ...(q.search
        ? { title: { contains: q.search, mode: 'insensitive' } }
        : {}),
    };
    const [rows, total] = await this.db.$transaction([
      this.db.case.findMany({
        where,
        take: q.limit,
        skip: q.offset,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      }),
      this.db.case.count({ where }),
    ]);
    return {
      items: rows.map(caseJson),
      total,
      offset: q.offset,
      limit: q.limit,
    };
  }
  async caseWorkspace(ctx: ExecutionContext, id: string) {
    const row = await this.getCase(ctx, id);
    const [tasks, signals, timeline, operations] = await Promise.all([
      this.db.task.findMany({
        where: { ...this.taskScope(ctx), case_id: id },
        take: 100,
        orderBy: { created_at: 'desc' },
      }),
      ctx.permissions.includes('*') || ctx.permissions.includes('signals:read')
        ? this.db.signal.findMany({
            where: { organization_id: ctx.organizationId, case_id: id },
            take: 100,
            orderBy: { received_at: 'desc' },
          })
        : [],
      this.db.workEvent.findMany({
        where: {
          organization_id: ctx.organizationId,
          aggregate_type: 'case',
          aggregate_id: id,
        },
        take: 100,
        orderBy: { created_at: 'desc' },
      }),
      ctx.permissions.includes('*') ||
      ctx.permissions.includes('integrations:read')
        ? this.db.integrationOperation.findMany({
            where: {
              organization_id: ctx.organizationId,
              subject_type: 'case',
              subject_id: id,
            },
            take: 100,
            orderBy: { created_at: 'desc' },
          })
        : [],
    ]);
    return {
      ...caseJson(row),
      tasks: tasks.map(taskJson),
      signals,
      timeline,
      operations,
    };
  }
}
