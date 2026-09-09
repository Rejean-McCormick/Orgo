/**
 * Stable functional identifiers for Orgo v3 (frontend mirror).
 *
 * Pattern: FN_<MODULE>_<ACTION>
 *
 * These IDs are used in:
 * - Structured logging / analytics
 * - Configuration & feature flags (per-function overrides)
 *
 * This file must stay in sync with:
 * - apps/api/src/orgo/core/functional-ids.ts
 * - Doc 4 – Functional Code-Name Inventory
 */

/* -------------------------------------------------------------------------- */
/* Aggregate list (mirrors backend ALL_FUNCTIONAL_IDS)                        */
/* -------------------------------------------------------------------------- */

export const ALL_FUNCTIONAL_IDS = [
  // Backbone – organizations, persons, identity & RBAC
  "FN_ORG_CREATE_ORGANIZATION",
  "FN_ORG_UPDATE_ORGANIZATION",
  "FN_PERSON_UPSERT_PERSON_PROFILE",
  "FN_RBAC_CREATE_ROLE",
  "FN_RBAC_ASSIGN_PERMISSION",
  "FN_RBAC_ASSIGN_USER_ROLE",
  "FN_IDENTITY_LINK_USER_TO_PERSON",

  // Signals & ingestion – email, API, offline
  "FN_EMAIL_SEND",
  "FN_EMAIL_PARSE_INCOMING",
  "FN_EMAIL_VALIDATE_PAYLOAD",
  "FN_EMAIL_POLL_MAILBOX",
  "FN_EMAIL_ROUTE_TO_WORKFLOW",
  "FN_SIGNAL_INGEST",
  "FN_EMAIL_IMPORT_ARCHIVE",
  "FN_SYNC_OFFLINE_NODE",
  "FN_SYNC_OFFLINE_TASKS",

  // Core – cases, tasks, workflow, escalations & labels
  "FN_CASE_CREATE_FROM_SIGNAL",
  "FN_CASE_CREATE",
  "FN_CASE_GET_WITH_TASKS",
  "FN_CASE_RUN_CYCLIC_REVIEW",
  "FN_TASK_CREATE",
  "FN_TASK_UPDATE_STATUS",
  "FN_TASK_ESCALATE",
  "FN_TASK_ASSIGN",
  "FN_TASK_ADD_COMMENT",
  "FN_TASK_GET_BY_ID",
  "FN_WORKFLOW_EXECUTE",
  "FN_WORKFLOW_VALIDATE_RULES",
  "FN_WORKFLOW_SIMULATE",
  "FN_ESCALATION_EVALUATE",
  "FN_LABEL_RESOLVE",
  "FN_ROUTING_APPLY_RULES",
  "FN_LABEL_CREATE_DEFINITION",
  "FN_LABEL_APPLY_TO_ENTITY",

  // Config, profiles & feature flags
  "FN_PROFILE_LOAD",
  "FN_PROFILE_APPLY_DEFAULTS",
  "FN_PROFILE_PREVIEW_DIFF",
  "FN_CONFIG_GET_GLOBAL",
  "FN_CONFIG_UPDATE_SERVICE_CONFIG",
  "FN_CONFIG_IMPORT_BUNDLE",
  "FN_FEATURE_FLAG_SET",
  "FN_FEATURE_FLAG_EVALUATE",

  // Interfaces – public API, admin UI, live updates
  "FN_API_LIST_TASKS",
  "FN_API_GET_TASK",
  "FN_API_CREATE_TASK",
  "FN_API_UPDATE_TASK_STATUS",
  "FN_API_LIST_CASES",
  "FN_API_GET_CASE",
  "FN_API_EXECUTE_WORKFLOW",
  "FN_UI_ADMIN_TASK_OVERVIEW",
  "FN_UI_ADMIN_CASE_OVERVIEW",
  "FN_UI_ORG_PROFILE_SETTINGS",
  "FN_NOTIFICATION_SEND_IN_APP",
  "FN_NOTIFICATION_SEND_EMAIL",
  "FN_GATEWAY_TASK_EVENTS_STREAM",

  // Domain modules – maintenance, HR, education, generic domain API
  "FN_DOMAIN_MAINTENANCE_REGISTER_INCIDENT",
  "FN_DOMAIN_MAINTENANCE_LIST_INCIDENTS",
  "FN_DOMAIN_HR_REGISTER_REPORT",
  "FN_DOMAIN_HR_LIST_CASES",
  "FN_DOMAIN_EDUCATION_REGISTER_STUDENT_INCIDENT",
  "FN_DOMAIN_EDUCATION_LIST_INCIDENTS",
  "FN_DOMAIN_TASK_FACTORY_CREATE",
  "FN_DOMAIN_WORKFLOW_APPLY_OVERRIDES",

  // Insights, analytics & cyclic overview
  "FN_REPORTS_GET_TASK_VOLUME",
  "FN_REPORTS_GET_SLA_BREACHES",
  "FN_REPORTS_GET_PROFILE_SCORE",
  "FN_ANALYTICS_EXPORT_FACTS",
  "FN_ANALYTICS_REFRESH_MATERIALIZED_VIEWS",
  "FN_INSIGHTS_RUN_WEEKLY_PATTERNS",
  "FN_INSIGHTS_RUN_MONTHLY_TRENDS",
  "FN_INSIGHTS_RUN_YEARLY_SYSTEMIC_REVIEW",
  "FN_INSIGHTS_CACHE_WARM_DASHBOARDS",
  "FN_INSIGHTS_EXPORT_ANALYTICS",

  // Infrastructure, health, metrics & alerts
  "FN_HEALTH_GET",
  "FN_WORKER_HEARTBEAT",
  "FN_METRICS_RECORD_WORKFLOW_LATENCY",
  "FN_METRICS_RECORD_QUEUE_DEPTH",
  "FN_ALERT_ESCALATION_DELAY",
  "FN_ALERT_ERROR_RATE",

  // Security, privacy, compliance & logging
  "FN_AUTH_VALIDATE_ACCESS_TOKEN",
  "FN_RBAC_CHECK_PERMISSION",
  "FN_PRIVACY_ANONYMIZE_PAYLOAD",
  "FN_AUDIT_RECORD_EVENT",
  "FN_COMPLIANCE_EXPORT_AUDIT_LOG",
  "FN_LOG_SYSTEM_EVENT",
  "FN_LOG_SECURITY_EVENT",
  "FN_LOG_ROTATE_LOGS",
  "FN_LOG_QUERY_ENTITY_ACTIVITY",
  "FN_CONFIG_VALIDATE_BUNDLE",
  "FN_VALIDATE_API_PAYLOAD",
  "FN_METADATA_NORMALIZE",
] as const;

/**
 * Union type of all known functional IDs.
 * Mirrors the backend FunctionalId type.
 */
export type FunctionalId = (typeof ALL_FUNCTIONAL_IDS)[number];

/**
 * Backwards-compatible alias used by earlier web code.
 * Prefer ALL_FUNCTIONAL_IDS for new usage.
 */
export const FUNCTIONAL_ID_VALUES = ALL_FUNCTIONAL_IDS;

/**
 * Convenience map FunctionalIds[id] === id for ergonomic imports.
 */
export const FunctionalIds: Record<FunctionalId, FunctionalId> =
  ALL_FUNCTIONAL_IDS.reduce(
    (acc, id) => {
      acc[id] = id;
      return acc;
    },
    {} as Record<FunctionalId, FunctionalId>,
  );

/**
 * Type guard to validate whether a string is a known FunctionalId.
 */
export function isFunctionalId(value: string): value is FunctionalId {
  return (ALL_FUNCTIONAL_IDS as readonly string[]).includes(value);
}
