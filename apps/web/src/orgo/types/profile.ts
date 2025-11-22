// apps/web/src/orgo/types/profile.ts

/**
 * Profile-related types for the Orgo web application.
 *
 * This file sits on top of:
 * - Behavioural profile templates defined in the profiles YAML (Doc 7).
 * - The `organization_profiles` table and OrgProfileService types (Docs 1, 4, 5).
 * - Admin UI views for inspecting and previewing organization profiles.
 */

import type {
  UUID,
  OrganizationProfileKey,
  BehaviorProfile,
  BehaviorProfileMetadata,
  BehaviorProfileCyclicOverviewConfig,
  BehaviorProfilesMap,
  OrganizationProfile,
  OrganizationWithProfile,
} from './organization';

/**
 * Convenience alias for profile codes as used by UI / config APIs.
 *
 * Backed by `organization_profiles.profile_code` and the profiles YAML.
 */
export type OrgProfileCode = OrganizationProfileKey;

/* -------------------------------------------------------------------------- */
/*  Canonical tokens used by OrgProfileService                                */
/* -------------------------------------------------------------------------- */

/**
 * Canonical VISIBILITY token, aligned with the backend VISIBILITY enum.
 */
export type VisibilityToken =
  | 'PUBLIC'
  | 'INTERNAL'
  | 'RESTRICTED'
  | 'ANONYMISED';

/**
 * Canonical TASK_PRIORITY token, aligned with the backend TASK_PRIORITY enum.
 */
export type TaskPriorityToken = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/* -------------------------------------------------------------------------- */
/*  Profile templates & resolved organization profile                         */
/* -------------------------------------------------------------------------- */

/**
 * Frontend alias for the behavioural profile template loaded
 * from the profiles YAML (Doc 7).
 *
 * The shape mirrors `BehaviorProfile` from organization.ts and the
 * backend `ProfileTemplate` type in OrgProfileService.
 */
export type ProfileTemplate = BehaviorProfile;

/**
 * Metadata attached to each profile template (version, environment, etc.).
 */
export type ProfileTemplateMetadata = BehaviorProfileMetadata;

/**
 * Cyclic overview / review configuration copied from a profile template.
 */
export type CyclicOverviewConfig = BehaviorProfileCyclicOverviewConfig;

/**
 * Fully-resolved profile for a specific organization, as returned by
 * `OrgProfileService.loadProfile` and configuration endpoints.
 *
 * Combines:
 *   - The selected profile code
 *   - The behavioural template from YAML
 *   - An optional shallow view of the `organization_profiles` row
 */
export interface ResolvedOrgProfile {
  /**
   * Owning organization identifier.
   */
  organizationId: UUID;
  /**
   * Active profile code (e.g. "default", "hospital").
   */
  profileCode: OrgProfileCode | string;
  /**
   * Behavioural template used for this organization.
   */
  template: ProfileTemplate;
  /**
   * Optional shallow copy of the DB row for callers that need to inspect
   * JSONB override blobs or the version counter.
   */
  dbProfile?: {
    id: UUID;
    version: number;
    reactivity_profile?: unknown;
    transparency_profile?: unknown;
    pattern_sensitivity_profile?: unknown;
    retention_profile?: unknown;
  };
}

/* -------------------------------------------------------------------------- */
/*  Applying profile defaults                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What kind of entity profile defaults are being applied to.
 */
export type DefaultsTargetKind = 'task' | 'case';

/**
 * Input used when asking the backend to apply profile-driven defaults
 * to a Task/Case draft.
 *
 * The backend fills in any omitted values using the active profile.
 */
export interface ApplyDefaultsInput {
  organizationId: UUID;
  /**
   * What we are applying defaults to. For now this only changes how callers
   * interpret the result; the actual values are the same.
   */
  kind: DefaultsTargetKind;
  /**
   * Existing canonical priority (TASK_PRIORITY) if already chosen.
   * If omitted, the profile default is used.
   */
  existingPriority?: TaskPriorityToken;
  /**
   * Existing canonical visibility (VISIBILITY) if already chosen.
   * If omitted, the profile default is used.
   */
  existingVisibility?: VisibilityToken;
  /**
   * Explicit SLA (in seconds) computed by the caller. When omitted,
   * the profile's default reactivity is used.
   */
  requestedReactivitySeconds?: number | null;
}

/**
 * Result of applying profile defaults to a Task/Case draft.
 *
 * This is deliberately small; Task/Case handlers can embed it into
 * their own DTOs or view models.
 */
