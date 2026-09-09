// apps/api/src/orgo/core/tasks/task.controller.ts

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';

import { TaskService } from './task.service';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';

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

/**
 * JSON-level variants for canonical enums (upper + lower-case tokens).
 */
export type TaskStatusJson = TaskStatus | Lowercase<TaskStatus>;
export type TaskPriorityJson = TaskPriority | Lowercase<TaskPriority>;
export type TaskSeverityJson = TaskSeverity | Lowercase<TaskSeverity>;
export type TaskVisibilityJson = TaskVisibility | Lowercase<TaskVisibility>;

/**
 * Standard result envelope for Core Services (locked for v3).
 */
export interface OrgoError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface OrgoResult<T> {
  ok: boolean;
  data: T | null;
  error: OrgoError | null;
}

/**
 * Canonical Task JSON DTO (API boundary).
 * Mirrors Doc 2.10 + Doc 8.4.2.
 */
export interface TaskDto {
  task_id: string;
  organization_id: string;
  case_id: string | null;

  // Classification / routing
  source: TaskSource;
  type: string;
  category: TaskCategory;
  subtype: string | null;
  label: string;

  // Human-facing
  title: string;
  description: string;

  // Lifecycle / enums
  status: TaskStatusJson;
  priority: TaskPriorityJson;
  severity: TaskSeverityJson;
  visibility: TaskVisibilityJson;

  // Ownership / actors
  assignee_role: string | null;
  created_by_user_id: string | null;
  requester_person_id: string | null;
  owner_role_id: string | null;
  owner_user_id: string | null;

  // SLA / timing
  due_at: string | null;
  reactivity_time: string | null;
  reactivity_deadline_at: string | null;
  escalation_level: number;
  closed_at: string | null;

  // Arbitrary domain metadata
  metadata: Record<string, unknown>;

  // Audit
  created_at: string;
  updated_at: string;
}

/**
 * Query parameters for GET /api/v3/tasks.
 * Filters match the functional inventory (status, label, domain/type, assignee, severity, visibility).
 * Pagination fields are intentionally minimal and can be extended later.
 */
export class ListTasksQueryDto {
  /**
   * Tenant isolation key (organization_id).
   * In most real calls this should be required, but left optional at DTO level
   * to allow auth middleware / guards to inject it.
   */
  organization_id?: string;

  /**
   * Filter by canonical status (PENDING, IN_PROGRESS, etc.) or lower-case JSON form.
   */
  status?: TaskStatusJson;

  /**
   * Filter by canonical label code (e.g. "100.11.Ops.Maintenance").
   */
  label?: string;

  /**
   * Domain-level type (e.g. "maintenance", "hr_case", "education_support").
   */
  type?: string;

  /**
   * Denormalised routing role label, aligned with label system (e.g. "Ops.Maintenance").
   */
  assignee_role?: string;

  /**
   * Severity filter using JSON-level tokens (minor/moderate/major/critical).
   */
  severity?: TaskSeverityJson;

  /**
   * Visibility filter using JSON-level tokens (public/internal/restricted/anonymised).
   */
  visibility?: TaskVisibilityJson;

  /**
   * Priority filter using JSON-level tokens (low/medium/high/critical).
   */
  priority?: TaskPriorityJson;

  /**
   * Page number for pagination (1-based).
   */
  page?: number;

  /**
   * Page size for pagination.
   */
  page_size?: number;
}

/**
 * Request body for POST /api/v3/tasks (Create Task via API).
 * Required fields match Core Services spec for create_task.
 */
export class CreateTaskRequestDto {
  // Required core fields
  organization_id!: string;
  type!: string;
  category!: TaskCategory;
  title!: string;
  description!: string;
  priority!: TaskPriorityJson;
  severity!: TaskSeverityJson;
  visibility!: TaskVisibilityJson;
  label!: string;
  source!: TaskSource;
  metadata!: Record<string, unknown>;

  // Optional fields
  case_id?: string | null;
  subtype?: string | null;
  created_by_user_id?: string | null;
  requester_person_id?: string | null;
  owner_role_id?: string | null;
  owner_user_id?: string | null;
  assignee_role?: string | null;
  due_at?: string | null;
}

