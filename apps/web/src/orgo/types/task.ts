// Canonical Orgo Task types for the web app.
// This mirrors the Task JSON contract exposed by the API.

/**
 * Simple ID aliases for clarity.
 */
export type TaskId = string;
export type OrganizationId = string;
export type CaseId = string;

/**
 * Task status values (JSON-level).
 * Back-end maps these to DB enums.
 */
export type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'on_hold'
  | 'completed'
  | 'failed'
  | 'escalated'
  | 'cancelled';

/**
 * Task priority values (JSON-level).
 */
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

/**
 * Task severity values (JSON-level).
 */
export type TaskSeverity = 'minor' | 'moderate' | 'major' | 'critical';

/**
 * Visibility values (JSON-level).
 */
export type Visibility = 'public' | 'internal' | 'restricted' | 'anonymised';

/**
 * Task source/channel values (JSON-level).
 */
export type TaskSource = 'email' | 'api' | 'manual' | 'sync';

/**
 * Global task category values (JSON-level).
 */
export type TaskCategory =
  | 'request'
  | 'incident'
  | 'update'
  | 'report'
  | 'distribution';

/**
 * Arbitrary domain metadata attached to a Task.
 * Must not duplicate core fields (status, severity, etc.).
 */
export type TaskMetadata = Record<string, unknown>;

/**
 * Canonical Task object as returned by the Orgo API.
 * All timestamps are ISO-8601 strings (UTC).
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
  label: string;

  // Core text
  title: string;
  description: string;

  // State and enums
  status: TaskStatus;
  priority: TaskPriority;
  severity: TaskSeverity;
  visibility: Visibility;
  source: TaskSource;

  // Ownership / actors
  created_by_user_id: string | null;
  requester_person_id: string | null;
  owner_role_id: string | null;
  owner_user_id: string | null;
  assignee_role: string | null;

  // Timing / SLA
  due_at: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  reactivity_time: string | null;
  reactivity_deadline_at: string | null;
  escalation_level: number;

  // Domain-specific payload
  metadata: TaskMetadata;
}
