import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../persistence/prisma/prisma.service';

/**
 * Canonical enums (logical view)
 * These mirror the enums described in the Orgo v3 spec (Docs 2, 5, 8).
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
 * Input types accepted by the TaskService.
 * These are internal TS types, designed to map cleanly to the canonical
 * Task JSON contract and the underlying Prisma models.
 */

type StatusInput = TaskStatus | Lowercase<TaskStatus>;
type PriorityInput = TaskPriority | Lowercase<TaskPriority>;
type SeverityInput = TaskSeverity | Lowercase<TaskSeverity>;
type VisibilityInput = TaskVisibility | Lowercase<TaskVisibility>;
type SourceInput = TaskSource | Lowercase<TaskSource>;

export interface CreateTaskInput {
  organizationId: string;
  type: string;
  category: TaskCategory;
  title: string;
  description: string;
  priority: PriorityInput;
  severity: SeverityInput;
  visibility: VisibilityInput;
  label: string;
  source: SourceInput;

  caseId?: string | null;
  subtype?: string | null;
  dueAt?: string | Date | null;
  createdByUserId?: string | null;
  requesterPersonId?: string | null;
  ownerRoleId?: string | null;
  ownerUserId?: string | null;
  assigneeRole?: string | null;
  metadata?: Record<string, any> | null;

  /**
   * Reactivity configuration.
   * In a later iteration this should be derived from OrgProfileService +
   * workflow rules. For now we support direct overrides plus a default.
   */
  reactivitySeconds?: number | null;
  reactivityTimeIso?: string | null;
  reactivityDeadlineAt?: string | Date | null;
}

export interface UpdateTaskStatusInput {
  organizationId: string;
  taskId: string;
  newStatus: StatusInput;
  reason?: string;
  actorUserId?: string | null;
}

export interface EscalateTaskInput {
  organizationId: string;
  taskId: string;
  reason: string;
  actorUserId?: string | null;
}

export interface AssignTaskInput {
  organizationId: string;
  taskId: string;
  assigneeRole?: string | null;
  assigneeUserId?: string | null;
  actorUserId?: string | null;
}

export interface AddTaskCommentInput {
  organizationId: string;
  taskId: string;
  comment: string;
  authorUserId: string;
  visibility?: TaskCommentVisibility;
}

/**
 * DTOs returned by the service.
 * These are camelCase for internal TS usage; controllers can remap to
 * snake_case / canonical JSON property names as needed.
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
  reactivityDeadlineAt: string | null;
  escalationLevel: number;
  closedAt: string | null;

  metadata: Record<string, any>;

  createdAt: string;
  updatedAt: string;
}

export interface TaskCommentDto {
  id: string;
  taskId: string;
  organizationId: string;
  authorUserId: string;
  visibility: TaskCommentVisibility;
  comment: string;
  createdAt: string;
}

/**
 * Standard result shape for all Core Services:
 *
 *   { ok: true, data, error: null }
 *   { ok: false, data: null, error: { code, message, details? } }
 */

export interface ServiceError {
  code: string;
  message: string;
  details?: Record<string, any>;
}

export interface ServiceResult<T> {
  ok: boolean;
  data: T | null;
  error: ServiceError | null;
}

/**
 * Internal helpers and constants.
 */

