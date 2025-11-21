import { Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

import { DatabaseService } from '../../core/database/database.service';

export type ComplianceAuditLogSource = 'activity_log' | 'security_event';

export interface ComplianceAuditLogExportOptions {
  /**
   * Organization to scope the export to.
   * If null/undefined, all organizations are included (restricted to caller's RBAC elsewhere).
   */
  organizationId?: string | null;

  /**
   * Inclusive lower bound for log timestamps.
   */
  from: Date;

  /**
   * Inclusive upper bound for log timestamps.
   */
  to: Date;

  /**
   * Whether to include rows from activity_logs.
   * Defaults to true.
   */
  includeActivityLogs?: boolean;

  /**
   * Whether to include rows from security_events.
   * Defaults to true.
   */
  includeSecurityEvents?: boolean;

  /**
   * Maximum number of rows to return.
   * This is further clamped by the hard upper bound.
   */
  maxRows?: number;

  /**
   * If false (default), PII and sensitive fields are masked.
   * If true, raw values are returned (caller must ensure appropriate RBAC).
   */
  includeSensitiveFields?: boolean;

  /**
   * Optional identity of the user requesting the export.
   * Used only for the security_events audit row.
   */
  requestedByUserId?: string | null;

  /**
   * Optional IP address of the requester (for audit trail).
   */
  requestIp?: string | null;

  /**
   * Optional user agent of the requester (for audit trail).
   */
  requestUserAgent?: string | null;
}

export interface ComplianceAuditLogExportRow {
  /**
   * ISO-8601 timestamp of the original log row (created_at).
   */
  timestamp: string;
  source: ComplianceAuditLogSource;

  organizationId: string | null;
  userId: string | null;
  sessionId: string | null;

  /**
   * For activity_logs: action.
   * For security_events: event_type.
   */
  eventType: string;

  /**
   * For security_events only; null for activity_logs.
   */
  severity: string | null;

  ipAddress: string | null;
  userAgent: string | null;

  /**
   * For activity_logs only; null for security_events.
   */
  targetType: string | null;
  targetId: string | null;

  /**
   * JSON payload from details column (possibly masked).
   */
  details: Record<string, unknown> | null;
}

export interface ComplianceAuditLogExportResult {
  exportId: string;
  generatedAt: Date;

  from: Date;
  to: Date;
  organizationId: string | null;

  /**
   * Number of rows actually returned (after masking and truncation).
   */
  rowCount: number;

  /**
   * True if more rows exist in the given window than were returned
   * (i.e. export was truncated at maxRows).
   */
  hasMore: boolean;

  rows: ComplianceAuditLogExportRow[];
}

/**
 * Local view of the activity_logs row shape.
 * Mirrors the schema in the database; not all columns are included.
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

/**
 * Local view of the security_events row shape.
 * Mirrors the schema in the database; not all columns are included.
 */
type SecurityEventRow = {
  id: string;
  organization_id: string | null;
  user_id: string | null;
  event_type: 'failed_login' | 'permission_escalation' | 'api_abuse' | 'data_export' | 'config_change';
  ip_address: string | null;
  user_agent: string | null;
  details: Prisma.JsonValue | null;
  severity: 'low' | 'medium' | 'high' | 'critical';
  created_at: Date;
};

/**
 * Service responsible for preparing audit-log exports (activity_logs + security_events)
 * for compliance and regulatory review. Exports are:
 *
 * - Scoped by organization and time window.
 * - Row-limited to protect the system.
 * - Optionally PII-masked, depending on includeSensitiveFields.
 *
 * RBAC / visibility checks are enforced at the controller/guard layer;
 * this service only implements the data shaping and audit logging.
 */
@Injectable()
export class ComplianceExportService {
  /**
   * Hard upper bound for any single export, regardless of config.
   * This should stay aligned with analytics/export limits.
   */
  private static readonly HARD_ROW_LIMIT = 100_000;

  /**
   * Default soft limit when no explicit maxRows is provided.
   * This is aligned with the production analytics export default (50k rows).
   */
  private static readonly DEFAULT_SOFT_ROW_LIMIT = 50_000;

  private readonly logger = new Logger(ComplianceExportService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  private get prisma(): PrismaClient {
    return this.databaseService.getPrismaClient();
  }

  async exportAuditLog(
    options: ComplianceAuditLogExportOptions,
  ): Promise<ComplianceAuditLogExportResult> {
    const from = new Date(options.from);
    const to = new Date(options.to);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new Error('Invalid from/to date supplied to ComplianceExportService.exportAuditLog');
    }

    if (from > to) {
      throw new Error('"from" must be less than or equal to "to" in ComplianceExportService.exportAuditLog');
    }

    const includeActivityLogs = options.includeActivityLogs ?? true;
    const includeSecurityEvents = options.includeSecurityEvents ?? true;

    if (!includeActivityLogs && !includeSecurityEvents) {
      throw new Error('At least one of includeActivityLogs/includeSecurityEvents must be true');
    }

    const maxRows = this.resolveMaxRows(options.maxRows);
    const includeSensitive = options.includeSensitiveFields === true;

    this.logger.log(
      `Preparing compliance audit log export from ${from.toISOString()} to ${to.toISOString()} ` +
        `(org=${options.organizationId ?? 'ALL'}, maxRows=${maxRows}, includeSensitive=${includeSensitive})`,
    );

    const [activityLogs, securityEvents] = await Promise.all([
      includeActivityLogs ? this.fetchActivityLogs(options.organizationId, from, to, maxRows) : Promise.resolve([]),
      includeSecurityEvents ? this.fetchSecurityEvents(options.organizationId, from, to, maxRows) : Promise.resolve([]),
    ]);

    const combined: ComplianceAuditLogExportRow[] = [
      ...activityLogs.map((row) => this.mapActivityLogRow(row)),
      ...securityEvents.map((row) => this.mapSecurityEventRow(row)),
    ];

    combined.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    const hasMore = combined.length > maxRows;
    let rows = hasMore ? combined.slice(0, maxRows) : combined;

    if (!includeSensitive) {
      rows = rows.map((row) => this.maskRow(row));
    }

    const exportId = uuidv4();
    const generatedAt = new Date();

    await this.recordComplianceSecurityEvent(exportId, options, rows.length, hasMore, from, to);

    this.logger.log(
      `Compliance audit log export ${exportId} prepared with ${rows.length} rows (hasMore=${hasMore})`,
    );

    return {
      exportId,
      generatedAt,
      from,
      to,
      organizationId: options.organizationId ?? null,
      rowCount: rows.length,
      hasMore,
      rows,
    };
  }

  private resolveMaxRows(requested?: number): number {
    const envLimitRaw = process.env.COMPLIANCE_EXPORT_MAX_ROWS;
    const envLimit =
      envLimitRaw && !Number.isNaN(Number(envLimitRaw)) ? Number(envLimitRaw) : undefined;

    const base =
      requested && requested > 0
        ? requested
        : envLimit && envLimit > 0
        ? envLimit
        : ComplianceExportService.DEFAULT_SOFT_ROW_LIMIT;

    return Math.min(base, ComplianceExportService.HARD_ROW_LIMIT);
  }

  private async fetchActivityLogs(
    organizationId: string | null | undefined,
    from: Date,
    to: Date,
    maxRows: number,
  ): Promise<ActivityLogRow[]> {
    const where: Prisma.activity_logsWhereInput = {
      created_at: {
        gte: from,
        lte: to,
      },
      ...(organizationId ? { organization_id: organizationId } : {}),
    };

    return (this.prisma.activity_logs.findMany({
      where,
      orderBy: { created_at: 'asc' },
      take: maxRows,
    }) as unknown) as ActivityLogRow[];
  }

  private async fetchSecurityEvents(
    organizationId: string | null | undefined,
    from: Date,
    to: Date,
    maxRows: number,
  ): Promise<SecurityEventRow[]> {
    const where: Prisma.security_eventsWhereInput = {
      created_at: {
        gte: from,
        lte: to,
      },
      ...(organizationId ? { organization_id: organizationId } : {}),
    };

    return (this.prisma.security_events.findMany({
      where,
      orderBy: { created_at: 'asc' },
      take: maxRows,
    }) as unknown) as SecurityEventRow[];
  }

  private mapActivityLogRow(row: ActivityLogRow): ComplianceAuditLogExportRow {
    return {
      timestamp: row.created_at.toISOString(),
      source: 'activity_log',
      organizationId: row.organization_id,
      userId: row.user_id,
      sessionId: row.session_id,
      eventType: row.action,
      severity: null,
      ipAddress: null,
      userAgent: null,
      targetType: row.target_type,
      targetId: row.target_id,
      details: (row.details as Record<string, unknown> | null) ?? null,
    };
  }

  private mapSecurityEventRow(row: SecurityEventRow): ComplianceAuditLogExportRow {
    return {
      timestamp: row.created_at.toISOString(),
      source: 'security_event',
      organizationId: row.organization_id,
      userId: row.user_id,
      sessionId: null,
      eventType: row.event_type,
      severity: row.severity,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      targetType: null,
      targetId: null,
      details: (row.details as Record<string, unknown> | null) ?? null,
    };
  }

  private maskRow(row: ComplianceAuditLogExportRow): ComplianceAuditLogExportRow {
    return {
      ...row,
      userId: row.userId ? this.hashIdentifier(row.userId) : null,
      sessionId: row.sessionId ? this.hashIdentifier(row.sessionId) : null,
      ipAddress: row.ipAddress ? this.maskIp(row.ipAddress) : null,
      details: row.details ? (this.maskDetails(row.details) as Record<string, unknown>) : null,
    };
  }

  private maskDetails(value: unknown): unknown {
    if (value === null || value === undefined) {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((v) => this.maskDetails(v));
    }

    if (typeof value !== 'object') {
      return value;
    }

    const piiKeys = new Set([
      'email',
      'email_address',
      'phone',
      'phone_number',
      'ssn',
      'national_id',
      'nationalInsuranceNumber',
    ]);

    const masked: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (piiKeys.has(key)) {
        masked[key] = raw == null ? raw : '***REDACTED***';
      } else if (key.toLowerCase().includes('ip')) {
        masked[key] = raw == null ? raw : this.maskIp(String(raw));
      } else if (key.toLowerCase().endsWith('_id')) {
        masked[key] = raw == null ? raw : this.hashIdentifier(String(raw));
      } else if (typeof raw === 'object') {
        masked[key] = this.maskDetails(raw);
      } else {
        masked[key] = raw;
      }
    }

    return masked;
  }

  private maskIp(ip: string): string {
    const ipv4Parts = ip.split('.');
    if (ipv4Parts.length === 4) {
      return `${ipv4Parts[0]}.${ipv4Parts[1]}.${ipv4Parts[2]}.x`;
    }

    if (ip.includes(':')) {
      const parts = ip.split(':');
      if (parts.length > 2) {
        return [...parts.slice(0, parts.length - 2), 'xxxx', 'xxxx'].join(':');
      }
    }

    return '***REDACTED***';
  }

  private hashIdentifier(value: string): string {
    // Lightweight, deterministic hash suitable for masking IDs in exports.
    // Not intended as a cryptographic guarantee.
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash << 5) - hash + value.charCodeAt(i);
      hash |= 0; // Convert to 32-bit int
    }
    return `hash_${Math.abs(hash).toString(16)}`;
  }

  private async recordComplianceSecurityEvent(
    exportId: string,
    options: ComplianceAuditLogExportOptions,
    rowCount: number,
    hasMore: boolean,
    from: Date,
    to: Date,
  ): Promise<void> {
    try {
      await this.prisma.security_events.create({
        data: {
          organization_id: options.organizationId ?? null,
          user_id: options.requestedByUserId ?? null,
          event_type: 'data_export',
          ip_address: options.requestIp ?? null,
          user_agent: options.requestUserAgent ?? null,
          severity: 'medium',
          details: {
            exportId,
            kind: 'compliance_audit_log_export',
            rowCount,
            hasMore,
            from: from.toISOString(),
            to: to.toISOString(),
          } as Prisma.JsonObject,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to record compliance export security event for ${exportId}`,
        (error as Error)?.stack,
      );
    }
  }
}
