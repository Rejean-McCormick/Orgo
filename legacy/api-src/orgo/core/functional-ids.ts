/**
 * Stable functional identifiers for Orgo v3.
 *
 * Pattern: FN_<MODULE>_<ACTION>
 *
 * These IDs are used in:
 * - Structured logging (`identifier` field in LOG_EVENT)
 * - Analytics / Insights dimensions
 * - Configuration & feature flags (per-function overrides)
 *
 * This file must stay in sync with:
 * - apps/web/src/orgo/core/functional-ids.ts
 * - Doc 4 – Functional Code-Name Inventory
 */

/* ------------------------------------------------------------------------- */
/* Backbone: Organizations, Persons, Identity & RBAC                         */
/* ------------------------------------------------------------------------- */

export const FN_ORG_CREATE_ORGANIZATION = 'FN_ORG_CREATE_ORGANIZATION' as const;
export const FN_ORG_UPDATE_ORGANIZATION = 'FN_ORG_UPDATE_ORGANIZATION' as const;

export const FN_PERSON_UPSERT_PERSON_PROFILE =
  'FN_PERSON_UPSERT_PERSON_PROFILE' as const;

export const FN_RBAC_CREATE_ROLE = 'FN_RBAC_CREATE_ROLE' as const;
export const FN_RBAC_ASSIGN_PERMISSION = 'FN_RBAC_ASSIGN_PERMISSION' as const;
export const FN_RBAC_ASSIGN_USER_ROLE = 'FN_RBAC_ASSIGN_USER_ROLE' as const;

export const FN_IDENTITY_LINK_USER_TO_PERSON =
  'FN_IDENTITY_LINK_USER_TO_PERSON' as const;

/* ------------------------------------------------------------------------- */
/* Signals & Ingestion: Email, API, Offline                                  */
/* ------------------------------------------------------------------------- */

export const FN_EMAIL_SEND = 'FN_EMAIL_SEND' as const;
export const FN_EMAIL_PARSE_INCOMING = 'FN_EMAIL_PARSE_INCOMING' as const;
export const FN_EMAIL_VALIDATE_PAYLOAD = 'FN_EMAIL_VALIDATE_PAYLOAD' as const;
export const FN_EMAIL_POLL_MAILBOX = 'FN_EMAIL_POLL_MAILBOX' as const;
export const FN_EMAIL_ROUTE_TO_WORKFLOW = 'FN_EMAIL_ROUTE_TO_WORKFLOW' as const;

export const FN_SIGNAL_INGEST = 'FN_SIGNAL_INGEST' as const;

export const FN_EMAIL_IMPORT_ARCHIVE = 'FN_EMAIL_IMPORT_ARCHIVE' as const;

export const FN_SYNC_OFFLINE_NODE = 'FN_SYNC_OFFLINE_NODE' as const;
export const FN_SYNC_OFFLINE_TASKS = 'FN_SYNC_OFFLINE_TASKS' as const;

/* ------------------------------------------------------------------------- */
/* Core: Cases, Tasks, Workflow, Escalations & Labels                        */
/* ------------------------------------------------------------------------- */

/** Case management */
export const FN_CASE_CREATE_FROM_SIGNAL =
  'FN_CASE_CREATE_FROM_SIGNAL' as const;
export const FN_CASE_CREATE = 'FN_CASE_CREATE' as const;
export const FN_CASE_GET_WITH_TASKS = 'FN_CASE_GET_WITH_TASKS' as const;
export const FN_CASE_RUN_CYCLIC_REVIEW =
  'FN_CASE_RUN_CYCLIC_REVIEW' as const;

/** Task management */
export const FN_TASK_CREATE = 'FN_TASK_CREATE' as const;
export const FN_TASK_UPDATE_STATUS = 'FN_TASK_UPDATE_STATUS' as const;
export const FN_TASK_ESCALATE = 'FN_TASK_ESCALATE' as const;
export const FN_TASK_ASSIGN = 'FN_TASK_ASSIGN' as const;
export const FN_TASK_ADD_COMMENT = 'FN_TASK_ADD_COMMENT' as const;
export const FN_TASK_GET_BY_ID = 'FN_TASK_GET_BY_ID' as const;

