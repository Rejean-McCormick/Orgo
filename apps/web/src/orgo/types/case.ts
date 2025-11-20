// apps/web/src/orgo/types/case.ts

// Canonical enums for Case, aligned with Docs 1, 2 and 8.

/**
 * CASE_STATUS
 * - open
 * - in_progress
 * - resolved
 * - archived
 */
export const CASE_STATUSES = [
  'open',
  'in_progress',
  'resolved',
  'archived',
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

/**
 * JSON form of TASK_SEVERITY for Cases
 * - minor
 * - moderate
 * - major
 * - critical
 */
export const CASE_SEVERITIES = [
  'minor',
  'moderate',
  'major',
  'critical',
] as const;
export type CaseSeverity = (typeof CASE_SEVERITIES)[number];

/**
 * Case source_type / task_source_enum (JSON form)
 * - email
 * - api
 * - manual
 * - sync
 */
export const CASE_SOURCE_TYPES = ['email', 'api', 'manual', 'sync'] as const;
export type CaseSourceType = (typeof CASE_SOURCE_TYPES)[number];

// Common scalar aliases used across Orgo types
export type UUID = string;
export type IsoDateTimeString = string; // e.g. "2025-11-18T10:30:00Z"
export type IsoDurationString = string; // e.g. "PT2H"
export type LabelCode = string; // "<BASE>.<CATEGORY><SUBCATEGORY>.<HORIZONTAL_ROLE>"

/**
 * Canonical Case JSON contract for the web app, matching Doc 2 §2.11
 * and Doc 8 §8.4.1.
 *
 * This represents the shape returned by the public Case API
 * (GET /api/v3/cases, GET /api/v3/cases/:id) for the Case fields.
 */
export interface Case {
  case_id: UUID;
  organization_id: UUID;

  source_type: CaseSourceType;
  source_reference: string | null;

  label: LabelCode;
  title: string;
  description: string;

  status: CaseStatus;
  severity: CaseSeverity;

  /**
   * ISO‑8601 duration (e.g. "PT2H"); derived from profiles/workflows.
   * Null if no explicit SLA window is set for this Case.
   */
  reactivity_time: IsoDurationString | null;

  /**
   * Base part of the original label (e.g. 100, 1001).
   */
  origin_vertical_level: number | null;

  /**
   * Horizontal role of origin (e.g. "Ops.Maintenance").
   */
  origin_role: string | null;

  /**
   * High‑level tags (e.g. ["safety","wet_floor"]).
   */
  tags: string[] | null;

  /**
   * Structured location (site, building, GPS, etc.).
   */
  location: Record<string, unknown> | null;

  /**
   * Case‑level metadata (pattern_sensitivity, review settings, profile_id, etc.).
   */
  metadata: Record<string, unknown>;

  /**
   * Timestamps are ISO‑8601 in UTC.
   */
  created_at: IsoDateTimeString;
  updated_at: IsoDateTimeString;
}

/**
 * Optional extension used by Case details endpoints that include linked Tasks.
 *
 * TTask is generic so this file does not need to depend on a specific Task type;
 * callers can specialise it as CaseWithTasks<Task>.
 */
export interface CaseWithTasks<TTask = unknown> extends Case {
  tasks: TTask[];
}
