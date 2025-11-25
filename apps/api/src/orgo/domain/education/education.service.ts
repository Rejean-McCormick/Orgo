// apps/api/src/orgo/domain/education/education.service.ts

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Canonical enums aligned with Doc 1 / Doc 2 / Doc 8.
 * These are intentionally duplicated here (like in HrModuleService) so that
 * the Education domain module can stay decoupled from core service types.
 */

export type TaskStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'ON_HOLD'
  | 'COMPLETED'
  | 'FAILED'
  | 'ESCALATED'
  | 'CANCELLED';

export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type TaskSeverity = 'MINOR' | 'MODERATE' | 'MAJOR' | 'CRITICAL';

export type Visibility = 'PUBLIC' | 'INTERNAL' | 'RESTRICTED' | 'ANONYMISED';

export type TaskSource = 'email' | 'api' | 'manual' | 'sync';

export type TaskCategory =
  | 'request'
  | 'incident'
  | 'update'
  | 'report'
  | 'distribution';

/**
 * Canonical domain type for education Tasks.
 * This must match Task.type in the DB and all docs.
 */
export const EDUCATION_DOMAIN_TYPE = 'education_support';

/**
 * Minimal Task row shape for raw SQL usage in this module.
 * Field names mirror the `tasks` table in Doc 1.
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
  created_at: Date;
  updated_at: Date;
}

/**
 * education_task_links row shape (Module 12 – Education & Groups).
 */
export interface EducationTaskLinkRow {
  id: string;
  task_id: string;
  learning_group_id: string | null;
  person_id: string | null;
  context_note: string | null;
}

/**
 * Optional learning group projection used in list results.
 */
export interface LearningGroupSummary {
  learningGroupId: string;
  code: string;
  name: string;
  category: string | null;
}

/**
 * Optional student / person projection used in list results.
 */
export interface StudentSummary {
  personId: string;
  fullName: string;
  externalReference: string | null;
}

/**
 * Service-level DTO for registering a student incident.
 * Controller-level DTOs should validate and map into this shape.
 */
export interface RegisterStudentIncidentInput {
  /**
   * Tenant isolation key – required for all operations.
   */
  organizationId: string;

  /**
   * Human-facing title and description of the incident.
   */
  title: string;
  description: string;

  /**
   * Task classification.
   * Category defaults to "incident" for classroom incidents.
   */
  category?: TaskCategory;
  subtype?: string | null; // e.g. "attendance" | "performance" | "conflict"

  /**
   * Canonical enums (JSON inputs may be lower-case; normalization happens here).
   */
  severity?: TaskSeverity | string;
  priority?: TaskPriority | string;
  visibility?: Visibility | string;

  /**
   * Canonical information label.
   * If omitted, a sane education default is used.
   * Example: "100.94.Education.Support"
   */
  label?: string;

  /**
   * Signal/source metadata (aligned with task_source_enum).
   */
  sourceType?: TaskSource | string;
  sourceReference?: string | null;

  /**
   * Ownership / routing hints.
   */
  ownerRoleId?: string | null;
  ownerUserId?: string | null;
  assigneeRole?: string | null;

  /**
   * Student / group context.
   * Either or both may be provided.
   */
  studentPersonId?: string | null;
  learningGroupId?: string | null;
  contextNote?: string | null; // e.g. "attendance", "performance", "conflict"

  /**
   * Due date for the incident follow-up task.
   */
  dueAt?: string | Date | null;

  /**
   * Actor who is creating the incident (user account).
   */
  createdByUserId?: string | null;

  /**
   * Additional domain-specific task metadata.
   * This will be merged with the standard education domain metadata.
   */
  taskMetadata?: Record<string, unknown> | null;
}

/**
 * Options for listing classroom incidents.
 * These are service-level options; controller DTOs can adapt query params.
 */
export interface ListEducationIncidentsOptions {
  organizationId: string;
  status?: TaskStatus | TaskStatus[];
  learningGroupId?: string;
  studentPersonId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

/**
 * Single incident view returned by listIncidents.
 * This is a Task plus education context and lightweight person/group info.
 */
export interface EducationIncidentSummary {
  taskId: string;
  organizationId: string;
  caseId: string | null;

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