/**
 * TaskController – Public API interface for Tasks.
 *
 * Routes (locked by functional inventory):
 *  - GET    /api/v3/tasks           → listTasks
 *  - GET    /api/v3/tasks/:id       → getTask
 *  - POST   /api/v3/tasks           → createTask
 *  - PATCH  /api/v3/tasks/:id/status → updateTaskStatus
 */
@ApiTags('tasks')
@Controller('api/v3/tasks')
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  @Get()
  @ApiOperation({
    summary: 'Get Tasks (list)',
    description:
      'Returns a list of Tasks filtered by status, label, domain/type, assignee, severity, and visibility.',
  })
  @ApiOkResponse({
    description: 'List of Tasks wrapped in the standard ok/data/error envelope.',
    type: Object,
  })
  async listTasks(
    @Query() query: ListTasksQueryDto,
  ): Promise<OrgoResult<TaskDto[]>> {
    // Existing behaviour: delegate directly to TaskService.
    // Service is responsible for mapping query → internal filters and JSON DTOs.
    return this.taskService.listTasks(query as any);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get single Task',
    description:
      'Returns a single Task by its task_id, using the canonical Task JSON schema.',
  })
  @ApiOkResponse({
    description: 'Single Task wrapped in the standard ok/data/error envelope.',
    type: Object,
  })
  async getTask(@Param('id') taskId: string): Promise<OrgoResult<TaskDto>> {
    return this.taskService.getTask(taskId as any);
  }

  @Post()
  @ApiOperation({
    summary: 'Create Task via API',
    description:
      'Creates a new Task using the canonical Task model and enums. Status, SLA fields and escalation_level are derived by Core Services.',
  })
  @ApiCreatedResponse({
    description: 'Created Task wrapped in the standard ok/data/error envelope.',
    type: Object,
  })
  async createTask(
    @Body() body: CreateTaskRequestDto,
  ): Promise<OrgoResult<TaskDto>> {
    return this.taskService.createTask(body as any);
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Update Task status',
    description:
      'Updates the status of a Task using the canonical TASK_STATUS enum and enforces lifecycle rules and tenant isolation.',
  })
  @ApiOkResponse({
    description: 'Updated Task wrapped in the standard ok/data/error envelope.',
    type: Object,
  })
  async updateTaskStatus(
    @Param('id') taskId: string,
    @Body() body: UpdateTaskStatusDto,
    @Req() req: Request,
  ): Promise<OrgoResult<TaskDto>> {
    const organizationId = this.getOrganizationIdFromRequest(req);

    // Derive actorUserId from auth context when available.
    const userFromReq = (req as any).user as { userId?: string } | undefined;
    const actorUserId =
      (req as any).userId ??
      (userFromReq && typeof userFromReq.userId === 'string'
        ? userFromReq.userId
        : undefined);

    return this.taskService.updateTaskStatus({
      organizationId,
      taskId,
      newStatus: body.status,
      reason: body.reason,
      actorUserId,
    } as any);
  }

  /**
   * Resolve the current organization identifier from the request.
   *
   * Priority:
   *  - request.user.organizationId (AuthGuard / JWT context)
   *  - request.organizationId (legacy context)
   *  - X-Org-Id / X-Organization-Id headers
   */
  private getOrganizationIdFromRequest(req: Request): string {
    const user = (req as any).user as { organizationId?: string } | undefined;
    const orgFromUser = user?.organizationId;

    const orgFromReq = (req as any).organizationId as string | undefined;

    const headerRaw =
      (req.headers['x-org-id'] as string | undefined) ||
      (req.headers['x-organization-id'] as string | undefined);
    const orgFromHeader = headerRaw?.trim() || undefined;

    const organizationId = orgFromUser ?? orgFromReq ?? orgFromHeader;

    if (!organizationId) {
      throw new BadRequestException(
        'Missing organization identifier (expected auth context or X-Org-Id / X-Organization-Id header).',
      );
    }

    return organizationId;
  }
}
