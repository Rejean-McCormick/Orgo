// apps/api/src/orgo/insights/pattern-detection.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { ModuleRef } from '@nestjs/core';

import { OrgProfileService } from '../config/org-profile.service';
import { OrgoConfigService } from '../config/config.service';
import type { Environment } from '../core/metrics/metrics.service';
import { CaseService } from '../core/cases/case.service';

export type PatternDetectionKind = 'weekly' | 'monthly' | 'yearly';

export interface PatternDetectionRunOptions {
  /**
   * Optional fixed list of organization IDs to run against.
   * When omitted, falls back to INSIGHTS_PATTERN_ORG_IDS or
   * INSIGHTS_CACHE_WARMUP_ORG_IDS.
   */
  organizationIds?: string[];

  /**
   * Optional domain hint (e.g. "safety", "hr") that can be used by
   * downstream pattern logic or Airflow DAGs for scoping.
   */
  domainHint?: string;

  /**
   * Reference date for the pattern window. Defaults to "today" (UTC).
   */
  referenceDate?: Date | string;

  /**
   * When true, the service only logs which Cases would be created
   * instead of mutating state.
   */
  dryRun?: boolean;
}

export interface PatternDetectionRunParams extends PatternDetectionRunOptions {
  jobId: string;
}

interface ResolvedPatternWindowConfig {
  kind: PatternDetectionKind;
  windowDays: number;
  incidentFrequencyMinEvents: number;
  crossDepartmentMinEvents: number;
  crossDepartmentMinDistinctBases: number;
  highRiskMinEvents: number;
}

type PatternType =
  | 'incident_frequency'
  | 'cross_department_trends'
  | 'high_risk_indicator';

interface DetectedPattern {
  organizationId: string;
  patternType: PatternType;
  label: string | null;
  categoryCode?: string | null;
  severity?: string | null;
  incidentCount: number;
  distinctBases?: number;
  windowStartDateKey: string;
  windowEndDateKey: string;
}

@Injectable()
export class PatternDetectionService {
  private readonly logger = new Logger(PatternDetectionService.name);

  /**
   * Only these environments will actually execute pattern detection.
   * Others will short-circuit to avoid hammering production data
   * from dev shells.
   */
  private readonly enabledEnvironments: ReadonlySet<Environment> =
    new Set<Environment>(['staging', 'prod']);

