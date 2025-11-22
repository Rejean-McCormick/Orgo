// apps/api/src/orgo/insights/patterns/pattern-detection.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Stable job IDs for pattern detection, aligned with Doc 4 – Functional
 * Code‑Name Inventory and the Insights config (Doc 6).
 */
export const INSIGHTS_WEEKLY_PATTERN_REVIEW_JOB_ID =
  'orgo.insights.weekly-pattern-review';

export const INSIGHTS_MONTHLY_TREND_REPORT_JOB_ID =
  'orgo.insights.monthly-trend-report';

export const INSIGHTS_YEARLY_SYSTEMIC_REVIEW_JOB_ID =
  'orgo.insights.yearly-systemic-review';

/**
 * Logical pattern detection frequencies supported by this service.
 */
export type PatternDetectionKind = 'weekly' | 'monthly' | 'yearly';

/**
 * Options for triggering a pattern detection run.
 *
 * In most scheduled runs, callers will simply invoke the relevant
 * method with no arguments and let this service derive organization
 * IDs and thresholds from configuration. Explicit organization IDs
 * are useful for targeted runs in tests or operations tooling.
 */
export interface PatternDetectionRunOptions {
  /**
   * One or more organization IDs to run pattern detection for.
   *
   * If omitted, this service will attempt to derive a default set
   * from configuration:
   *
   *   - INSIGHTS_PATTERN_ORG_IDS
   *   - or, as a fallback, INSIGHTS_CACHE_WARMUP_ORG_IDS
   *
   * Both are expected to be comma‑separated UUID lists.
   */
  organizationIds?: string[];

  /**
   * When true, the service only logs what it would do without actually
   * triggering any external work. This is primarily intended for dry‑run
   * tooling and operational debugging.
   */
  dryRun?: boolean;

  /**
   * Optional correlation identifier (trace ID, job run ID, etc.) that
   * will be included in log messages for easier tracing across systems.
   */
  correlationId?: string;
}

/**
 * PatternDetectionService
 *
 * Thin orchestration layer for weekly / monthly / yearly pattern detection
 * jobs in the Insights / Analytics slice.
 *
 * Responsibilities:
 *  - Derive the effective Insights environment (dev/staging/prod/offline).
 *  - Apply job‑level environment constraints from the Insights config:
 *      * weekly_pattern_review → staging + prod
 *      * monthly_trend_report → staging + prod
 *      * yearly_systemic_review → prod only
 *      * offline → always treated as no‑op
 *  - Resolve which organizations should be included in a run.
 *  - Emit structured logs that can be picked up by workers / job runners
 *    that actually implement the analytics / ETL work.
 *
 * The heavy‑weight pattern detection logic (clustering incidents, computing
 * thresholds, populating pattern tables, and creating review Cases) is
 * implemented in the analytics / ETL stack (Python + Airflow + Postgres)
 * described in the Insights documentation (Docs 6–8). Integration with
 * that stack (queue publish, HTTP call, etc.) should be wired into the
 * `runForOrganization` method.
 */
@Injectable()
export class PatternDetectionService {
  private readonly logger = new Logger(PatternDetectionService.name);

  // Environment gating follows Doc 6 §4.2:
  // - weekly_pattern_review: staging + prod
  // - monthly_trend_report:  staging + prod
  // - yearly_systemic_review: prod only
  // - offline: always no‑op
  private static readonly WEEKLY_ENABLED_ENVIRONMENTS = new Set([
    'staging',
    'prod',
  ]);
  private static readonly MONTHLY_ENABLED_ENVIRONMENTS = new Set([
    'staging',
    'prod',
  ]);
  private static readonly YEARLY_ENABLED_ENVIRONMENTS = new Set(['prod']);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Run the weekly pattern review job across one or more organizations.
   *
   * This corresponds to the `weekly_pattern_review` DAG /
   * `orgo.insights.weekly-pattern-review` job in the Insights stack.
   */
  async runWeekly(
    options: PatternDetectionRunOptions = {},
  ): Promise<void> {
    await this.run(
      'weekly',
      INSIGHTS_WEEKLY_PATTERN_REVIEW_JOB_ID,
      options,
    );
  }

  /**
   * Run the monthly trend report job across one or more organizations.
   *
   * This corresponds to the `monthly_trend_report` DAG /
   * `orgo.insights.monthly-trend-report` job.
   */
  async runMonthly(
    options: PatternDetectionRunOptions = {},
  ): Promise<void> {
    await this.run(
      'monthly',
      INSIGHTS_MONTHLY_TREND_REPORT_JOB_ID,
      options,
    );
  }

  /**
   * Run the yearly systemic review job across one or more organizations.
   *
   * This corresponds to the `yearly_systemic_review` DAG /
   * `orgo.insights.yearly-systemic-review` job.
   */
  async runYearly(
    options: PatternDetectionRunOptions = {},
  ): Promise<void> {
    await this.run(
      'yearly',
      INSIGHTS_YEARLY_SYSTEMIC_REVIEW_JOB_ID,
      options,
    );
  }

