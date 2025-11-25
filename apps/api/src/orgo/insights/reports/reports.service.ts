// apps/api/src/orgo/insights/reports/reports.service.ts

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

/**
 * Canonical task status tokens mirrored from Doc 2 / Doc 6.
 * These must match both the operational enums and the analytics schema.
 */
export type TaskStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'ON_HOLD'
  | 'COMPLETED'
  | 'FAILED'
  | 'ESCALATED'
  | 'CANCELLED';

/**
 * Canonical task priority tokens.
 */
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/**
 * Canonical task severity tokens.
 */
export type TaskSeverity = 'MINOR' | 'MODERATE' | 'MAJOR' | 'CRITICAL';

/**
 * Parameters for the task volume report.
 *
 * organizationId and the date window are required at the semantic level,
 * but the date window may be omitted in which case a default lookback is used.
 */
export interface TaskVolumeReportParams {
  organizationId: string;
  /**
   * Inclusive start of the window. If omitted together with toDate,
   * a default rolling window is used.
   */
  fromDate?: Date | string;
  /**
   * Inclusive end of the window. If omitted, defaults to "today" (UTC).
   */
  toDate?: Date | string;
  /**
   * Optional filter for Task.status; interpreted against ft.current_status.
   */
  status?: TaskStatus[];
  /**
   * Optional filter for Task.type / domain;
   * this is resolved via insights.dim_tasks.type.
   */
  type?: string;
}

/**
 * One bucket in the task volume report – counts per day and status.
 */
export interface TaskVolumeBucket {
  /**
   * ISO date (YYYY-MM-DD), matching insights.dim_dates.date_key.
   */
  date: string;
  status: TaskStatus;
  count: number;
}

/**
 * Parameters used for SLA breach reporting. Thresholds are provided
 * by the caller (typically derived from organization profiles and
 * global config).
 */
export interface SlaBreachesParams {
  organizationId: string;
  fromDate?: Date | string;
  toDate?: Date | string;
  /**
   * Threshold (seconds) for time_to_first_response_seconds beyond
   * which a task is considered to have breached the reactivity SLA.
   */
  reactivitySecondsThreshold: number;
  /**
   * Threshold (seconds) for time_to_completion_seconds beyond
   * which a task is considered to have breached the completion SLA.
   */
  completionSecondsThreshold: number;
  /**
   * Optional filter for Task.type / domain.
   */
  type?: string;
  /**
   * Optional profile code (profileKey) used by callers to indicate
   * which behavioural profile’s SLA expectations were applied
   * (e.g. "hospital", "default").
   *
   * The reporting service itself does not currently alter aggregation
   * logic based on this field, but it is accepted so that API
   * contracts can pass it through and logging can include it.
   */
  profileKey?: string;
}

/**
 * Aggregated SLA breach data per domain (Task.type).
 */
export interface SlaBreachRow {
  /**
   * Task.type from insights.dim_tasks.type (e.g. "maintenance", "hr_case").
   */
  domainType: string;
  /**
   * Total tasks considered for this domain within the date window.
   */
  totalTasks: number;
  /**
   * Tasks that breached either the reactivity or completion SLA.
   */
  breachedTasks: number;
  /**
   * breachedTasks / totalTasks, in [0, 1]. 0 when totalTasks == 0.
   */
  breachRate: number;
}

/**
 * Profile score parameters – equivalent to SLA breach parameters,
 * since the score is derived from the same aggregates.
 */
export interface ProfileScoreParams extends SlaBreachesParams {}

/**
 * Overall profile effectiveness score plus per-domain breakdown.
 */
export interface ProfileScore {
  organizationId: string;
  fromDate: string;
  toDate: string;
  /**
   * Total tasks considered across all domains.
   */
  overallTasks: number;
  /**
   * Total tasks that breached SLA across all domains.
   */
  overallBreachedTasks: number;
  /**
   * Score in [0, 100]. 100 means no breaches, 0 means all breached.
   */
  overallScore: number;
  /**
   * Per-domain SLA breach breakdown.
   */
  perDomain: SlaBreachRow[];
}

/**
 * Utility: normalize a Date or date-like string to a YYYY-MM-DD string in UTC.
 * Throws if the input cannot be parsed as a date.
 */
function toDateKey(input: Date | string): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  const time = d.getTime();

  if (Number.isNaN(time)) {
    throw new Error(`Invalid date value: ${String(input)}`);
  }

  const year = d.getUTCFullYear();
  const month = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = d.getUTCDate().toString().padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Default lookback window for date ranges when none is provided.
 * This is intentionally conservative and can be overridden by callers.
 */