  constructor(
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    private readonly orgProfileService: OrgProfileService,
    private readonly orgoConfigService: OrgoConfigService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /* ------------------------------------------------------------------------ */
  /*  Public entrypoints – scheduled by workers / Airflow                     */
  /* ------------------------------------------------------------------------ */

  async runWeekly(options: PatternDetectionRunOptions = {}): Promise<void> {
    const params: PatternDetectionRunParams = {
      ...options,
      jobId: 'orgo.insights.weekly-pattern-review',
    };
    await this.run('weekly', params);
  }

  async runMonthly(options: PatternDetectionRunOptions = {}): Promise<void> {
    const params: PatternDetectionRunParams = {
      ...options,
      jobId: 'orgo.insights.monthly-trend-report',
    };
    await this.run('monthly', params);
  }

  async runYearly(options: PatternDetectionRunOptions = {}): Promise<void> {
    const params: PatternDetectionRunParams = {
      ...options,
      jobId: 'orgo.insights.yearly-systemic-review',
    };
    await this.run('yearly', params);
  }

  /* ------------------------------------------------------------------------ */
  /*  Orchestration                                                           */
  /* ------------------------------------------------------------------------ */

  private async run(
    kind: PatternDetectionKind,
    params: PatternDetectionRunParams,
  ): Promise<void> {
    const environment = this.getInsightsEnvironment();

    if (!this.enabledEnvironments.has(environment)) {
      this.logger.warn(
        `Pattern detection (${kind}) skipped – environment "${environment}" is not enabled.`,
      );
      return;
    }

    if (environment === 'offline') {
      this.logger.debug(
        `Pattern detection (${kind}) skipped – offline environment.`,
      );
      return;
    }

    const organizationIds = this.resolveOrganizationIds(params);
    if (organizationIds.length === 0) {
      this.logger.warn(
        `Pattern detection (${kind}) skipped – no organization IDs configured.`,
      );
      return;
    }

    const referenceDate = this.normalizeReferenceDate(params.referenceDate);

    for (const organizationId of organizationIds) {
      await this.runForOrganization(kind, {
        ...params,
        organizationId,
        environment,
        referenceDate,
      });
    }
  }

  private async runForOrganization(
    kind: PatternDetectionKind,
    params: PatternDetectionRunParams & {
      organizationId: string;
      environment: Environment;
      referenceDate: Date;
    },
  ): Promise<void> {
    const { organizationId, environment, jobId, dryRun, domainHint } = params;

    // Load Insights config (patterns section) and behaviour profile.
    // Handle both shapes:
    //  - getInsightsConfig() returning the module slice directly
    //  - or a wrapper with `.insights` root.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insightsConfigWrapper = this.orgoConfigService.getInsightsConfig() as any;
    const insightsRoot =
      insightsConfigWrapper?.insights ?? insightsConfigWrapper ?? null;
    const patternsConfig = insightsRoot?.patterns ?? null;

    // Behaviour profile (Doc 7).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let profileTemplate: any | null = null;
    try {
      const resolvedProfile = await this.orgProfileService.loadProfile(
        organizationId,
      );
      profileTemplate = (resolvedProfile as any)?.template ?? null;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? '');
      this.logger.warn(
        `Pattern detection (${kind}) – failed to load behaviour profile for org "${organizationId}": ${message}. Continuing with Insights config only.`,
      );
    }

    const windowConfig = this.resolveWindowConfig(
      kind,
      profileTemplate,
      patternsConfig,
    );

    const { fromDateKey, toDateKey } = this.computeWindowDateKeys(
      windowConfig.windowDays,
      params.referenceDate,
    );

    this.logger.log(
      `Pattern detection (${kind}) started for org="${organizationId}" [env=${environment}, window=${fromDateKey}..${toDateKey}, dryRun=${!!dryRun}]`,
    );

    const patterns: DetectedPattern[] = [];

    // 1) Incident frequency (short-window clusters)
    const incidentPatterns = await this.detectIncidentFrequencyPatterns({
      organizationId,
      fromDateKey,
      toDateKey,
      windowConfig,
    });
    patterns.push(...incidentPatterns);

    // 2) Cross-department trends (horizontal spread across bases)
    const crossDeptEnabled =
      profileTemplate?.cyclic_overview?.threshold_triggers
        ?.cross_departmental_trends ?? true;

    if (crossDeptEnabled) {
      const crossDepartmentPatterns = await this.detectCrossDepartmentTrends({
        organizationId,
        fromDateKey,
        toDateKey,
        windowConfig,
      });
      patterns.push(...crossDepartmentPatterns);
    }

    // 3) High-risk indicators (safety / HR / clinical)
    const highRiskEnabled =
      profileTemplate?.cyclic_overview?.threshold_triggers
        ?.high_risk_indicators ?? true;

    if (highRiskEnabled) {
      const highRiskPatterns = await this.detectHighRiskIndicators({
        organizationId,
        fromDateKey,
        toDateKey,
        windowConfig,
      });
      patterns.push(...highRiskPatterns);
    }

    if (patterns.length === 0) {
      this.logger.log(
        `Pattern detection (${kind}) finished for org="${organizationId}" – no patterns above thresholds in window ${fromDateKey}..${toDateKey}.`,
      );
      return;
    }

    await this.materialisePatterns(
      kind,
      {
        organizationId,
        environment,
        jobId,
        dryRun: !!dryRun,
        domainHint,
      },
      patterns,
    );

    this.logger.log(
      `Pattern detection (${kind}) finished for org="${organizationId}" – ${patterns.length} pattern(s) detected in window ${fromDateKey}..${toDateKey}.`,
    );
  }

  /* ------------------------------------------------------------------------ */
  /*  Detection primitives (SQL over insights.fact_* tables)                  */
  /* ------------------------------------------------------------------------ */

