// apps/api/src/orgo/config/org-profile.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '././persistence/prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

/**
 * Canonical VISIBILITY token, aligned with VISIBILITY enum (Docs 2, 7, 8).
 */
export type VisibilityToken =
  | 'PUBLIC'
  | 'INTERNAL'
  | 'RESTRICTED'
  | 'ANONYMISED';

/**
 * Canonical TASK_PRIORITY token, aligned with TASK_PRIORITY enum (Docs 2, 5, 8).
 */
export type TaskPriorityToken = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/**
 * Lower‑case visibility tokens as they appear in YAML / JSON configs.
 */
type LowerVisibility =
  | 'public'
  | 'internal'
  | 'restricted'
  | 'anonymised'
  | 'anonymized'; // accept US spelling as alias

/**
 * Lower‑case priority tokens as they appear in YAML / JSON configs.
 */
type LowerPriority = 'low' | 'medium' | 'high' | 'critical';

/**
 * Default Task metadata block inside a behaviour profile template (Doc 7).
 */
export interface ProfileDefaultTaskMetadataTemplate {
  visibility: LowerVisibility;
  default_priority: LowerPriority;
  default_reactivity_seconds: number;
}

/**
 * Cyclic overview / pattern review configuration copied from a profile.
 * Mirrors the `cyclic_overview` block in Doc 7.
 */
export interface CyclicOverviewConfig {
  enabled: boolean;
  schedule: {
    weekly: boolean;
    monthly: boolean;
    yearly: boolean;
  };
  threshold_triggers: {
    incident_frequency: {
      min_events: number;
      window_days: number;
    };
    cross_departmental_trends: boolean;
    high_risk_indicators: boolean;
  };
}

/**
 * Environment token used in profile metadata.
 */
export type EnvironmentToken = 'dev' | 'staging' | 'prod' | 'offline';

/**
 * Metadata attached to each behavioural profile template.
 */
export interface ProfileTemplateMetadata {
  version: string;
  last_updated: string;
  environment: EnvironmentToken;
}

/**
 * Behaviour profile template as defined in the profiles YAML (Doc 7).
 *
 * This mirrors the BehaviourProfile type used in the web app and the
 * schema template documented in the organization profiles doc.
 */
export interface ProfileTemplate {
  description: string;
  metadata: ProfileTemplateMetadata;

  // Reactivity / escalation timing
  reactivity_seconds: number;
  max_escalation_seconds: number;

  // Information visibility
  transparency_level: 'full' | 'balanced' | 'restricted' | 'private';

  // Escalation structure
  escalation_granularity: 'relaxed' | 'moderate' | 'detailed' | 'aggressive';

  // Review cadence
  review_frequency:
    | 'real_time'
    | 'daily'
    | 'weekly'
    | 'monthly'
    | 'quarterly'
    | 'yearly'
    | 'ad_hoc';

  // Notification scope
  notification_scope: 'user' | 'team' | 'department' | 'org_wide';

  // Pattern detection
  pattern_sensitivity: 'low' | 'medium' | 'high' | 'critical';
  pattern_window_days: number;
  pattern_min_events: number;

  // Severity / auto‑escalation
  severity_threshold: 'very_high' | 'high' | 'medium' | 'low';
  severity_policy: {
    critical: { immediate_escalation: boolean };
    major: { immediate_escalation: boolean };
    minor: { immediate_escalation: boolean };
  };

  // Logging & traceability
  logging_level: 'minimal' | 'standard' | 'detailed' | 'audit';
  log_retention_days: number;

  // Automation level
  automation_level: 'manual' | 'low' | 'medium' | 'high' | 'full';

  // Defaults for Task metadata
  default_task_metadata: ProfileDefaultTaskMetadataTemplate;

  // Cyclic overview / pattern review config
  cyclic_overview: CyclicOverviewConfig;
}

/**
 * Resolved profile for a specific organization (tenant).
 *
 * Combines:
 *  - The active profile code (from organization_profiles.profile_code), and
 *  - The behavioural template from the profiles YAML (Doc 7),
 *  - An optional shallow copy of the DB row with JSONB overrides.
 */