/** Workflow engine & escalation */
export const FN_WORKFLOW_EXECUTE = 'FN_WORKFLOW_EXECUTE' as const;
export const FN_WORKFLOW_VALIDATE_RULES =
  'FN_WORKFLOW_VALIDATE_RULES' as const;
export const FN_WORKFLOW_SIMULATE = 'FN_WORKFLOW_SIMULATE' as const;

export const FN_ESCALATION_EVALUATE = 'FN_ESCALATION_EVALUATE' as const;

/** Labels & routing */
export const FN_LABEL_RESOLVE = 'FN_LABEL_RESOLVE' as const;
export const FN_ROUTING_APPLY_RULES = 'FN_ROUTING_APPLY_RULES' as const;
export const FN_LABEL_CREATE_DEFINITION =
  'FN_LABEL_CREATE_DEFINITION' as const;
export const FN_LABEL_APPLY_TO_ENTITY = 'FN_LABEL_APPLY_TO_ENTITY' as const;

/* ------------------------------------------------------------------------- */
/* Configuration, Profiles & Feature Flags                                   */
/* ------------------------------------------------------------------------- */

export const FN_PROFILE_LOAD = 'FN_PROFILE_LOAD' as const;
export const FN_PROFILE_APPLY_DEFAULTS =
  'FN_PROFILE_APPLY_DEFAULTS' as const;
export const FN_PROFILE_PREVIEW_DIFF = 'FN_PROFILE_PREVIEW_DIFF' as const;

export const FN_CONFIG_GET_GLOBAL = 'FN_CONFIG_GET_GLOBAL' as const;
export const FN_CONFIG_UPDATE_SERVICE_CONFIG =
  'FN_CONFIG_UPDATE_SERVICE_CONFIG' as const;
export const FN_CONFIG_IMPORT_BUNDLE = 'FN_CONFIG_IMPORT_BUNDLE' as const;

export const FN_FEATURE_FLAG_SET = 'FN_FEATURE_FLAG_SET' as const;
export const FN_FEATURE_FLAG_EVALUATE = 'FN_FEATURE_FLAG_EVALUATE' as const;

/* ------------------------------------------------------------------------- */
/* Interfaces: Public API, Admin UI, Live Updates                            */
/* ------------------------------------------------------------------------- */

/** Public REST API – Tasks */
export const FN_API_LIST_TASKS = 'FN_API_LIST_TASKS' as const;
export const FN_API_GET_TASK = 'FN_API_GET_TASK' as const;
export const FN_API_CREATE_TASK = 'FN_API_CREATE_TASK' as const;
export const FN_API_UPDATE_TASK_STATUS =
  'FN_API_UPDATE_TASK_STATUS' as const;

/** Public REST API – Cases */
export const FN_API_LIST_CASES = 'FN_API_LIST_CASES' as const;
export const FN_API_GET_CASE = 'FN_API_GET_CASE' as const;

/** Public REST API – Workflows */
export const FN_API_EXECUTE_WORKFLOW = 'FN_API_EXECUTE_WORKFLOW' as const;

/** Admin UI screens */
export const FN_UI_ADMIN_TASK_OVERVIEW =
  'FN_UI_ADMIN_TASK_OVERVIEW' as const;
export const FN_UI_ADMIN_CASE_OVERVIEW =
  'FN_UI_ADMIN_CASE_OVERVIEW' as const;
export const FN_UI_ORG_PROFILE_SETTINGS =
  'FN_UI_ORG_PROFILE_SETTINGS' as const;

/** Notifications & live updates */
export const FN_NOTIFICATION_SEND_IN_APP =
  'FN_NOTIFICATION_SEND_IN_APP' as const;
export const FN_NOTIFICATION_SEND_EMAIL =
  'FN_NOTIFICATION_SEND_EMAIL' as const;

export const FN_GATEWAY_TASK_EVENTS_STREAM =
  'FN_GATEWAY_TASK_EVENTS_STREAM' as const;