  private async detectIncidentFrequencyPatterns(args: {
    organizationId: string;
    fromDateKey: string;
    toDateKey: string;
    windowConfig: ResolvedPatternWindowConfig;
  }): Promise<DetectedPattern[]> {
    const { organizationId, fromDateKey, toDateKey, windowConfig } = args;
    const minEvents = windowConfig.incidentFrequencyMinEvents;

    if (!Number.isFinite(minEvents) || minEvents <= 0) {
      return [];
    }

    const sql = `
      SELECT
        dc.label AS label,
        dc.severity AS severity,
        COUNT(*)::int AS incident_count,
        COUNT(DISTINCT split_part(dc.label, '.', 1))::int AS distinct_bases
      FROM insights.fact_cases fc
      JOIN insights.dim_cases dc
        ON fc.case_id = dc.case_id
      WHERE fc.organization_id = $1
        AND fc.opened_date_key >= $2
        AND fc.opened_date_key <= $3
      GROUP BY dc.label, dc.severity
      HAVING COUNT(*) >= $4
      ORDER BY incident_count DESC
      LIMIT 100;
    `;

    const rows =
      (await this.dataSource.query(sql, [
        organizationId,
        fromDateKey,
        toDateKey,
        minEvents,
      ])) ?? [];

    return rows.map(
      (row: any): DetectedPattern => ({
        organizationId,
        patternType: 'incident_frequency',
        label: row.label ?? null,
        severity: row.severity ?? null,
        incidentCount: Number(row.incident_count ?? 0),
        distinctBases:
          row.distinct_bases !== undefined && row.distinct_bases !== null
            ? Number(row.distinct_bases)
            : undefined,
        windowStartDateKey: fromDateKey,
        windowEndDateKey: toDateKey,
      }),
    );
  }

  private async detectCrossDepartmentTrends(args: {
    organizationId: string;
    fromDateKey: string;
    toDateKey: string;
    windowConfig: ResolvedPatternWindowConfig;
  }): Promise<DetectedPattern[]> {
    const { organizationId, fromDateKey, toDateKey, windowConfig } = args;
    const minEvents = windowConfig.crossDepartmentMinEvents;
    const minDistinctBases = windowConfig.crossDepartmentMinDistinctBases;

    if (
      !Number.isFinite(minEvents) ||
      minEvents <= 0 ||
      !Number.isFinite(minDistinctBases) ||
      minDistinctBases <= 1
    ) {
      return [];
    }

    const sql = `
      SELECT
        split_part(dc.label, '.', 2) AS category_code,
        COUNT(*)::int AS incident_count,
        COUNT(DISTINCT split_part(dc.label, '.', 1))::int AS distinct_bases
      FROM insights.fact_cases fc
      JOIN insights.dim_cases dc
        ON fc.case_id = dc.case_id
      WHERE fc.organization_id = $1
        AND fc.opened_date_key >= $2
        AND fc.opened_date_key <= $3
      GROUP BY split_part(dc.label, '.', 2)
      HAVING COUNT(*) >= $4
         AND COUNT(DISTINCT split_part(dc.label, '.', 1)) >= $5
      ORDER BY incident_count DESC
      LIMIT 100;
    `;

    const rows =
      (await this.dataSource.query(sql, [
        organizationId,
        fromDateKey,
        toDateKey,
        minEvents,
        minDistinctBases,
      ])) ?? [];

    return rows.map(
      (row: any): DetectedPattern => ({
        organizationId,
        patternType: 'cross_department_trends',
        label:
          row.category_code != null ? `*.${row.category_code}.*` : null,
        categoryCode: row.category_code ?? null,
        incidentCount: Number(row.incident_count ?? 0),
        distinctBases:
          row.distinct_bases !== undefined && row.distinct_bases !== null
            ? Number(row.distinct_bases)
            : undefined,
        windowStartDateKey: fromDateKey,
        windowEndDateKey: toDateKey,
      }),
    );
  }

