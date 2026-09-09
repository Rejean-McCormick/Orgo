// apps/api/src/orgo/security/logging/log-query.service.ts

import { Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  PrismaClient,
  TaskEvent as TaskEventModel,
} from '@prisma/client';
import { DatabaseService } from '../../core/database/database.service';
import { FN_LOG_QUERY_ENTITY_ACTIVITY } from '../../core/functional-ids';

export interface StandardResultError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface StandardResult<T> {
  ok: boolean;
  data: T | null;
  error: StandardResultError | null;
}

export type ActivityLogSource = 'activity_log' | 'task_event';

export interface EntityActivityLogItem {
  /**
   * Stable identifier of the underlying log/event row.
   */
  id: string;

  /**
   * Logical source of the event.
   * - "activity_log" → activity_logs table
   * - "task_event"   → task_events table
   */
  source: ActivityLogSource;

  /**
   * Tenant / organization scope.
   */
  organizationId: string;

  /**
   * High-level entity type this item is about (e.g. "task", "case", "person").
   */
  entityType: string;

  /**
   * ID of the entity this event relates to.
   */
  entityId: string;

  /**
   * Event timestamp in ISO 8601 format.
   */
  timestamp: string;

  /**
   * Actor classification. Derived from the underlying row when available.
   */
  actorType: 'user' | 'system' | null;

  /**
   * User responsible for the event, if known.
   */
  actorUserId: string | null;

  /**
   * Role of the actor, if recorded (task_events only).
   */
  actorRoleId: string | null;

  /**
   * Optional login/session correlation (activity_logs only).
   */
  sessionId: string | null;

  /**
   * Logical event type/action.
   * - activity_logs.action
   * - task_events.eventType
   */
  eventType: string;

  /**
   * Origin of the event when tracked (e.g. "api", "ui", "worker").
   * Populated from task_events.origin, null for generic activity logs.
   */
  origin: string | null;

  /**
   * Optional low-level target classification from the source table.
   */
  targetType: string | null;

  /**
   * Optional low-level target id from the source table.
   */
  targetId: string | null;

  /**
   * Event details. For task_events this will contain an object with
   * oldValue/newValue when present.
   */
  details: Prisma.JsonValue | null;

  /**
   * Optional raw old/new values for task_events.
   */
  oldValue?: Prisma.JsonValue | null;
  newValue?: Prisma.JsonValue | null;
}

export interface EntityActivityLogResult {
  /**
   * Combined, chronologically ordered items for the requested entity.
   */
  items: EntityActivityLogItem[];

  /**
   * True when there are more events available than returned in `items`.
   */
  hasMore: boolean;
}

export interface GetEntityActivityLogOptions {
  /**
   * Optional lower bound for event timestamps.
   */
  from?: Date | string;

  /**
   * Optional upper bound for event timestamps.
   */
  to?: Date | string;

  /**
   * Maximum number of items to return across all sources.
   * Defaults to 200, capped at a hard limit.
   */
  limit?: number;

  /**
   * Whether to include generic activity_logs rows.
   * Defaults to true.
   */
  includeActivityLogs?: boolean;

  /**
   * Whether to include task_events rows.
   * Defaults to true when entityType === "task", otherwise false.
   */
  includeTaskEvents?: boolean;
}

/**
 * Narrow DB view of activity_logs for mapping.
 */
type ActivityLogRow = {
  id: string;
  organization_id: string;
  user_id: string | null;
  session_id: string | null;
  actor_type: 'user' | 'system';
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Prisma.JsonValue | null;
  created_at: Date;
};

@Injectable()
export class LogQueryService {
  private static readonly DEFAULT_LIMIT = 200;
  private static readonly HARD_LIMIT = 1000;