  /**
   * Shared implementation for weekly/monthly/yearly runs.
   */
  private async run(
    kind: PatternDetectionKind,
    jobId: string,
    options: PatternDetectionRunOptions,
  ): Promise<void> {
    const environment = this.getInsightsEnvironment();

    if (!this.isEnvironmentEnabled(kind, environment)) {
      this.logger.debug(
        `Skipping ${kind} pattern detection (${jobId}) in environment "${environment}" – job disabled for this environment.`,
      );
      return;
    }

    const organizationIds =
      options.organizationIds && options.organizationIds.length > 0
        ? this.normalizeOrganizationIds(options.organizationIds)
        : this.getConfiguredOrganizationIds();

    if (organizationIds.length === 0) {
      this.logger.warn(
        `No organization IDs resolved for ${kind} pattern detection (${jobId}); nothing to do.`,
      );
      return;
    }

    const prefix = options.dryRun ? '[DRY RUN] ' : '';
    const correlationSuffix = options.correlationId
      ? `, correlationId=${options.correlationId}`
      : '';

    this.logger.log(
      `${prefix}Starting ${kind} pattern detection (${jobId}) for ${organizationIds.length} organization(s) in environment "${environment}"${correlationSuffix}.`,
    );

    for (const organizationId of organizationIds) {
      await this.runForOrganization(
        kind,
        jobId,
        environment,
        organizationId,
        options,
      );
    }

    this.logger.log(
      `${prefix}Finished ${kind} pattern detection (${jobId}) for ${organizationIds.length} organization(s) in environment "${environment}"${correlationSuffix}.`,
    );
  }

  /**
   * Orchestrates pattern detection for a single organization.
   *
   * In the current NestJS implementation this method is intentionally
   * conservative and only performs structured logging. The actual
   * implementation of pattern detection is expected to be handled by
   * the analytics / ETL workers (e.g. via a queue, scheduler, or
   * Airflow trigger) that integrate with this orchestration layer.
   *
   * When wiring in a concrete integration, this is the place to:
   *  - Enqueue a job for the ETL worker.
   *  - Call an HTTP endpoint on the analytics service.
   *  - Publish a message to a queue/topic that ETL listens on.
   */
  private async runForOrganization(
    kind: PatternDetectionKind,
    jobId: string,
    environment: string,
    organizationId: string,
    options: PatternDetectionRunOptions,
  ): Promise<void> {
    const prefix = options.dryRun ? '[DRY RUN] ' : '';
    const correlationSuffix = options.correlationId
      ? `, correlationId=${options.correlationId}`
      : '';

    this.logger.debug(
      `${prefix}Triggering ${kind} pattern detection (${jobId}) for organization=${organizationId} in env=${environment}${correlationSuffix}.`,
    );

    // NOTE:
    //  - The heavy lifting (reading from insights.fact_* tables, applying
    //    pattern windows and thresholds from patterns.yaml / profiles, and
    //    writing to pattern tables or creating review Cases) is performed
    //    by the analytics / ETL layer.
    //  - To avoid coupling this NestJS service to a particular ETL mechanism,
    //    we only handle orchestration concerns here. Integrations should be
    //    implemented by extending this method with queue/HTTP calls as needed.
  }

  /**
   * Derives the current Insights environment.
   *
   * Prefers the explicit INSIGHTS_ENV (as defined in the Insights module
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
   * Determines whether a given pattern detection kind is allowed to run
   * in the specified environment.
   */
  private isEnvironmentEnabled(
    kind: PatternDetectionKind,
    environment: string,
  ): boolean {
    const env = (environment || 'dev').toLowerCase();

    // Offline is always treated as no‑op for Insights jobs.
    if (env === 'offline') {
      return false;
    }

    switch (kind) {
      case 'weekly':
        return PatternDetectionService.WEEKLY_ENABLED_ENVIRONMENTS.has(
          env,
        );
      case 'monthly':
        return PatternDetectionService.MONTHLY_ENABLED_ENVIRONMENTS.has(
          env,
        );
      case 'yearly':
        return PatternDetectionService.YEARLY_ENABLED_ENVIRONMENTS.has(
          env,
        );
      default:
        return false;
    }
  }

  /**
   * Normalises a user‑provided list of organization IDs:
   *  - trims whitespace
   *  - drops empty entries
   *  - de‑duplicates while preserving order
   */
  private normalizeOrganizationIds(
    organizationIds: string[],
  ): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const raw of organizationIds) {
      const value = (raw ?? '').trim();
      if (!value || seen.has(value)) {
        continue;
      }
      seen.add(value);
      result.push(value);
    }

    return result;
  }

  /**
   * Reads the default set of organization IDs to run pattern detection for.
   *
   * By convention this is supplied via:
   *   - INSIGHTS_PATTERN_ORG_IDS
   *   - or, if not set, INSIGHTS_CACHE_WARMUP_ORG_IDS
   *
   * Both are expected to be comma‑separated lists of UUIDs.
   */
  private getConfiguredOrganizationIds(): string[] {
    const raw =
      this.configService.get<string>('INSIGHTS_PATTERN_ORG_IDS') ||
      process.env.INSIGHTS_PATTERN_ORG_IDS ||
      this.configService.get<string>('INSIGHTS_CACHE_WARMUP_ORG_IDS') ||
      process.env.INSIGHTS_CACHE_WARMUP_ORG_IDS ||
      '';

    return raw
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }
}
