import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './././persistence/prisma/prisma.service';
import {
  OrgProfileService,
  ApplyDefaultsResult,
} from './././config/org-profile.service';

/**
 * Canonical Task enums (DB / Core-service level).
 * JSON contracts may use lower-case; service accepts both and normalizes.
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

export type TaskVisibility = 'PUBLIC' | 'INTERNAL' | 'RESTRICTED' | 'ANONYMISED';

export type TaskSource = 'email' | 'api' | 'manual' | 'sync';

/**
 * Task category codes (Doc 5 – Task logical view).
 */
export type TaskCategory =
  | 'request'
  | 'incident'
  | 'update'
  | 'report'
  | 'distribution';

export type TaskCommentVisibility =
  | 'internal_only'
  | 'requester_visible'
  | 'org_wide';

/**
 * Internal input types used by TaskService.
 * These are mapped from API DTOs and workflow actions.
 */

type PriorityInput = TaskPriority | string | null | undefined;
type SeverityInput = TaskSeverity | string | null | undefined;
type VisibilityInput = TaskVisibility | string | null | undefined;
type SourceInput = TaskSource | string | null | undefined;

export interface CreateTaskInput {
  organizationId: string;

  // Optional linkage to a Case (Doc 5 §8 – Task <-> Case).
  caseId?: string | null;

  // Classification
  type: string;
  category: TaskCategory;
  subtype?: string | null;
  label: string;

  // Core details
  title: string;
  description: string;

  // State / SLA inputs – may be partially overridden by OrgProfileService.
  priority?: PriorityInput;
  severity?: SeverityInput;
  visibility?: VisibilityInput;
  source: SourceInput;

  // Actors / routing
  createdByUserId?: string | null;
  requesterPersonId?: string | null;
  ownerRoleId?: string | null;
  ownerUserId?: string | null;
  assigneeRole?: string | null;

  // SLA / scheduling
  dueAt?: string | Date | null;

  /**
   * Optional SLA inputs. In most flows, the active organization profile
   * provides reactivity defaults. These fields act as overrides:
   *
   * - reactivitySeconds → explicit SLA in seconds
   * - reactivityTimeIso → ISO 8601 duration ("P1DT4H", "PT3600S")
   * - reactivityDeadlineAt → absolute override (wins over other fields)
   */
  reactivitySeconds?: number | null;
  reactivityTimeIso?: string | null;
  reactivityDeadlineAt?: string | Date | null;

  /**
   * Free-form metadata, normalized by MetadataService. Must not contain any of
   * the canonical Task fields (Doc 5 §9, Metadata rules).
   */
  metadata?: Record<string, unknown> | null;
}

export interface UpdateTaskStatusInput {
  organizationId: string;
  taskId: string;
  newStatus: TaskStatus | string;
  reason?: string | null;
  actorUserId?: string | null;
}

export interface EscalateTaskInput {
  organizationId: string;
  taskId: string;
  actorUserId?: string | null;
  escalationReason?: string | null;
}

export interface AssignTaskInput {
  organizationId: string;
  taskId: string;
  assigneeRole?: string | null;
  ownerUserId?: string | null;
  ownerRoleId?: string | null;
  actorUserId?: string | null;
  reason?: string | null;
}

export interface AddTaskCommentInput {
  organizationId: string;
  taskId: string;
  authorUserId?: string | null;
  visibility: TaskCommentVisibility;
  body: string;
}

/**
 * ListTasksInput – internal filter for multi-tenant Task listing.
 * Maps cleanly from ListTasksQueryDto (API) and web AdminTaskOverview filters.
 */
export interface ListTasksInput {
  organizationId: string;

  status?: string | string[]; // TaskStatus | "all" | lowercase
  label?: string; // canonical label code
  type?: string;
  assigneeRole?: string;
  severity?: string | string[];
  visibility?: string | string[];
  priority?: string | string[];

  page?: number;
  pageSize?: number;
}

/**
 * Canonical Task DTO used by Core Services and domain modules.
 * JSON contracts map this to snake_case (apps/web/src/orgo/types/task.ts).
 */
export interface TaskDto {
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

  visibility: TaskVisibility;
  source: TaskSource;

  createdByUserId: string | null;
  requesterPersonId: string | null;
  ownerRoleId: string | null;
  ownerUserId: string | null;
  assigneeRole: string | null;

