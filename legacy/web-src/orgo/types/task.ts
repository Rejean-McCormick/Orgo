// apps/web/src/orgo/types/task.ts

// Canonical Orgo Task types for the web app.
// This mirrors the Task JSON contract exposed by the API (Docs 2, 5, 8).

/**
 * Common scalar aliases used across Orgo types.
 */
export type UUID = string;
export type IsoDateTimeString = string; // e.g. "2025-11-18T10:30:00Z"
export type IsoDurationString = string; // e.g. "PT2H"
export type LabelCode = string; // "<BASE>.<CATEGORY><SUBCATEGORY>.<HORIZONTAL_ROLE>"

/**
 * Simple ID aliases for clarity.
 */
export type TaskId = UUID;
export type OrganizationId = UUID;
export type CaseId = UUID;

/**
 * Task status values (JSON-level).
 * Back-end maps these to DB enums (TASK_STATUS).
 *
 * - pending
 * - in_progress
 * - on_hold
 * - completed
 * - failed
 * - escalated
 * - cancelled
 */
export const TASK_STATUSES = [
  "pending",
  "in_progress",
  "on_hold",
  "completed",
  "failed",
  "escalated",
  "cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/**
 * Task priority values (JSON-level).
 * Maps to TASK_PRIORITY (LOW/MEDIUM/HIGH/CRITICAL) at DB/analytics level.
 *
 * - low
 * - medium
 * - high
 * - critical
 */
export const TASK_PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/**
 * Task severity values (JSON-level).
 * Maps to TASK_SEVERITY (MINOR/MODERATE/MAJOR/CRITICAL).
 *
 * - minor
 * - moderate
 * - major
 * - critical
 */
export const TASK_SEVERITIES = [
  "minor",
  "moderate",
  "major",
  "critical",
] as const;
export type TaskSeverity = (typeof TASK_SEVERITIES)[number];

/**
 * Visibility values (JSON-level).
 * Maps to VISIBILITY (PUBLIC/INTERNAL/RESTRICTED/ANONYMISED).
 *
 * - public
 * - internal
 * - restricted
 * - anonymised
 */
export const TASK_VISIBILITIES = [
  "public",
  "internal",
  "restricted",
  "anonymised",
] as const;
export type Visibility = (typeof TASK_VISIBILITIES)[number];

/**
 * Task source/channel values (JSON-level).
 * Backed by task_source_enum in the DB.
 *
 * - email
 * - api
 * - manual
 * - sync
 */
export const TASK_SOURCES = ["email", "api", "manual", "sync"] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

/**
 * Global task category values (JSON-level).
 *
 * - request
 * - incident
 * - update
 * - report
 * - distribution
 */
export const TASK_CATEGORIES = [
  "request",
  "incident",
  "update",
  "report",
  "distribution",
] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

/**
 * Arbitrary domain metadata attached to a Task.
 * Must not duplicate core fields (status, severity, etc.).
 */
export type TaskMetadata = Record<string, unknown>;

/**
 * Canonical Task object as returned by the Orgo API.
 * All timestamps are ISO-8601 strings (UTC).
 *
 * Mirrors the TaskDto shape from the Core Services API.
 */
export interface Task {
  // Identity and tenancy
  task_id: TaskId;
  organization_id: OrganizationId;
  case_id: CaseId | null;

  // Classification
  type: string;
  category: TaskCategory;
  subtype: string | null;
  label: LabelCode;

  // Core text
  title: string;
  description: string;

  // State and enums (JSON-level tokens)
  status: TaskStatus;
  priority: TaskPriority;
  severity: TaskSeverity;
  visibility: Visibility;
  source: TaskSource;

  // Ownership / actors (UUIDs at JSON level)
  created_by_user_id: UUID | null;
  requester_person_id: UUID | null;
  owner_role_id: UUID | null;
  owner_user_id: UUID | null;
  assignee_role: string | null;

  // Timing / SLA
  due_at: IsoDateTimeString | null;
  created_at: IsoDateTimeString;
  updated_at: IsoDateTimeString;
  closed_at: IsoDateTimeString | null;
  /**
   * ISO-8601 duration (e.g. "PT2H"); SLA window from creation used to derive
   * reactivity_deadline_at. Null if no explicit SLA window is set.
   */
  reactivity_time: IsoDurationString | null;
  reactivity_deadline_at: IsoDateTimeString | null;
  escalation_level: number;

  // Domain-specific payload
  metadata: TaskMetadata;
}
