import { Injectable } from '@nestjs/common';
import { Prisma, Case, Task } from '@prisma/client';
import { PrismaService } from '../../../persistence/prisma/prisma.service';
import { LogService } from '../logging/log.service';

export type CaseStatus = 'open' | 'in_progress' | 'resolved' | 'archived';

export type CaseSeverity = 'MINOR' | 'MODERATE' | 'MAJOR' | 'CRITICAL';

export interface ServiceError {
  code: string;
  message: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  details?: any;
}

export interface ServiceResult<T> {
  ok: boolean;
  data: T | null;
  error: ServiceError | null;
}

export interface CreateCaseFromSignalInput {
  organizationId: string;
  sourceType: string; // email | api | manual | sync (or historical ui/import/insight)
  sourceReference?: string | null;

  label: string; // "<BASE>.<CATEGORY><SUBCATEGORY>.<HORIZONTAL_ROLE>"
  title: string;
  description: string;

  severity: string; // MINOR|MODERATE|MAJOR|CRITICAL or lower-case/json variant

  // Optional context
  originVerticalLevel?: number | null;
  originRole?: string | null;
  tags?: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  location?: Record<string, any> | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any> | null;

  /**
   * Optional SLA for this case, in seconds.
   * If provided, will be stored as an ISO-8601 duration string (e.g. "PT3600S").
   * Profiles / workflows may override or refine this later.
   */
  reactivityTimeSeconds?: number | null;
}

export interface GetCaseWithTasksOptions {
  organizationId: string;
  caseId: string;
  /**
   * If false, only unresolved tasks are returned (PENDING, IN_PROGRESS, ON_HOLD, ESCALATED).
   * Defaults to true = include all tasks.
   */
  includeClosedTasks?: boolean;
}

export interface CaseWithTasks {
  case: Case;
  tasks: Task[];
}