  dueAt: string | null;

  /**
   * Canonical SLA fields.
   * - reactivityTime: ISO 8601 duration (Doc 5 §8.5 & Doc 8 JSON schema)
   * - reactivityDeadlineAt: derived deadline in org-local time (UTC timestamp)
   */
  reactivityTime: string | null;
  reactivityDeadlineAt: string | null;

  escalationLevel: number;
  closedAt: string | null;

  metadata: Record<string, unknown>;

  createdAt: string;
  updatedAt: string;
}

export interface TaskCommentDto {
  id: string;
  taskId: string;
  organizationId: string;
  authorUserId: string | null;
  visibility: TaskCommentVisibility;
  body: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * ListTasksResult – internal service-level list response,
 * mapped by controllers to the web ListTasksResponse / AdminTaskOverviewResponse.
 */
export interface ListTasksResult {
  items: TaskDto[];
  total: number;
  /**
   * Optional cursor for offline/sync scenarios. For now we use a simple
   * page-based cursor encoded as a string; controllers can surface this as-is.
   */
  nextCursor: string | null;
}

/**
 * Standard result shape used across Core Services.
 */
export interface ServiceError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ServiceResult<T> {
  ok: boolean;
  data: T | null;
  error: ServiceError | null;
}

/**
 * Task lifecycle and allowed transitions (Doc 5 §8.5.2 – Task Status Lifecycle).
 */
const TASK_STATE_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  PENDING: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['ON_HOLD', 'COMPLETED', 'FAILED', 'ESCALATED'],
  ON_HOLD: ['IN_PROGRESS', 'CANCELLED'],
  COMPLETED: [],
  FAILED: [],
  ESCALATED: ['IN_PROGRESS', 'COMPLETED', 'FAILED'],
  CANCELLED: [],
};

const TERMINAL_STATUSES: Set<TaskStatus> = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

/**
 * Fallback SLA in seconds when neither the org-profile nor the caller
 * provides a reactivity window. 43 200s = 12h (Doc 5 §8.5.3).
 */
