import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../../core/database/database.service';

export type AuditEventType =
  | 'failed_login'
  | 'permission_escalation'
  | 'api_abuse'
  | 'data_export'
  | 'config_change';

export type AuditEventSeverity = 'low' | 'medium' | 'high' | 'critical';
export type AuditActorType = 'user' | 'system';

export interface AuditActivityMetadata {
  /**
   * Logical action name for the audit/activity log.
   * Examples: "config_updated", "permission_changed", "report_exported".
   */
  action: string;

  /**
   * What kind of entity this action is about.
   * Examples: "security_event", "role", "permission", "report".
   */
  targetType?: string;

  /**
   * ID of the target entity, if any (Task, Case, Role, etc.).
   * For security events this typically defaults to the security_events.id row.
   */
  targetId?: string | null;

  /**
   * Optional login/session context.
   */
  sessionId?: string | null;

  /**
   * Actor type stored in activity_logs.actor_type.
   * Defaults to "user" if userId is present, otherwise "system".
   */
  actorType?: AuditActorType;

  /**
   * Additional JSON details specific to the activity log row.
   * This will be merged on top of the base security event details.
   */
  activityDetails?: Record<string, unknown>;
}

export interface RecordAuditEventInput {
  /**
   * Tenant scope for the event. May be null for global/system-wide events in security_events.
   * Required if an activity_logs row should be created.
   */
  organizationId?: string | null;

  /**
   * User responsible for the event, if any.
   */
  userId?: string | null;

  /**
   * Network and client context (optional).
   */
  ipAddress?: string | null;
  userAgent?: string | null;

  /**
   * Security event classification and severity.
   */
  eventType: AuditEventType;
  severity: AuditEventSeverity;

  /**
   * Arbitrary structured details to store in security_events.details.
   */
  details?: Record<string, unknown>;

  /**
   * Optional activity log metadata. When provided (and organizationId is non-null),
   * an activity_logs entry will be created alongside the security_events row.
   */
  activity?: AuditActivityMetadata;
}

export interface RecordAuditEventSuccessData {
  securityEventId: string;
  activityLogId?: string | null;
}

export interface RecordAuditEventError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface RecordAuditEventResult {
  ok: boolean;
  data: RecordAuditEventSuccessData | null;
  error: RecordAuditEventError | null;
}

@Injectable()
export class AuditTrailService {
  private readonly logger = new Logger(AuditTrailService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Generate an audit trail entry for a security‑relevant operation.
   *
   * Primary persistence:
   *   - security_events (always, if insert succeeds)
   * Optional secondary persistence:
   *   - activity_logs (only when organizationId and activity metadata are provided)
   *
   * Returns the standard { ok, data, error } result shape.
   */
  async recordAuditEvent(input: RecordAuditEventInput): Promise<RecordAuditEventResult> {
    const prisma = this.databaseService.getPrismaClient();

    // 1. Write canonical security_events row
    let securityEventId: string;

    try {
      const securityRows = await prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`
          INSERT INTO security_events (
            organization_id,
            user_id,
            event_type,
            ip_address,
            user_agent,
            details,
            severity
          ) VALUES (
            ${input.organizationId ?? null},
            ${input.userId ?? null},
            ${input.eventType},
            ${input.ipAddress ?? null},
            ${input.userAgent ?? null},
            ${input.details ?? {}},
            ${input.severity}
          )
          RETURNING id
        `,
      );

      if (!securityRows || securityRows.length === 0) {
        this.logger.error('security_events insert returned no rows');
        return {
          ok: false,
          data: null,
          error: {
            code: 'AUDIT_EVENT_WRITE_FAILED',
            message: 'Failed to record audit event (no row returned from security_events)',
          },
        };
      }

      securityEventId = securityRows[0].id;
    } catch (err) {
      const error = err as Error;
      this.logger.error(
        `Failed to record security event: ${error.message}`,
        error.stack,
      );

      return {
        ok: false,
        data: null,
        error: {
          code: 'AUDIT_EVENT_WRITE_FAILED',
          message: 'Failed to record audit event',
          details: {
            originalError: error.message,
          },
        },
      };
    }

    // 2. Optionally write a linked activity_logs row
    let activityLogId: string | null = null;

    if (input.activity && input.organizationId) {
      const activity = input.activity;

      const actorType: AuditActorType =
        activity.actorType ?? (input.userId ? 'user' : 'system');

      const targetType = activity.targetType ?? 'security_event';
      const targetId = activity.targetId ?? securityEventId;

      const activityDetails: Record<string, unknown> = {
        event_type: input.eventType,
        severity: input.severity,
        ip_address: input.ipAddress,
        user_agent: input.userAgent,
        security_event_id: securityEventId,
        ...(input.details ?? {}),
        ...(activity.activityDetails ?? {}),
      };

      try {
        const activityRows = await prisma.$queryRaw<{ id: string }[]>(
          Prisma.sql`
            INSERT INTO activity_logs (
              organization_id,
              user_id,
              session_id,
              actor_type,
              action,
              target_type,
              target_id,
              details
            ) VALUES (
              ${input.organizationId},
              ${input.userId ?? null},
              ${activity.sessionId ?? null},
              ${actorType},
              ${activity.action},
              ${targetType},
              ${targetId},
              ${activityDetails}
            )
            RETURNING id
          `,
        );

        if (activityRows && activityRows.length > 0) {
          activityLogId = activityRows[0].id;
        } else {
          this.logger.error(
            'activity_logs insert returned no rows for audit event',
          );
        }
      } catch (err) {
        const error = err as Error;
        this.logger.error(
          `Failed to record activity log for audit event: ${error.message}`,
          error.stack,
        );
        // Non‑fatal: we still return ok=true as the primary security event is persisted.
      }
    }

    // 3. Return standard result shape
    return {
      ok: true,
      data: {
        securityEventId,
        activityLogId,
      },
      error: null,
    };
  }
}