/* ------------------------------------------------------------------------- */
/* Domain Modules: Maintenance, HR, Education, Generic Domain API           */
/* ------------------------------------------------------------------------- */

/** Maintenance domain */
export const FN_DOMAIN_MAINTENANCE_REGISTER_INCIDENT =
  'FN_DOMAIN_MAINTENANCE_REGISTER_INCIDENT' as const;
export const FN_DOMAIN_MAINTENANCE_LIST_INCIDENTS =
  'FN_DOMAIN_MAINTENANCE_LIST_INCIDENTS' as const;

/** HR domain */
export const FN_DOMAIN_HR_REGISTER_REPORT =
  'FN_DOMAIN_HR_REGISTER_REPORT' as const;
export const FN_DOMAIN_HR_LIST_CASES = 'FN_DOMAIN_HR_LIST_CASES' as const;

/** Education domain */
export const FN_DOMAIN_EDUCATION_REGISTER_STUDENT_INCIDENT =
  'FN_DOMAIN_EDUCATION_REGISTER_STUDENT_INCIDENT' as const;
export const FN_DOMAIN_EDUCATION_LIST_INCIDENTS =
  'FN_DOMAIN_EDUCATION_LIST_INCIDENTS' as const;

/** Generic domain abstractions */
export const FN_DOMAIN_TASK_FACTORY_CREATE =
  'FN_DOMAIN_TASK_FACTORY_CREATE' as const;
export const FN_DOMAIN_WORKFLOW_APPLY_OVERRIDES =
  'FN_DOMAIN_WORKFLOW_APPLY_OVERRIDES' as const;

/* ------------------------------------------------------------------------- */
/* Insights, Analytics & Cyclic Overview                                     */
/* ------------------------------------------------------------------------- */

export const FN_REPORTS_GET_TASK_VOLUME =
  'FN_REPORTS_GET_TASK_VOLUME' as const;
export const FN_REPORTS_GET_SLA_BREACHES =
  'FN_REPORTS_GET_SLA_BREACHES' as const;
export const FN_REPORTS_GET_PROFILE_SCORE =
  'FN_REPORTS_GET_PROFILE_SCORE' as const;

export const FN_ANALYTICS_EXPORT_FACTS =
  'FN_ANALYTICS_EXPORT_FACTS' as const;
export const FN_ANALYTICS_REFRESH_MATERIALIZED_VIEWS =
  'FN_ANALYTICS_REFRESH_MATERIALIZED_VIEWS' as const;

export const FN_INSIGHTS_RUN_WEEKLY_PATTERNS =
  'FN_INSIGHTS_RUN_WEEKLY_PATTERNS' as const;
export const FN_INSIGHTS_RUN_MONTHLY_TRENDS =
  'FN_INSIGHTS_RUN_MONTHLY_TRENDS' as const;
export const FN_INSIGHTS_RUN_YEARLY_SYSTEMIC_REVIEW =
  'FN_INSIGHTS_RUN_YEARLY_SYSTEMIC_REVIEW' as const;

export const FN_INSIGHTS_CACHE_WARM_DASHBOARDS =
  'FN_INSIGHTS_CACHE_WARM_DASHBOARDS' as const;

/* ------------------------------------------------------------------------- */
/* Infrastructure, Health, Metrics & Alerts                                  */
/* ------------------------------------------------------------------------- */

export const FN_HEALTH_GET = 'FN_HEALTH_GET' as const;
export const FN_WORKER_HEARTBEAT = 'FN_WORKER_HEARTBEAT' as const;

export const FN_METRICS_RECORD_WORKFLOW_LATENCY =
  'FN_METRICS_RECORD_WORKFLOW_LATENCY' as const;
export const FN_METRICS_RECORD_QUEUE_DEPTH =
  'FN_METRICS_RECORD_QUEUE_DEPTH' as const;

export const FN_ALERT_ESCALATION_DELAY =
  'FN_ALERT_ESCALATION_DELAY' as const;
export const FN_ALERT_ERROR_RATE = 'FN_ALERT_ERROR_RATE' as const;

