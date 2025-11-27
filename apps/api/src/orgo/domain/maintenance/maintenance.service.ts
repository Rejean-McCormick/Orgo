// apps/api/src/orgo/domain/maintenance/maintenance.service.ts

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PrismaClient, TaskStatus } from '@prisma/client';

/**
 * Domain type for maintenance tasks.
 * Must match Task.type stored in DB.
 */
export const MAINTENANCE_DOMAIN_TYPE = 'maintenance';

/**
 * Canonical Task enums (Doc 1 / Doc 2).
 */
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type TaskSeverity = 'MINOR' | 'MODERATE' | 'MAJOR' | 'CRITICAL';
export type TaskCategory =
  | 'request'
  | 'incident'
  | 'update'
  | 'report'
  | 'distribution';
export type Visibility = 'PUBLIC' | 'INTERNAL' | 'RESTRICTED' | 'ANONYMISED';
export type TaskSource = 'email' | 'api' | 'manual' | 'sync';

/**
 * Row shapes for the maintenance domain (raw SQL).
 */
export interface TaskRow {
  id: string;
  organization_id: string;
  case_id: string | null;
  type: string;
  category: TaskCategory;
  subtype: string | null;
  label: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  severity: TaskSeverity;
  visibility: Visibility;
  source: TaskSource;
  created_by_user_id: string | null;
  requester_person_id: string | null;
  owner_role_id: string | null;
  owner_user_id: string | null;
  assignee_role: string | null;
  due_at: Date | null;
  reactivity_deadline_at: Date | null;
  escalation_level: number;
  closed_at: Date | null;
  metadata: Prisma.JsonValue | null;
  created_at: Date;
  updated_at: Date;
}

export interface MaintenanceTaskLinkRow {
  id: string;
  task_id: string;
  asset_id: string | null;
  work_order_reference: string | null;
  priority_override: TaskPriority | null;
}

export interface MaintenanceCalendarSlotRow {
  id: string;
  task_id: string;
  assigned_user_id: string | null;
  start_at: Date;
  end_at: Date;
  status: 'planned' | 'in_progress' | 'completed' | 'cancelled';
}

/* -------------------------------------------------------------------------- */
/*  Input DTOs (service‑level shaping)                                        */
/* -------------------------------------------------------------------------- */

export interface CreateMaintenanceInput {
  organizationId: string;
  title: string;
  description: string;

  category?: TaskCategory;
  subtype?: string | null;
  priority?: TaskPriority;
  severity?: TaskSeverity;
  visibility?: Visibility;
  label?: string | null;
  sourceType?: TaskSource | string;
  metadata?: Record<string, unknown> | null;

  assetId?: string | null;
  workOrderReference?: string | null;

  createdByUserId?: string | null;
  requesterPersonId?: string | null;
  ownerRoleId?: string | null;
  ownerUserId?: string | null;
  assigneeRole?: string | null;

  dueAt?: string | Date | null;
}

export interface UpdateMaintenanceInput {
  title?: string;
  description?: string;
  category?: TaskCategory;
  subtype?: string | null;
  priority?: TaskPriority;
  severity?: TaskSeverity;
  visibility?: Visibility;
  label?: string | null;
  metadata?: Record<string, unknown> | null;

  assetId?: string | null;
  workOrderReference?: string | null;
  priorityOverride?: TaskPriority | null;

  dueAt?: string | Date | null;
}

export interface CompleteMaintenanceInput {
  closedAt?: string | Date | null;
  reason?: string | null;
}

export interface ReassignMaintenanceInput {
  newOwnerUserId?: string | null;
  newOwnerRoleId?: string | null;
  newAssigneeRole?: string | null;
}

/* -------------------------------------------------------------------------- */
/*  Service Implementation                                                    */
/* -------------------------------------------------------------------------- */

@Injectable()
export class MaintenanceService {
  private readonly prisma: PrismaClient;

  constructor() {
    // Same pattern as education/hr domain modules
    this.prisma = new PrismaClient();
  }

  /* ---------------------------------------------------------------------- */
  /*  List all maintenance tasks for an organization                        */
  /* ---------------------------------------------------------------------- */