export interface ListCasesParams {
  organizationId: string;
  status?: CaseStatus | CaseStatus[];
  severity?: CaseSeverity | CaseSeverity[];
  /**
   * Filter by label prefix (e.g. "100.94." to get all safety-related cases at base 100).
   */
  labelPrefix?: string;
  /**
   * Free-text search in title/description.
   */
  search?: string;
  /**
   * Pagination (offset/limit).
   */
  offset?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

/**
 * CaseService implements the generic Case management logic:
 * - createCaseFromSignal: create a Case from an incoming signal/pattern
 * - getCaseWithTasks: fetch a Case and its linked Tasks
 * - listCases: list Cases per organization with filters
 * - updateCaseStatus: enforce the Case status lifecycle
 *
 * It follows the Orgo v3 specs (Docs 1, 2, 5, 8) for schema and lifecycle.
 */
@Injectable()
export class CaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logService: LogService,
  ) {}

  /**
   * Creates a Case row from an incoming signal (email/API/offline) or pattern.
   *
   * Responsibilities:
   * - Validate required fields.
   * - Normalize sourceType and severity to canonical tokens.
   * - Set initial status = "open".
   * - Store profile/workflow-driven fields in metadata/reactivityTime where applicable.
   */
  async createCaseFromSignal(
    input: CreateCaseFromSignalInput,
  ): Promise<ServiceResult<Case>> {
    const validationError = this.validateCreateCaseInput(input);
    if (validationError) {
      return {
        ok: false,
        data: null,
        error: validationError,
      };
    }

    let severity: CaseSeverity;
    let sourceType: 'email' | 'api' | 'manual' | 'sync';
    try {
      severity = this.normalizeSeverity(input.severity);
      sourceType = this.normalizeSourceType(input.sourceType);
    } catch (err) {
      return this.failure<Case>(
        'CASE_VALIDATION_ERROR',
        (err as Error).message,
      );
    }

    const reactivityTime =
      input.reactivityTimeSeconds != null
        ? this.secondsToIsoDuration(input.reactivityTimeSeconds)
        : null;

    try {
      const created = await this.prisma.case.create({
        data: {
          organizationId: input.organizationId,
          sourceType,
          sourceReference: input.sourceReference ?? null,
          label: input.label,
          title: input.title,
          description: input.description,
          status: 'open',
          severity,
          reactivityTime,
          originVerticalLevel: input.originVerticalLevel ?? null,
          originRole: input.originRole ?? null,
          tags: input.tags ?? [],
          location: (input.location ?? {}) as Prisma.JsonValue,
          metadata: (input.metadata ?? {}) as Prisma.JsonValue,
        },
      });

      // Best-effort logging; failures here should not break the main flow.
      void this.logService.logEvent({
        category: 'SYSTEM',
        level: 'INFO',
        message: 'Case created from signal',
        identifier: `case_id:${created.id}`,
        metadata: {
          organizationId: created.organizationId,
          sourceType,
          label: created.label,
          severity: created.severity,
          functionId: 'FN_CASE_CREATE',
        },
      });

      return this.success(created);
    } catch (error) {
      void this.logService.logEvent({
        category: 'SYSTEM',
        level: 'ERROR',
        message: 'Failed to create case from signal',
        metadata: {
          organizationId: input.organizationId,
          label: input.label,
          error: this.safeErrorToString(error),
          functionId: 'FN_CASE_CREATE',
        },
      });

      return this.failure<Case>(
        'CASE_CREATE_ERROR',
        'Failed to create case',
        error,
      );
    }
  }

  /**
   * Fetch a Case and its linked Tasks (via tasks.caseId).
   *
   * This is used by generic Case detail UIs and domain-specific views.
   */
  async getCaseWithTasks(
    options: GetCaseWithTasksOptions,
  ): Promise<ServiceResult<CaseWithTasks>> {
    const { organizationId, caseId } = options;

    try {
      const caseRecord = await this.prisma.case.findFirst({
        where: {
          id: caseId,
          organizationId,
        },
      });

      if (!caseRecord) {
        return this.failure<CaseWithTasks>(
          'CASE_NOT_FOUND',
          'Case not found for this organization',
          { organizationId, caseId },
        );
      }

      const tasksWhere: Prisma.TaskWhereInput = {
        organizationId,
        caseId: caseRecord.id,
      };

      if (options.includeClosedTasks === false) {
        tasksWhere.status = {
          in: ['PENDING', 'IN_PROGRESS', 'ON_HOLD', 'ESCALATED'],
        };
      }

      const tasks = await this.prisma.task.findMany({
        where: tasksWhere,
        orderBy: { createdAt: 'asc' },
      });

      return this.success<CaseWithTasks>({
        case: caseRecord,
        tasks,
      });
    } catch (error) {
      void this.logService.logEvent({
        category: 'SYSTEM',
        level: 'ERROR',
        message: 'Failed to fetch case with tasks',
        metadata: {
          organizationId,
          caseId,
          error: this.safeErrorToString(error),
          functionId: 'FN_CASE_GET_WITH_TASKS',
        },
      });

      return this.failure<CaseWithTasks>(
        'CASE_FETCH_ERROR',
        'Failed to fetch case with tasks',
        error,
      );
    }
  }

  /**
   * List Cases for an organization with basic filters and pagination.
   */
  async listCases(
    params: ListCasesParams,
  ): Promise<ServiceResult<PaginatedResult<Case>>> {
    const {
      organizationId,
      status,
      severity,
      labelPrefix,
      search,
      offset = 0,
      limit = 50,
    } = params;

    const where: Prisma.CaseWhereInput = {
      organizationId,
    };

    if (status) {
      if (Array.isArray(status)) {
        where.status = { in: status };
      } else {
        where.status = status;
      }
    }

    if (severity) {
      if (Array.isArray(severity)) {
        where.severity = { in: severity };
      } else {
        where.severity = severity;
      }
    }

    if (labelPrefix) {
      where.label = { startsWith: labelPrefix };
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    try {
      const [items, total] = await this.prisma.$transaction([
        this.prisma.case.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: offset,
          take: limit,
        }),
        this.prisma.case.count({ where }),
      ]);

      return this.success<PaginatedResult<Case>>({
        items,
        total,
        offset,
        limit,
      });
    } catch (error) {
      void this.logService.logEvent({
        category: 'SYSTEM',
        level: 'ERROR',
        message: 'Failed to list cases',
        metadata: {
          organizationId,
          error: this.safeErrorToString(error),
          functionId: 'FN_CASE_LIST',
        },
      });

      return this.failure<PaginatedResult<Case>>(
        'CASE_LIST_ERROR',
        'Failed to list cases',
        error,
      );
    }
  }

  /**
   * Update Case status, enforcing the canonical Case lifecycle:
   *
   * Allowed transitions:
   * - open        -> in_progress, resolved, archived
   * - in_progress -> resolved, archived
   * - resolved    -> archived, in_progress (re-open)
   * - archived    -> (terminal)
   */
  async updateCaseStatus(
    organizationId: string,
    caseId: string,
    newStatus: CaseStatus,
  ): Promise<ServiceResult<Case>> {
    try {
      const caseRecord = await this.prisma.case.findFirst({
        where: {
          id: caseId,
          organizationId,
        },
      });

      if (!caseRecord) {
        return this.failure<Case>(
          'CASE_NOT_FOUND',
          'Case not found for this organization',
          { organizationId, caseId },
        );
      }

      const currentStatus = caseRecord.status as CaseStatus;

      if (!this.isValidStatusTransition(currentStatus, newStatus)) {
        return this.failure<Case>(
          'INVALID_CASE_STATE_TRANSITION',
          `Transition ${currentStatus} → ${newStatus} is not allowed`,
          { organizationId, caseId },
        );
      }

      const updated = await this.prisma.case.update({
        where: { id: caseRecord.id },
        data: {
          status: newStatus,
        },
      });

      void this.logService.logEvent({
        category: 'SYSTEM',
        level: 'INFO',
        message: 'Case status updated',
        identifier: `case_id:${updated.id}`,
        metadata: {
          organizationId: updated.organizationId,
          oldStatus: currentStatus,
          newStatus,
          functionId: 'FN_CASE_UPDATE_STATUS',
        },
      });

      return this.success(updated);
    } catch (error) {
      void this.logService.logEvent({
        category: 'SYSTEM',
        level: 'ERROR',
        message: 'Failed to update case status',
        metadata: {
          organizationId,
          caseId,
          newStatus,
          error: this.safeErrorToString(error),
          functionId: 'FN_CASE_UPDATE_STATUS',
        },
      });

      return this.failure<Case>(
        'CASE_UPDATE_STATUS_ERROR',
        'Failed to update case status',
        error,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private validateCreateCaseInput(
    input: CreateCaseFromSignalInput,
  ): ServiceError | null {
    const missing: string[] = [];

    if (!input.organizationId) missing.push('organizationId');
    if (!input.sourceType) missing.push('sourceType');
    if (!input.label) missing.push('label');
    if (!input.title) missing.push('title');
    if (!input.description) missing.push('description');
    if (!input.severity) missing.push('severity');

    if (missing.length > 0) {
      return {
        code: 'CASE_VALIDATION_ERROR',
        message: `Missing required fields: ${missing.join(', ')}`,
        details: { missingFields: missing },
      };
    }

    return null;
  }

  private normalizeSeverity(severity: string): CaseSeverity {
    const value = severity.trim();

    if (!value) {
      throw new Error('Severity must not be empty');
    }

    const lower = value.toLowerCase();

    // Historical mapping: "info" -> MINOR (Doc 1/2).
    if (lower === 'info') {
      return 'MINOR';
    }

    const upper = lower.toUpperCase() as CaseSeverity;

    if (upper === 'MINOR' || upper === 'MODERATE' || upper === 'MAJOR' || upper === 'CRITICAL') {
      return upper;
    }

    throw new Error(`Invalid case severity: ${severity}`);
  }

  private normalizeSourceType(
    sourceType: string,
  ): 'email' | 'api' | 'manual' | 'sync' {
    const value = sourceType.trim();

    if (!value) {
      throw new Error('sourceType must not be empty');
    }

    const lower = value.toLowerCase();

    // Historical mappings (Doc 1 §Enum implementation notes).
    if (lower === 'ui') return 'manual';
    if (lower === 'import') return 'sync';
    if (lower === 'insight') return 'api';

    if (lower === 'email' || lower === 'api' || lower === 'manual' || lower === 'sync') {
      return lower;
    }

    throw new Error(`Invalid case sourceType: ${sourceType}`);
  }

  /**
   * Convert seconds to an ISO-8601 duration string (e.g. 3600 -> "PT3600S").
   * DB stores reactivityTime as an interval; the exact mapping is handled at schema level.
   */
  private secondsToIsoDuration(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
    return `PT${s}S`;
  }

  private isValidStatusTransition(
    from: CaseStatus,
    to: CaseStatus,
  ): boolean {
    if (from === to) {
      // No-op transitions are allowed but usually pointless; treat as valid.
      return true;
    }

    switch (from) {
      case 'open':
        return to === 'in_progress' || to === 'resolved' || to === 'archived';
      case 'in_progress':
        return to === 'resolved' || to === 'archived';
      case 'resolved':
        return to === 'archived' || to === 'in_progress';
      case 'archived':
        // archived is terminal in normal flows
        return false;
      default:
        return false;
    }
  }

  private success<T>(data: T): ServiceResult<T> {
    return {
      ok: true,
      data,
      error: null,
    };
  }

  private failure<T>(
    code: string,
    message: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    details?: any,
  ): ServiceResult<T> {
    return {
      ok: false,
      data: null,
      error: { code, message, details },
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private safeErrorToString(error: any): string {
    if (!error) return 'Unknown error';
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    try {
      return JSON.stringify(error);
    } catch {
      return 'Unserializable error';
    }
  }
}