/* ------------------------------------------------------------------------- */
/* Security, Privacy, Compliance & Logging                                   */
/* ------------------------------------------------------------------------- */

export const FN_AUTH_VALIDATE_ACCESS_TOKEN =
  'FN_AUTH_VALIDATE_ACCESS_TOKEN' as const;
export const FN_RBAC_CHECK_PERMISSION =
  'FN_RBAC_CHECK_PERMISSION' as const;

export const FN_PRIVACY_ANONYMIZE_PAYLOAD =
  'FN_PRIVACY_ANONYMIZE_PAYLOAD' as const;

export const FN_AUDIT_RECORD_EVENT = 'FN_AUDIT_RECORD_EVENT' as const;
export const FN_COMPLIANCE_EXPORT_AUDIT_LOG =
  'FN_COMPLIANCE_EXPORT_AUDIT_LOG' as const;
export const FN_INSIGHTS_EXPORT_ANALYTICS =
  'FN_INSIGHTS_EXPORT_ANALYTICS' as const;

/** Logging functions – `FN_LOG_SYSTEM_EVENT` is explicitly referenced in specs. */
export const FN_LOG_SYSTEM_EVENT = 'FN_LOG_SYSTEM_EVENT' as const;
export const FN_LOG_SECURITY_EVENT = 'FN_LOG_SECURITY_EVENT' as const;
export const FN_LOG_ROTATE_LOGS = 'FN_LOG_ROTATE_LOGS' as const;
export const FN_LOG_QUERY_ENTITY_ACTIVITY =
  'FN_LOG_QUERY_ENTITY_ACTIVITY' as const;

/** Validation helpers */
export const FN_CONFIG_VALIDATE_BUNDLE =
  'FN_CONFIG_VALIDATE_BUNDLE' as const;
export const FN_VALIDATE_API_PAYLOAD =
  'FN_VALIDATE_API_PAYLOAD' as const;
export const FN_METADATA_NORMALIZE = 'FN_METADATA_NORMALIZE' as const;

/* ------------------------------------------------------------------------- */
/* Aggregates & Type Helpers                                                 */
/* ------------------------------------------------------------------------- */