const DEFAULT_LOOKBACK_DAYS = 30;

/**
 * ReportsService
 *
 * Read-only service over the analytics star-schema (insights.*),
 * providing high-level reporting aggregates used by dashboards:
 *
 * - getTaskVolumeReport: task counts by day and status.
 * - getSlaBreaches: SLA breach rates per domain.
 * - getProfileScore: aggregate profile effectiveness score derived
 *   from SLA breaches.
 *
 * The DataSource injected here should be configured to talk to the
 * analytics database that hosts the `insights` schema. If the same
 * Postgres instance is used for OLTP and analytics, this service can
 * use the default application DataSource.
 *
 * This service also honours caching guidance from the Insights config
 * (Doc 6 – analytics.cache.ttl_seconds.*) when a CacheManager is
 * available, so that dashboard traffic can be served from Redis.
 */
@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    @Optional()
    @Inject(CACHE_MANAGER)
    private readonly cacheManager?: Cache,
  ) {}

  /**
   * Returns task volume buckets grouped by created_date_key and
   * current_status for a given organization and date window.
   *
   * Data source:
   *   - insights.fact_tasks (created_date_key, current_status, organization_id)
   *   - optional join to insights.dim_tasks when filtering by Task.type.
   */
  async getTaskVolumeReport(
    params: TaskVolumeReportParams,
  ): Promise<TaskVolumeBucket[]> {
    const { organizationId, status, type } = params;
    const { fromKey, toKey } = this.normalizeDateRange(
      params.fromDate,
      params.toDate,
    );

    const cacheKey = this.buildCacheKey('taskVolume', {
      organizationId,
      fromDate: fromKey,
      toDate: toKey,
      status: status ?? [],
      type: type ?? null,
    });

    const compute = async (): Promise<TaskVolumeBucket[]> => {
      const conditions: string[] = [];
      const values: any[] = [];

      // 1) organization_id filter
      values.push(organizationId);
      let paramIndex = 1;
      conditions.push(`ft.organization_id = $${paramIndex++}`);

      // 2) date window (created_date_key is a DATE)
      values.push(fromKey);
      conditions.push(`ft.created_date_key >= $${paramIndex++}`);

      values.push(toKey);
      conditions.push(`ft.created_date_key <= $${paramIndex++}`);

      // 3) optional status filter
      if (status && status.length > 0) {
        values.push(status);
        conditions.push(`ft.current_status = ANY($${paramIndex++})`);
      }

      // 4) optional domain type filter (requires dim_tasks join)
      if (type) {
        values.push(type);
        conditions.push(`dt.type = $${paramIndex++}`);
      }

      const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const sql = `
        SELECT
          ft.created_date_key AS date,
          ft.current_status AS status,
          COUNT(*)::int AS count
        FROM insights.fact_tasks ft
        LEFT JOIN insights.dim_tasks dt
          ON dt.task_id = ft.task_id
        ${whereClause}
        GROUP BY ft.created_date_key, ft.current_status
        ORDER BY ft.created_date_key ASC, ft.current_status ASC;
      `;

      try {
        const rows: Array<{
          date: string | Date;
          status: TaskStatus;
          count: string | number;
        }> = await this.dataSource.query(sql, values);

        return rows.map((row) => ({
          date:
            row.date instanceof Date
              ? row.date.toISOString().slice(0, 10)
              : String(row.date),
          status: row.status,
          count:
            typeof row.count === 'string'
              ? parseInt(row.count, 10)
              : row.count,
        }));
      } catch (error) {
        this.logger.error(
          `Failed to compute task volume report for org=${organizationId}`,
          (error as Error).stack ?? String(error),
        );
        throw error;
      }
    };

    return this.withCache<TaskVolumeBucket[]>(
      cacheKey,
      'analytics.cache.ttl_seconds.dashboard_default',
      compute,
    );
  }

  /**
   * Returns SLA breach statistics per domain (Task.type) for a given
   * organization and date window.
   *
   * A task is counted as "breached" if either:
   *   - time_to_first_response_seconds > reactivitySecondsThreshold, OR
   *   - time_to_completion_seconds > completionSecondsThreshold.
   *
   * Data source:
   *   - insights.fact_tasks (metrics & dates)
   *   - insights.dim_tasks (domain type, organization)
   */
  async getSlaBreaches(params: SlaBreachesParams): Promise<SlaBreachRow[]> {
    const {
      organizationId,
      reactivitySecondsThreshold,
      completionSecondsThreshold,
      type,
      profileKey,
    } = params;

    const { fromKey, toKey } = this.normalizeDateRange(
      params.fromDate,
      params.toDate,
    );

    if (
      reactivitySecondsThreshold == null ||
      Number.isNaN(reactivitySecondsThreshold)
    ) {
      throw new Error(
        'reactivitySecondsThreshold is required and must be a number',
      );
    }

    if (
      completionSecondsThreshold == null ||
      Number.isNaN(completionSecondsThreshold)
    ) {
      throw new Error(
        'completionSecondsThreshold is required and must be a number',
      );
    }

    const cacheKey = this.buildCacheKey('slaBreaches', {
      organizationId,
      fromDate: fromKey,
      toDate: toKey,
      type: type ?? null,
      profileKey: profileKey ?? null,
      reactivitySecondsThreshold,
      completionSecondsThreshold,
    });

    const compute = async (): Promise<SlaBreachRow[]> => {
      const conditions: string[] = [];
      const values: any[] = [];

      // 1) organization filter (from fact_tasks)
      values.push(organizationId);
      let paramIndex = 1;
      conditions.push(`ft.organization_id = $${paramIndex++}`);

      // 2) date window
      values.push(fromKey);
      conditions.push(`ft.created_date_key >= $${paramIndex++}`);

      values.push(toKey);
      conditions.push(`ft.created_date_key <= $${paramIndex++}`);

      // 3) optional type filter (dim_tasks.type)
      if (type) {
        values.push(type);
        conditions.push(`dt.type = $${paramIndex++}`);
      }

      // 4) SLA thresholds – added as parameters used in FILTER clause
      const reactivityIndex = paramIndex++;
      const completionIndex = paramIndex++;

      values.push(reactivitySecondsThreshold);
      values.push(completionSecondsThreshold);

      const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const sql = `
        SELECT
          dt.type AS domain_type,
          COUNT(*)::int AS total_tasks,
          COUNT(*) FILTER (
            WHERE
              (ft.time_to_first_response_seconds IS NOT NULL
               AND ft.time_to_first_response_seconds > $${reactivityIndex})
              OR
              (ft.time_to_completion_seconds IS NOT NULL
               AND ft.time_to_completion_seconds > $${completionIndex})
          )::int AS breached_tasks
        FROM insights.fact_tasks ft
        JOIN insights.dim_tasks dt
          ON dt.task_id = ft.task_id
        ${whereClause}
        GROUP BY dt.type
        ORDER BY dt.type;
      `;

      try {
        const rows: Array<{
          domain_type: string;
          total_tasks: string | number;
          breached_tasks: string | number;
        }> = await this.dataSource.query(sql, values);

        return rows.map((row) => {
          const total =
            typeof row.total_tasks === 'string'
              ? parseInt(row.total_tasks, 10)
              : row.total_tasks;
          const breached =
            typeof row.breached_tasks === 'string'
              ? parseInt(row.breached_tasks, 10)
              : row.breached_tasks;
          const breachRate = total > 0 ? breached / total : 0;

          return {
            domainType: row.domain_type,
            totalTasks: total,
            breachedTasks: breached,
            breachRate,
          };
        });
      } catch (error) {
        this.logger.error(
          `Failed to compute SLA breaches for org=${organizationId}, profileKey=${profileKey ?? 'n/a'}`,
          (error as Error).stack ?? String(error),
        );
        throw error;
      }
    };

    return this.withCache<SlaBreachRow[]>(
      cacheKey,
      'analytics.cache.ttl_seconds.dashboard_default',
      compute,
    );
  }

  /**
   * Computes an overall "profile effectiveness" score for an organization
   * over a date window, based on SLA breaches, and returns that score plus
   * the per-domain breakdown.
   *
   * The score is currently defined as:
   *
   *   overallScore = round((1 - breachRate) * 100),
   *
   * where breachRate = overallBreachedTasks / overallTasks.
   *
   * Callers are responsible for providing the SLA thresholds; this service
   * focuses purely on analytics aggregation.
   */
  async getProfileScore(params: ProfileScoreParams): Promise<ProfileScore> {
    const { organizationId, profileKey } = params;
    const { fromKey, toKey } = this.normalizeDateRange(
      params.fromDate,
      params.toDate,
    );

    const cacheKey = this.buildCacheKey('profileScore', {
      organizationId,
      fromDate: fromKey,
      toDate: toKey,
      type: params.type ?? null,
      profileKey: profileKey ?? null,
      reactivitySecondsThreshold: params.reactivitySecondsThreshold,
      completionSecondsThreshold: params.completionSecondsThreshold,
    });

    const compute = async (): Promise<ProfileScore> => {
      try {
        const perDomain = await this.getSlaBreaches({
          ...params,
          fromDate: fromKey,
          toDate: toKey,
        });

        const overallTasks = perDomain.reduce(
          (sum, row) => sum + row.totalTasks,
          0,
        );
        const overallBreachedTasks = perDomain.reduce(
          (sum, row) => sum + row.breachedTasks,
          0,
        );

        const breachRate =
          overallTasks > 0 ? overallBreachedTasks / overallTasks : 0;
        const overallScore = Math.round((1 - breachRate) * 100);

        return {
          organizationId,
          fromDate: fromKey,
          toDate: toKey,
          overallTasks,
          overallBreachedTasks,
          overallScore,
          perDomain,
        };
      } catch (error) {
        this.logger.error(
          `Failed to compute profile score for org=${organizationId}, profileKey=${profileKey ?? 'n/a'}`,
          (error as Error).stack ?? String(error),
        );
        throw error;
      }
    };

    return this.withCache<ProfileScore>(
      cacheKey,
      'analytics.cache.ttl_seconds.dashboard_default',
      compute,
    );
  }

  /**
   * Normalizes any provided from/to dates to UTC date keys (YYYY-MM-DD).
   * If either is missing, default to a rolling window ending "today"
   * (UTC) with DEFAULT_LOOKBACK_DAYS lookback.
   */
  private normalizeDateRange(
    fromDate?: Date | string,
    toDate?: Date | string,
  ): { fromKey: string; toKey: string } {
    const now = new Date();

    const to =
      toDate != null
        ? toDateKey(toDate)
        : toDateKey(now);

    const defaultFromDate = new Date(
      now.getTime() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    );

    const from =
      fromDate != null
        ? toDateKey(fromDate)
        : toDateKey(defaultFromDate);

    return { fromKey: from, toKey: to };
  }

  /**
   * Thin wrapper around the cache manager that:
   * - builds on config-driven TTLs (Doc 6 – analytics.cache.ttl_seconds.*);
   * - degrades gracefully when caching is not configured or fails.
   */
  private async withCache<T>(
    key: string,
    ttlConfigKey: string,
    compute: () => Promise<T>,
  ): Promise<T> {
    // No cache configured – just compute.
    if (!this.cacheManager) {
      return compute();
    }

    try {
      const cached = await this.cacheManager.get<T>(key);
      if (cached !== undefined && cached !== null) {
        return cached;
      }
    } catch (error) {
      this.logger.warn(
        `Cache get failed for key=${key}: ${String(error)}`,
      );
      // Continue to compute fresh result.
    }

    const result = await compute();

    try {
      const ttlValue = this.configService.get<number | string | undefined>(
        ttlConfigKey,
      );
      let ttlSeconds: number | undefined;

      if (typeof ttlValue === 'number') {
        ttlSeconds = ttlValue;
      } else if (typeof ttlValue === 'string') {
        const parsed = Number(ttlValue);
        ttlSeconds = Number.isNaN(parsed) ? undefined : parsed;
      }

      if (ttlSeconds && ttlSeconds > 0) {
        await this.cacheManager.set(key, result, { ttl: ttlSeconds });
      } else {
        // Fall back to cache manager default TTL if any.
        await this.cacheManager.set(key, result);
      }
    } catch (error) {
      this.logger.warn(
        `Cache set failed for key=${key}: ${String(error)}`,
      );
    }

    return result;
  }

  /**
   * Builds a stable cache key for a given dashboard/report prefix and a set
   * of parameters. This is designed to keep the number of keys per dashboard
   * within the bounds configured in analytics.cache.max_keys_per_dashboard.
   */
  private buildCacheKey(
    prefix: string,
    parts: Record<string, unknown>,
  ): string {
    const serializedParts = Object.entries(parts)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => {
        if (Array.isArray(value)) {
          return `${key}=[${value
            .map((v) => this.serializeCachePart(v))
            .join(',')}]`;
        }
        return `${key}=${this.serializeCachePart(value)}`;
      })
      .sort();

    return `insights:${prefix}:${serializedParts.join('|')}`;
  }

  private serializeCachePart(value: unknown): string {
    if (value === null) return 'null';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    return JSON.stringify(value);
  }
}