export interface ResolvedOrgProfile {
  organizationId: string;
  profileCode: string;
  template: ProfileTemplate;
  // Shallow copy of DB row for callers that need it; type is intentionally loose
  dbProfile?: {
    id: string;
    version: number;
    reactivity_profile?: unknown;
    transparency_profile?: unknown;
    pattern_sensitivity_profile?: unknown;
    retention_profile?: unknown;
  };
}

/**
 * What kind of entity profile defaults are being applied to.
 */
export type DefaultsTargetKind = 'task' | 'case';

/**
 * Input for applying profile‑driven defaults to a Task/Case.
 */
export interface ApplyDefaultsInput {
  organizationId: string;
  /**
   * What we are applying defaults to. For now this only changes how callers
   * interpret the result; the actual values are the same.
   */
  kind: DefaultsTargetKind;
  /**
   * Existing canonical priority (TASK_PRIORITY) if already chosen.
   * If omitted, profile default is used.
   */
  existingPriority?: TaskPriorityToken;
  /**
   * Existing canonical visibility (VISIBILITY) if already chosen.
   * If omitted, profile default is used.
   */
  existingVisibility?: VisibilityToken;
  /**
   * If the caller already computed a reactivity SLA (in seconds),
   * pass it here; otherwise the profile default is used.
   */
  requestedReactivitySeconds?: number | null;
}

/**
 * Result of applying profile defaults to a Task/Case draft.
 * This is deliberately small; Task/Case handlers can attach it into
 * their own DTOs / DB models.
 */
export interface ApplyDefaultsResult {
  organizationId: string;
  profileCode: string;
  kind: DefaultsTargetKind;
  priority: TaskPriorityToken;
  visibility: VisibilityToken;
  /**
   * SLA before first escalation, in seconds, after applying profile defaults.
   */
  reactivitySeconds: number;
  /**
   * Reactivity time expressed as ISO‑8601 duration (e.g. "PT3600S").
   */
  reactivityTimeIso: string;
  /**
   * Automation level from the org profile, useful for downstream
   * workflow/notification engines.
   */
  automationLevel: ProfileTemplate['automation_level'];
  /**
   * Cyclic overview configuration copied from the profile, so
   * callers can decide whether to schedule reviews.
   */
  cyclicOverview: CyclicOverviewConfig;
}

/**
 * A simple numeric field change descriptor used in previewProfileDiff.
 */
export interface ProfileDiffNumericField {
  field: string;
  from: number | null;
  to: number;
  direction: 'increase' | 'decrease' | 'same';
}

/**
 * A simple enum/string field change descriptor used in previewProfileDiff.
 */
export interface ProfileDiffEnumField {
  field: string;
  from: string | null;
  to: string;
  changed: boolean;
}

/**
 * Compact summary of key behavioural knobs for a profile.
 * Used by previewProfileDiff and configuration UIs.
 */
export interface ProfileSummary {
  profileCode: string;
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
 * Result of simulating the impact of switching to a new profile for an org.
 */
export interface ProfileDiffResult {
  organizationId: string;
  currentProfileCode: string | null;
  candidateProfileCode: string;
  currentProfileSummary: ProfileSummary | null;
  candidateProfileSummary: ProfileSummary;
  numericChanges: ProfileDiffNumericField[];
  enumChanges: ProfileDiffEnumField[];
}

/**
 * Shape of the profiles YAML file on disk.
 */
interface ProfilesFileShape {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: any;
  profiles?: Record<string, ProfileTemplate>;
}

/**
 * Small helper snapshot types exposed as convenience integration points.
 */

/**
 * SLA configuration derived from a profile for a specific organization.
 * Used by TaskService / Workflow engines when computing deadlines.
 */
export interface OrgSlaConfig {
  /**
   * Base reactivity time before first escalation (seconds).
   * Mirrors ProfileTemplate.reactivity_seconds.
   */
  reactivitySeconds: number;
  /**
   * Maximum allowed escalation window (seconds).
   * Mirrors ProfileTemplate.max_escalation_seconds.
   */
  maxEscalationSeconds: number;
  /**
   * Default SLA for tasks created under this profile, when
   * the caller does not specify an explicit SLA.
   * Mirrors default_task_metadata.default_reactivity_seconds,
   * falling back to reactivity_seconds when omitted.
   */
  defaultTaskReactivitySeconds: number;
}

/**
 * Default Task metadata derived from the active profile.
 * Used by TaskService and domain modules when seeding new work.
 */
export interface OrgTaskDefaults {
  priority: TaskPriorityToken;
  visibility: VisibilityToken;
  /**
   * Default SLA in seconds for new Tasks/Cases when caller does not override.
   */
  reactivitySeconds: number;
}

/**
 * Pattern detection knobs for a given organization.
 * Used by Insights / analytics modules when aligning pattern windows
 * with operational expectations.
 */
export interface OrgPatternConfig {
  patternSensitivity: string;
  patternWindowDays: number;
  patternMinEvents: number;
}

/**
 * Logging and retention knobs for a given organization.
 * Used by logging/audit services and data retention policies.
 */
export interface OrgLoggingConfig {
  loggingLevel: string;
  logRetentionDays: number;
}

const DEFAULT_PROFILE_CODE = 'default';
const PROFILE_CONFIG_ENV_VAR = 'ORGO_PROFILES_CONFIG_PATH';

@Injectable()
export class OrgProfileService {
  private readonly logger = new Logger(OrgProfileService.name);