export const ALL_FUNCTIONAL_IDS = [
  /* Backbone */
  FN_ORG_CREATE_ORGANIZATION,
  FN_ORG_UPDATE_ORGANIZATION,
  FN_PERSON_UPSERT_PERSON_PROFILE,
  FN_RBAC_CREATE_ROLE,
  FN_RBAC_ASSIGN_PERMISSION,
  FN_RBAC_ASSIGN_USER_ROLE,
  FN_IDENTITY_LINK_USER_TO_PERSON,

  /* Signals & ingestion */
  FN_EMAIL_SEND,
  FN_EMAIL_PARSE_INCOMING,
  FN_EMAIL_VALIDATE_PAYLOAD,
  FN_EMAIL_POLL_MAILBOX,
  FN_EMAIL_ROUTE_TO_WORKFLOW,
  FN_SIGNAL_INGEST,
  FN_EMAIL_IMPORT_ARCHIVE,
  FN_SYNC_OFFLINE_NODE,
  FN_SYNC_OFFLINE_TASKS,

  /* Core: Cases, Tasks, Workflow, Labels */
  FN_CASE_CREATE_FROM_SIGNAL,
  FN_CASE_CREATE,
  FN_CASE_GET_WITH_TASKS,
  FN_CASE_RUN_CYCLIC_REVIEW,
  FN_TASK_CREATE,
  FN_TASK_UPDATE_STATUS,
  FN_TASK_ESCALATE,
  FN_TASK_ASSIGN,
  FN_TASK_ADD_COMMENT,
  FN_TASK_GET_BY_ID,
  FN_WORKFLOW_EXECUTE,
  FN_WORKFLOW_VALIDATE_RULES,
  FN_WORKFLOW_SIMULATE,
  FN_ESCALATION_EVALUATE,
  FN_LABEL_RESOLVE,
  FN_ROUTING_APPLY_RULES,
  FN_LABEL_CREATE_DEFINITION,
  FN_LABEL_APPLY_TO_ENTITY,

  /* Config, profiles & feature flags */
  FN_PROFILE_LOAD,
  FN_PROFILE_APPLY_DEFAULTS,
  FN_PROFILE_PREVIEW_DIFF,
  FN_CONFIG_GET_GLOBAL,
  FN_CONFIG_UPDATE_SERVICE_CONFIG,
  FN_CONFIG_IMPORT_BUNDLE,
  FN_FEATURE_FLAG_SET,
  FN_FEATURE_FLAG_EVALUATE,

  /* Interfaces */
  FN_API_LIST_TASKS,
  FN_API_GET_TASK,
  FN_API_CREATE_TASK,
  FN_API_UPDATE_TASK_STATUS,
  FN_API_LIST_CASES,
  FN_API_GET_CASE,
  FN_API_EXECUTE_WORKFLOW,
  FN_UI_ADMIN_TASK_OVERVIEW,
  FN_UI_ADMIN_CASE_OVERVIEW,
  FN_UI_ORG_PROFILE_SETTINGS,
  FN_NOTIFICATION_SEND_IN_APP,
  FN_NOTIFICATION_SEND_EMAIL,
  FN_GATEWAY_TASK_EVENTS_STREAM,

  /* Domain modules */
  FN_DOMAIN_MAINTENANCE_REGISTER_INCIDENT,
  FN_DOMAIN_MAINTENANCE_LIST_INCIDENTS,
  FN_DOMAIN_HR_REGISTER_REPORT,
  FN_DOMAIN_HR_LIST_CASES,
  FN_DOMAIN_EDUCATION_REGISTER_STUDENT_INCIDENT,
  FN_DOMAIN_EDUCATION_LIST_INCIDENTS,
  FN_DOMAIN_TASK_FACTORY_CREATE,
  FN_DOMAIN_WORKFLOW_APPLY_OVERRIDES,

  /* Insights & analytics */
  FN_REPORTS_GET_TASK_VOLUME,
  FN_REPORTS_GET_SLA_BREACHES,
  FN_REPORTS_GET_PROFILE_SCORE,
  FN_ANALYTICS_EXPORT_FACTS,
  FN_ANALYTICS_REFRESH_MATERIALIZED_VIEWS,
  FN_INSIGHTS_RUN_WEEKLY_PATTERNS,
  FN_INSIGHTS_RUN_MONTHLY_TRENDS,
  FN_INSIGHTS_RUN_YEARLY_SYSTEMIC_REVIEW,
  FN_INSIGHTS_CACHE_WARM_DASHBOARDS,
  FN_INSIGHTS_EXPORT_ANALYTICS,

  /* Infra, health, metrics, alerts */
  FN_HEALTH_GET,
  FN_WORKER_HEARTBEAT,
  FN_METRICS_RECORD_WORKFLOW_LATENCY,
  FN_METRICS_RECORD_QUEUE_DEPTH,
  FN_ALERT_ESCALATION_DELAY,
  FN_ALERT_ERROR_RATE,

  /* Security, privacy, compliance, logging */
  FN_AUTH_VALIDATE_ACCESS_TOKEN,
  FN_RBAC_CHECK_PERMISSION,
  FN_PRIVACY_ANONYMIZE_PAYLOAD,
  FN_AUDIT_RECORD_EVENT,
  FN_COMPLIANCE_EXPORT_AUDIT_LOG,
  FN_LOG_SYSTEM_EVENT,
  FN_LOG_SECURITY_EVENT,
  FN_LOG_ROTATE_LOGS,
  FN_LOG_QUERY_ENTITY_ACTIVITY,
  FN_CONFIG_VALIDATE_BUNDLE,
  FN_VALIDATE_API_PAYLOAD,
  FN_METADATA_NORMALIZE,
] as const;

/**
 * Union type of all known functional IDs.
 */
export type FunctionalId = (typeof ALL_FUNCTIONAL_IDS)[number];

/**
 * Type guard to validate whether a string is a known FunctionalId.
 */
export function isFunctionalId(value: string): value is FunctionalId {
  return (ALL_FUNCTIONAL_IDS as readonly string[]).includes(value);
}