const TASK_STATE_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  PENDING: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['ON_HOLD', 'COMPLETED', 'FAILED', 'ESCALATED'],
  ON_HOLD: ['IN_PROGRESS', 'CANCELLED'],
  ESCALATED: ['IN_PROGRESS', 'COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

const ALLOWED_CATEGORIES: ReadonlySet<TaskCategory> = new Set([
  'request',
  'incident',
  'update',
  'report',
  'distribution',
]);

const DEFAULT_REACTIVITY_SECONDS = 43_200; // 12h, aligned with default profile


type TaskEventType =
  | 'task_created'
  | 'task_status_changed'
  | 'task_escalated'
  | 'task_assigned'
  | 'task_comment_added';

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create Task from event / workflow / API input.
   */
  async createTask(input: CreateTaskInput): Promise<ServiceResult<TaskDto>> {
    const validationError = this.validateCreateTaskInput(input);
    if (validationError) {
      return this.fail<TaskDto>(validationError);
    }

    try {
      const now = new Date();
      const reactivityDeadline = this.computeReactivityDeadline(now, input);
      const status: TaskStatus = 'PENDING';

      const data: any = {
        // identity / linkage
        organization_id: input.organizationId,
        case_id: input.caseId ?? null,

        // classification
        type: input.type,
        category: input.category,
        subtype: input.subtype ?? null,
        label: input.label,

        // content
        title: input.title,
        description: input.description,

        // enums
        status,
        priority: this.normalizePriority(input.priority),
        severity: this.normalizeSeverity(input.severity),
        visibility: this.normalizeVisibility(input.visibility),
        source: this.normalizeSource(input.source),

        // actors
        created_by_user_id: input.createdByUserId ?? null,
        requester_person_id: input.requesterPersonId ?? null,
        owner_role_id: input.ownerRoleId ?? null,
        owner_user_id: input.ownerUserId ?? null,
        assignee_role: input.assigneeRole ?? null,

        // timing
        due_at: input.dueAt ? new Date(input.dueAt) : null,
        reactivity_deadline_at: reactivityDeadline,
        escalation_level: 0,
        closed_at: null,

        // metadata
        metadata: input.metadata ?? {},

        // audit columns (these may be handled by DB defaults; we set them defensively)
        created_at: now,
        updated_at: now,
      };

      // Note: we cast prisma to any here to decouple from the current Prisma schema.
      // Once the `Task` model is added to schema.prisma, this can be made fully typed.
      const created = await (this.prisma as any).task.create({ data });
      const dto = this.mapTaskModelToDto(created);

      await this.recordTaskEvent('task_created', dto.taskId, dto.organizationId, {
        status: dto.status,
        priority: dto.priority,
        severity: dto.severity,
      });

      return this.ok(dto);
    } catch (err: any) {
      this.logger.error('Failed to create task', err?.stack || err?.message);
      return this.fail<TaskDto>({
        code: 'TASK_CREATION_FAILED',
        message: 'Failed to create task',
        details: { cause: err?.message },
      });
    }
  }

  /**
   * Update Task status (enforces canonical state machine).
   */
  async updateTaskStatus(
    input: UpdateTaskStatusInput,
  ): Promise<ServiceResult<TaskDto>> {
    const normalizedStatus = this.normalizeStatus(input.newStatus);
    if (!normalizedStatus) {
      return this.fail<TaskDto>({
        code: 'TASK_VALIDATION_ERROR',
        message: `Invalid status value: ${input.newStatus}`,
        details: { field: 'newStatus' },
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
          message: 'Task not found',
          details: {
            taskId: input.taskId,
            organizationId: input.organizationId,
          },
        });
      }

      const currentStatus = this.normalizeStatus(taskModel.status);
      if (!currentStatus) {
        return this.fail<TaskDto>({
          code: 'TASK_STATE_CORRUPTED',
          message: 'Task has invalid current status',
          details: { taskId: input.taskId, status: taskModel.status },
        });
      }

      if (!this.isTransitionAllowed(currentStatus, normalizedStatus)) {
        return this.fail<TaskDto>({
          code: 'INVALID_TASK_STATE_TRANSITION',
          message: `Transition ${currentStatus} → ${normalizedStatus} is not allowed`,
          details: {
            from: currentStatus,
            to: normalizedStatus,
            taskId: input.taskId,
          },
        });
      }

      const now = new Date();

      const updateData: any = {
        status: normalizedStatus,
        updated_at: now,
      };

      if (TERMINAL_STATUSES.has(normalizedStatus)) {
        updateData.closed_at = now;
      } else if (TERMINAL_STATUSES.has(currentStatus)) {
        // Moving from terminal to non‑terminal should not normally happen,
        // but if it does, closed_at must be cleared.
        updateData.closed_at = null;
      }

      const updated = await (this.prisma as any).task.update({
        where: { id: taskModel.id },
        data: updateData,
      });

      const dto = this.mapTaskModelToDto(updated);

      await this.recordTaskEvent(
        'task_status_changed',
        dto.taskId,
        dto.organizationId,
        {
          from: currentStatus,
          to: normalizedStatus,
          reason: input.reason,
          actorUserId: input.actorUserId,
        },
      );

      return this.ok(dto);
    } catch (err: any) {
      this.logger.error('Failed to update task status', err?.stack || err?.message);
      return this.fail<TaskDto>({
        code: 'TASK_STATUS_UPDATE_FAILED',
        message: 'Failed to update task status',
        details: { cause: err?.message },
      });
    }
  }

  /**
   * Escalate a Task: increments escalation_level and sets status = ESCALATED.
   * This enforces that the current status allows an ESCALATED transition.
   */
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
          message: 'Task not found',
          details: {
            taskId: input.taskId,
            organizationId: input.organizationId,
          },
        });
      }

      const currentStatus = this.normalizeStatus(taskModel.status);
      if (!currentStatus) {
        return this.fail<TaskDto>({
          code: 'TASK_STATE_CORRUPTED',
          message: 'Task has invalid current status',
          details: { taskId: input.taskId, status: taskModel.status },
        });
      }

      if (!this.isTransitionAllowed(currentStatus, 'ESCALATED')) {
        return this.fail<TaskDto>({
          code: 'TASK_ESCALATION_INVALID_STATE',
          message: `Cannot escalate task from state ${currentStatus}`,
          details: { taskId: input.taskId },
        });
      }

      const now = new Date();
      const currentLevel =
        typeof taskModel.escalation_level === 'number'
          ? taskModel.escalation_level
          : 0;

      const updated = await (this.prisma as any).task.update({
        where: { id: taskModel.id },
        data: {
          status: 'ESCALATED',
          escalation_level: currentLevel + 1,
          updated_at: now,
        },
      });

      const dto = this.mapTaskModelToDto(updated);

      await this.recordTaskEvent('task_escalated', dto.taskId, dto.organizationId, {
        from: currentStatus,
        to: 'ESCALATED',
        previousEscalationLevel: currentLevel,
        newEscalationLevel: currentLevel + 1,
        reason: input.reason,
        actorUserId: input.actorUserId,
      });

      return this.ok(dto);
    } catch (err: any) {
      this.logger.error('Failed to escalate task', err?.stack || err?.message);
      return this.fail<TaskDto>({
        code: 'TASK_ESCALATION_FAILED',
        message: 'Failed to escalate task',
        details: { cause: err?.message },
      });
    }
  }

  /**
   * Assign / reassign a Task to a role and/or user.
   */
  async assignTask(
    input: AssignTaskInput,
  ): Promise<ServiceResult<TaskDto>> {
    if (!input.assigneeRole && !input.assigneeUserId) {
      return this.fail<TaskDto>({
        code: 'TASK_VALIDATION_ERROR',
        message: 'Either assigneeRole or assigneeUserId must be provided',
        details: { field: 'assigneeRole/assigneeUserId' },
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
          message: 'Task not found',
          details: {
            taskId: input.taskId,
            organizationId: input.organizationId,
          },
        });
      }

      const now = new Date();

      const data: any = {
        updated_at: now,
      };

      if (input.assigneeRole !== undefined) {
        data.assignee_role = input.assigneeRole;
      }

      // For now we only update routing-level fields in tasks;
      // per spec, full assignment history would be stored in a separate table.
      if (input.assigneeUserId !== undefined) {
        data.owner_user_id = input.assigneeUserId;
      }

      const updated = await (this.prisma as any).task.update({
        where: { id: taskModel.id },
        data,
      });

      const dto = this.mapTaskModelToDto(updated);

      await this.recordTaskEvent('task_assigned', dto.taskId, dto.organizationId, {
        assigneeRole: dto.assigneeRole,
        assigneeUserId: input.assigneeUserId,
        actorUserId: input.actorUserId,
      });

      return this.ok(dto);
    } catch (err: any) {
      this.logger.error('Failed to assign task', err?.stack || err?.message);
      return this.fail<TaskDto>({
        code: 'TASK_ASSIGNMENT_FAILED',
        message: 'Failed to assign task',
        details: { cause: err?.message },
      });
    }
  }

  /**
   * Add a comment to a Task.
   */
  async addComment(
    input: AddTaskCommentInput,
  ): Promise<ServiceResult<TaskCommentDto>> {
    if (!input.comment || !input.comment.trim()) {
      return this.fail<TaskCommentDto>({
        code: 'TASK_VALIDATION_ERROR',
        message: 'Comment must not be empty',
        details: { field: 'comment' },
      });
    }

    const visibility: TaskCommentVisibility =
      input.visibility ?? 'internal_only';

    try {
      const taskModel = await this.getTaskModelForOrg(
        input.organizationId,
        input.taskId,
      );

      if (!taskModel) {
        return this.fail<TaskCommentDto>({
          code: 'TASK_NOT_FOUND',
          message: 'Task not found',
          details: {
            taskId: input.taskId,
            organizationId: input.organizationId,
          },
        });
      }

      const now = new Date();

      const commentModel = await (this.prisma as any).taskComment.create({
        data: {
          organization_id: input.organizationId,
          task_id: taskModel.id,
          author_user_id: input.authorUserId,
          visibility,
          comment: input.comment,
          created_at: now,
        },
      });

      const dto: TaskCommentDto = {
        id: String(commentModel.id),
        taskId: String(commentModel.task_id ?? taskModel.id),
        organizationId: String(
          commentModel.organization_id ?? input.organizationId,
        ),
        authorUserId: String(commentModel.author_user_id),
        visibility: commentModel.visibility as TaskCommentVisibility,
        comment: String(commentModel.comment),
        createdAt: (commentModel.created_at ?? now).toISOString(),
      };

      await this.recordTaskEvent(
        'task_comment_added',
        dto.taskId,
        dto.organizationId,
        {
          authorUserId: dto.authorUserId,
          visibility: dto.visibility,
        },
      );

      return this.ok(dto);
    } catch (err: any) {
      this.logger.error('Failed to add task comment', err?.stack || err?.message);
      return this.fail<TaskCommentDto>({
        code: 'TASK_COMMENT_FAILED',
        message: 'Failed to add comment to task',
        details: { cause: err?.message },
      });
    }
  }

  /**
   * Fetch Task details by id for a given organization.
   */
  async getTaskById(
    organizationId: string,
    taskId: string,
  ): Promise<ServiceResult<TaskDto>> {
    try {
      const taskModel = await this.getTaskModelForOrg(organizationId, taskId);

      if (!taskModel) {
        return this.fail<TaskDto>({
          code: 'TASK_NOT_FOUND',
          message: 'Task not found',
          details: { organizationId, taskId },
        });
      }

      const dto = this.mapTaskModelToDto(taskModel);
      return this.ok(dto);
    } catch (err: any) {
      this.logger.error('Failed to fetch task by id', err?.stack || err?.message);
      return this.fail<TaskDto>({
        code: 'TASK_FETCH_FAILED',
        message: 'Failed to fetch task',
        details: { cause: err?.message },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private validateCreateTaskInput(
    input: CreateTaskInput,
  ): ServiceError | null {
    const requiredStringFields: Array<keyof CreateTaskInput> = [
      'organizationId',
      'type',
      'category',
      'title',
      'description',
      'priority',
      'severity',
      'visibility',
      'label',
      'source',
    ];

    for (const field of requiredStringFields) {
      const value = input[field] as any;
      if (
        value === undefined ||
        value === null ||
        (typeof value === 'string' && !value.trim())
      ) {
        return {
          code: 'TASK_VALIDATION_ERROR',
          message: `Missing required field '${String(field)}'`,
          details: { field },
        };
      }
    }

    if (!ALLOWED_CATEGORIES.has(input.category)) {
      return {
        code: 'TASK_VALIDATION_ERROR',
        message: `Invalid task category: ${input.category}`,
        details: {
          field: 'category',
          allowed: Array.from(ALLOWED_CATEGORIES),
        },
      };
    }

    // Basic sanity check for label: must contain at least one dot.
    if (!input.label.includes('.')) {
      return {
        code: 'TASK_VALIDATION_ERROR',
        message: 'Label must contain at least one dot ("<BASE>.<CATEGORY><SUBCATEGORY>...")',
        details: { field: 'label' },
      };
    }

    // Validate enum-like fields via the normalizers
    if (!this.normalizePriority(input.priority)) {
      return {
        code: 'TASK_VALIDATION_ERROR',
        message: `Invalid priority: ${input.priority}`,
        details: { field: 'priority' },
      };
    }

    if (!this.normalizeSeverity(input.severity)) {
      return {
        code: 'TASK_VALIDATION_ERROR',
        message: `Invalid severity: ${input.severity}`,
        details: { field: 'severity' },
      };
    }

    if (!this.normalizeVisibility(input.visibility)) {
      return {
        code: 'TASK_VALIDATION_ERROR',
        message: `Invalid visibility: ${input.visibility}`,
        details: { field: 'visibility' },
      };
    }

    if (!this.normalizeSource(input.source)) {
      return {
        code: 'TASK_VALIDATION_ERROR',
        message: `Invalid source: ${input.source}`,
        details: { field: 'source' },
      };
    }

    return null;
  }

  private computeReactivityDeadline(
    createdAt: Date,
    input: CreateTaskInput,
  ): Date | null {
    // Absolute override wins
    if (input.reactivityDeadlineAt) {
      return new Date(input.reactivityDeadlineAt);
    }

    let seconds: number | null = null;

    if (typeof input.reactivitySeconds === 'number') {
      seconds = input.reactivitySeconds;
    } else if (input.reactivityTimeIso) {
      seconds = this.parseIsoDurationToSeconds(input.reactivityTimeIso);
    }

    if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) {
      // Fallback to profile-like default (aligned with "default" profile).
      seconds = DEFAULT_REACTIVITY_SECONDS;
    }

    return new Date(createdAt.getTime() + seconds * 1000);
  }

  private parseIsoDurationToSeconds(value: string): number | null {
    // Very small subset of ISO‑8601 duration: P[nD]T[nH][nM][nS]
    const trimmed = value.trim().toUpperCase();
    const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
      trimmed,
    );
    if (!match) {
      return null;
    }

    const days = match[1] ? parseInt(match[1], 10) : 0;
    const hours = match[2] ? parseInt(match[2], 10) : 0;
    const minutes = match[3] ? parseInt(match[3], 10) : 0;
    const seconds = match[4] ? parseInt(match[4], 10) : 0;

    return (
      days * 24 * 3600 +
      hours * 3600 +
      minutes * 60 +
      seconds
    );
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
    const upper = input.toUpperCase() as TaskPriority;
    if (['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(upper)) {
      return upper;
    }
    return null;
  }

  private normalizeSeverity(input: SeverityInput): TaskSeverity | null {
    if (!input) return null;
    const upper = input.toUpperCase() as TaskSeverity;
    if (['MINOR', 'MODERATE', 'MAJOR', 'CRITICAL'].includes(upper)) {
      return upper;
    }
    return null;
  }

  private normalizeVisibility(input: VisibilityInput): TaskVisibility | null {
    if (!input) return null;
    const upper = input.toUpperCase() as TaskVisibility;
    if (['PUBLIC', 'INTERNAL', 'RESTRICTED', 'ANONYMISED'].includes(upper)) {
      return upper;
    }
    return null;
  }

  private normalizeSource(input: SourceInput): TaskSource | null {
    if (!input) return null;
    const lower = input.toLowerCase() as TaskSource;
    if (['email', 'api', 'manual', 'sync'].includes(lower)) {
      return lower;
    }
    return null;
  }

  private isTransitionAllowed(
    from: TaskStatus,
    to: TaskStatus,
  ): boolean {
    const allowed = TASK_STATE_TRANSITIONS[from] ?? [];
    return allowed.includes(to);
  }

  private async getTaskModelForOrg(
    organizationId: string,
    taskId: string,
  ): Promise<any | null> {
    const model = await (this.prisma as any).task.findUnique({
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
      (this.normalizePriority(get('priority')) ?? 'MEDIUM');
    const severity =
      (this.normalizeSeverity(get('severity')) ?? 'MINOR');
    const visibility =
      (this.normalizeVisibility(get('visibility')) ?? 'INTERNAL');
    const source = this.normalizeSource(get('source')) ?? 'manual';

    const escalationLevel = get('escalation_level', 'escalationLevel');
    const meta = get('metadata') ?? {};

    const toIso = (value: any | null | undefined): string | null => {
      if (!value) return null;
      if (value instanceof Date) return value.toISOString();
      const asDate = new Date(value);
      return Number.isNaN(asDate.getTime()) ? null : asDate.toISOString();
    };

    return {
      taskId: String(id),
      organizationId: String(organizationId),
      caseId: caseId ? String(caseId) : null,

      type: String(get('type') ?? ''),
      category: get('category') as TaskCategory,
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
      reactivityDeadlineAt: toIso(
        get('reactivity_deadline_at', 'reactivityDeadlineAt'),
      ),
      escalationLevel:
        typeof escalationLevel === 'number' ? escalationLevel : 0,
      closedAt: toIso(get('closed_at', 'closedAt')),

      metadata: typeof meta === 'object' && meta !== null ? meta : {},

      createdAt: toIso(get('created_at', 'createdAt')) ?? new Date().toISOString(),
      updatedAt: toIso(get('updated_at', 'updatedAt')) ?? new Date().toISOString(),
    };
  }

  private async recordTaskEvent(
    type: TaskEventType,
    taskId: string,
    organizationId: string,
    metadata?: Record<string, any>,
  ): Promise<void> {
    // For now we only log via NestJS Logger.
    // Later this can be wired into a dedicated LogService + task_events table.
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
