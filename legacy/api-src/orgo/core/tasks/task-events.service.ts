// apps/api/src/orgo/core/tasks/task-events.service.ts

import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { Prisma, TaskEvent as TaskEventModel } from '@prisma/client';

import { DatabaseService } from '../database/database.service';
import { LogService } from '../logging/log.service';

export type TaskEventType =
  | 'created'
  | 'status_changed'
  | 'priority_changed'
  | 'ownership_changed'
  | 'comment_added'
  | 'email_linked'
  | 'escalated'
  | 'deadline_updated'
  | 'metadata_updated';

export type TaskEventOrigin = 'ui' | 'api' | 'email' | 'system_rule';

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

export interface TaskEventPayload {
  taskId: string;
  organizationId: string;
  eventType: TaskEventType;
  origin: TaskEventOrigin;
  oldValue?: Prisma.JsonValue | null;
  newValue?: Prisma.JsonValue | null;
  actorUserId?: string | null;
  actorRoleId?: string | null;
}

/**
 * Shape of messages pushed to the live event stream (for WebSocket gateway).
 * This is intentionally compact and UI‑oriented.
 */
export interface TaskEventStreamMessage {
  eventId: string;
  taskId: string;
  organizationId: string;
  eventType: TaskEventType;
  origin: TaskEventOrigin;
  oldValue: Prisma.JsonValue | null;
  newValue: Prisma.JsonValue | null;
  actorUserId: string | null;
  actorRoleId: string | null;
  createdAt: Date;
}

/**
 * TaskEventsService
 *
 * Responsibilities:
 * - Append append‑only rows into task_events.
 * - Provide convenience helpers for common event types.
 * - Expose an RxJS stream used by TaskEventsGateway for live updates.
 * - Emit structured log entries via LogService.
 */
@Injectable()
export class TaskEventsService {
  private readonly eventsSubject = new Subject<TaskEventStreamMessage>();

  constructor(
    private readonly database: DatabaseService,
    private readonly logService: LogService,
  ) {}

  /**
   * Observable stream of task events for WebSocket gateway or other subscribers.
   */
  get events$(): Observable<TaskEventStreamMessage> {
    return this.eventsSubject.asObservable();
  }

  /**
   * Low‑level primitive to append a TaskEvent row.
   * All convenience helpers delegate to this.
   */
  async appendEvent(
    payload: TaskEventPayload,
  ): Promise<StandardResult<TaskEventModel>> {
    const { taskId, organizationId, eventType, origin } = payload;

    if (!taskId || !organizationId || !eventType || !origin) {
      return {
        ok: false,
        data: null,
        error: {
          code: 'TASK_EVENT_VALIDATION_ERROR',
          message:
            'taskId, organizationId, eventType and origin are required to append a task event.',
          details: { taskId, organizationId, eventType, origin },
        },
      };
    }

    try {
      const prisma = this.database.getPrismaClient();

      const created = await prisma.taskEvent.create({
        data: {
          taskId,
          organizationId,
          eventType,
          origin,
          oldValue:
            typeof payload.oldValue === 'undefined' ? null : payload.oldValue,
          newValue:
            typeof payload.newValue === 'undefined' ? null : payload.newValue,
          actorUserId:
            typeof payload.actorUserId === 'undefined'
              ? null
              : payload.actorUserId,
          actorRoleId:
            typeof payload.actorRoleId === 'undefined'
              ? null
              : payload.actorRoleId,
          // createdAt is assumed to be defaulted by the DB.
        },
      });

      const streamMessage: TaskEventStreamMessage = {
        eventId: created.id,
        taskId: created.taskId,
        organizationId: created.organizationId,
        eventType: created.eventType as TaskEventType,
        origin: created.origin as TaskEventOrigin,
        oldValue: created.oldValue,
        newValue: created.newValue,
        actorUserId: created.actorUserId,
        actorRoleId: created.actorRoleId,
        createdAt: created.createdAt,
      };

      this.eventsSubject.next(streamMessage);

      this.logService.logEvent({
        category: 'TASK',
        logLevel: 'INFO',
        message: `Task event recorded: ${created.eventType}`,
        identifier: `task_id:${created.taskId}`,
        metadata: {
          organizationId: created.organizationId,
          eventType: created.eventType,
          origin: created.origin,
          eventId: created.id,
        },
      });

      return {
        ok: true,
        data: created,
        error: null,
      };
    } catch (err) {
      this.logService.logEvent({
        category: 'SYSTEM',
        logLevel: 'ERROR',
        message: 'Failed to append task event',
        identifier: `task_id:${taskId}`,
        metadata: {
          eventType,
          origin,
          error:
            err instanceof Error ? err.message : 'Unknown error in appendEvent',
        },
      });

      return {
        ok: false,
        data: null,
        error: {
          code: 'TASK_EVENT_PERSISTENCE_ERROR',
          message: 'Failed to persist task event.',
          details: {
            taskId,
            organizationId,
            eventType,
            origin,
          },
        },
      };
    }
  }

