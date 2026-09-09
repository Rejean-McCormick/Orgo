// apps/web/src/orgo/types/organization.ts

/**
 * Organization and organization-profile related types used in the Orgo web app.
 *
 * These types mirror:
 * - The Orgo v3 database schema for `organizations` and `organization_profiles`.
 * - The profiles YAML behaviour schema (profile codes and behavioural knobs).
 */

/**
 * Canonical environment keys (ENVIRONMENT).
 */
export type EnvironmentKey = 'dev' | 'staging' | 'prod' | 'offline';

/**
 * Simple aliases for commonly used primitives.
 */
export type UUID = string;
export type ISO8601String = string;

/**
 * Status of an organization (organizations.status).
 * Backed by `organization_status_enum` in the database.
 */
export type OrganizationStatus = 'active' | 'suspended' | 'archived';

/**
 * Core Organization shape as exposed to the web app.
 *
 * Matches the `organizations` table logical fields:
 * - id (UUID PK)
 * - slug, display_name, legal_name, primary_domain
 * - status, timezone, default_locale
 * - created_at / updated_at (standard audit columns)
 */
export interface Organization {
  id: UUID;
  slug: string;
  display_name: string;
  legal_name: string | null;
  primary_domain: string | null;
  status: OrganizationStatus;
  /**
   * IANA timezone, e.g. "America/New_York".
   */
  timezone: string;
  /**
   * Locale code, e.g. "en", "fr-CA".
   */
  default_locale: string;
  /**
   * Standard audit timestamps (UTC ISO-8601).
   * Optional in case some APIs omit them.
   */
  created_at?: ISO8601String;
  updated_at?: ISO8601String;
}

/**
 * Known profile codes from the profiles YAML plus a string
 * extension point for custom / future profiles.
 *
 * These values correspond to `organization_profiles.profile_code`.
 */
export type OrganizationProfileKey =
  | 'default'
  | 'friend_group'
  | 'hospital'
  | 'advocacy_group'
  | 'retail_chain'
  | 'military_organization'
  | 'environmental_group'
  | 'artist_collective'
  | (string & {}); // allow custom codes while keeping string literal narrowing

/**
 * Behaviour profile primitives from the profiles YAML.
 */

export type TransparencyLevel = 'full' | 'balanced' | 'restricted' | 'private';

export type EscalationGranularity =
  | 'relaxed'
  | 'moderate'
  | 'detailed'
  | 'aggressive';

export type ReviewFrequency =
  | 'real_time'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'quarterly'
  | 'yearly'
  | 'ad_hoc';

export type NotificationScope = 'user' | 'team' | 'department' | 'org_wide';

export type PatternSensitivity = 'low' | 'medium' | 'high' | 'critical';

export type SeverityThreshold = 'very_high' | 'high' | 'medium' | 'low';

export type LoggingLevel = 'minimal' | 'standard' | 'detailed' | 'audit';

export type AutomationLevel = 'manual' | 'low' | 'medium' | 'high' | 'full';

export type ProfileVisibilityDefault =
  | 'public'
  | 'internal'
  | 'restricted'
  | 'anonymised';

export type ProfilePriorityDefault = 'low' | 'medium' | 'high' | 'critical';

/**
 * Metadata block used in the profiles YAML.
 */
export interface BehaviorProfileMetadata {
  version: string;
  last_updated: string; // "YYYY-MM-DD"
  environment: EnvironmentKey;
}

/**
 * Severity policy section from the profiles YAML.
 */
export interface BehaviorProfileSeverityPolicyEntry {
  immediate_escalation: boolean;
}

export interface BehaviorProfileSeverityPolicy {
  critical: BehaviorProfileSeverityPolicyEntry;
  major: BehaviorProfileSeverityPolicyEntry;
  minor: BehaviorProfileSeverityPolicyEntry;
}

/**
 * Default task metadata section from the profiles YAML.
 * Values map to canonical TASK_PRIORITY and VISIBILITY enums.
 */
export interface BehaviorProfileDefaultTaskMetadata {
  visibility: ProfileVisibilityDefault;
  default_priority: ProfilePriorityDefault;
  /**
   * Default SLA window (in seconds) for tasks created under this profile.
   */
  default_reactivity_seconds: number;
}

