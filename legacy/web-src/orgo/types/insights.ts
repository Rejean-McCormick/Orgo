/**
 * Orgo v3 – Insights / Analytics Type Definitions
 *
 * This file models:
 * - Canonical enums reused in the Insights slice
 * - The /config/insights/config.yaml structure
 * - Star-schema dimensions and fact tables in the `insights.*` schema
 *
 * All enums and shapes are aligned with the v3 spec documents.
 */

/* -------------------------------------------------------------------------- */
/*  Common primitive aliases                                                   */
/* -------------------------------------------------------------------------- */

export type UUID = string;

/**
 * ISO-8601 timestamp in UTC, e.g. "2025-11-18T10:30:00Z".
 */
export type IsoDateTimeString = string;

/**
 * ISO-8601 calendar date, e.g. "2025-03-14".
 */
export type IsoDateString = string;

/* -------------------------------------------------------------------------- */
/*  Core enums used by Insights (mirroring canonical enums)                   */
/* -------------------------------------------------------------------------- */

/**
 * Global deployment environments.
 */
export type Environment = 'dev' | 'staging' | 'prod' | 'offline';

/**
 * Task lifecycle status in analytics and operational views.
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
 * Task priority.
 */
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/**
 * Task / Case severity.
 */
export type TaskSeverity = 'MINOR' | 'MODERATE' | 'MAJOR' | 'CRITICAL';

/**
 * Visibility of a task/case/event.
 */
export type Visibility = 'PUBLIC' | 'INTERNAL' | 'RESTRICTED' | 'ANONYMISED';

/**
 * Operational source of a task/case.
 */
export type TaskSource = 'email' | 'api' | 'manual' | 'sync';

/**
 * Case lifecycle status used in analytics.
 */
export type CaseStatus = 'open' | 'in_progress' | 'resolved' | 'archived';

/**
 * Notification channel enum values as used in analytics/export config.
 */
export type NotificationChannel = 'email' | 'sms' | 'in_app' | 'webhook';

/**
 * Notification scope, as used in profiles and reporting.
 */
export type NotificationScope = 'user' | 'team' | 'department' | 'org_wide';

/* -------------------------------------------------------------------------- */
/*  Profile keys (as referenced from Insights patterns config)                */
/* -------------------------------------------------------------------------- */

/**
 * Known profile keys from the profiles YAML.
 *
 * Additional profile keys may be added in the YAML; consumers should still
 * accept arbitrary strings where forward compatibility is needed.
 */
export type ProfileKey =
  | 'default'
  | 'friend_group'
  | 'hospital'
  | 'advocacy_group'
  | 'retail_chain'
  | 'military_organization'
  | 'environmental_group'
  | 'artist_collective';

/* -------------------------------------------------------------------------- */
/*  Insights config: /config/insights/config.yaml (insights: subtree)         */
/* -------------------------------------------------------------------------- */

/**
 * Warehouse types supported by the Insights slice.
 */
export type InsightsWarehouseType = 'postgres' | 'bigquery' | 'snowflake';

export interface InsightsWarehouseConfig {
  type: InsightsWarehouseType;
  connection_url: string;
  schema: string;
  read_only_user: string;
  write_user: string;
}

export interface InsightsEtlConfig {
  owner_email: string;
  default_batch_size: number;
  max_batch_size: number;
  concurrency: number;
}

export interface InsightsCacheTtlSeconds {
  dashboard_default: number;
  dashboard_slow: number;
  streaming_like: number;
}

export interface InsightsCacheMaxKeysPerDashboard {
  dev?: number;
  staging?: number;
  prod?: number;
  offline?: number;
}

export interface InsightsCacheConfig {
  backend: 'redis';
  url: string;
  ttl_seconds: InsightsCacheTtlSeconds;
  max_keys_per_dashboard: InsightsCacheMaxKeysPerDashboard;
}

/**
 * Per-environment numeric config slice, where not all environments
 * must be explicitly defined in YAML.
 */
export type PerEnvironmentNumber = Partial<Record<Exclude<Environment, 'offline'>, number>>;

export interface InsightsRetentionConfig {
  raw_event_retention_days: PerEnvironmentNumber;
  aggregated_retention_days: PerEnvironmentNumber;
  pattern_result_retention_days: PerEnvironmentNumber;
}

export interface InsightsBackupSlice {
  rpo_minutes: PerEnvironmentNumber;
  rto_minutes: PerEnvironmentNumber;
}

export interface InsightsExportLimitsPerEnvironment {
  dev?: number;
  staging?: number;
  prod?: number;
}

export interface InsightsExportConfig {
  max_rows_per_export: InsightsExportLimitsPerEnvironment;
  max_parallel_exports_per_user: InsightsExportLimitsPerEnvironment;
  pii_masking_enabled: boolean;
  allowed_visibilities: Visibility[];
}

/**
 * Sliding-window settings for pattern detection at a given cadence
 * (weekly / monthly / yearly).
 */
export interface InsightsPatternWindowConfig {
  window_days: number;
  min_events: number;
  min_distinct_sources: number;
}

/**
 * Pattern configuration, including profile selection by domain.
 */
export interface InsightsPatternsConfig {
  /**
   * Profile key to use when no domain-specific override applies.
   */
  default_profile_key: ProfileKey | string;

  /**
   * Mapping from Task.type (e.g. "maintenance", "hr_case") to profile key.
   */
  overrides_by_domain?: Record<string, ProfileKey | string>;

  weekly: InsightsPatternWindowConfig;
  monthly: InsightsPatternWindowConfig;
  yearly: InsightsPatternWindowConfig;
}

/**
 * Root of the /config/insights/config.yaml "insights" subtree.
 *
 * Note: some deployments may wrap this under a top-level `{ insights: InsightsConfig }`.
 */