  /**
   * Fetch full event history for a task, ordered by createdAt ascending.
   */
  async getEventsForTask(
    taskId: string,
    organizationId: string,
  ): Promise<StandardResult<TaskEventModel[]>> {
    if (!taskId || !organizationId) {
      return {
        ok: false,
        data: null,
        error: {
          code: 'TASK_EVENT_VALIDATION_ERROR',
          message: 'taskId and organizationId are required.',
          details: { taskId, organizationId },
        },
      };
    }

    try {
      const prisma = this.database.getPrismaClient();

      const events = await prisma.taskEvent.findMany({
        where: {
          taskId,
          organizationId,
        },
        orderBy: {
          createdAt: 'asc',
        },
      });

      return {
        ok: true,
        data: events,
        error: null,
      };
    } catch (err) {
      this.logService.logEvent({
        category: 'SYSTEM',
        logLevel: 'ERROR',
        message: 'Failed to fetch task events',
        identifier: `task_id:${taskId}`,
        metadata: {
          error:
            err instanceof Error
              ? err.message
              : 'Unknown error in getEventsForTask',
        },
      });

      return {
        ok: false,
        data: null,
        error: {
          code: 'TASK_EVENT_QUERY_ERROR',
          message: 'Failed to fetch task events.',
          details: { taskId, organizationId },
        },
      };
    }
  }

  /**
   * Convenience: record `created` event.
   * Typically called immediately after Task creation.
   */
  async recordTaskCreated(params: {
    taskId: string;
    organizationId: string;
    origin: TaskEventOrigin;
    actorUserId?: string | null;
    actorRoleId?: string | null;
    snapshot?: Prisma.JsonValue; // optional full Task snapshot
  }): Promise<StandardResult<TaskEventModel>> {
    const { snapshot, ...rest } = params;
    return this.appendEvent({
      ...rest,
      eventType: 'created',
      oldValue: null,
      newValue: snapshot ?? null,
    });
  }

  /**
   * Convenience: record `status_changed` event.
   */
  async recordStatusChanged(params: {
    taskId: string;
    organizationId: string;
    origin: TaskEventOrigin;
    previousStatus: string;
    nextStatus: string;
    actorUserId?: string | null;
    actorRoleId?: string | null;
    reason?: string;
  }): Promise<StandardResult<TaskEventModel>> {
    const { previousStatus, nextStatus, reason, ...base } = params;

    return this.appendEvent({
      ...base,
      eventType: 'status_changed',
      oldValue: {
        status: previousStatus,
      },
      newValue: {
        status: nextStatus,
        reason: reason ?? null,
      },
    });
  }

  /**
   * Convenience: record `priority_changed` event.
   */
  async recordPriorityChanged(params: {
    taskId: string;
    organizationId: string;
    origin: TaskEventOrigin;
    previousPriority: string;
    nextPriority: string;
    actorUserId?: string | null;
    actorRoleId?: string | null;
  }): Promise<StandardResult<TaskEventModel>> {
    const { previousPriority, nextPriority, ...base } = params;

    return this.appendEvent({
      ...base,
      eventType: 'priority_changed',
      oldValue: {
        priority: previousPriority,
      },
      newValue: {
        priority: nextPriority,
      },
    });
  }