  private async detectHighRiskIndicators(args: {
    organizationId: string;
    fromDateKey: string;
    toDateKey: string;
    windowConfig: ResolvedPatternWindowConfig;
  }): Promise<DetectedPattern[]> {
    const { organizationId, fromDateKey, toDateKey, windowConfig } = args;
    const minEvents = windowConfig.highRiskMinEvents;

    if (!Number.isFinite(minEvents) || minEvents <= 0) {
      return [];
    }

    const sql = `
      SELECT
        dc.label AS label,
        dc.severity AS severity,
        COUNT(*)::int AS incident_count,
        COUNT(DISTINCT split_part(dc.label, '.', 1))::int AS distinct_bases
      FROM insights.fact_cases fc
      JOIN insights.dim_cases dc
        ON fc.case_id = dc.case_id
      WHERE fc.organization_id = $1
        AND fc.opened_date_key >= $2
        AND fc.opened_date_key <= $3
        AND dc.severity IN ('MAJOR', 'CRITICAL')
      GROUP BY dc.label, dc.severity
      HAVING COUNT(*) >= $4
      ORDER BY incident_count DESC
      LIMIT 100;
    `;

    const rows =
      (await this.dataSource.query(sql, [
        organizationId,
        fromDateKey,
        toDateKey,
        minEvents,
      ])) ?? [];

    return rows.map(
      (row: any): DetectedPattern => ({
        organizationId,
        patternType: 'high_risk_indicator',
        label: row.label ?? null,
        severity: row.severity ?? null,
        incidentCount: Number(row.incident_count ?? 0),
        distinctBases:
          row.distinct_bases !== undefined && row.distinct_bases !== null
            ? Number(row.distinct_bases)
            : undefined,
        windowStartDateKey: fromDateKey,
        windowEndDateKey: toDateKey,
      }),
    );
  }

  /* ------------------------------------------------------------------------ */
  /*  Materialisation – turn patterns into work (Cases)                       */
  /* ------------------------------------------------------------------------ */

  private async materialisePatterns(
    kind: PatternDetectionKind,
    context: {
      organizationId: string;
      environment: Environment;
      jobId: string;
      dryRun?: boolean;
      domainHint?: string;
    },
    patterns: DetectedPattern[],
  ): Promise<void> {
    if (!patterns.length) {
      return;
    }

    const { organizationId, environment, jobId, dryRun, domainHint } = context;

    let caseService: CaseService | null = null;
    try {
      caseService = this.moduleRef.get(CaseService, { strict: false });
    } catch {
      caseService = null;
    }

    const isDryRun = !!dryRun || !caseService;

    for (const pattern of patterns) {
      const title = this.buildCaseTitle(kind, pattern);
      const description = this.buildCaseDescription(kind, pattern, {
        environment,
        jobId,
        domainHint,
      });

      if (!isDryRun && caseService) {
        try {
          // We deliberately pass "insight" as the source type; the CaseService
          // normalises this to the canonical TASK_SOURCE internally.
          const result = await (caseService as any).createCaseFromSignal({
            organizationId,
            sourceType: 'insight',
            label: this.buildCaseLabel(pattern),
            title,
            description,
            severity:
              pattern.severity ??
              this.inferCaseSeverity(
                pattern.patternType,
                pattern.incidentCount,
              ),
            metadata: {
              patternType: pattern.patternType,
              incidentCount: pattern.incidentCount,
              distinctBases: pattern.distinctBases ?? null,
              windowStartDateKey: pattern.windowStartDateKey,
              windowEndDateKey: pattern.windowEndDateKey,
              categoryCode: pattern.categoryCode ?? null,
              jobId,
              environment,
              domainHint: domainHint ?? null,
            },
          });

          if (!result || result.ok === false) {
            const errorCode = result?.error?.code ?? 'unknown';
            const errorMessage = result?.error?.message ?? 'Unknown error';
            this.logger.warn(
              `Pattern detection (${kind}) failed to create Case for pattern ${pattern.patternType} (label=${pattern.label ?? pattern.categoryCode ?? 'n/a'}): ${errorCode} – ${errorMessage}`,
            );
          }
        } catch (err) {
          const error = err as Error;
          this.logger.error(
            `Pattern detection (${kind}) threw while creating Case for pattern ${pattern.patternType}: ${error.message}`,
            error.stack,
          );
        }
      } else {
        this.logger.log(
          `[DRY RUN] Pattern detection (${kind}) would create Case for ${pattern.patternType} (org=${organizationId}, label=${pattern.label ?? pattern.categoryCode ?? 'n/a'}, incidents=${pattern.incidentCount}).`,
        );
      }
    }
  }