const DEFAULT_REACTIVITY_SECONDS = 43_200;

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orgProfileService: OrgProfileService,
  ) {}

  /**
   * Multi-tenant Task listing with simple filters and page-based pagination.
   * Controllers adapt this to the public JSON ListTasksResponse shape.
   */
  async listTasks(input: ListTasksInput): Promise<ServiceResult<ListTasksResult>> {
    if (!input.organizationId) {
      return this.fail<ListTasksResult>({
        code: 'TASK_VALIDATION_ERROR',
        message: 'organizationId is required to list tasks.',
      });
    }

    const page = input.page && input.page > 0 ? input.page : 1;
    const pageSizeRaw =
      input.pageSize && input.pageSize > 0 ? input.pageSize : 50;
    const pageSize = Math.min(pageSizeRaw, 500);
    const skip = (page - 1) * pageSize;

    const where: Record<string, any> = {
      organization_id: input.organizationId,
    };

    const normalizeFilterValues = <T>(
      raw: string | string[] | undefined,
      normalizer: (value: string) => T | null,
    ): T[] | null => {
      if (!raw) return null;
      const values = Array.isArray(raw) ? raw : [raw];
      const normalized: T[] = [];

      for (const value of values) {
        if (!value) continue;
        if (value === 'all') {
          // "all" means no filter; handled by skipping assigning predicate.
          return null;
        }
        const v = normalizer(String(value));
        if (v) {
          normalized.push(v);
        }
      }

      return normalized.length ? normalized : null;
    };

    const statusValues = normalizeFilterValues<TaskStatus>(
      input.status,
      (token) => this.normalizeStatus(token),
    );
    if (statusValues) {
      where.status = { in: statusValues };
    }

    const priorityValues = normalizeFilterValues<TaskPriority>(
      input.priority,
      (token) => this.normalizePriority(token),
    );
    if (priorityValues) {
      where.priority = { in: priorityValues };
    }

    const severityValues = normalizeFilterValues<TaskSeverity>(
      input.severity,
      (token) => this.normalizeSeverity(token),
    );
    if (severityValues) {
      where.severity = { in: severityValues };
    }

    const visibilityValues = normalizeFilterValues<TaskVisibility>(
      input.visibility,
      (token) => this.normalizeVisibility(token),
    );
    if (visibilityValues) {
      where.visibility = { in: visibilityValues };
    }

    if (input.label) {
      // Filter by canonical label code (exact match; prefix logic lives in Case listing).
      where.label = input.label;
    }

    if (input.type) {
      where.type = input.type;
    }

    if (input.assigneeRole) {
      where.assignee_role = input.assigneeRole;
    }

    try {
      const prismaAny = this.prisma as any;

      const [rows, total] = await Promise.all([
        prismaAny.task.findMany({
          where,
          orderBy: { created_at: 'desc' },
          skip,
          take: pageSize,
        }),
        prismaAny.task.count({ where }),
      ]);

      const items = rows.map((row: any) => this.mapTaskModelToDto(row));
      const reachedEnd = skip + items.length >= total;
      const nextCursor = reachedEnd ? null : String(page + 1);

      return this.ok<ListTasksResult>({
        items,
        total,
        nextCursor,
      });
    } catch (error) {
      this.logger.error(
        `Failed to list tasks for organization ${input.organizationId}: ${String(
          error,
        )}`,
      );
      return this.fail<ListTasksResult>({
        code: 'TASK_LIST_FAILED',
        message: 'Failed to list tasks.',
        details: { organizationId: input.organizationId },
      });
    }
  }

  /**
   * Convenience wrapper for API layer. In Core Services and domain modules,
   * prefer getTaskById(organizationId, taskId) to keep explicit tenancy.
   *
   * The API layer is expected to enforce organization scoping before calling.
   */
  async getTask(taskId: string): Promise<ServiceResult<TaskDto>> {
    if (!taskId) {
      return this.fail<TaskDto>({
        code: 'TASK_VALIDATION_ERROR',
        message: 'taskId is required.',
      });
    }

    try {
      const prismaAny = this.prisma as any;
      const model = await prismaAny.task.findUnique({
        where: { id: taskId },
      });

      if (!model) {
        return this.fail<TaskDto>({
          code: 'TASK_NOT_FOUND',
          message: `Task with id ${taskId} not found.`,
        });
      }

      const dto = this.mapTaskModelToDto(model);
      return this.ok(dto);
    } catch (error) {
      this.logger.error(`Failed to fetch task ${taskId}: ${String(error)}`);
      return this.fail<TaskDto>({
        code: 'TASK_FETCH_FAILED',
        message: 'Failed to fetch task.',
        details: { taskId },
      });
    }
  }

  /**
   * Task creation entry point used by API, workflows, email router and domain modules.
   * Enforces Task spec and uses OrgProfileService for SLA defaults where available.
   */
  async createTask(input: CreateTaskInput): Promise<ServiceResult<TaskDto>> {
    const validationError = this.validateCreateTaskInput(input);
    if (validationError) {
      return this.fail<TaskDto>({
        code: 'TASK_VALIDATION_ERROR',
        message: validationError,
      });
    }

    const now = new Date();

    try {
      const {
        priority,
        visibility,
        severity,
        reactivitySeconds,
        reactivityTimeIso,
        reactivityDeadlineAt,
      } = await this.computeSlaAndClassificationForCreate(input, now);

      const prismaAny = this.prisma as any;

      const created = await prismaAny.task.create({
        data: {
          organization_id: input.organizationId,
          case_id: input.caseId ?? null,

          type: input.type,
          category: input.category,
          subtype: input.subtype ?? null,

          label: input.label,
          title: input.title,
          description: input.description,

          status: 'PENDING',
          priority,
          severity,
          visibility,
          source: this.normalizeSource(input.source) ?? 'manual',

          created_by_user_id: input.createdByUserId ?? null,
          requester_person_id: input.requesterPersonId ?? null,
          owner_role_id: input.ownerRoleId ?? null,
          owner_user_id: input.ownerUserId ?? null,
          assignee_role: input.assigneeRole ?? null,

          due_at: input.dueAt ? new Date(input.dueAt) : null,

          reactivity_time: reactivityTimeIso ?? null,
          reactivity_deadline_at: reactivityDeadlineAt,
          escalation_level: 0,
          closed_at: null,

          metadata: input.metadata ?? {},
        },
      });

      const dto = this.mapTaskModelToDto(created);
      await this.recordTaskEvent('task_created', dto.taskId, dto.organizationId, {
        category: dto.category,
        label: dto.label,
        priority: dto.priority,
        severity: dto.severity,
      });

      return this.ok(dto);
    } catch (error) {
      this.logger.error(
        `Failed to create task for organization ${input.organizationId}: ${String(
          error,
        )}`,
      );
      return this.fail<TaskDto>({
        code: 'TASK_CREATE_FAILED',
        message: 'Failed to create task.',
        details: { organizationId: input.organizationId },
      });
    }
  }

  async updateTaskStatus(
    input: UpdateTaskStatusInput,
  ): Promise<ServiceResult<TaskDto>> {
    const newStatusNormalized = this.normalizeStatus(
      input.newStatus as string,
    );

    if (!newStatusNormalized) {
      return this.fail<TaskDto>({
        code: 'TASK_VALIDATION_ERROR',
        message: `Invalid new task status: ${input.newStatus}`,
      });
    }

    try {
      const taskModel = await this.getTaskModelForOrg(
        input.organizationId,
        input.taskId,
      );

      if (!taskModel) {
        return this.fail<TaskDto>({
          code: 'TASK_NOT_FOUND',
          message: `Task with id ${input.taskId} not found in organization ${input.organizationId}.`,
        });
      }

      const currentStatus =
        this.normalizeStatus(taskModel.status) ?? 'PENDING';

      if (currentStatus === newStatusNormalized) {
        const dto = this.mapTaskModelToDto(taskModel);
        return this.ok(dto);
      }

      if (!this.isTransitionAllowed(currentStatus, newStatusNormalized)) {
        return this.fail<TaskDto>({
          code: 'TASK_INVALID_TRANSITION',
          message: `Transition from ${currentStatus} to ${newStatusNormalized} is not allowed.`,
          details: {
            from: currentStatus,
            to: newStatusNormalized,
          },
        });
      }

      const now = new Date();
      const data: any = {
        status: newStatusNormalized,
        updated_at: now,
      };

      const wasTerminal = TERMINAL_STATUSES.has(currentStatus);
      const isNowTerminal = TERMINAL_STATUSES.has(newStatusNormalized);

      if (!wasTerminal && isNowTerminal) {
        data.closed_at = now;
      } else if (wasTerminal && !isNowTerminal) {
        data.closed_at = null;
      }

      const prismaAny = this.prisma as any;
      const updated = await prismaAny.task.update({
        where: { id: input.taskId },
        data,
      });

      const dto = this.mapTaskModelToDto(updated);

      await this.recordTaskEvent(
        'task_status_changed',
        dto.taskId,
        dto.organizationId,
        {
          previousStatus: currentStatus,
          nextStatus: newStatusNormalized,
          reason: input.reason,
          actorUserId: input.actorUserId,
        },
      );

      return this.ok(dto);
    } catch (error) {
      this.logger.error(
        `Failed to update status for task ${input.taskId}: ${String(error)}`,
      );
      return this.fail<TaskDto>({
        code: 'TASK_STATUS_UPDATE_FAILED',
        message: 'Failed to update task status.',
        details: {
          taskId: input.taskId,
          organizationId: input.organizationId,
        },
      });
    }
  }

  async escalateTask(
    input: EscalateTaskInput,
  ): Promise<ServiceResult<TaskDto>> {
    try {
      const taskModel = await this.getTaskModelForOrg(
        input.organizationId,
        input.taskId,
      );

      if (!taskModel) {
        return this.fail<TaskDto>({
          code: 'TASK_NOT_FOUND',
          message: `Task with id ${input.taskId} not found in organization ${input.organizationId}.`,
        });
      }

      const currentStatus =
        this.normalizeStatus(taskModel.status) ?? 'PENDING';

      if (
        !['PENDING', 'IN_PROGRESS', 'ON_HOLD', 'ESCALATED'].includes(
          currentStatus,
        )
      ) {
        return this.fail<TaskDto>({
          code: 'TASK_CANNOT_ESCALATE',
          message: `Task in status ${currentStatus} cannot be escalated.`,
        });
      }

      const now = new Date();
      const nextEscalationLevel =
        typeof taskModel.escalation_level === 'number'
          ? taskModel.escalation_level + 1
          : 1;

      const prismaAny = this.prisma as any;
      const updated = await prismaAny.task.update({
        where: { id: input.taskId },
        data: {
          status: 'ESCALATED',
          escalation_level: nextEscalationLevel,
          updated_at: now,
        },
      });

      const dto = this.mapTaskModelToDto(updated);

      await this.recordTaskEvent('task_escalated', dto.taskId, dto.organizationId, {
        previousStatus: currentStatus,
        nextStatus: 'ESCALATED',
        previousEscalationLevel: taskModel.escalation_level ?? 0,
        newEscalationLevel: nextEscalationLevel,
        reason: input.escalationReason,
        actorUserId: input.actorUserId,
      });

      return this.ok(dto);
    } catch (error) {
      this.logger.error(
        `Failed to escalate task ${input.taskId}: ${String(error)}`,
      );
      return this.fail<TaskDto>({
        code: 'TASK_ESCALATION_FAILED',
        message: 'Failed to escalate task.',
        details: {
          taskId: input.taskId,
          organizationId: input.organizationId,
        },
      });
    }
  }

  async assignTask(input: AssignTaskInput): Promise<ServiceResult<TaskDto>> {
    try {
      const taskModel = await this.getTaskModelForOrg(
        input.organizationId,
        input.taskId,
      );

      if (!taskModel) {
        return this.fail<TaskDto>({
          code: 'TASK_NOT_FOUND',
          message: `Task with id ${input.taskId} not found in organization ${input.organizationId}.`,
        });
      }

      const prismaAny = this.prisma as any;
      const updated = await prismaAny.task.update({
        where: { id: input.taskId },
        data: {
          assignee_role: input.assigneeRole ?? null,
          owner_user_id: input.ownerUserId ?? null,
          owner_role_id: input.ownerRoleId ?? null,
          updated_at: new Date(),
        },
      });

      const dto = this.mapTaskModelToDto(updated);

      await this.recordTaskEvent(
        'task_ownership_changed',
        dto.taskId,
        dto.organizationId,
        {
          previousOwnerUserId: taskModel.owner_user_id ?? null,
          newOwnerUserId: input.ownerUserId ?? null,
          previousOwnerRoleId: taskModel.owner_role_id ?? null,
          newOwnerRoleId: input.ownerRoleId ?? null,
          previousAssigneeRole: taskModel.assignee_role ?? null,
          newAssigneeRole: input.assigneeRole ?? null,
          actorUserId: input.actorUserId,
          reason: input.reason,
        },
      );

      return this.ok(dto);
    } catch (error) {
      this.logger.error(
        `Failed to assign task ${input.taskId}: ${String(error)}`,
      );
      return this.fail<TaskDto>({
        code: 'TASK_ASSIGN_FAILED',
        message: 'Failed to assign task.',
        details: {
          taskId: input.taskId,
          organizationId: input.organizationId,
        },
      });
    }
  }

  async addComment(
    input: AddTaskCommentInput,
  ): Promise<ServiceResult<TaskCommentDto>> {
    if (!input.body || !input.body.trim()) {
      return this.fail<TaskCommentDto>({
        code: 'TASK_VALIDATION_ERROR',
        message: 'Comment body must not be empty.',
      });
    }

    if (
      !['internal_only', 'requester_visible', 'org_wide'].includes(
        input.visibility,
      )
    ) {
      return this.fail<TaskCommentDto>({
        code: 'TASK_VALIDATION_ERROR',
        message: `Invalid comment visibility: ${input.visibility}`,
      });
    }

    try {
      const taskModel = await this.getTaskModelForOrg(
        input.organizationId,
        input.taskId,
      );

      if (!taskModel) {
        return this.fail<TaskCommentDto>({
          code: 'TASK_NOT_FOUND',
          message: `Task with id ${input.taskId} not found in organization ${input.organizationId}.`,
        });
      }

      const prismaAny = this.prisma as any;
      const created = await prismaAny.task_comment.create({
        data: {
          task_id: input.taskId,
          author_user_id: input.authorUserId ?? null,
          visibility: input.visibility,
          body: input.body.trim(),
        },
      });

      const dto: TaskCommentDto = {
        id: String(created.id),
        taskId: String(created.task_id),
        organizationId: String(taskModel.organization_id),
        authorUserId: created.author_user_id ?? null,
        visibility: created.visibility,
        body: created.body,
        createdAt: created.created_at.toISOString(),
        updatedAt: created.updated_at.toISOString(),
      };

      await this.recordTaskEvent(
        'task_comment_added',
        dto.taskId,
        dto.organizationId,
        {
          commentId: dto.id,
          visibility: dto.visibility,
          authorUserId: dto.authorUserId,
        },
      );

      return this.ok(dto);
    } catch (error) {
      this.logger.error(
        `Failed to add comment to task ${input.taskId}: ${String(error)}`,
      );
      return this.fail<TaskCommentDto>({
        code: 'TASK_COMMENT_FAILED',
        message: 'Failed to add comment to task.',
        details: {
          taskId: input.taskId,
          organizationId: input.organizationId,
        },
      });
    }
  }

  /**
   * Multi-tenant Task fetch used by domain modules and workflows.
   */
  async getTaskById(
    organizationId: string,
    taskId: string,
  ): Promise<ServiceResult<TaskDto>> {
    try {
      const model = await this.getTaskModelForOrg(organizationId, taskId);

      if (!model) {
        return this.fail<TaskDto>({
          code: 'TASK_NOT_FOUND',
          message: `Task with id ${taskId} not found in organization ${organizationId}.`,
        });
      }

      const dto = this.mapTaskModelToDto(model);
      return this.ok(dto);
    } catch (error) {
      this.logger.error(
        `Failed to fetch task ${taskId} for organization ${organizationId}: ${String(
          error,
        )}`,
      );
      return this.fail<TaskDto>({
        code: 'TASK_FETCH_FAILED',
        message: 'Failed to fetch task.',
        details: { taskId, organizationId },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // SLA / Org profile integration helpers
  // ---------------------------------------------------------------------------

  private async computeSlaAndClassificationForCreate(
    input: CreateTaskInput,
    now: Date,
  ): Promise<{
    priority: TaskPriority;
    severity: TaskSeverity;
    visibility: TaskVisibility;
    reactivitySeconds: number | null;
    reactivityTimeIso: string | null;
    reactivityDeadlineAt: Date | null;
  }> {
    const normalizedPriority = this.normalizePriority(input.priority);
    const normalizedVisibility = this.normalizeVisibility(input.visibility);
    const normalizedSeverity =
      this.normalizeSeverity(input.severity) ?? 'MINOR';

    const requestedSeconds =
      typeof input.reactivitySeconds === 'number' && input.reactivitySeconds > 0
        ? input.reactivitySeconds
        : input.reactivityTimeIso
        ? this.parseIsoDurationToSeconds(input.reactivityTimeIso)
        : null;

    let profileDefaults: ApplyDefaultsResult | null = null;

    try {
      profileDefaults = await this.orgProfileService.applyDefaults({
        organizationId: input.organizationId,
        kind: 'task',
        existingPriority: normalizedPriority ?? undefined,
        existingVisibility: normalizedVisibility ?? undefined,
        requestedReactivitySeconds: requestedSeconds ?? undefined,
      });
    } catch (error) {
      this.logger.warn(
        `OrgProfileService.applyDefaults failed for org ${input.organizationId}: ${String(
          error,
        )}`,
      );
    }

    const priority: TaskPriority =
      (profileDefaults?.priority as TaskPriority | undefined) ??
      normalizedPriority ??
      'MEDIUM';

    const visibility: TaskVisibility =
      (profileDefaults?.visibility as TaskVisibility | undefined) ??
      normalizedVisibility ??
      'INTERNAL';

    const reactivitySeconds =
      profileDefaults?.reactivitySeconds ??
      requestedSeconds ??
      DEFAULT_REACTIVITY_SECONDS;

    const reactivityTimeIso =
      profileDefaults?.reactivityTimeIso ??
      input.reactivityTimeIso ??
      (reactivitySeconds != null
        ? this.secondsToIsoDuration(reactivitySeconds)
        : null);

    let reactivityDeadlineAt: Date | null = null;

    if (input.reactivityDeadlineAt) {
      reactivityDeadlineAt = this.toDateOrNull(input.reactivityDeadlineAt);
    } else if (reactivitySeconds != null) {
      reactivityDeadlineAt = new Date(now.getTime() + reactivitySeconds * 1000);
    }

    return {
      priority,
      severity: normalizedSeverity,
      visibility,
      reactivitySeconds,
      reactivityTimeIso,
      reactivityDeadlineAt,
    };
  }

  private parseIsoDurationToSeconds(
    isoDuration: string | null | undefined,
  ): number | null {
    if (!isoDuration) return null;

    const isoPattern =
      /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;
    const match = isoDuration.match(isoPattern);
    if (!match) {
      return null;
    }

    const days = match[1] ? parseInt(match[1], 10) : 0;
    const hours = match[2] ? parseInt(match[2], 10) : 0;
    const minutes = match[3] ? parseInt(match[3], 10) : 0;
    const seconds = match[4] ? parseFloat(match[4]) : 0;

    return days * 86400 + hours * 3600 + minutes * 60 + seconds;
  }

  private secondsToIsoDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return 'PT0S';
    }

    const total = Math.floor(seconds);
    const days = Math.floor(total / 86400);
    let remaining = total - days * 86400;
    const hours = Math.floor(remaining / 3600);
    remaining -= hours * 3600;
    const minutes = Math.floor(remaining / 60);
    const secs = remaining - minutes * 60;

    let result = 'P';
    if (days > 0) {
      result += `${days}D`;
    }

    if (hours || minutes || secs || days === 0) {
      result += 'T';
    }

    if (hours) {
      result += `${hours}H`;
    }
    if (minutes) {
      result += `${minutes}M`;
    }
    if (secs || (!days && !hours && !minutes)) {
      result += `${secs}S`;
    }

    return result;
  }

  private toDateOrNull(value: string | Date | null): Date | null {
    if (!value) return null;
    if (value instanceof Date) return value;
    const asDate = new Date(value);
    return Number.isNaN(asDate.getTime()) ? null : asDate;
  }

  // ---------------------------------------------------------------------------
  // Validation & normalization helpers
  // ---------------------------------------------------------------------------

  private validateCreateTaskInput(input: CreateTaskInput): string | null {
    const requiredStringFields: (keyof CreateTaskInput)[] = [
      'organizationId',
      'type',
      'category',
      'title',
      'description',
      'label',
      'source',
    ];

    for (const field of requiredStringFields) {
      const value = input[field];
      if (typeof value !== 'string' || value.trim().length === 0) {
        return `Field "${field}" is required and must be a non-empty string.`;
      }
    }

    if (!this.normalizeSource(input.source)) {
      return 'Invalid task source.';
    }

    if (input.priority !== undefined && !this.normalizePriority(input.priority)) {
      return 'Invalid task priority.';
    }

    if (input.severity !== undefined && !this.normalizeSeverity(input.severity)) {
      return 'Invalid task severity.';
    }

    if (
      input.visibility !== undefined &&
      !this.normalizeVisibility(input.visibility)
    ) {
      return 'Invalid task visibility.';
    }

    if (!input.category) {
      return 'Task category is required.';
    }

    return null;
  }

  private normalizeStatus(input: string): TaskStatus | null {
    if (!input) return null;
    const upper = input.toUpperCase() as TaskStatus;
    if (upper in TASK_STATE_TRANSITIONS || TERMINAL_STATUSES.has(upper)) {
      return upper;
    }
    return null;
  }

  private normalizePriority(input: PriorityInput): TaskPriority | null {
    if (!input) return null;
    const upper = String(input).toUpperCase() as TaskPriority;
    if (['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(upper)) {
      return upper;
    }
    return null;
  }

  private normalizeSeverity(input: SeverityInput): TaskSeverity | null {
    if (!input) return null;
    const upper = String(input).toUpperCase() as TaskSeverity;
    if (['MINOR', 'MODERATE', 'MAJOR', 'CRITICAL'].includes(upper)) {
      return upper;
    }
    return null;
  }

  private normalizeVisibility(input: VisibilityInput): TaskVisibility | null {
    if (!input) return null;
    const upper = String(input).toUpperCase() as TaskVisibility;
    if (['PUBLIC', 'INTERNAL', 'RESTRICTED', 'ANONYMISED'].includes(upper)) {
      return upper;
    }
    return null;
  }

  private normalizeSource(input: SourceInput): TaskSource | null {
    if (!input) return null;
    const lower = String(input).toLowerCase() as TaskSource;
    if (['email', 'api', 'manual', 'sync'].includes(lower)) {
      return lower;
    }
    return null;
  }

  private isTransitionAllowed(from: TaskStatus, to: TaskStatus): boolean {
    const allowed = TASK_STATE_TRANSITIONS[from] ?? [];
    return allowed.includes(to);
  }

  private async getTaskModelForOrg(
    organizationId: string,
    taskId: string,
  ): Promise<any | null> {
    const prismaAny = this.prisma as any;
    const model = await prismaAny.task.findUnique({
      where: { id: taskId },
    });

    if (!model) {
      return null;
    }

    const orgId =
      model.organization_id ?? model.organizationId ?? model.org_id;
    if (orgId !== organizationId) {
      this.logger.warn(
        `Attempt to access task ${taskId} from wrong organization ${organizationId}`,
      );
      return null;
    }

    return model;
  }

  private mapTaskModelToDto(model: any): TaskDto {
    const get = (...keys: string[]) => {
      for (const key of keys) {
        if (key in model && model[key] !== undefined) {
          return model[key];
        }
      }
      return undefined;
    };

    const id = get('id', 'task_id');
    const organizationId = get('organization_id', 'organizationId');
    const caseId = get('case_id', 'caseId') ?? null;

    const status = this.normalizeStatus(get('status')) ?? 'PENDING';
    const priority =
      this.normalizePriority(get('priority')) ?? 'MEDIUM';
    const severity =
      this.normalizeSeverity(get('severity')) ?? 'MINOR';
    const visibility =
      this.normalizeVisibility(get('visibility')) ?? 'INTERNAL';
    const source = this.normalizeSource(get('source')) ?? 'manual';

    const escalationLevel = get('escalation_level', 'escalationLevel');
    const meta = get('metadata') ?? {};

    const reactivityTimeRaw = get('reactivity_time', 'reactivityTime');

    const toIso = (value: any | null | undefined): string | null => {
      if (!value) return null;
      if (value instanceof Date) return value.toISOString();
      const asDate = new Date(value);
      return Number.isNaN(asDate.getTime()) ? null : asDate.toISOString();
    };

    const reactivityTime: string | null =
      typeof reactivityTimeRaw === 'string'
        ? reactivityTimeRaw
        : typeof reactivityTimeRaw === 'number'
        ? this.secondsToIsoDuration(reactivityTimeRaw)
        : null;

    return {
      taskId: String(id),
      organizationId: String(organizationId),
      caseId: caseId ? String(caseId) : null,

      type: String(get('type') ?? ''),
      category: (get('category') as TaskCategory) ?? 'request',
      subtype: get('subtype') ?? null,

      label: String(get('label') ?? ''),
      title: String(get('title') ?? ''),
      description: String(get('description') ?? ''),

      status,
      priority,
      severity,

      visibility,
      source,

      createdByUserId: get('created_by_user_id', 'createdByUserId') ?? null,
      requesterPersonId:
        get('requester_person_id', 'requesterPersonId') ?? null,
      ownerRoleId: get('owner_role_id', 'ownerRoleId') ?? null,
      ownerUserId: get('owner_user_id', 'ownerUserId') ?? null,
      assigneeRole: get('assignee_role', 'assigneeRole') ?? null,

      dueAt: toIso(get('due_at', 'dueAt')),
      reactivityTime,
      reactivityDeadlineAt: toIso(
        get('reactivity_deadline_at', 'reactivityDeadlineAt'),
      ),
      escalationLevel:
        typeof escalationLevel === 'number' ? escalationLevel : 0,
      closedAt: toIso(get('closed_at', 'closedAt')),

      metadata: typeof meta === 'object' && meta !== null ? meta : {},

      createdAt:
        toIso(get('created_at', 'createdAt')) ?? new Date().toISOString(),
      updatedAt:
        toIso(get('updated_at', 'updatedAt')) ?? new Date().toISOString(),
    };
  }

  private async recordTaskEvent(
    type:
      | 'task_created'
      | 'task_status_changed'
      | 'task_escalated'
      | 'task_ownership_changed'
      | 'task_comment_added',
    taskId: string,
    organizationId: string,
    metadata?: Record<string, any>,
  ): Promise<void> {
    // For now we only log via NestJS Logger.
    // Later this can be wired into TaskEventsService + task_events table.
    this.logger.log(
      JSON.stringify({
        type,
        taskId,
        organizationId,
        metadata: metadata ?? {},
      }),
      'TaskEvent',
    );
  }

  private ok<T>(data: T): ServiceResult<T> {
    return { ok: true, data, error: null };
  }

  private fail<T>(error: ServiceError): ServiceResult<T> {
    return { ok: false, data: null, error };
  }
}