export interface InsightsConfig {
  environment: Environment;
  warehouse: InsightsWarehouseConfig;
  etl: InsightsEtlConfig;
  cache: InsightsCacheConfig;
  retention: InsightsRetentionConfig;
  backups: InsightsBackupSlice;
  exports: InsightsExportConfig;
  patterns: InsightsPatternsConfig;
}

/* -------------------------------------------------------------------------- */
/*  Star-schema dimensions: insights.dim_*                                    */
/* -------------------------------------------------------------------------- */

/**
 * Calendar/date dimension row.
 */
export interface InsightsDimDate {
  date_key: IsoDateString; // e.g. "2025-03-14"
  year: number;
  quarter: number; // 1–4
  month: number; // 1–12
  month_name: string;
  week_of_year: number;
  day_of_week: number; // 1=Monday–7=Sunday
  day_name: string;
  is_weekend: boolean;
}

/**
 * Organization dimension row (analytics view over organizations).
 */
export interface InsightsDimOrganization {
  organization_id: UUID;
  slug: string;
  display_name: string;
  org_type: string | null;
  timezone: string;
  active_from: IsoDateString;
  active_to: IsoDateString | null;
}

/**
 * Task dimension row (denormalized task view).
 */
export interface InsightsDimTask {
  task_id: UUID;
  organization_id: UUID;
  case_id: UUID | null;

  label: string;
  type: string;
  category: string;
  subtype: string | null;

  priority: TaskPriority;
  severity: TaskSeverity;
  visibility: Visibility;
  source: TaskSource;

  assignee_role: string | null;

  created_at: IsoDateTimeString;
  closed_at: IsoDateTimeString | null;

  current_status: TaskStatus;
}

/**
 * Case dimension row (denormalized case view).
 */
export interface InsightsDimCase {
  case_id: UUID;
  organization_id: UUID;

  label: string;
  title: string;
  status: CaseStatus;
  severity: TaskSeverity;

  origin_vertical_level: number;
  origin_role: string;

  opened_at: IsoDateTimeString;
  closed_at: IsoDateTimeString | null;
}

/**
 * Person dimension row (analytics view over person_profiles).
 */
export type PersonConfidentialityLevel = 'normal' | 'sensitive' | 'highly_sensitive';

export interface InsightsDimPerson {
  person_id: UUID;
  organization_id: UUID;
  full_name: string;
  external_reference: string | null;
  confidentiality_level: PersonConfidentialityLevel;
}

/**
 * Learning group (class/team/group) dimension row.
 */
export interface InsightsDimLearningGroup {
  learning_group_id: UUID;
  organization_id: UUID;
  code: string;
  name: string;
  category: string;
}

/* -------------------------------------------------------------------------- */
/*  Star-schema fact tables: insights.fact_*                                  */
/* -------------------------------------------------------------------------- */

/**
 * Task fact row – core lifecycle metrics used in reporting.
 */
export interface InsightsFactTask {
  id: number; // bigserial in DB
  task_id: UUID;
  organization_id: UUID;

  created_date_key: IsoDateString;
  closed_date_key: IsoDateString | null;

  current_status: TaskStatus;
  priority: TaskPriority;
  severity: TaskSeverity;
  source: TaskSource;

  time_to_first_response_seconds: number | null;
  time_to_completion_seconds: number | null;

  escalation_count: number;
  comment_count: number;
}

/**
 * Case fact row – lifecycle metrics and link counts.
 */
export interface InsightsFactCase {
  id: number; // bigserial
  case_id: UUID;
  organization_id: UUID;

  opened_date_key: IsoDateString;
  closed_date_key: IsoDateString | null;

  status: CaseStatus;
  severity: TaskSeverity;

  linked_task_count: number;
  escalation_count: number;
  review_count: number;
}

/**
 * Wellbeing check-in fact row.
 */
export interface InsightsFactWellbeingCheckin {
  id: number; // bigserial
  checkin_id: UUID;
  organization_id: UUID;

  person_id: UUID | null;
  learning_group_id: UUID | null;

  date_key: IsoDateString;
  score: number;
  tags: string[];

  related_case_id: UUID | null;
  related_task_id: UUID | null;
}

/* -------------------------------------------------------------------------- */
/*  Generic helpers for UI/reporting                                         */
/* -------------------------------------------------------------------------- */

/**
 * Generic time-series point used by insights dashboards.
 */
export interface InsightsTimeSeriesPoint<TExtra = unknown> {
  /**
   * Calendar date for this bucket (usually mapped from dim_dates.date_key).
   */
  date_key: IsoDateString;

  /**
   * Primary value for this bucket (e.g. count of tasks).
   */
  value: number;

  /**
   * Optional extra payload per point (e.g. breakdowns).
   */
  extra?: TExtra;
}

/**
 * Simple grouped aggregate row, e.g. "tasks by status" or "cases by label".
 */
export interface InsightsGroupedAggregateRow<TKey = string> {
  key: TKey;
  count: number;
}

/**
 * Standard shape for "SLA breach" listings in analytics reports.
 * This does not directly map to a single table, but is a convenient
 * projection over tasks + fact_tasks + profiles.
 */
export interface InsightsSlaBreachRow {
  task_id: UUID;
  organization_id: UUID;
  title: string;
  type: string;
  category: string;
  priority: TaskPriority;
  severity: TaskSeverity;
  visibility: Visibility;
  source: TaskSource;

  status: TaskStatus;
  created_at: IsoDateTimeString;
  reactivity_deadline_at: IsoDateTimeString | null;
  closed_at: IsoDateTimeString | null;

  /**
   * Positive number of seconds the task is/was beyond its SLA, if applicable.
   */
  breach_seconds: number;
}