  /**
   * Convenience: record `ownership_changed` event.
   * Used for assignments / reassignments.
   */
  async recordOwnershipChanged(params: {
    taskId: string;
    organizationId: string;
    origin: TaskEventOrigin;
    previousOwnerRoleId?: string | null;
    previousOwnerUserId?: string | null;
    previousAssigneeRole?: string | null;
    nextOwnerRoleId?: string | null;
    nextOwnerUserId?: string | null;
    nextAssigneeRole?: string | null;
    actorUserId?: string | null;
    actorRoleId?: string | null;
    reason?: string;
  }): Promise<StandardResult<TaskEventModel>> {
    const {
      previousOwnerRoleId,
      previousOwnerUserId,
      previousAssigneeRole,
      nextOwnerRoleId,
      nextOwnerUserId,
      nextAssigneeRole,
      reason,
      ...base
    } = params;

    return this.appendEvent({
      ...base,
      eventType: 'ownership_changed',
      oldValue: {
        owner_role_id: previousOwnerRoleId ?? null,
        owner_user_id: previousOwnerUserId ?? null,
        assignee_role: previousAssigneeRole ?? null,
      },
      newValue: {
        owner_role_id: nextOwnerRoleId ?? null,
        owner_user_id: nextOwnerUserId ?? null,
        assignee_role: nextAssigneeRole ?? null,
        reason: reason ?? null,
      },
    });
  }

  /**
   * Convenience: record `comment_added` event.
   * Comment body itself lives in task_comments; this logs metadata.
   */
  async recordCommentAdded(params: {
    taskId: string;
    organizationId: string;
    origin: TaskEventOrigin;
    commentId: string;
    visibility: string;
    actorUserId?: string | null;
    actorRoleId?: string | null;
  }): Promise<StandardResult<TaskEventModel>> {
    const { commentId, visibility, ...base } = params;

    return this.appendEvent({
      ...base,
      eventType: 'comment_added',
      oldValue: null,
      newValue: {
        comment_id: commentId,
        visibility,
      },
    });
  }

  /**
   * Convenience: record `email_linked` event.
   */
  async recordEmailLinked(params: {
    taskId: string;
    organizationId: string;
    origin: TaskEventOrigin;
    emailMessageId: string;
    actorUserId?: string | null;
    actorRoleId?: string | null;
  }): Promise<StandardResult<TaskEventModel>> {
    const { emailMessageId, ...base } = params;

    return this.appendEvent({
      ...base,
      eventType: 'email_linked',
      oldValue: null,
      newValue: {
        email_message_id: emailMessageId,
      },
    });
  }

  /**
   * Convenience: record `escalated` event.
   */
  async recordEscalated(params: {
    taskId: string;
    organizationId: string;
    origin: TaskEventOrigin;
    previousEscalationLevel: number;
    nextEscalationLevel: number;
    actorUserId?: string | null;
    actorRoleId?: string | null;
    reason: string;
  }): Promise<StandardResult<TaskEventModel>> {
    const {
      previousEscalationLevel,
      nextEscalationLevel,
      reason,
      ...base
    } = params;

    return this.appendEvent({
      ...base,
      eventType: 'escalated',
      oldValue: {
        escalation_level: previousEscalationLevel,
      },
      newValue: {
        escalation_level: nextEscalationLevel,
        reason,
      },
    });
  }

  /**
   * Convenience: record `deadline_updated` event.
   */
  async recordDeadlineUpdated(params: {
    taskId: string;
    organizationId: string;
    origin: TaskEventOrigin;
    previousDeadlineAt: string | null;
    nextDeadlineAt: string | null;
    actorUserId?: string | null;
    actorRoleId?: string | null;
    reason?: string;
  }): Promise<StandardResult<TaskEventModel>> {
    const { previousDeadlineAt, nextDeadlineAt, reason, ...base } = params;

    return this.appendEvent({
      ...base,
      eventType: 'deadline_updated',
      oldValue: {
        reactivity_deadline_at: previousDeadlineAt,
      },
      newValue: {
        reactivity_deadline_at: nextDeadlineAt,
        reason: reason ?? null,
      },
    });
  }

  /**
   * Convenience: record `metadata_updated` event.
   * Accepts arbitrary old/new shape and leaves semantics to caller.
   */
  async recordMetadataUpdated(params: {
    taskId: string;
    organizationId: string;
    origin: TaskEventOrigin;
    oldMetadata: Prisma.JsonValue | null;
    newMetadata: Prisma.JsonValue | null;
    actorUserId?: string | null;
    actorRoleId?: string | null;
  }): Promise<StandardResult<TaskEventModel>> {
    const { oldMetadata, newMetadata, ...base } = params;

    return this.appendEvent({
      ...base,
      eventType: 'metadata_updated',
      oldValue: oldMetadata,
      newValue: newMetadata,
    });
  }
}
