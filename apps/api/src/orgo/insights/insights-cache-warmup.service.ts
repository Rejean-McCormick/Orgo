// apps/api/src/orgo/insights/insights-cache-warmup.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ReportsService } from './reports.service';

export const INSIGHTS_CACHE_WARMUP_JOB_ID =
  'orgo.insights.cache-warmup-dashboards';

/**
 * Options for a cache warmup run.
 *
 * In most cases callers will just invoke `warmDashboards()` with no arguments
 * and let this service derive organization IDs and dashboards from configuration.
 * Passing explicit organization IDs or dashboard subsets is useful for targeted
 * warmups in tests or operations tooling.
 */
export interface InsightsCacheWarmupOptions {
  /**
   * One or more organization IDs whose dashboards should be pre‑warmed.
   * If omitted, the service will try to read `INSIGHTS_CACHE_WARMUP_ORG_IDS`
   * (comma‑separated UUIDs) from configuration.
   */
  organizationIds?: string[];

  /**
   * Optional subset of dashboards to warm. If omitted, the service uses
   * configuration (INSIGHTS_CACHE_WARMUP_DASHBOARDS / insights.cache.warmup_dashboards)
   * and falls back to all high‑traffic dashboards.
   */
  dashboards?: Array<'taskVolume' | 'slaBreaches' | 'profileScore'>;
}

/**
 * Pre‑warms Redis caches for high‑traffic insights dashboards by issuing the
 * same queries the UI uses, letting the reporting layer cache the results
 * using the TTLs defined in the insights configuration.
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
   *   ["staging", "prod"] or when it resolves to "offline".
   * - Determines the set of organizations to warm from the options or from
   *   `INSIGHTS_CACHE_WARMUP_ORG_IDS` (comma‑separated UUIDs).
   * - Determines which dashboards to warm from options or config.
   * - For each organization, calls the main high‑traffic reporting endpoints
   *   so that their results are cached for upcoming dashboard requests.
   */
  async warmDashboards(
    options: InsightsCacheWarmupOptions = {},
  ): Promise<void> {
    const env = this.getInsightsEnvironment();

    // Offline is always treated as a no‑op for Insights jobs.
    if (env === 'offline') {
      this.logger.debug('Insights cache warmup skipped: offline environment');
      return;
    }

    if (!InsightsCacheWarmupService.ENABLED_ENVIRONMENTS.has(env)) {
      this.logger.debug(
        `Insights cache warmup skipped: INSIGHTS_ENV=${env} is not in enabled environments ${Array.from(
          InsightsCacheWarmupService.ENABLED_ENVIRONMENTS,
        ).join(', ')}`,
      );
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

    const configuredDashboards = this.getConfiguredDashboards();
    const dashboards =
      options.dashboards && options.dashboards.length > 0
        ? options.dashboards
        : configuredDashboards.length > 0
        ? configuredDashboards
        : (['taskVolume', 'slaBreaches', 'profileScore'] as const);

    if (dashboards.length === 0) {
      this.logger.warn(
        'Insights cache warmup skipped: resolved dashboard list is empty after applying options and configuration',
      );
      return;
    }

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
   *
   * Errors are logged per‑dashboard so that a failure in one dashboard does
   * not abort the entire warmup run for the organization.
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
          // service can interpret an organization‑only payload as "default range"
          // and apply its own default lookback window.
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
          // Thresholds and detailed filters are derived inside the reporting
          // service based on profiles / config; the warmup only needs to hit
          // the endpoint so that the cached aggregations are populated.
          .getSlaBreaches({ organizationId } as any)
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
          .getProfileScore({ organizationId } as any)
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

  /**
   * Reads a configured subset of dashboards to warm, if any.
   *
   * Supported sources:
   * - ENV:  INSIGHTS_CACHE_WARMUP_DASHBOARDS=taskVolume,slaBreaches,profileScore
   * - YAML: insights.cache.warmup_dashboards: ["taskVolume", "profileScore"]
   *
   * Unknown values are ignored with a warning.
   */
  private getConfiguredDashboards(): Array<
    'taskVolume' | 'slaBreaches' | 'profileScore'
  > {
    const allowed = new Set(['taskVolume', 'slaBreaches', 'profileScore']);

    const fromYaml = this.configService.get<string | string[]>(
      'insights.cache.warmup_dashboards',
    );
    const fromEnv =
      this.configService.get<string>('INSIGHTS_CACHE_WARMUP_DASHBOARDS') || '';

    let rawValues: string[] = [];

    if (Array.isArray(fromYaml)) {
      rawValues = fromYaml.map((v) => String(v));
    } else if (typeof fromYaml === 'string' && fromYaml.trim().length > 0) {
      rawValues = fromYaml.split(',');
    } else if (fromEnv.trim().length > 0) {
      rawValues = fromEnv.split(',');
    }

    const dashboards: Array<'taskVolume' | 'slaBreaches' | 'profileScore'> = [];
    const seen = new Set<string>();

    for (const raw of rawValues) {
      const value = raw.trim();
      if (!value || seen.has(value)) continue;
      if (allowed.has(value)) {
        dashboards.push(value as any);
        seen.add(value);
      } else {
        this.logger.warn(
          `Ignoring unknown dashboard identifier "${value}" in INSIGHTS_CACHE_WARMUP_DASHBOARDS / insights.cache.warmup_dashboards`,
        );
      }
    }

    return dashboards;
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