export interface ApplyDefaultsResult {
  organizationId: UUID;
  profileCode: OrgProfileCode | string;
  kind: DefaultsTargetKind;
  priority: TaskPriorityToken;
  visibility: VisibilityToken;
  /**
   * SLA before first escalation, in seconds, after applying defaults.
   */
  reactivitySeconds: number;
  /**
   * Reactivity window expressed as ISO‑8601 duration (e.g. "PT3600S").
   */
  reactivityTimeIso: string;
  /**
   * Automation level from the org profile, useful for workflow engines.
   */
  automationLevel: ProfileTemplate['automation_level'];
  /**
   * Cyclic overview configuration copied from the profile.
   */
  cyclicOverview: CyclicOverviewConfig;
}

/* -------------------------------------------------------------------------- */
/*  Profile diff / preview (Preview profile impact)                            */
/* -------------------------------------------------------------------------- */

/**
 * A simple numeric field change descriptor used when previewing
 * the impact of switching profiles.
 */
export interface ProfileDiffNumericField {
  field: string;
  from: number | null;
  to: number;
  direction: 'increase' | 'decrease' | 'same';
}

/**
 * A simple enum/string field change descriptor used when previewing
 * the impact of switching profiles.
 */
export interface ProfileDiffEnumField {
  field: string;
  from: string | null;
  to: string;
  changed: boolean;
}

/**
 * Compact summary of a profile's key behavioural knobs.
 */
export interface ProfileSummary {
  profileCode: OrgProfileCode | string;
  description: string;
  reactivitySeconds: number;
  maxEscalationSeconds: number;
  notificationScope: string;
  patternSensitivity: string;
  patternWindowDays: number;
  patternMinEvents: number;
  loggingLevel: string;
  logRetentionDays: number;
  defaultVisibility: VisibilityToken;
  defaultPriority: TaskPriorityToken;
}

/**
 * Result of simulating the impact of switching an organization to
 * a new profile code.
 */
export interface ProfileDiffResult {
  organizationId: UUID;
  currentProfileCode: OrgProfileCode | string | null;
  candidateProfileCode: OrgProfileCode | string;
  currentProfileSummary: ProfileSummary | null;
  candidateProfileSummary: ProfileSummary;
  numericChanges: ProfileDiffNumericField[];
  enumChanges: ProfileDiffEnumField[];
}

/**
 * Minimal preview payload used by the admin UI. Controllers are expected
 * to adapt `ProfileDiffResult` into this human-readable form.
 */
export interface ProfilePreviewDiff {
  /**
   * Free‑form summary paragraph describing the impact.
   */
  summary?: string;
  /**
   * Bullet points for the most important changes.
   */
  impact_bullets?: string[];
}

/* -------------------------------------------------------------------------- */
/*  Admin UI: current organization profile snapshot                           */
/* -------------------------------------------------------------------------- */

/**
 * Snapshot of an organization's current profile as expected by the
 * admin "Organization profile" screen.
 *
 * The `profile` sub-object is a relaxed, optional view over the
 * full ProfileTemplate/BehaviorProfile schema, using snake_case keys
 * exactly as in the YAML / backend.
 */
export interface OrgProfileSnapshot {
  organization_id: UUID;
  organization_slug?: string;
  organization_display_name?: string;
  profile_code: OrgProfileCode | string;
  /**
   * Profile version from `organization_profiles.version`, if available.
   */
  version?: number;
  profile: {
    description?: string;
    reactivity_seconds?: number;
    max_escalation_seconds?: number;
    transparency_level?: string;
    escalation_granularity?: string;
    review_frequency?: string;
    notification_scope?: string;
    pattern_sensitivity?: string;
    pattern_window_days?: number;
    pattern_min_events?: number;
    severity_threshold?: string;
    logging_level?: string;
    log_retention_days?: number;
    automation_level?: string;
    default_task_metadata?: {
      visibility?: string;
      default_priority?: string;
      default_reactivity_seconds?: number;
    };
    cyclic_overview?: {
      enabled?: boolean;
      schedule?: {
        weekly?: boolean;
        monthly?: boolean;
        yearly?: boolean;
      };
      threshold_triggers?: {
        incident_frequency?: {
          min_events?: number;
          window_days?: number;
        };
        cross_departmental_trends?: boolean;
        high_risk_indicators?: boolean;
      };
    };
  };
}

/* -------------------------------------------------------------------------- */
/*  Re‑exports for convenience                                                */
/* -------------------------------------------------------------------------- */

/**
 * Re-export core profile-related types from organization.ts so callers
 * can import them from a single module when working with profiles.
 */
export type {
  BehaviorProfile,
  BehaviorProfileMetadata,
  BehaviorProfileCyclicOverviewConfig,
  BehaviorProfilesMap,
  OrganizationProfile,
  OrganizationWithProfile,
};
