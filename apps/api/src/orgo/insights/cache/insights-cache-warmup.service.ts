// apps/api/src/orgo/insights/cache/insights-cache-warmup.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ReportsService } from '../reports/reports.service';

export const INSIGHTS_CACHE_WARMUP_JOB_ID = 'orgo.insights.cache-warmup-dashboards';

/**
 * Options for a cache warmup run.
 *
 * In most cases callers will just invoke `warmDashboards()` with no arguments
 * and let this service derive organization IDs from configuration. Passing
 * explicit organization IDs is useful for targeted warmups in tests or tools.
 */
export interface InsightsCacheWarmupOptions {
  /**
   * One or more organization IDs whose dashboards should be pre‑warmed.
   * If omitted, the service will try to read `INSIGHTS_CACHE_WARMUP_ORG_IDS`
   * (comma‑separated UUIDs) from configuration.
   */
  organizationIds?: string[];

  /**
   * Optional subset of dashboards to warm. If omitted, all known high‑traffic
   * dashboards are warmed.
   */
  dashboards?: Array<'taskVolume' | 'slaBreaches' | 'profileScore'>;
}

/**
 * Pre‑warms Redis caches for high‑traffic insights dashboards by issuing the
 * same queries the UI uses, letting the reporting layer cache the results
 * using the TTLs defined in the insights configuration. :contentReference[oaicite:1]{index=1}
 *
 * This service is typically invoked by a scheduled worker tied to the
 * `orgo.insights.cache-warmup-dashboards` queue/job ID. 
 */
@Injectable()
export class InsightsCacheWarmupService {
  private readonly logger = new Logger(InsightsCacheWarmupService.name);

  // Only staging + prod are configured to run this job by default.
  private static readonly ENABLED_ENVIRONMENTS = new Set(['staging', 'prod']);

  constructor(
    private readonly reportsService: ReportsService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Entry point used by the background job handler.
   *
   * Behaviour:
   * - Skips execution entirely when INSIGHTS_ENV is not one of
   *   ["staging", "prod"] (or is set to "offline").
   * - Determines the set of organizations to warm from the options or from
   *   `INSIGHTS_CACHE_WARMUP_ORG_IDS` (comma‑separated UUIDs).
   * - For each organization, calls the main high‑traffic reporting endpoints
   *   so that their results are cached for upcoming dashboard requests.
   */
  async warmDashboards(options: InsightsCacheWarmupOptions = {}): Promise<void> {
    const env = this.getInsightsEnvironment();

    if (!InsightsCacheWarmupService.ENABLED_ENVIRONMENTS.has(env)) {
      this.logger.debug(
        `Insights cache warmup skipped: INSIGHTS_ENV=${env} is not in enabled environments ${Array.from(
          InsightsCacheWarmupService.ENABLED_ENVIRONMENTS,
        ).join(', ')}`,
      );
      return;
    }

    if (env === 'offline') {
      this.logger.debug('Insights cache warmup skipped: offline environment');
      return;
    }

    const organizationIds =
      (options.organizationIds && options.organizationIds.length > 0
        ? options.organizationIds
        : this.getConfiguredOrganizationIds()) || [];

    if (organizationIds.length === 0) {
      this.logger.warn(
        'Insights cache warmup skipped: no organization IDs provided and INSIGHTS_CACHE_WARMUP_ORG_IDS is not configured',
      );
      return;
    }

    const dashboards =
      options.dashboards && options.dashboards.length > 0
        ? options.dashboards
        : (['taskVolume', 'slaBreaches', 'profileScore'] as const);

    this.logger.log(
      `Starting insights cache warmup (env=${env}, orgs=${organizationIds.length}, dashboards=${dashboards.join(
        ', ',
      )})`,
    );

    const startedAt = Date.now();

    const results = await Promise.allSettled(
      organizationIds.map((organizationId) =>
        this.warmDashboardsForOrganization(organizationId, dashboards),
      ),
    );

    const failed = results.filter((r) => r.status === 'rejected').length;
    const durationMs = Date.now() - startedAt;

    if (failed > 0) {
      this.logger.warn(
        `Insights cache warmup finished with ${failed} failures out of ${organizationIds.length} organizations in ${durationMs} ms`,
      );
    } else {
      this.logger.log(
        `Insights cache warmup finished successfully for ${organizationIds.length} organizations in ${durationMs} ms`,
      );
    }
  }

  /**
   * Warm the configured set of dashboards for a single organization.
   *
   * This delegates to the reporting service, which is responsible for:
   * - honouring analytics cache TTLs from the insights config;
   * - applying access‑control and visibility rules;
   * - performing any internal caching through Redis.
   */
  private async warmDashboardsForOrganization(
    organizationId: string,
    dashboards: Array<'taskVolume' | 'slaBreaches' | 'profileScore'>,
  ): Promise<void> {
    this.logger.debug(
      `Warming insights dashboards for organization ${organizationId} (${dashboards.join(
        ', ',
      )})`,
    );

    const tasks: Promise<unknown>[] = [];

    if (dashboards.includes('taskVolume')) {
      tasks.push(
        this.reportsService
          // Typical dashboards show "recent activity" for an org; the reporting
          // service can interpret an organization‑only payload as "default range".
          .getTaskVolumeReport({ organizationId })
          .catch((error) =>
            this.logDashboardError(
              organizationId,
              'taskVolume',
              error as Error,
            ),
          ),
      );
    }

    if (dashboards.includes('slaBreaches')) {
      tasks.push(
        this.reportsService
          .getSlaBreaches({ organizationId })
          .catch((error) =>
            this.logDashboardError(
              organizationId,
              'slaBreaches',
              error as Error,
            ),
          ),
      );
    }

    if (dashboards.includes('profileScore')) {
      tasks.push(
        this.reportsService
          .getProfileScore({ organizationId })
          .catch((error) =>
            this.logDashboardError(
              organizationId,
              'profileScore',
              error as Error,
            ),
          ),
      );
    }

    // Run all dashboard warmups for this org in parallel; errors are handled
    // per‑dashboard above so we do not reject the entire org on a single failure.
    await Promise.all(tasks);
  }

  /**
   * Derives the current insights environment.
   *
   * Prefers the explicit INSIGHTS_ENV (as defined in the insights module
   * config) and falls back to the global ENVIRONMENT when not set. 
   */
  private getInsightsEnvironment(): string {
    const fromInsightsEnv =
      this.configService.get<string>('INSIGHTS_ENV') ||
      this.configService.get<string>('insights.environment');
    const fromGlobalEnv =
      this.configService.get<string>('ENVIRONMENT') ||
      this.configService.get<string>('environment');

    return (fromInsightsEnv || fromGlobalEnv || 'dev').toLowerCase();
  }

  /**
   * Reads the default set of organization IDs to warm from configuration.
   *
   * By convention this is supplied via the environment variable
   * `INSIGHTS_CACHE_WARMUP_ORG_IDS` as a comma‑separated list of UUIDs, e.g.:
   *
   *   INSIGHTS_CACHE_WARMUP_ORG_IDS=org-uuid-1,org-uuid-2
   */
  private getConfiguredOrganizationIds(): string[] {
    const raw =
      this.configService.get<string>('INSIGHTS_CACHE_WARMUP_ORG_IDS') || '';

    return raw
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }

  private logDashboardError(
    organizationId: string,
    dashboard: string,
    error: Error,
  ): void {
    this.logger.error(
      `Failed to warm insights dashboard "${dashboard}" for organization ${organizationId}: ${error.message}`,
      error.stack,
    );
  }
}