  /**
   * Profiles loaded from YAML configuration (Doc 7 shape).
   * Keyed by profile_code (e.g. "default", "friend_group", "hospital").
   */
  private profileTemplates: Record<string, ProfileTemplate> = {};

  private readonly profilesConfigPath: string;

  /**
   * Current environment, normalised to EnvironmentToken when possible.
   * Used to validate profile metadata.environment.
   */
  private readonly environmentToken: EnvironmentToken | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const fromEnv = this.configService.get<string>('ENVIRONMENT');
    const rawEnvironment = fromEnv ?? process.env.ENVIRONMENT ?? null;
    this.environmentToken = this.normalizeEnvironmentToken(rawEnvironment);

    const profilesPathFromEnv =
      this.configService.get<string>(PROFILE_CONFIG_ENV_VAR);
    this.profilesConfigPath =
      profilesPathFromEnv ??
      path.resolve(
        process.cwd(),
        'config',
        'profiles',
        'organization_profiles.yaml',
      );

    this.loadProfilesFromConfig();
  }

  /**
   * Load and cache profile templates from the profiles YAML file.
   * Fails softly: if the file is missing or invalid, we fall back to
   * a hard‑coded "default" profile so the system can still operate.
   *
   * This now validates the presence and shape of the per-profile metadata
   * block (metadata.version / metadata.last_updated / metadata.environment)
   * and enforces basic environment coherence.
   */
  private loadProfilesFromConfig(): void {
    try {
      if (!fs.existsSync(this.profilesConfigPath)) {
        this.logger.warn(
          `Org profiles config not found at "${this.profilesConfigPath}". Falling back to hard‑coded default profile.`,
        );
        this.profileTemplates = {
          [DEFAULT_PROFILE_CODE]: this.buildHardcodedDefaultProfile(),
        };
        return;
      }

      const raw = fs.readFileSync(this.profilesConfigPath, 'utf8');
      const parsed = yaml.load(raw) as ProfilesFileShape | undefined;

      if (!parsed || typeof parsed !== 'object' || !parsed.profiles) {
        this.logger.warn(
          `Org profiles config at "${this.profilesConfigPath}" is missing a "profiles" root key. Falling back to hard‑coded default profile.`,
        );
        this.profileTemplates = {
          [DEFAULT_PROFILE_CODE]: this.buildHardcodedDefaultProfile(),
        };
        return;
      }

      const validatedProfiles = this.validateAndNormalizeProfileTemplates(
        parsed.profiles,
      );

      this.profileTemplates = { ...validatedProfiles };

      if (!this.profileTemplates[DEFAULT_PROFILE_CODE]) {
        this.logger.warn(
          `Org profiles config at "${this.profilesConfigPath}" does not define a "${DEFAULT_PROFILE_CODE}" profile. Injecting built‑in default profile.`,
        );
        this.profileTemplates[DEFAULT_PROFILE_CODE] =
          this.buildHardcodedDefaultProfile();
      }

      this.logger.log(
        `Loaded ${Object.keys(this.profileTemplates).length} org profile templates from YAML config.`,
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : String(error ?? '');
      this.logger.error(
        `Failed to load org profiles config from "${this.profilesConfigPath}": ${message}. Falling back to hard‑coded default profile.`,
      );
      this.profileTemplates = {
        [DEFAULT_PROFILE_CODE]: this.buildHardcodedDefaultProfile(),
      };
    }
  }

  /**
   * Validate and normalise profile templates loaded from YAML.
   *
   * Responsibilities:
   *   - Ensure each profile has a metadata block.
   *   - Ensure metadata.version, metadata.last_updated, metadata.environment
   *     are present and strings.
   *   - Normalise metadata.environment to EnvironmentToken.
   *   - Enforce environment coherence against ENVIRONMENT when set.
   *   - Validate that the internal "_template" profile has a coherent schema,
   *     but do not expose it as a usable profile.
   */
  private validateAndNormalizeProfileTemplates(
    rawProfiles: Record<string, ProfileTemplate>,
  ): Record<string, ProfileTemplate> {
    const result: Record<string, ProfileTemplate> = {};
    const currentEnv = this.environmentToken;

    for (const [code, rawTemplate] of Object.entries(rawProfiles ?? {})) {
      if (!rawTemplate || typeof rawTemplate !== 'object') {
        this.logger.warn(
          `Profile "${code}" in org profiles config is not an object. Skipping.`,
        );
        continue;
      }

      // Basic schema presence for all profiles (including _template).
      const metadata: any = (rawTemplate as any).metadata;
      if (!metadata || typeof metadata !== 'object') {
        this.logger.error(
          `Profile "${code}" is missing required "metadata" block (metadata.version / metadata.last_updated / metadata.environment). This profile will be ignored.`,
        );
        continue;
      }

      const version =
        typeof metadata.version === 'string' && metadata.version.trim().length > 0
          ? metadata.version.trim()
          : null;
      const lastUpdated =
        typeof metadata.last_updated === 'string' &&
        metadata.last_updated.trim().length > 0
          ? metadata.last_updated.trim()
          : null;
      const envRaw =
        typeof metadata.environment === 'string' &&
        metadata.environment.trim().length > 0
          ? metadata.environment.trim()
          : null;

      const normalizedEnv = this.normalizeEnvironmentToken(envRaw);

      if (!version || !lastUpdated || !normalizedEnv) {
        this.logger.error(
          `Profile "${code}" has invalid metadata; expected non-empty string "version" and "last_updated" and a valid "environment" token. This profile will be ignored.`,
        );
        continue;
      }

      // Minimal schema sanity checks for core fields (applied to all profiles,
      // including _template).
      const template = rawTemplate as any;

      if (typeof template.description !== 'string') {
        this.logger.error(
          `Profile "${code}" is missing a string "description". This profile will be ignored.`,
        );
        continue;
      }

      if (typeof template.reactivity_seconds !== 'number') {
        this.logger.error(
          `Profile "${code}" is missing a numeric "reactivity_seconds". This profile will be ignored.`,
        );
        continue;
      }

      if (typeof template.max_escalation_seconds !== 'number') {
        this.logger.error(
          `Profile "${code}" is missing a numeric "max_escalation_seconds". This profile will be ignored.`,
        );
        continue;
      }

      if (
        !template.default_task_metadata ||
        typeof template.default_task_metadata !== 'object'
      ) {
        this.logger.error(
          `Profile "${code}" is missing the "default_task_metadata" block. This profile will be ignored.`,
        );
        continue;
      }

      // Environment coherence check.
      if (currentEnv && normalizedEnv && currentEnv !== normalizedEnv) {
        this.logger.warn(
          `Profile "${code}" declares metadata.environment="${normalizedEnv}" which does not match current ENVIRONMENT="${currentEnv}". This profile will be skipped to avoid cross-environment profile leakage.`,
        );
        // For both regular profiles and "_template", we do not load the
        // mismatched profile. "_template" remains validated but unused.
        continue;
      }

      const normalizedTemplate: ProfileTemplate = {
        ...(rawTemplate as ProfileTemplate),
        metadata: {
          version,
          last_updated: lastUpdated,
          environment: normalizedEnv,
        },
      };

      // "_template" is validated for schema coherence but never exposed
      // as a selectable profile template.
      if (code === '_template') {
        this.logger.debug(
          'Validated internal "_template" profile schema; it will not be exposed as a usable profile.',
        );
        continue;
      }

      result[code] = normalizedTemplate;
    }

    return result;
  }

  /**
   * Hard‑coded default profile matching the "default" profile from Doc 7.
   * This is used as a safety net when YAML config is unavailable or invalid.
   */
  private buildHardcodedDefaultProfile(): ProfileTemplate {
    return {
      description:
        'Default balanced organizational profile used when no more specific archetype is selected.',
      metadata: {
        version: '3.0',
        last_updated: '2025-11-19',
        environment: 'prod',
      },
      reactivity_seconds: 43_200,
      max_escalation_seconds: 172_800,
      transparency_level: 'balanced',
      escalation_granularity: 'moderate',
      review_frequency: 'monthly',
      notification_scope: 'department',
      pattern_sensitivity: 'medium',
      pattern_window_days: 30,
      pattern_min_events: 3,
      severity_threshold: 'medium',
      severity_policy: {
        critical: { immediate_escalation: true },
        major: { immediate_escalation: true },
        minor: { immediate_escalation: false },
      },
      logging_level: 'standard',
      log_retention_days: 1_095,
      automation_level: 'medium',
      default_task_metadata: {
        visibility: 'internal',
        default_priority: 'medium',
        default_reactivity_seconds: 43_200,
      },
      cyclic_overview: {
        enabled: true,
        schedule: {
          weekly: true,
          monthly: true,
          yearly: true,
        },
        threshold_triggers: {
          incident_frequency: {
            min_events: 3,
            window_days: 30,
          },
          cross_departmental_trends: true,
          high_risk_indicators: true,
        },
      },
    };
  }

  /**
   * Internal helper to fetch a profile template by code, falling back
   * to the default profile when the requested code is unknown.
   */
  private getProfileTemplate(profileCode: string): ProfileTemplate {
    const normalizedCode = profileCode || DEFAULT_PROFILE_CODE;
    const fromConfig = this.profileTemplates[normalizedCode];

    if (fromConfig) {
      return fromConfig;
    }

    if (normalizedCode !== DEFAULT_PROFILE_CODE) {
      this.logger.warn(
        `Profile code "${normalizedCode}" not found in org profiles config. Falling back to "${DEFAULT_PROFILE_CODE}" profile.`,
      );
    }

    const fallback =
      this.profileTemplates[DEFAULT_PROFILE_CODE] ??
      this.buildHardcodedDefaultProfile();

    // Cache the fallback default to avoid re‑creating it.
    if (!this.profileTemplates[DEFAULT_PROFILE_CODE]) {
      this.profileTemplates[DEFAULT_PROFILE_CODE] = fallback;
    }

    return fallback;
  }

  /**
   * Load an organization's active profile by combining:
   *   - The profile record in organization_profiles (if present), and
   *   - The profile template from the profiles YAML (Doc 7).
   *
   * If no DB row exists or the table is not yet present, the default profile
   * template is returned.
   *
   * Multi‑tenant safety:
   *   - All lookups are scoped by organization_id.
   *
   * Metadata.version is also compared (when possible) with the DB version to
   * surface mismatches in logs.
   */
  async loadProfile(organizationId: string): Promise<ResolvedOrgProfile> {
    if (!organizationId) {
      throw new Error('organizationId is required to load org profile.');
    }

    let dbProfile:
      | {
          id: string;
          organization_id: string;
          profile_code: string;
          version: number;
          reactivity_profile?: unknown;
          transparency_profile?: unknown;
          pattern_sensitivity_profile?: unknown;
          retention_profile?: unknown;
        }
      | null = null;

    try {
      // Use "any" to avoid tight coupling to a particular Prisma schema version.
      const prismaAny = this.prisma as any;
      if (
        prismaAny &&
        prismaAny.organizationProfile &&
        typeof prismaAny.organizationProfile.findUnique === 'function'
      ) {
        dbProfile = await prismaAny.organizationProfile.findUnique({
          where: { organization_id: organizationId },
        });
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : String(error ?? '');
      this.logger.warn(
        `Failed to fetch organization profile from DB for org "${organizationId}": ${message}. Continuing with YAML profile only.`,
      );
    }

    const profileCode = dbProfile?.profile_code ?? DEFAULT_PROFILE_CODE;
    const template = this.getProfileTemplate(profileCode);

    // Version tracking: compare DB version with metadata.version (major number)
    // when both are available, so operators can detect drift.
    const metadataVersion = template.metadata?.version;
    const dbVersion = dbProfile?.version;

    if (metadataVersion && typeof dbVersion === 'number') {
      const parsedMetadataVersion = Number.parseInt(
        String(metadataVersion).split('.')[0],
        10,
      );

      if (!Number.isNaN(parsedMetadataVersion)) {
        if (parsedMetadataVersion !== dbVersion) {
          this.logger.warn(
            `Organization profile version mismatch for org "${organizationId}" (profile_code="${profileCode}"): metadata.version="${metadataVersion}", organization_profiles.version=${dbVersion}.`,
          );
        }
      } else {
        this.logger.warn(
          `Unable to interpret metadata.version="${metadataVersion}" as a numeric major version for org "${organizationId}" (profile_code="${profileCode}").`,
        );
      }
    }

    return {
      organizationId,
      profileCode,
      template,
      dbProfile:
        dbProfile == null
          ? undefined
          : {
              id: dbProfile.id,
              version: dbProfile.version,
              reactivity_profile: dbProfile.reactivity_profile,
              transparency_profile: dbProfile.transparency_profile,
              pattern_sensitivity_profile: dbProfile.pattern_sensitivity_profile,
              retention_profile: dbProfile.retention_profile,
            },
    };
  }

  /**
   * Applies profile‑driven defaults to a Task/Case draft:
   *   - priority (TASK_PRIORITY)
   *   - visibility (VISIBILITY)
   *   - reactivity SLA (seconds + ISO‑8601 duration)
   *   - automation level
   *   - cyclic overview schedule (for review scheduling)
   *
   * This is the primary integration point for TaskService and
   * domain modules when deriving defaults from an organization's profile.
   */
  async applyDefaults(
    input: ApplyDefaultsInput,
  ): Promise<ApplyDefaultsResult> {
    const resolved = await this.loadProfile(input.organizationId);
    const template = resolved.template;
    const defaults = template.default_task_metadata;

    const priority =
      input.existingPriority ??
      this.normalizePriorityToken(defaults.default_priority);
    const visibility =
      input.existingVisibility ??
      this.normalizeVisibilityToken(defaults.visibility);

    const reactivitySeconds =
      input.requestedReactivitySeconds ??
      defaults.default_reactivity_seconds ??
      template.reactivity_seconds;

    const reactivityTimeIso = this.secondsToIsoDuration(reactivitySeconds);

    return {
      organizationId: input.organizationId,
      profileCode: resolved.profileCode,
      kind: input.kind,
      priority,
      visibility,
      reactivitySeconds,
      reactivityTimeIso,
      automationLevel: template.automation_level,
      cyclicOverview: template.cyclic_overview,
    };
  }

  /**
   * Simulate the impact of switching an organization to a new profile code.
   *
   * Returns a compact diff over key behavioural knobs:
   *   - Reactivity & escalation timing
   *   - Notification scope
   *   - Pattern sensitivity & windows
   *   - Logging retention
   *   - Default visibility & priority
   *
   * Used by the admin UI via OrgProfileController.previewProfileChange.
   */
  async previewProfileDiff(
    organizationId: string,
    candidateProfileCode: string,
  ): Promise<ProfileDiffResult> {
    if (!candidateProfileCode) {
      throw new Error('candidateProfileCode is required.');
    }

    const [currentResolved, candidateTemplate] = await Promise.all([
      this.loadProfile(organizationId).catch(() => null),
      Promise.resolve(this.getProfileTemplate(candidateProfileCode)),
    ]);

    const currentTemplate = currentResolved?.template ?? null;

    const currentSummary = currentTemplate
      ? this.summarizeProfile(currentResolved!.profileCode, currentTemplate)
      : null;
    const candidateSummary = this.summarizeProfile(
      candidateProfileCode,
      candidateTemplate,
    );

    const numericChanges: ProfileDiffNumericField[] = [
      this.makeNumericDiff(
        'reactivity_seconds',
        currentSummary?.reactivitySeconds ?? null,
        candidateSummary.reactivitySeconds,
      ),
      this.makeNumericDiff(
        'max_escalation_seconds',
        currentSummary?.maxEscalationSeconds ?? null,
        candidateSummary.maxEscalationSeconds,
      ),
      this.makeNumericDiff(
        'pattern_window_days',
        currentSummary?.patternWindowDays ?? null,
        candidateSummary.patternWindowDays,
      ),
      this.makeNumericDiff(
        'pattern_min_events',
        currentSummary?.patternMinEvents ?? null,
        candidateSummary.patternMinEvents,
      ),
      this.makeNumericDiff(
        'log_retention_days',
        currentSummary?.logRetentionDays ?? null,
        candidateSummary.logRetentionDays,
      ),
    ];

    const enumChanges: ProfileDiffEnumField[] = [
      this.makeEnumDiff(
        'notification_scope',
        currentSummary?.notificationScope ?? null,
        candidateSummary.notificationScope,
      ),
      this.makeEnumDiff(
        'pattern_sensitivity',
        currentSummary?.patternSensitivity ?? null,
        candidateSummary.patternSensitivity,
      ),
      this.makeEnumDiff(
        'logging_level',
        currentSummary?.loggingLevel ?? null,
        candidateSummary.loggingLevel,
      ),
      this.makeEnumDiff(
        'default_visibility',
        currentSummary?.defaultVisibility ?? null,
        candidateSummary.defaultVisibility,
      ),
      this.makeEnumDiff(
        'default_priority',
        currentSummary?.defaultPriority ?? null,
        candidateSummary.defaultPriority,
      ),
    ];

    return {
      organizationId,
      currentProfileCode: currentResolved?.profileCode ?? null,
      candidateProfileCode,
      currentProfileSummary: currentSummary,
      candidateProfileSummary: candidateSummary,
      numericChanges,
      enumChanges,
    };
  }

  /**
   * Convenience: get a ProfileSummary for the organization's active profile.
   *
   * This is a stable integration point for services that only need
   * high‑level behaviour knobs (Insights, reporting, admin dashboards).
   */
  async getProfileSummaryForOrg(
    organizationId: string,
  ): Promise<ProfileSummary> {
    const resolved = await this.loadProfile(organizationId);
    return this.summarizeProfile(resolved.profileCode, resolved.template);
  }

  /**
   * Convenience: return SLA configuration for an organization.
   *
   * Used by TaskService, WorkflowEngine and escalation modules when
   * computing reactive deadlines and escalation horizons.
   */
  async getSlaConfig(organizationId: string): Promise<OrgSlaConfig> {
    const resolved = await this.loadProfile(organizationId);
    const template = resolved.template;

    const defaultTaskReactivitySeconds =
      template.default_task_metadata.default_reactivity_seconds ??
      template.reactivity_seconds;

    return {
      reactivitySeconds: template.reactivity_seconds,
      maxEscalationSeconds: template.max_escalation_seconds,
      defaultTaskReactivitySeconds,
    };
  }

  /**
   * Convenience: default Task/Case metadata derived from the active profile.
   *
   * This is a lighter‑weight alternative to applyDefaults when callers
   * want the profile defaults without providing a full draft payload.
   */
  async getTaskDefaults(organizationId: string): Promise<OrgTaskDefaults> {
    const resolved = await this.loadProfile(organizationId);
    const template = resolved.template;
    const defaults = template.default_task_metadata;

    return {
      priority: this.normalizePriorityToken(defaults.default_priority),
      visibility: this.normalizeVisibilityToken(defaults.visibility),
      reactivitySeconds:
        defaults.default_reactivity_seconds ?? template.reactivity_seconds,
    };
  }

  /**
   * Convenience: pattern detection configuration derived from the active profile.
   *
   * Insights / analytics modules can combine this with their own aggregation
   * settings to decide detection windows and thresholds per organization.
   */
  async getPatternConfig(organizationId: string): Promise<OrgPatternConfig> {
    const resolved = await this.loadProfile(organizationId);
    const template = resolved.template;

    return {
      patternSensitivity: template.pattern_sensitivity,
      patternWindowDays: template.pattern_window_days,
      patternMinEvents: template.pattern_min_events,
    };
  }

  /**
   * Convenience: logging and retention knobs derived from the active profile.
   *
   * Logging services and data retention schedulers can use this to align
   * operational logs with organizational expectations.
   */
  async getLoggingConfig(organizationId: string): Promise<OrgLoggingConfig> {
    const resolved = await this.loadProfile(organizationId);
    const template = resolved.template;

    return {
      loggingLevel: template.logging_level,
      logRetentionDays: template.log_retention_days,
    };
  }

  /**
   * Convenience: cyclic overview configuration for an organization.
   *
   * Used by Insights / reporting layers and scheduling code when setting up
   * periodic pattern reviews and systemic follow‑ups.
   */
  async getCyclicOverviewConfig(
    organizationId: string,
  ): Promise<CyclicOverviewConfig> {
    const resolved = await this.loadProfile(organizationId);
    return resolved.template.cyclic_overview;
  }

  /**
   * Build a compact summary representation of a given profile template.
   */
  private summarizeProfile(
    profileCode: string,
    template: ProfileTemplate,
  ): ProfileSummary {
    const defaultVisibility = this.normalizeVisibilityToken(
      template.default_task_metadata.visibility,
    );
    const defaultPriority = this.normalizePriorityToken(
      template.default_task_metadata.default_priority,
    );

    return {
      profileCode,
      description: template.description,
      reactivitySeconds: template.reactivity_seconds,
      maxEscalationSeconds: template.max_escalation_seconds,
      notificationScope: template.notification_scope,
      patternSensitivity: template.pattern_sensitivity,
      patternWindowDays: template.pattern_window_days,
      patternMinEvents: template.pattern_min_events,
      loggingLevel: template.logging_level,
      logRetentionDays: template.log_retention_days,
      defaultVisibility,
      defaultPriority,
    };
  }

  private makeNumericDiff(
    field: string,
    from: number | null,
    to: number,
  ): ProfileDiffNumericField {
    let direction: ProfileDiffNumericField['direction'] = 'same';
    if (from == null) {
      direction = 'increase';
    } else if (to > from) {
      direction = 'increase';
    } else if (to < from) {
      direction = 'decrease';
    }

    return { field, from, to, direction };
  }

  private makeEnumDiff(
    field: string,
    from: string | null,
    to: string,
  ): ProfileDiffEnumField {
    return {
      field,
      from,
      to,
      changed: from == null ? true : from !== to,
    };
  }

  /**
   * Map lower‑case config values for priority to canonical TASK_PRIORITY tokens.
   */
  private normalizePriorityToken(input: LowerPriority): TaskPriorityToken {
    switch (input) {
      case 'low':
        return 'LOW';
      case 'medium':
        return 'MEDIUM';
      case 'high':
        return 'HIGH';
      case 'critical':
        return 'CRITICAL';
      default:
        return 'MEDIUM';
    }
  }

  /**
   * Map lower‑case config values for visibility to canonical VISIBILITY tokens.
   */
  private normalizeVisibilityToken(input: LowerVisibility): VisibilityToken {
    const normalized = input.toLowerCase() as LowerVisibility;

    switch (normalized) {
      case 'public':
        return 'PUBLIC';
      case 'internal':
        return 'INTERNAL';
      case 'restricted':
        return 'RESTRICTED';
      case 'anonymised':
      case 'anonymized':
        return 'ANONYMISED';
      default:
        return 'INTERNAL';
    }
  }

  /**
   * Normalise environment tokens for profile metadata and the current process
   * environment. Returns null when the value is missing or invalid.
   */
  private normalizeEnvironmentToken(
    input: string | EnvironmentToken | null | undefined,
  ): EnvironmentToken | null {
    if (!input) {
      return null;
    }

    const token = String(input).toLowerCase().trim();

    switch (token) {
      case 'dev':
      case 'staging':
      case 'prod':
      case 'offline':
        return token;
      default:
        this.logger.warn(
          `Unknown environment token "${input}" in org profiles metadata/config. Expected one of: dev, staging, prod, offline.`,
        );
        return null;
    }
  }

  /**
   * Convert a number of seconds into an ISO‑8601 duration string,
   * e.g. 3600 → "PT3600S".
   */
  private secondsToIsoDuration(seconds: number): string {
    const safeSeconds =
      typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0
        ? Math.floor(seconds)
        : 0;
    return `PT${safeSeconds}S`;
  }
}