  private buildCaseTitle(
    kind: PatternDetectionKind,
    pattern: DetectedPattern,
  ): string {
    const labelOrCategory = pattern.label ?? pattern.categoryCode ?? 'pattern';

    switch (pattern.patternType) {
      case 'incident_frequency':
        return `[${kind}] Incident frequency pattern for ${labelOrCategory}`;
      case 'cross_department_trends':
        return `[${kind}] Cross-department trend for category ${labelOrCategory}`;
      case 'high_risk_indicator':
        return `[${kind}] High-risk pattern for ${labelOrCategory}`;
      default:
        return `[${kind}] Pattern detected for ${labelOrCategory}`;
    }
  }

  private buildCaseDescription(
    kind: PatternDetectionKind,
    pattern: DetectedPattern,
    context: { environment: Environment; jobId: string; domainHint?: string },
  ): string {
    const parts: string[] = [
      `Pattern type: ${pattern.patternType}`,
      `Organization: ${pattern.organizationId}`,
      `Window: ${pattern.windowStartDateKey} to ${pattern.windowEndDateKey}`,
      `Incidents in window: ${pattern.incidentCount}`,
    ];

    if (pattern.distinctBases != null) {
      parts.push(`Distinct bases: ${pattern.distinctBases}`);
    }
    if (pattern.label) {
      parts.push(`Source label: ${pattern.label}`);
    }
    if (pattern.categoryCode) {
      parts.push(`Category code: ${pattern.categoryCode}`);
    }
    if (pattern.severity) {
      parts.push(`Representative severity: ${pattern.severity}`);
    }

    parts.push(
      `Run kind: ${kind}`,
      `Environment: ${context.environment}`,
      `Job: ${context.jobId}`,
    );

    if (context.domainHint) {
      parts.push(`Domain hint: ${context.domainHint}`);
    }

    return parts.join('\n');
  }

  private buildCaseLabel(pattern: DetectedPattern): string {
    const rawLabel = pattern.label ?? '';
    const parts = rawLabel.split('.').filter((p) => p.length > 0);
    const categoryFromLabel =
      parts.length > 1 ? parts[1] : pattern.categoryCode ?? '94';
    const horizontalFromLabel =
      parts.length > 2 ? parts.slice(2).join('.') : 'Operations.Safety';

    switch (pattern.patternType) {
      case 'incident_frequency':
        // Department-level "audit" case for recurring incidents.
        return `11.${categoryFromLabel}.${horizontalFromLabel}.Audit`;
      case 'cross_department_trends':
        // Leadership-level review case capturing cross-department spread.
        return `2.${categoryFromLabel}.Leadership.Review`;
      case 'high_risk_indicator':
        // High-risk patterns escalate to leadership with review semantics.
        return `2.${categoryFromLabel}.${horizontalFromLabel}.Review`;
      default:
        return rawLabel || `11.${categoryFromLabel}.Patterns.CyclicOverview`;
    }
  }

  private inferCaseSeverity(
    patternType: PatternType,
    incidentCount: number,
  ): string {
    switch (patternType) {
      case 'high_risk_indicator':
        return incidentCount >= 2 ? 'CRITICAL' : 'MAJOR';
      case 'cross_department_trends':
        return 'MAJOR';
      case 'incident_frequency':
      default:
        return incidentCount >= 10 ? 'MAJOR' : 'MODERATE';
    }
  }