/**
 * Cyclic overview / pattern detection configuration from the profiles YAML.
 */
export interface BehaviorProfileCyclicIncidentFrequency {
  min_events: number;
  window_days: number;
}

export interface BehaviorProfileCyclicThresholdTriggers {
  incident_frequency: BehaviorProfileCyclicIncidentFrequency;
  cross_departmental_trends: boolean;
  high_risk_indicators: boolean;
}

export interface BehaviorProfileCyclicSchedule {
  weekly: boolean;
  monthly: boolean;
  yearly: boolean;
}

export interface BehaviorProfileCyclicOverviewConfig {
  enabled: boolean;
  schedule: BehaviorProfileCyclicSchedule;
  threshold_triggers: BehaviorProfileCyclicThresholdTriggers;
}

/**
 * Behaviour profile as loaded from the profiles YAML
 * (one entry under `profiles:`).
 *
 * This describes how intense/urgent/private an org is:
 * reactivity, escalation, transparency, pattern sensitivity, logging, etc.
 */
export interface BehaviorProfile {
  description: string;
  metadata: BehaviorProfileMetadata;

  // 1. Reactivity / Escalation timing
  reactivity_seconds: number;
  max_escalation_seconds: number;

  // 2. Information visibility
  transparency_level: TransparencyLevel;

  // 3. Escalation structure
  escalation_granularity: EscalationGranularity;

  // 4. Review cadence
  review_frequency: ReviewFrequency;

  // 5. Who gets notified
  notification_scope: NotificationScope;

  // 6. Pattern detection
  pattern_sensitivity: PatternSensitivity;
  pattern_window_days: number;
  pattern_min_events: number;

  // 7. Severity / auto-escalation
  severity_threshold: SeverityThreshold;
  severity_policy: BehaviorProfileSeverityPolicy;

  // 8. Logging & traceability
  logging_level: LoggingLevel;
  log_retention_days: number;

  // 9. Automation level
  automation_level: AutomationLevel;

  // 10. Defaults for task metadata
  default_task_metadata: BehaviorProfileDefaultTaskMetadata;

  // 11. Cyclic Overview settings
  cyclic_overview: BehaviorProfileCyclicOverviewConfig;
}

/**
 * Mapping from profile code → behaviour profile.
 * Mirrors the `profiles:` top-level map in the YAML.
 */
export type BehaviorProfilesMap = Record<
  OrganizationProfileKey,
  BehaviorProfile
>;

/**
 * Database-level link between an organization and a profile code,
 * plus per-organization overrides for reactivity / transparency /
 * pattern sensitivity / retention.
 *
 * Mirrors the `organization_profiles` table.
 */
export interface OrganizationProfile {
  id: UUID;
  organization_id: UUID;
  profile_code: OrganizationProfileKey;

  /**
   * Per-task-type SLA targets, minutes for LOW/MEDIUM/HIGH/CRITICAL
   * or a similar structure. Kept generic here because the concrete
   * shape is configuration-driven.
   */
  reactivity_profile: unknown;

  /**
   * Defaults for who can see what; configuration-driven structure.
   */
  transparency_profile: unknown;

  /**
   * Thresholds for insights/alerts; configuration-driven structure.
   */
  pattern_sensitivity_profile: unknown;

  /**
   * Log & data retention periods per category; configuration-driven structure.
   */
  retention_profile: unknown;

  /**
   * Incremented on profile changes.
   */
  version: number;

  created_at?: ISO8601String;
  updated_at?: ISO8601String;
}

/**
 * Convenience view used by the frontend when an organization is loaded
 * together with its profile linkage and the resolved behaviour profile
 * (from the profiles YAML).
 */
export interface OrganizationWithProfile {
  organization: Organization;
  organization_profile: OrganizationProfile | null;
  /**
   * Fully-resolved behavioural profile (e.g. "hospital", "friend_group"),
   * if it could be loaded for the given profile_code.
   */
  behavior_profile: BehaviorProfile | null;
}