  createdByUserId: string | null;
  requesterPersonId: string | null;
  ownerRoleId: string | null;
  ownerUserId: string | null;
  assigneeRole: string | null;

  dueAt: string | null;
  reactivityDeadlineAt: string | null;
  escalationLevel: number;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;

  /**
   * Education context (group + student).
   * Any of these may be null when not applicable.
   */
  learningGroup?: LearningGroupSummary | null;
  student?: StudentSummary | null;
  contextNote?: string | null;
}

/**
 * Paginated list wrapper for classroom incidents.
 */
export interface PaginatedEducationIncidentSummary {
  items: EducationIncidentSummary[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * TxClient alias for use inside Prisma transactions.
 */
type TxClient = Prisma.TransactionClient;

/**
 * EducationModuleService
 *
 * Responsibilities:
 * - registerStudentIncident: wraps Task creation for education incidents
 *   (`type = "education_support"`) and inserts an entry in education_task_links.
 * - listIncidents: returns Tasks scoped to the education domain, enriched with
 *   learning group / person context for dashboards and reviews.
 * - findIncidentById: returns a single education incident with full context.
 * - deleteIncident: deletes an education incident and its link rows.
 */
@Injectable()
export class EducationModuleService {
  /**
   * Default canonical label for education incidents.
   * This is aligned with the label taxonomy examples (Doc 8).
   */
  private static readonly DEFAULT_EDUCATION_LABEL = '100.94.Education.Support';

  private readonly prisma: PrismaClient;

  constructor() {
    // Note: if a shared PrismaService / PersistenceModule is in place,
    // this can be refactored to inject that instead.
    this.prisma = new PrismaClient();
  }

  /**
   * Register a new student incident:
   * - Creates a Task (`tasks`) with type = "education_support"
   * - Inserts a row in `education_task_links` with group/person context
   */
  async registerStudentIncident(
    input: RegisterStudentIncidentInput,
  ): Promise<{
    task: EducationIncidentSummary;
    link: EducationTaskLinkRow | null;
  }> {
    this.ensureRequiredFields(input);

    const organizationId = input.organizationId.trim();

    const severity = this.normalizeSeverity(input.severity);
    const priority = this.normalizePriority(input.priority);
    const visibility = this.normalizeVisibility(input.visibility);
    const category = this.normalizeCategory(input.category);
    const sourceType = this.normalizeSource(input.sourceType);
    const label =
      input.label && input.label.trim().length > 0
        ? input.label.trim()
        : EducationModuleService.DEFAULT_EDUCATION_LABEL;

    const dueAt = this.normalizeOptionalDate(input.dueAt);

    const taskMetadataJson = JSON.stringify({
      ...(input.taskMetadata ?? {}),
      domain: EDUCATION_DOMAIN_TYPE,
      context: {
        learning_group_id: input.learningGroupId ?? null,
        student_person_id: input.studentPersonId ?? null,
        context_note: input.contextNote ?? null,
      },
      source_reference: input.sourceReference ?? null,
    });

    const result = await this.prisma.$transaction(
      async (tx: TxClient): Promise<{
        taskRow: TaskRow;
        linkRow: EducationTaskLinkRow | null;
      }> => {
        // 1. Insert Task
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
            ${EDUCATION_DOMAIN_TYPE},
            ${category},
            ${input.subtype ?? null},
            ${label},
            ${input.title.trim()},
            ${input.description.trim()},
            ${'PENDING'},
            ${priority},
            ${severity},
            ${visibility},
            ${sourceType},
            ${input.createdByUserId ?? null},
            ${input.studentPersonId ?? null},
            ${input.ownerRoleId ?? null},
            ${input.ownerUserId ?? null},
            ${input.assigneeRole ?? null},
            ${dueAt},
            ${null},
            ${null},
            ${0},
            ${null},
            ${taskMetadataJson}::jsonb
          )
          RETURNING
            id,
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
            reactivity_deadline_at,
            escalation_level,
            closed_at,
            created_at,
            updated_at
        `;

        if (!taskRow) {
          throw new Error('Failed to create Task for education incident');
        }

        // 2. Insert education_task_links row when there is context to link
        let linkRow: EducationTaskLinkRow | null = null;

        if (
          input.learningGroupId ||
          input.studentPersonId ||
          input.contextNote
        ) {
          const [link] = await tx.$queryRaw<EducationTaskLinkRow[]>`
            INSERT INTO education_task_links (
              task_id,
              learning_group_id,
              person_id,
              context_note
            ) VALUES (
              ${taskRow.id},
              ${input.learningGroupId ?? null},
              ${input.studentPersonId ?? null},
              ${input.contextNote ?? null}
            )
            RETURNING
              id,
              task_id,
              learning_group_id,
              person_id,
              context_note
          `;
          linkRow = link ?? null;
        }

        return { taskRow, linkRow };
      },
    );

    const summary: EducationIncidentSummary = this.mapRowToIncidentSummary({
      taskRow: result.taskRow,
      linkRow: result.linkRow,
      learningGroup: null,
      student: null,
    });

    return {
      task: summary,
      link: result.linkRow,
    };
  }

  /**
   * List classroom incidents for an organization, optionally filtered by
   * status, learning group, student, and search text.
   *
   * Results are ordered by Task.created_at DESC.
   */
  async listIncidents(
    options: ListEducationIncidentsOptions,
  ): Promise<PaginatedEducationIncidentSummary> {
    const { organizationId } = options;

    if (!organizationId || !organizationId.trim()) {
      throw new BadRequestException('organizationId is required');
    }

    const orgId = organizationId.trim();
    const statuses = this.normalizeStatusFilter(options.status);
    const search = options.search?.trim() || null;

    const limit = this.normalizeLimit(options.limit);
    const offset = this.normalizeOffset(options.offset);

    const statusCondition: Prisma.Sql = statuses.length
      ? Prisma.sql`AND t.status = ANY(${statuses})`
      : Prisma.sql``;

    const groupCondition: Prisma.Sql = options.learningGroupId
      ? Prisma.sql`AND etl.learning_group_id = ${options.learningGroupId}`
      : Prisma.sql``;

    const studentCondition: Prisma.Sql = options.studentPersonId
      ? Prisma.sql`AND etl.person_id = ${options.studentPersonId}`
      : Prisma.sql``;

    const searchCondition: Prisma.Sql = search
      ? Prisma.sql`AND (
          t.title ILIKE ${`%${search}%`}
          OR t.description ILIKE ${`%${search}%`}
          OR lg.name ILIKE ${`%${search}%`}
          OR lg.code ILIKE ${`%${search}%`}
          OR pp.full_name ILIKE ${`%${search}%`}
          OR pp.external_reference ILIKE ${`%${search}%`}
        )`
      : Prisma.sql``;

    const rows = await this.prisma.$queryRaw<
      Array<
        TaskRow & {
          education_link_id: string | null;
          learning_group_id: string | null;
          learning_group_code: string | null;
          learning_group_name: string | null;
          learning_group_category: string | null;
          student_person_id: string | null;
          student_full_name: string | null;
          student_external_reference: string | null;
          context_note: string | null;
        }
      >
    >`
      SELECT
        t.id,
        t.organization_id,
        t.case_id,
        t.type,
        t.category,
        t.subtype,
        t.label,
        t.title,
        t.description,
        t.status,
        t.priority,
        t.severity,
        t.visibility,
        t.source,
        t.created_by_user_id,
        t.requester_person_id,
        t.owner_role_id,
        t.owner_user_id,
        t.assignee_role,
        t.due_at,
        t.reactivity_deadline_at,
        t.escalation_level,
        t.closed_at,
        t.created_at,
        t.updated_at,
        etl.id AS education_link_id,
        etl.learning_group_id,
        etl.person_id AS student_person_id,
        etl.context_note,
        lg.code AS learning_group_code,
        lg.name AS learning_group_name,
        lg.category AS learning_group_category,
        pp.full_name AS student_full_name,
        pp.external_reference AS student_external_reference
      FROM tasks t
      LEFT JOIN education_task_links etl
        ON etl.task_id = t.id
      LEFT JOIN learning_groups lg
        ON etl.learning_group_id = lg.id
      LEFT JOIN person_profiles pp
        ON etl.person_id = pp.id
      WHERE t.organization_id = ${orgId}
        AND t.type = ${EDUCATION_DOMAIN_TYPE}
        ${statusCondition}
        ${groupCondition}
        ${studentCondition}
        ${searchCondition}
      ORDER BY t.created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const [countRow] = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*)::bigint AS total
      FROM tasks t
      LEFT JOIN education_task_links etl
        ON etl.task_id = t.id
      LEFT JOIN learning_groups lg
        ON etl.learning_group_id = lg.id
      LEFT JOIN person_profiles pp
        ON etl.person_id = pp.id
      WHERE t.organization_id = ${orgId}
        AND t.type = ${EDUCATION_DOMAIN_TYPE}
        ${statusCondition}
        ${groupCondition}
        ${studentCondition}
        ${searchCondition}
    `;

    const total = countRow ? Number(countRow.total) : 0;

    const items: EducationIncidentSummary[] = rows.map((row) => {
      const learningGroup: LearningGroupSummary | null =
        row.learning_group_id &&
        row.learning_group_code &&
        row.learning_group_name
          ? {
              learningGroupId: row.learning_group_id,
              code: row.learning_group_code,
              name: row.learning_group_name,
              category: row.learning_group_category,
            }
          : null;

      const student: StudentSummary | null =
        row.student_person_id && row.student_full_name
          ? {
              personId: row.student_person_id,
              fullName: row.student_full_name,
              externalReference: row.student_external_reference,
            }
          : null;

      return this.mapRowToIncidentSummary({
        taskRow: row,
        linkRow: row.education_link_id
          ? {
              id: row.education_link_id,
              task_id: row.id,
              learning_group_id: row.learning_group_id,
              person_id: row.student_person_id,
              context_note: row.context_note,
            }
          : null,
        learningGroup,
        student,
      });
    });

    return {
      items,
      total,
      limit,
      offset,
    };
  }

  /**
   * Fetch a single education incident by task id and organization,
   * enriched with learning group and student projections.
   */
  async findIncidentById(
    organizationId: string,
    taskId: string,
  ): Promise<EducationIncidentSummary> {
    if (!organizationId || !organizationId.trim()) {
      throw new BadRequestException('organizationId is required');
    }
    if (!taskId || !taskId.trim()) {
      throw new BadRequestException('taskId is required');
    }

    const orgId = organizationId.trim();

    const rows = await this.prisma.$queryRaw<
      Array<
        TaskRow & {
          education_link_id: string | null;
          learning_group_id: string | null;
          learning_group_code: string | null;
          learning_group_name: string | null;
          learning_group_category: string | null;
          student_person_id: string | null;
          student_full_name: string | null;
          student_external_reference: string | null;
          context_note: string | null;
        }
      >
    >`
      SELECT
        t.id,
        t.organization_id,
        t.case_id,
        t.type,
        t.category,
        t.subtype,
        t.label,
        t.title,
        t.description,
        t.status,
        t.priority,
        t.severity,
        t.visibility,
        t.source,
        t.created_by_user_id,
        t.requester_person_id,
        t.owner_role_id,
        t.owner_user_id,
        t.assignee_role,
        t.due_at,
        t.reactivity_deadline_at,
        t.escalation_level,
        t.closed_at,
        t.created_at,
        t.updated_at,
        etl.id AS education_link_id,
        etl.learning_group_id,
        etl.person_id AS student_person_id,
        etl.context_note,
        lg.code AS learning_group_code,
        lg.name AS learning_group_name,
        lg.category AS learning_group_category,
        pp.full_name AS student_full_name,
        pp.external_reference AS student_external_reference
      FROM tasks t
      LEFT JOIN education_task_links etl
        ON etl.task_id = t.id
      LEFT JOIN learning_groups lg
        ON etl.learning_group_id = lg.id
      LEFT JOIN person_profiles pp
        ON etl.person_id = pp.id
      WHERE t.organization_id = ${orgId}
        AND t.id = ${taskId}
        AND t.type = ${EDUCATION_DOMAIN_TYPE}
      LIMIT 1
    `;

    const row = rows[0];

    if (!row) {
      throw new NotFoundException(
        `Education incident with id "${taskId}" not found`,
      );
    }

    const learningGroup: LearningGroupSummary | null =
      row.learning_group_id && row.learning_group_code && row.learning_group_name
        ? {
            learningGroupId: row.learning_group_id,
            code: row.learning_group_code,
            name: row.learning_group_name,
            category: row.learning_group_category,
          }
        : null;

    const student: StudentSummary | null =
      row.student_person_id && row.student_full_name
        ? {
            personId: row.student_person_id,
            fullName: row.student_full_name,
            externalReference: row.student_external_reference,
          }
        : null;

    return this.mapRowToIncidentSummary({
      taskRow: row,
      linkRow: row.education_link_id
        ? {
            id: row.education_link_id,
            task_id: row.id,
            learning_group_id: row.learning_group_id,
            person_id: row.student_person_id,
            context_note: row.context_note,
          }
        : null,
      learningGroup,
      student,
    });
  }

  /**
   * Delete an education incident (Task + link rows) for a given organization.
   * Throws NotFoundException if the incident does not exist or is not scoped
   * to the given organization.
   */
  async deleteIncident(
    organizationId: string,
    taskId: string,
  ): Promise<void> {
    if (!organizationId || !organizationId.trim()) {
      throw new BadRequestException('organizationId is required');
    }
    if (!taskId || !taskId.trim()) {
      throw new BadRequestException('taskId is required');
    }

    const orgId = organizationId.trim();

    await this.prisma.$transaction(async (tx: TxClient) => {
      // Remove any education_task_links first
      await tx.$executeRaw`
        DELETE FROM education_task_links
        WHERE task_id = ${taskId}
      `;

      // Then delete the task itself, scoped to organization and domain type
      const [deleted] = await tx.$queryRaw<{ id: string }[]>`
        DELETE FROM tasks
        WHERE id = ${taskId}
          AND organization_id = ${orgId}
          AND type = ${EDUCATION_DOMAIN_TYPE}
        RETURNING id
      `;

      if (!deleted) {
        throw new NotFoundException(
          `Education incident with id "${taskId}" not found`,
        );
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private ensureRequiredFields(input: RegisterStudentIncidentInput): void {
    if (!input.organizationId || !input.organizationId.trim()) {
      throw new BadRequestException('organizationId is required');
    }
    if (!input.title || !input.title.trim()) {
      throw new BadRequestException('title is required');
    }
    if (!input.description || !input.description.trim()) {
      throw new BadRequestException('description is required');
    }
  }

  private normalizeSeverity(severity?: TaskSeverity | string): TaskSeverity {
    if (!severity) {
      return 'MODERATE';
    }
    const raw = severity.toString().trim();
    const upper = raw.toUpperCase();

    if (upper === 'INFO') {
      // Historical mapping: treat "info" as MINOR
      return 'MINOR';
    }

    const allowed: TaskSeverity[] = ['MINOR', 'MODERATE', 'MAJOR', 'CRITICAL'];

    if (!allowed.includes(upper as TaskSeverity)) {
      throw new BadRequestException(
        `Invalid severity "${severity}". Expected one of: ${allowed.join(', ')}`,
      );
    }

    return upper as TaskSeverity;
  }

  private normalizePriority(priority?: TaskPriority | string): TaskPriority {
    if (!priority) {
      return 'MEDIUM';
    }
    const upper = priority.toString().trim().toUpperCase();
    const allowed: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

    if (!allowed.includes(upper as TaskPriority)) {
      throw new BadRequestException(
        `Invalid priority "${priority}". Expected one of: ${allowed.join(', ')}`,
      );
    }

    return upper as TaskPriority;
  }

  private normalizeVisibility(visibility?: Visibility | string): Visibility {
    if (!visibility) {
      return 'INTERNAL';
    }
    const upper = visibility.toString().trim().toUpperCase();
    const allowed: Visibility[] = [
      'PUBLIC',
      'INTERNAL',
      'RESTRICTED',
      'ANONYMISED',
    ];

    if (!allowed.includes(upper as Visibility)) {
      throw new BadRequestException(
        `Invalid visibility "${visibility}". Expected one of: ${allowed.join(
          ', ',
        )}`,
      );
    }

    return upper as Visibility;
  }

  private normalizeSource(source?: TaskSource | string): TaskSource {
    if (!source) {
      return 'manual';
    }
    const lower = source.toString().trim().toLowerCase();
    const allowed: TaskSource[] = ['email', 'api', 'manual', 'sync'];

    if (!allowed.includes(lower as TaskSource)) {
      throw new BadRequestException(
        `Invalid sourceType "${source}". Expected one of: ${allowed.join(
          ', ',
        )}`,
      );
    }

    return lower as TaskSource;
  }

  private normalizeCategory(category?: TaskCategory): TaskCategory {
    const allowed: TaskCategory[] = [
      'request',
      'incident',
      'update',
      'report',
      'distribution',
    ];

    if (!category) {
      return 'incident';
    }

    if (!allowed.includes(category)) {
      throw new BadRequestException(
        `Invalid category "${category}". Expected one of: ${allowed.join(', ')}`,
      );
    }

    return category;
  }

  private normalizeOptionalDate(date?: string | Date | null): Date | null {
    if (!date) {
      return null;
    }

    if (date instanceof Date) {
      return date;
    }

    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(
        `Invalid dueAt "${date}". Expected ISO-8601 string or Date.`,
      );
    }

    return parsed;
  }

  private normalizeStatusFilter(status?: TaskStatus | TaskStatus[]): TaskStatus[] {
    const allowed: TaskStatus[] = [
      'PENDING',
      'IN_PROGRESS',
      'ON_HOLD',
      'COMPLETED',
      'FAILED',
      'ESCALATED',
      'CANCELLED',
    ];

    if (!status) {
      // Default "open" view: only unresolved tasks.
      return ['PENDING', 'IN_PROGRESS', 'ON_HOLD', 'ESCALATED'];
    }

    const list = Array.isArray(status) ? status : [status];
    const normalized: TaskStatus[] = [];

    for (const raw of list) {
      const upper = raw.toString().trim().toUpperCase() as TaskStatus;
      if (!allowed.includes(upper)) {
        throw new BadRequestException(
          `Invalid status "${raw}". Expected one of: ${allowed.join(', ')}`,
        );
      }
      if (!normalized.includes(upper)) {
        normalized.push(upper);
      }
    }

    return normalized;
  }

  private normalizeLimit(limit?: number): number {
    if (!Number.isFinite(limit as number) || (limit as number) <= 0) {
      return 50;
    }
    const value = Math.floor(limit as number);
    return value > 500 ? 500 : value;
  }

  private normalizeOffset(offset?: number): number {
    if (!Number.isFinite(offset as number) || (offset as number) < 0) {
      return 0;
    }
    return Math.floor(offset as number);
  }

  private mapRowToIncidentSummary(args: {
    taskRow: TaskRow;
    linkRow: EducationTaskLinkRow | null;
    learningGroup: LearningGroupSummary | null;
    student: StudentSummary | null;
  }): EducationIncidentSummary {
    const { taskRow, linkRow, learningGroup, student } = args;

    return {
      taskId: taskRow.id,
      organizationId: taskRow.organization_id,
      caseId: taskRow.case_id,

      type: taskRow.type,
      category: taskRow.category,
      subtype: taskRow.subtype,
      label: taskRow.label,

      title: taskRow.title,
      description: taskRow.description,

      status: taskRow.status,
      priority: taskRow.priority,
      severity: taskRow.severity,
      visibility: taskRow.visibility,
      source: taskRow.source,

      createdByUserId: taskRow.created_by_user_id,
      requesterPersonId: taskRow.requester_person_id,
      ownerRoleId: taskRow.owner_role_id,
      ownerUserId: taskRow.owner_user_id,
      assigneeRole: taskRow.assignee_role,

      dueAt: taskRow.due_at ? taskRow.due_at.toISOString() : null,
      reactivityDeadlineAt: taskRow.reactivity_deadline_at
        ? taskRow.reactivity_deadline_at.toISOString()
        : null,
      escalationLevel: taskRow.escalation_level,
      closedAt: taskRow.closed_at ? taskRow.closed_at.toISOString() : null,
      createdAt: taskRow.created_at.toISOString(),
      updatedAt: taskRow.updated_at.toISOString(),

      learningGroup: learningGroup ?? null,
      student: student ?? null,
      contextNote: linkRow?.context_note ?? null,
    };
  }
}