  /* ------------------------------------------------------------------------ */
  /*  Configuration helpers                                                   */
  /* ------------------------------------------------------------------------ */

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private resolveWindowConfig(
    kind: PatternDetectionKind,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profileTemplate: any | null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    patternsConfig: any | null,
  ): ResolvedPatternWindowConfig {
    // Config-backed defaults from insights.config.yaml
    const baseCfg = patternsConfig?.[kind] ?? {};
    const baseWindowDays: number =
      typeof baseCfg.window_days === 'number'
        ? baseCfg.window_days
        : kind === 'weekly'
        ? 28
        : kind === 'monthly'
        ? 180
        : 730;

    const baseMinEvents: number =
      typeof baseCfg.min_events === 'number'
        ? baseCfg.min_events
        : kind === 'weekly'
        ? 3
        : kind === 'monthly'
        ? 5
        : 10;

    const baseMinDistinctSources: number =
      typeof baseCfg.min_distinct_sources === 'number'
        ? baseCfg.min_distinct_sources
        : kind === 'weekly'
        ? 1
        : kind === 'monthly'
        ? 2
        : 3;

    const incidentCfg =
      profileTemplate?.cyclic_overview?.threshold_triggers
        ?.incident_frequency;

    const profileWindowDays: number | undefined =
      typeof incidentCfg?.window_days === 'number'
        ? incidentCfg.window_days
        : typeof profileTemplate?.pattern_window_days === 'number'
        ? profileTemplate.pattern_window_days
        : undefined;

    const profileMinEvents: number | undefined =
      typeof incidentCfg?.min_events === 'number'
        ? incidentCfg.min_events
        : typeof profileTemplate?.pattern_min_events === 'number'
        ? profileTemplate.pattern_min_events
        : undefined;

    const windowDays = profileWindowDays ?? baseWindowDays;
    const incidentFrequencyMinEvents = profileMinEvents ?? baseMinEvents;

    const crossDepartmentMinEvents = incidentFrequencyMinEvents;
    const crossDepartmentMinDistinctBases = baseMinDistinctSources;

    const highRiskMinEvents = Math.max(
      1,
      Math.min(incidentFrequencyMinEvents, 3),
    );

    return {
      kind,
      windowDays,
      incidentFrequencyMinEvents,
      crossDepartmentMinEvents,
      crossDepartmentMinDistinctBases,
      highRiskMinEvents,
    };
  }

  private normalizeReferenceDate(input?: Date | string): Date {
    if (!input) {
      const now = new Date();
      now.setUTCHours(0, 0, 0, 0);
      return now;
    }

    if (input instanceof Date) {
      const copy = new Date(input);
      copy.setUTCHours(0, 0, 0, 0);
      return copy;
    }

    const parsed = new Date(input);
    if (Number.isNaN(parsed.getTime())) {
      const fallback = new Date();
      fallback.setUTCHours(0, 0, 0, 0);
      return fallback;
    }

    parsed.setUTCHours(0, 0, 0, 0);
    return parsed;
  }

  private computeWindowDateKeys(
    windowDays: number,
    referenceDate?: Date | string,
  ): { fromDateKey: string; toDateKey: string } {
    const end = this.normalizeReferenceDate(referenceDate);
    const start = new Date(end);
    start.setUTCDate(end.getUTCDate() - Math.max(windowDays - 1, 0));

    return {
      fromDateKey: this.formatDateKey(start),
      toDateKey: this.formatDateKey(end),
    };
  }

  private formatDateKey(date: Date): string {
    const year = date.getUTCFullYear();
    const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
    const day = `${date.getUTCDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private getInsightsEnvironment(): Environment {
    const explicitEnv =
      this.configService.get<string>('INSIGHTS_ENV') ??
      this.configService.get<string>('INSIGHTS_ENVIRONMENT');
    const globalEnv =
      this.configService.get<string>('ENVIRONMENT') ??
      this.configService.get<string>('NODE_ENV');

    const raw = (explicitEnv || globalEnv || 'dev').toLowerCase();

    if (raw === 'production' || raw === 'prod') {
      return 'prod';
    }

    if (raw === 'staging' || raw === 'stage') {
      return 'staging';
    }

    if (raw === 'offline') {
      return 'offline';
    }

    return 'dev';
  }

  private resolveOrganizationIds(
    options: PatternDetectionRunOptions,
  ): string[] {
    if (options.organizationIds && options.organizationIds.length > 0) {
      return this.normalizeOrganizationIds(options.organizationIds);
    }

    return this.getConfiguredOrganizationIds();
  }

  private normalizeOrganizationIds(ids: string[]): string[] {
    const result = new Set<string>();

    for (const id of ids) {
      const trimmed = (id ?? '').trim();
      if (trimmed.length > 0) {
        result.add(trimmed);
      }
    }

    return Array.from(result);
  }

  private getConfiguredOrganizationIds(): string[] {
    const explicit = this.configService.get<string>('INSIGHTS_PATTERN_ORG_IDS');

    if (explicit && explicit.trim().length > 0) {
      return this.normalizeOrganizationIds(explicit.split(','));
    }

    const warmup = this.configService.get<string>(
      'INSIGHTS_CACHE_WARMUP_ORG_IDS',
    );

    if (warmup && warmup.trim().length > 0) {
      return this.normalizeOrganizationIds(warmup.split(','));
    }

    return [];
  }
}