  private readonly logger = new Logger(LogQueryService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  private get prisma(): PrismaClient {
    return this.databaseService.getPrismaClient();
  }

  /**
   * Fetch combined activity for a given entity within an organization.
   *
   * Sources:
   *   - activity_logs: target_type = entityType, target_id = entityId
   *   - task_events:   taskId = entityId (when entityType === "task")
   *
   * Returns the standard { ok, data, error } result shape.
   */
  async getActivityForEntity(
    organizationId: string,
    entityType: string,
    entityId: string,
    options?: GetEntityActivityLogOptions,
  ): Promise<StandardResult<EntityActivityLogResult>> {
    if (!organizationId || !organizationId.trim()) {
      return this.fail('INVALID_INPUT', 'organizationId is required.', {
        organizationId,
      });
    }

    if (!entityType || !entityType.trim()) {
      return this.fail('INVALID_INPUT', 'entityType is required.', {
        entityType,
      });
    }

    if (!entityId || !entityId.trim()) {
      return this.fail('INVALID_INPUT', 'entityId is required.', {
        entityId,
      });
    }

    const includeActivityLogs =
      options?.includeActivityLogs ?? true;

    const includeTaskEvents =
      options?.includeTaskEvents ?? entityType === 'task';

    if (!includeActivityLogs && !includeTaskEvents) {
      return this.fail(
        'NO_SOURCES_SELECTED',
        'At least one of includeActivityLogs or includeTaskEvents must be true.',
        { entityType },
      );
    }

    const requestedLimit =
      options?.limit && options.limit > 0
        ? options.limit
        : LogQueryService.DEFAULT_LIMIT;

    const limit = Math.min(
      requestedLimit,
      LogQueryService.HARD_LIMIT,
    );

    // Fetch one extra row per source so we can detect hasMore.
    const perSourceLimit = limit + 1;

    const fromDate = this.parseOptionalDate(options?.from);
    if (options?.from && !fromDate) {
      return this.fail('INVALID_DATE', 'Invalid from date.', {
        from: options.from,
      });
    }

    const toDate = this.parseOptionalDate(options?.to);
    if (options?.to && !toDate) {
      return this.fail('INVALID_DATE', 'Invalid to date.', {
        to: options.to,
      });
    }

    if (fromDate && toDate && fromDate > toDate) {
      return this.fail(
        'INVALID_DATE_RANGE',
        'from must be less than or equal to to.',
        {
          from: options?.from,
          to: options?.to,
        },
      );
    }

    this.logger.debug(
      `Querying entity activity log for org=${organizationId} entity=${entityType}:${entityId} [${FN_LOG_QUERY_ENTITY_ACTIVITY}]`,
    );

    try {
      const promises: Array<Promise<EntityActivityLogItem[]>> = [];

      if (includeActivityLogs) {
        promises.push(
          this.fetchActivityLogsForEntity(
            organizationId,
            entityType,
            entityId,
            fromDate,
            toDate,
            perSourceLimit,
          ),
        );
      }

      if (includeTaskEvents && entityType === 'task') {
        promises.push(
          this.fetchTaskEventsForTask(
            organizationId,
            entityId,
            fromDate,
            toDate,
            perSourceLimit,
          ),
        );
      }

      const results = await Promise.all(promises);
      const combined = results.flat();

      // Sort most recent first for trimming to limit.
      combined.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() -
          new Date(a.timestamp).getTime(),
      );

      const hasMore = combined.length > limit;
      const window = combined.slice(0, limit);

      // Present to callers in chronological order (oldest first).
      window.sort(
        (a, b) =>
          new Date(a.timestamp).getTime() -
          new Date(b.timestamp).getTime(),
      );

      return this.ok({
        items: window,
        hasMore,
      });
    } catch (error) {
      this.logger.error(
        `Failed to query entity activity log for org=${organizationId} entity=${entityType}:${entityId} [${FN_LOG_QUERY_ENTITY_ACTIVITY}]`,
        (error as Error).stack ?? String(error),
      );

      return this.fail(
        'QUERY_FAILED',
        'Failed to load activity log for entity.',
        {
          organizationId,
          entityType,
          entityId,
          error:
            error instanceof Error
              ? error.message
              : String(error),
        },
      );
    }
  }

  private parseOptionalDate(
    value?: Date | string,
  ): Date | undefined {
    if (!value) {
      return undefined;
    }

    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) {
        return undefined;
      }
      return value;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return undefined;
    }

    return parsed;
  }

  private async fetchActivityLogsForEntity(
    organizationId: string,
    entityType: string,
    entityId: string,
    from?: Date,
    to?: Date,
    limit?: number,
  ): Promise<EntityActivityLogItem[]> {
    const createdAtFilter: { gte?: Date; lte?: Date } = {};

    if (from) {
      createdAtFilter.gte = from;
    }

    if (to) {
      createdAtFilter.lte = to;
    }

    const where: Prisma.activity_logsWhereInput = {
      organization_id: organizationId,
      target_type: entityType,
      target_id: entityId,
      ...(from || to ? { created_at: createdAtFilter } : {}),
    };

    const rows = (await this.prisma.activity_logs.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: limit,
    })) as unknown as ActivityLogRow[];

    return rows.map((row) =>
      this.mapActivityLogRowToItem(row, entityType, entityId),
    );
  }

  private async fetchTaskEventsForTask(
    organizationId: string,
    taskId: string,
    from?: Date,
    to?: Date,
    limit?: number,
  ): Promise<EntityActivityLogItem[]> {
    const createdAtFilter: { gte?: Date; lte?: Date } = {};

    if (from) {
      createdAtFilter.gte = from;
    }

    if (to) {
      createdAtFilter.lte = to;
    }

    const where: Prisma.TaskEventWhereInput = {
      organizationId,
      taskId,
      ...(from || to ? { createdAt: createdAtFilter } : {}),
    };

    const rows = (await this.prisma.taskEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    })) as unknown as TaskEventModel[];

    return rows.map((row) => this.mapTaskEventRowToItem(row));
  }

  private mapActivityLogRowToItem(
    row: ActivityLogRow,
    entityType: string,
    entityId: string,
  ): EntityActivityLogItem {
    return {
      id: row.id,
      source: 'activity_log',
      organizationId: row.organization_id,
      entityType: row.target_type ?? entityType,
      entityId: row.target_id ?? entityId,
      timestamp: row.created_at.toISOString(),
      actorType: row.actor_type ?? null,
      actorUserId: row.user_id,
      actorRoleId: null,
      sessionId: row.session_id,
      eventType: row.action,
      origin: null,
      targetType: row.target_type,
      targetId: row.target_id,
      details: row.details,
    };
  }

  private mapTaskEventRowToItem(
    row: TaskEventModel,
  ): EntityActivityLogItem {
    const details =
      row.oldValue || row.newValue
        ? ({
            oldValue: row.oldValue ?? null,
            newValue: row.newValue ?? null,
          } as Prisma.JsonValue)
        : null;

    return {
      id: row.id,
      source: 'task_event',
      organizationId: row.organizationId,
      entityType: 'task',
      entityId: row.taskId,
      timestamp: row.createdAt.toISOString(),
      actorType: row.actorUserId ? 'user' : 'system',
      actorUserId: row.actorUserId,
      actorRoleId: row.actorRoleId ?? null,
      sessionId: null,
      eventType: row.eventType,
      origin: row.origin ?? null,
      targetType: 'task',
      targetId: row.taskId,
      details,
      oldValue: row.oldValue ?? null,
      newValue: row.newValue ?? null,
    };
  }

  private ok<T>(data: T): StandardResult<T> {
    return {
      ok: true,
      data,
      error: null,
    };
  }

  private fail<T>(
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ): StandardResult<T> {
    return {
      ok: false,
      data: null,
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
    };
  }
}