  async findAll(
    organizationId: string,
    query?: {
      status?: TaskStatus;
      category?: TaskCategory;
      subtype?: string;
      label?: string;
      search?: string;
      page?: number;
      pageSize?: number;
    },
  ): Promise<TaskRow[]> {
    if (!organizationId) {
      throw new BadRequestException('organizationId is required');
    }

    const page = query?.page && query.page > 0 ? query.page : 1;
    const pageSize =
      query?.pageSize && query.pageSize > 0 ? query.pageSize : 50;

    const whereClauses: Prisma.Sql[] = [
      Prisma.sql`t.organization_id = ${organizationId}`,
      Prisma.sql`t.type = ${MAINTENANCE_DOMAIN_TYPE}`,
    ];

    if (query?.status) {
      whereClauses.push(Prisma.sql`t.status = ${query.status}`);
    }
    if (query?.category) {
      whereClauses.push(Prisma.sql`t.category = ${query.category}`);
    }
    if (query?.subtype) {
      whereClauses.push(Prisma.sql`t.subtype = ${query.subtype}`);
    }
    if (query?.label) {
      whereClauses.push(Prisma.sql`t.label = ${query.label}`);
    }
    if (query?.search) {
      const s = `%${query.search}%`;
      whereClauses.push(
        Prisma.sql`(t.title ILIKE ${s} OR t.description ILIKE ${s})`,
      );
    }

    const whereSql =
      whereClauses.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(whereClauses, Prisma.sql` AND `)}`
        : Prisma.sql``;

    const rows = await this.prisma.$queryRaw<TaskRow[]>`
      SELECT
        t.* 
      FROM tasks t
      LEFT JOIN maintenance_task_links m
        ON m.task_id = t.id
      ${whereSql}
      ORDER BY t.created_at DESC
      LIMIT ${pageSize}
      OFFSET ${(page - 1) * pageSize}
    `;

    return rows;
  }

  /* ---------------------------------------------------------------------- */
  /*  Fetch a single maintenance task                                       */
  /* ---------------------------------------------------------------------- */

  async findOne(
    organizationId: string,
    id: string,
  ): Promise<(TaskRow & { maintenanceLink: MaintenanceTaskLinkRow | null })> {
    if (!organizationId || !id) {
      throw new BadRequestException('organizationId and id are required');
    }

    const rows = await this.prisma.$queryRaw<
      Array<TaskRow & { link_id: string | null; asset_id: string | null; work_order_reference: string | null; priority_override: TaskPriority | null }>
    >`
      SELECT
        t.*,
        m.id     AS link_id,
        m.asset_id,
        m.work_order_reference,
        m.priority_override
      FROM tasks t
      LEFT JOIN maintenance_task_links m
        ON m.task_id = t.id
      WHERE t.organization_id = ${organizationId}
        AND t.id = ${id}
        AND t.type = ${MAINTENANCE_DOMAIN_TYPE}
      LIMIT 1
    `;

    if (rows.length === 0) {
      throw new NotFoundException(`Maintenance task ${id} not found`);
    }

    const row = rows[0];

    return {
      ...row,
      maintenanceLink: row.link_id
        ? ({
            id: row.link_id,
            task_id: row.id,
            asset_id: row.asset_id,
            work_order_reference: row.work_order_reference,
            priority_override: row.priority_override,
          } as MaintenanceTaskLinkRow)
        : null,
    };
  }

  /* ---------------------------------------------------------------------- */
  /*  Create a maintenance task                                             */
  /* ---------------------------------------------------------------------- */

  async create(
    organizationId: string,
    userId: string | undefined,
    input: CreateMaintenanceInput,
  ): Promise<{ task: TaskRow; link: MaintenanceTaskLinkRow | null }> {
    if (!organizationId) {
      throw new BadRequestException('organizationId is required');
    }
    if (!input.title || !input.title.trim()) {
      throw new BadRequestException('title is required');
    }
    if (!input.description || !input.description.trim()) {
      throw new BadRequestException('description is required');
    }

    const severity = this.normalizeSeverity(input.severity);
    const priority = this.normalizePriority(input.priority);
    const visibility = this.normalizeVisibility(input.visibility);
    const category = input.category ?? 'incident';
    const source = this.normalizeSource(input.sourceType);
    const label = input.label?.trim() || '100.94.Operations.Maintenance';
    const dueAt = this.normalizeOptionalDate(input.dueAt);

    const metadataJson = input.metadata
      ? JSON.stringify(input.metadata)
      : JSON.stringify({});

    const result = await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const [taskRow] = await tx.$queryRaw<TaskRow[]>`
          INSERT INTO tasks (
            organization_id,
            case_id,
            type,
            category,
            subtype,
            label,
            title,
            description,
            status,
            priority,
            severity,
            visibility,
            source,
            created_by_user_id,
            requester_person_id,
            owner_role_id,
            owner_user_id,
            assignee_role,
            due_at,
            reactivity_time,
            reactivity_deadline_at,
            escalation_level,
            closed_at,
            metadata
          ) VALUES (
            ${organizationId},
            ${null},
            ${MAINTENANCE_DOMAIN_TYPE},
            ${category},
            ${input.subtype ?? null},
            ${label},
            ${input.title.trim()},
            ${input.description.trim()},
            ${'PENDING'},
            ${priority},
            ${severity},
            ${visibility},
            ${source},
            ${userId ?? null},
            ${input.requesterPersonId ?? null},
            ${input.ownerRoleId ?? null},
            ${input.ownerUserId ?? null},
            ${input.assigneeRole ?? null},
            ${dueAt},
            ${null},
            ${null},
            ${0},
            ${null},
            ${metadataJson}::jsonb
          )
          RETURNING *
        `;

        if (!taskRow) {
          throw new Error('Failed to create maintenance task');
        }

        let linkRow: MaintenanceTaskLinkRow | null = null;

        if (input.assetId || input.workOrderReference) {
          const [row] = await tx.$queryRaw<MaintenanceTaskLinkRow[]>`
            INSERT INTO maintenance_task_links (
              task_id,
              asset_id,
              work_order_reference,
              priority_override
            ) VALUES (
              ${taskRow.id},
              ${input.assetId ?? null},
              ${input.workOrderReference ?? null},
              ${null}
            )
            RETURNING *
          `;
          linkRow = row ?? null;
        }

        return { task: taskRow, link: linkRow };
      },
    );

    return result;
  }

  /* ---------------------------------------------------------------------- */
  /*  Update a maintenance task                                             */
  /* ---------------------------------------------------------------------- */

  async update(
    organizationId: string,
    id: string,
    input: UpdateMaintenanceInput,
  ): Promise<{ task: TaskRow; link: MaintenanceTaskLinkRow | null }> {
    if (!organizationId || !id) {
      throw new BadRequestException('organizationId and id are required');
    }

    const existing = await this.findOne(organizationId, id);

    const severity = input.severity
      ? this.normalizeSeverity(input.severity)
      : existing.severity;
    const priority = input.priority
      ? this.normalizePriority(input.priority)
      : existing.priority;
    const visibility = input.visibility
      ? this.normalizeVisibility(input.visibility)
      : existing.visibility;
    const category = input.category ?? existing.category;
    const dueAt = input.dueAt ? this.normalizeOptionalDate(input.dueAt) : null;

    const metadata =
      input.metadata != null
        ? JSON.stringify(input.metadata)
        : existing.metadata;

    const updated = await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const [taskRow] = await tx.$queryRaw<TaskRow[]>`
          UPDATE tasks
          SET
            title = COALESCE(${input.title}, title),
            description = COALESCE(${input.description}, description),
            category = ${category},
            subtype = COALESCE(${input.subtype}, subtype),
            priority = ${priority},
            severity = ${severity},
            visibility = ${visibility},
            label = COALESCE(${input.label}, label),
            due_at = COALESCE(${dueAt}, due_at),
            metadata = ${metadata}::jsonb,
            updated_at = NOW()
          WHERE id = ${id}
            AND organization_id = ${organizationId}
            AND type = ${MAINTENANCE_DOMAIN_TYPE}
          RETURNING *
        `;

        if (!taskRow) {
          throw new NotFoundException(
            `Maintenance task ${id} not found or not in domain`,
          );
        }

        let linkRow: MaintenanceTaskLinkRow | null = null;

        if (
          input.assetId !== undefined ||
          input.workOrderReference !== undefined ||
          input.priorityOverride !== undefined
        ) {
          const [existingLink] = await tx.$queryRaw<
            MaintenanceTaskLinkRow[]
          >`
            SELECT * FROM maintenance_task_links WHERE task_id = ${id} LIMIT 1
          `;

          if (existingLink) {
            const [row] = await tx.$queryRaw<MaintenanceTaskLinkRow[]>`
              UPDATE maintenance_task_links
              SET
                asset_id = COALESCE(${input.assetId}, asset_id),
                work_order_reference = COALESCE(${input.workOrderReference}, work_order_reference),
                priority_override = COALESCE(${input.priorityOverride}, priority_override)
              WHERE task_id = ${id}
              RETURNING *
            `;
            linkRow = row ?? null;
          } else if (
            input.assetId !== undefined ||
            input.workOrderReference !== undefined ||
            input.priorityOverride !== undefined
          ) {
            const [row] = await tx.$queryRaw<MaintenanceTaskLinkRow[]>`
              INSERT INTO maintenance_task_links (
                task_id,
                asset_id,
                work_order_reference,
                priority_override
              ) VALUES (
                ${id},
                ${input.assetId ?? null},
                ${input.workOrderReference ?? null},
                ${input.priorityOverride ?? null}
              )
              RETURNING *
            `;
            linkRow = row ?? null;
          }
        } else if (existing.maintenanceLink) {
          linkRow = existing.maintenanceLink;
        }

        return { task: taskRow, link: linkRow };
      },
    );

    return updated;
  }

  /* ---------------------------------------------------------------------- */
  /*  Complete a maintenance task                                           */
  /* ---------------------------------------------------------------------- */

  async complete(
    organizationId: string,
    id: string,
    input: CompleteMaintenanceInput,
  ): Promise<TaskRow> {
    if (!organizationId || !id) {
      throw new BadRequestException('organizationId and id are required');
    }

    const closedAt = input.closedAt
      ? this.normalizeOptionalDate(input.closedAt)
      : new Date();

    const [updated] = await this.prisma.$queryRaw<TaskRow[]>`
      UPDATE tasks
      SET
        status = 'COMPLETED',
        closed_at = ${closedAt},
        updated_at = NOW()
      WHERE id = ${id}
        AND organization_id = ${organizationId}
        AND type = ${MAINTENANCE_DOMAIN_TYPE}
      RETURNING *
    `;

    if (!updated) {
      throw new NotFoundException(`Maintenance task ${id} not found`);
    }

    return updated;
  }

  /* ---------------------------------------------------------------------- */
  /*  Reassign owner/assignee                                               */
  /* ---------------------------------------------------------------------- */

  async reassign(
    organizationId: string,
    id: string,
    input: ReassignMaintenanceInput,
  ): Promise<TaskRow> {
    if (!organizationId || !id) {
      throw new BadRequestException('organizationId and id are required');
    }

    const [updated] = await this.prisma.$queryRaw<TaskRow[]>`
      UPDATE tasks
      SET
        owner_user_id = COALESCE(${input.newOwnerUserId}, owner_user_id),
        owner_role_id = COALESCE(${input.newOwnerRoleId}, owner_role_id),
        assignee_role = COALESCE(${input.newAssigneeRole}, assignee_role),
        updated_at = NOW()
      WHERE id = ${id}
        AND organization_id = ${organizationId}
        AND type = ${MAINTENANCE_DOMAIN_TYPE}
      RETURNING *
    `;

    if (!updated) {
      throw new NotFoundException(`Maintenance task ${id} not found`);
    }

    return updated;
  }

  /* ---------------------------------------------------------------------- */
  /*  Delete maintenance task                                               */
  /* ---------------------------------------------------------------------- */

  async remove(organizationId: string, id: string): Promise<void> {
    if (!organizationId || !id) {
      throw new BadRequestException('organizationId and id are required');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Remove maintenance links
      await tx.$executeRaw`
        DELETE FROM maintenance_task_links WHERE task_id = ${id}
      `;

      const [deleted] = await tx.$queryRaw<{ id: string }[]>`
        DELETE FROM tasks
        WHERE id = ${id}
          AND organization_id = ${organizationId}
          AND type = ${MAINTENANCE_DOMAIN_TYPE}
        RETURNING id
      `;

      if (!deleted) {
        throw new NotFoundException(`Maintenance task ${id} not found`);
      }
    });

    return;
  }

  /* ---------------------------------------------------------------------- */
  /*  Helpers                                                               */
