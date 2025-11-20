import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../persistence/prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export type VisibilityToken = 'PUBLIC' | 'INTERNAL' | 'RESTRICTED' | 'ANONYMISED';
export type TaskPriorityToken = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

type LowerVisibility =
  | 'public'
  | 'internal'
  | 'restricted'
  | 'anonymised'
  | 'anonymized'; // accept US spelling as alias

type LowerPriority = 'low' | 'medium' | 'high' | 'critical';

export interface ProfileDefaultTaskMetadataTemplate {
  visibility: LowerVisibility;
  default_priority: LowerPriority;
  default_reactivity_seconds: number;
}

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

export type EnvironmentToken = 'dev' | 'staging' | 'prod' | 'offline';

export interface ProfileTemplateMetadata {
  version: string;
  last_updated: string;
  environment: EnvironmentToken;
}

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

export type DefaultsTargetKind = 'task' | 'case';

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

interface ProfilesFileShape {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: any;
  profiles?: Record<string, ProfileTemplate>;
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const fromEnv = this.configService.get<string>(PROFILE_CONFIG_ENV_VAR);
    this.profilesConfigPath =
      fromEnv ??
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

      this.profileTemplates = { ...parsed.profiles };

      if (!this.profileTemplates[DEFAULT_PROFILE_CODE]) {
        this.logger.warn(
          `Org profiles config at "${this.profilesConfigPath}" does not define a "${DEFAULT_PROFILE_CODE}" profile. Injecting built‑in default profile.`,
        );
        this.profileTemplates[DEFAULT_PROFILE_CODE] =
          this.buildHardcodedDefaultProfile();
      }

      // Never expose the internal "_template" as a usable profile.
      if (this.profileTemplates._template) {
        delete this.profileTemplates._template;
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
      reactivity_seconds: 43200,
      max_escalation_seconds: 172800,
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
      log_retention_days: 1095,
      automation_level: 'medium',
      default_task_metadata: {
        visibility: 'internal',
        default_priority: 'medium',
        default_reactivity_seconds: 43200,
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
      ? this.summarizeProfile(
          currentResolved!.profileCode,
          currentTemplate,
        )
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
  private normalizePriorityToken(priority: LowerPriority | string): TaskPriorityToken {
    const value = String(priority).toLowerCase() as LowerPriority;

    switch (value) {
      case 'low':
        return 'LOW';
      case 'high':
        return 'HIGH';
      case 'critical':
        return 'CRITICAL';
      case 'medium':
      default:
        return 'MEDIUM';
    }
  }

  /**
   * Map lower‑case config values for visibility to canonical VISIBILITY tokens.
   */
  private normalizeVisibilityToken(
    visibility: LowerVisibility | string,
  ): VisibilityToken {
    const value = String(visibility).toLowerCase() as LowerVisibility;

    switch (value) {
      case 'public':
        return 'PUBLIC';
      case 'restricted':
        return 'RESTRICTED';
      case 'anonymised':
      case 'anonymized':
        return 'ANONYMISED';
      case 'internal':
      default:
        return 'INTERNAL';
    }
  }

  /**
   * Convert a number of seconds into an ISO‑8601 duration string, e.g. 3600 → "PT3600S".
   */
  private secondsToIsoDuration(seconds: number): string {
    const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
    return `PT${safe}S`;
  }
}
