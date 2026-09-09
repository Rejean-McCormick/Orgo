// apps/api/src/orgo/config/config.service.ts

import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

/**
 * Configuration scope identifiers.
 */
export type OrgoConfigScope = 'base' | 'environment' | 'org';

/**
 * The environment name used to select environment-level configuration.
 */
export type OrgoEnvironmentName = string;

/**
 * Email configuration slice.
 *
 * This type is intentionally permissive: only core fields are typed,
 * while additional keys from YAML are preserved via index signatures.
 */
export interface EmailConfig {
  enabled?: boolean;
  provider?: string;
  fromAddress?: string;
  replyToAddress?: string;
  transactionalDomain?: string;
  /**
   * Map of template keys to template identifiers (e.g. provider template IDs).
   */
  templates?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Per-channel notification configuration.
 */
export interface NotificationChannelConfig {
  enabled?: boolean;
  [key: string]: unknown;
}

/**
 * Notifications configuration slice.
 */
export interface NotificationsConfig {
  enabled?: boolean;
  channels?: {
    email?: NotificationChannelConfig;
    sms?: NotificationChannelConfig;
    push?: NotificationChannelConfig;
    in_app?: NotificationChannelConfig;
    [channel: string]: NotificationChannelConfig | undefined;
  };
  digest?: {
    enabled?: boolean;
    /**
     * Cron expression or similar schedule identifier.
     */
    cron?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Insights/analytics configuration slice.
 */
export interface InsightsConfig {
  enabled?: boolean;
  /**
   * Sampling rate between 0 and 1.
   */
  samplingRate?: number;
  /**
   * Data retention in days.
   */
  retentionDays?: number;
  /**
   * Destinations (e.g. warehouses, streams, external tools).
   */
  destinations?: {
    [destinationName: string]: {
      enabled?: boolean;
      [key: string]: unknown;
    };
  };
  [key: string]: unknown;
}

/**
 * Profile / feature-flag configuration slice.
 *
 * This allows:
 * - A top-level `feature_flags` map for simple feature toggles.
 * - Arbitrary profiles under `profiles` if the docs define those.
 */
export interface OrgProfilesConfig {
  default_profile?: string;
  feature_flags?: {
    [flagName: string]: boolean;
  };
  profiles?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Workflows configuration slice.
 *
 * The shape of workflow definitions is domain-specific, so it is kept generic.
 */
export interface WorkflowsConfig {
  [workflowKey: string]: unknown;
}

/**
 * Top-level config object as loaded from YAML, after normalization.
 *
 * This includes environment-level configuration plus module-level slices.
 */
export interface OrgoConfig {
  /**
   * Free-form environment label. May be duplicated by `environment`.
   */
  env?: OrgoEnvironmentName;
  /**
   * Alternative field for environment name.
   */
  environment?: OrgoEnvironmentName;

  /**
   * Module-level configuration slices.
   */
  email?: EmailConfig;
  notifications?: NotificationsConfig;
  workflows?: WorkflowsConfig;
  org_profiles?: OrgProfilesConfig;
  insights?: InsightsConfig;

  /**
   * Additional modules / keys not explicitly typed here.
   */
  [key: string]: unknown;
}

/**
 * A partial configuration used for environment-level and org-level overrides.
 */
export type OrgoConfigOverride = Partial<OrgoConfig>;

/**
 * Keys for the strongly-typed module slices that are accessed via helpers.
 */
export type OrgoModuleKey =
  | 'email'
  | 'notifications'
  | 'workflows'
  | 'org_profiles'
  | 'insights';

/**
 * Utility: detects plain objects.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Utility: deep merge of config objects.
 *
 * - Later objects override earlier ones.
 * - Objects are merged recursively.
 * - Arrays are replaced, not concatenated.
 * - `undefined` values do not overwrite.
 */
function deepMerge<T>(...sources: Array<Partial<T> | undefined>): T {
  const result: any = {};

  for (const source of sources) {
    if (!isPlainObject(source)) {
      continue;
    }

    for (const [key, value] of Object.entries(source)) {
      if (value === undefined) {
        continue;
      }

      if (Array.isArray(value)) {
        result[key] = value.slice();
        continue;
      }

      if (isPlainObject(value)) {
        const prev = result[key];
        if (isPlainObject(prev)) {
          result[key] = deepMerge(prev as any, value as any);
        } else {
          result[key] = deepMerge(value as any);
        }
        continue;
      }

      result[key] = value;
    }
  }

  return result as T;
}

/**
 * Service responsible for loading and merging configuration at:
 * - base scope (`base.yaml`)
 * - environment scope (`<env>.yaml`)
 * - organization scope (`orgs/<orgId>.yaml`)
 *
 * Configuration is YAML-based, normalized, and validated per slice,
 * then exposed via helpers for raw and module-level access.
 */
@Injectable()
export class OrgoConfigService {
  private readonly logger = new Logger(OrgoConfigService.name);

  /**
   * Root directory where YAML config files live.
   *
   * Layout:
   *   base.yaml
   *   <env>.yaml
   *   orgs/
   *     <orgId>.yaml
   */
  private readonly configRoot: string;

  /**
   * Environment name, used to pick `<env>.yaml`.
   */
  private readonly environment: OrgoEnvironmentName;

  /**
   * Base (global) configuration.
   */
  private readonly baseConfig: OrgoConfig;

  /**
   * Environment-level configuration overrides.
   */
  private readonly envConfig: OrgoConfigOverride;

  /**
   * Cache of org-level configuration overrides per org ID.
   */
  private readonly orgConfigCache = new Map<string, OrgoConfigOverride>();

  /**
   * Cache of fully merged config per org ID (base + env + org).
   */
  private readonly mergedOrgConfigCache = new Map<string, OrgoConfig>();

  constructor() {
    this.configRoot =
      process.env.ORGO_CONFIG_ROOT || path.resolve(process.cwd(), 'config');

    this.environment = this.detectEnvironment();

    this.baseConfig = this.loadAndNormalizeConfig(
      this.resolveConfigPath('base'),
      'base',
      false,
    ) as OrgoConfig;

    this.envConfig = this.loadAndNormalizeConfig(
      this.resolveConfigPath(this.environment),
      `environment(${this.environment})`,
      true,
    );
  }

  /**
   * Returns the effective environment name.
   *
   * Precedence: ORGO_ENV > NODE_ENV > 'development'.
   */
  private detectEnvironment(): OrgoEnvironmentName {
    const env =
      process.env.ORGO_ENV ||
      process.env.NODE_ENV ||
      'development';

    return env;
  }

  /**
   * Resolves a config path within the config root.
   *
   * Examples:
   *   resolveConfigPath('base')      -> <root>/base.yaml
   *   resolveConfigPath('staging')   -> <root>/staging.yaml
   */
  private resolveConfigPath(name: string): string {
    return path.join(this.configRoot, `${name}.yaml`);
  }

  /**
   * Resolves an org override config path.
   *
   * Example:
   *   resolveOrgConfigPath('org_123') -> <root>/orgs/org_123.yaml
   */
  private resolveOrgConfigPath(orgId: string): string {
    return path.join(this.configRoot, 'orgs', `${orgId}.yaml`);
  }

  /**
   * Loads a YAML file and returns the raw JS object, or `undefined` if missing.
   */
  private loadYamlFile(
    filePath: string,
    label: string,
    allowMissing: boolean,
  ): unknown | undefined {
    if (!fs.existsSync(filePath)) {
      if (allowMissing) {
        this.logger.debug(
          `Orgo config "${label}" file not found at ${filePath}; skipping.`,
        );
      } else {
        this.logger.warn(
          `Orgo config "${label}" file not found at ${filePath}; continuing with empty config.`,
        );
      }
      return undefined;
    }

    const contents = fs.readFileSync(filePath, 'utf8');
    if (!contents.trim()) {
      return {};
    }

    try {
      return yaml.load(contents) ?? {};
    } catch (err) {
      this.logger.error(
        `Failed to parse YAML for "${label}" at ${filePath}`,
        (err as Error).stack,
      );
      throw err;
    }
  }

  /**
   * Loads, normalizes, and validates a config object from YAML.
   */
  private loadAndNormalizeConfig(
    filePath: string,
    label: string,
    allowMissing: boolean,
  ): OrgoConfigOverride {
    const raw = this.loadYamlFile(filePath, label, allowMissing);
    if (raw === undefined) {
      return {};
    }
    return this.normalizeConfig(raw);
  }

  /**
   * Normalizes and validates a config object for the top-level shape
   * and well-known module slices.
   */
  private normalizeConfig(input: unknown): OrgoConfigOverride {
    if (input == null) {
      return {};
    }

    if (!isPlainObject(input)) {
      throw new Error(
        'Configuration root must be a plain object (YAML mapping).',
      );
    }

    const raw = input as Record<string, unknown>;
    const cfg: OrgoConfigOverride = { ...raw };

    if ('email' in raw) {
      cfg.email = this.normalizeEmailConfig(raw.email);
    }

    if ('notifications' in raw) {
      cfg.notifications = this.normalizeNotificationsConfig(raw.notifications);
    }

    if ('insights' in raw) {
      cfg.insights = this.normalizeInsightsConfig(raw.insights);
    }

    if ('org_profiles' in raw) {
      cfg.org_profiles = this.normalizeOrgProfilesConfig(raw.org_profiles);
    }

    if ('workflows' in raw && raw.workflows !== undefined) {
      if (!isPlainObject(raw.workflows)) {
        throw new Error('workflows config must be an object (YAML mapping).');
      }
      cfg.workflows = raw.workflows as WorkflowsConfig;
    }

    return cfg;
  }

  /**
   * Normalizes and validates the email slice.
   */
  private normalizeEmailConfig(input: unknown): EmailConfig {
    if (input == null) {
      return {};
    }

    if (!isPlainObject(input)) {
      throw new Error('email config must be an object (YAML mapping).');
    }

    const raw = input as Record<string, unknown>;
    const email: EmailConfig = { ...raw };

    if ('enabled' in raw && typeof raw.enabled !== 'boolean') {
      throw new Error('email.enabled must be a boolean if present.');
    }

    if ('provider' in raw && typeof raw.provider !== 'string') {
      throw new Error('email.provider must be a string if present.');
    }

    if ('fromAddress' in raw && typeof raw.fromAddress !== 'string') {
      throw new Error('email.fromAddress must be a string if present.');
    }

    if ('replyToAddress' in raw && typeof raw.replyToAddress !== 'string') {
      throw new Error('email.replyToAddress must be a string if present.');
    }

    if (
      'transactionalDomain' in raw &&
      typeof raw.transactionalDomain !== 'string'
    ) {
      throw new Error('email.transactionalDomain must be a string if present.');
    }

    if ('templates' in raw) {
      const { templates } = raw;
      if (!isPlainObject(templates)) {
        throw new Error('email.templates must be a mapping of strings.');
      }

      const normalizedTemplates: Record<string, string> = {};
      for (const [key, value] of Object.entries(templates)) {
        if (typeof value !== 'string') {
          throw new Error(
            `email.templates["${key}"] must be a string template identifier.`,
          );
        }
        normalizedTemplates[key] = value;
      }

      email.templates = normalizedTemplates;
    }

    return email;
  }

  /**
   * Normalizes and validates the notifications slice.
   */
  private normalizeNotificationsConfig(input: unknown): NotificationsConfig {
    if (input == null) {
      return {};
    }

    if (!isPlainObject(input)) {
      throw new Error('notifications config must be an object (YAML mapping).');
    }

    const raw = input as Record<string, unknown>;
    const notifications: NotificationsConfig = { ...raw };

    if ('enabled' in raw && typeof raw.enabled !== 'boolean') {
      throw new Error('notifications.enabled must be a boolean if present.');
    }

    if ('channels' in raw && raw.channels !== undefined) {
      if (!isPlainObject(raw.channels)) {
        throw new Error('notifications.channels must be an object.');
      }
      const channelsRaw = raw.channels as Record<string, unknown>;
      const channels: NotificationsConfig['channels'] = {};

      for (const [channelName, channelValue] of Object.entries(channelsRaw)) {
        if (channelValue == null) {
          continue;
        }
        if (!isPlainObject(channelValue)) {
          throw new Error(
            `notifications.channels["${channelName}"] must be an object.`,
          );
        }
        const channel: NotificationChannelConfig = { ...channelValue };
        if (
          'enabled' in channelValue &&
          typeof (channelValue as any).enabled !== 'boolean'
        ) {
          throw new Error(
            `notifications.channels["${channelName}"].enabled must be a boolean if present.`,
          );
        }
        channels[channelName] = channel;
      }

      notifications.channels = channels;
    }

    if ('digest' in raw && raw.digest !== undefined) {
      if (!isPlainObject(raw.digest)) {
        throw new Error('notifications.digest must be an object.');
      }
      const digestRaw = raw.digest as Record<string, unknown>;
      const digest: NonNullable<NotificationsConfig['digest']> = {
        ...digestRaw,
      };

      if ('enabled' in digestRaw && typeof digestRaw.enabled !== 'boolean') {
        throw new Error('notifications.digest.enabled must be a boolean.');
      }

      if ('cron' in digestRaw && typeof digestRaw.cron !== 'string') {
        throw new Error('notifications.digest.cron must be a string.');
      }

      notifications.digest = digest;
    }

    return notifications;
  }

  /**
   * Normalizes and validates the insights slice.
   */
  private normalizeInsightsConfig(input: unknown): InsightsConfig {
    if (input == null) {
      return {};
    }

    if (!isPlainObject(input)) {
      throw new Error('insights config must be an object (YAML mapping).');
    }

    const raw = input as Record<string, unknown>;
    const insights: InsightsConfig = { ...raw };

    if ('enabled' in raw && typeof raw.enabled !== 'boolean') {
      throw new Error('insights.enabled must be a boolean if present.');
    }

    if ('samplingRate' in raw) {
      const sr = raw.samplingRate;
      if (typeof sr !== 'number') {
        throw new Error('insights.samplingRate must be a number if present.');
      }
      if (sr < 0 || sr > 1) {
        throw new Error('insights.samplingRate must be between 0 and 1.');
      }
    }

    if ('retentionDays' in raw && typeof raw.retentionDays !== 'number') {
      throw new Error('insights.retentionDays must be a number if present.');
    }

    if ('destinations' in raw && raw.destinations !== undefined) {
      if (!isPlainObject(raw.destinations)) {
        throw new Error('insights.destinations must be an object.');
      }

      const destRaw = raw.destinations as Record<string, unknown>;
      const destinations: NonNullable<InsightsConfig['destinations']> = {};

      for (const [name, value] of Object.entries(destRaw)) {
        if (value == null) {
          continue;
        }
        if (!isPlainObject(value)) {
          throw new Error(
            `insights.destinations["${name}"] must be an object.`,
          );
        }
        const dest: { enabled?: boolean; [k: string]: unknown } = { ...value };

        if ('enabled' in value && typeof (value as any).enabled !== 'boolean') {
          throw new Error(
            `insights.destinations["${name}"].enabled must be a boolean if present.`,
          );
        }

        destinations[name] = dest;
      }

      insights.destinations = destinations;
    }

    return insights;
  }

  /**
   * Normalizes and validates the org_profiles slice.
   */
  private normalizeOrgProfilesConfig(input: unknown): OrgProfilesConfig {
    if (input == null) {
      return {};
    }

    if (!isPlainObject(input)) {
      throw new Error('org_profiles config must be an object (YAML mapping).');
    }

    const raw = input as Record<string, unknown>;
    const orgProfiles: OrgProfilesConfig = { ...raw };

    if (
      'default_profile' in raw &&
      raw.default_profile !== undefined &&
      typeof raw.default_profile !== 'string'
    ) {
      throw new Error('org_profiles.default_profile must be a string.');
    }

    if ('feature_flags' in raw && raw.feature_flags !== undefined) {
      if (!isPlainObject(raw.feature_flags)) {
        throw new Error('org_profiles.feature_flags must be an object.');
      }

      const flagsRaw = raw.feature_flags as Record<string, unknown>;
      const featureFlags: NonNullable<OrgProfilesConfig['feature_flags']> = {};

      for (const [name, value] of Object.entries(flagsRaw)) {
        if (typeof value !== 'boolean') {
          throw new Error(
            `org_profiles.feature_flags["${name}"] must be a boolean.`,
          );
        }
        featureFlags[name] = value;
      }

      orgProfiles.feature_flags = featureFlags;
    }

    if ('profiles' in raw && raw.profiles !== undefined) {
      if (!isPlainObject(raw.profiles)) {
        throw new Error('org_profiles.profiles must be an object.');
      }
      orgProfiles.profiles = raw.profiles as Record<string, unknown>;
    }

    return orgProfiles;
  }

  /**
   * Returns the environment name used by this service.
   */
  getEnvironment(): OrgoEnvironmentName {
    return this.environment;
  }

  /**
   * Returns the raw base configuration (already normalized and validated).
   */
  getBaseConfig(): OrgoConfig {
    return this.baseConfig;
  }

  /**
   * Returns the raw environment-level configuration (already normalized).
   */
  getEnvironmentConfig(): OrgoConfigOverride {
    return this.envConfig;
  }

  /**
   * Returns the raw organization-level configuration override for a given org,
   * loading and caching it from YAML if necessary.
   */
  getOrgConfig(orgId: string): OrgoConfigOverride {
    if (!orgId) {
      return {};
    }

    const cached = this.orgConfigCache.get(orgId);
    if (cached) {
      return cached;
    }

    const filePath = this.resolveOrgConfigPath(orgId);
    const override = this.loadAndNormalizeConfig(
      filePath,
      `org(${orgId})`,
      true,
    );

    this.orgConfigCache.set(orgId, override);
    return override;
  }

  /**
   * Returns the three-level scoped configs without merging.
   */
  getScopedConfigs(orgId?: string): {
    base: OrgoConfig;
    environment: OrgoConfigOverride;
    org: OrgoConfigOverride;
  } {
    return {
      base: this.baseConfig,
      environment: this.envConfig,
      org: orgId ? this.getOrgConfig(orgId) : {},
    };
  }

  /**
   * Returns the fully merged configuration for a given org:
   * base + environment + orgOverride.
   *
   * If `orgId` is omitted, only base + environment are merged.
   */
  getMergedConfig(orgId?: string): OrgoConfig {
    if (!orgId) {
      return deepMerge<OrgoConfig>(this.baseConfig, this.envConfig);
    }

    const cached = this.mergedOrgConfigCache.get(orgId);
    if (cached) {
      return cached;
    }

    const orgOverride = this.getOrgConfig(orgId);
    const merged = deepMerge<OrgoConfig>(
      this.baseConfig,
      this.envConfig,
      orgOverride,
    );
    this.mergedOrgConfigCache.set(orgId, merged);
    return merged;
  }

  /**
   * Returns a strongly-typed module-level configuration slice.
   *
   * Example:
   *   getModuleConfig('email', orgId)
   *   getModuleConfig('insights')
   */
  getModuleConfig<K extends OrgoModuleKey>(
    moduleKey: K,
    orgId?: string,
  ): OrgoConfig[K] | undefined {
    const merged = this.getMergedConfig(orgId);
    return merged[moduleKey] as OrgoConfig[K] | undefined;
  }

  /**
   * Convenience: get email config for an optional org.
   */
  getEmailConfig(orgId?: string): EmailConfig | undefined {
    return this.getModuleConfig('email', orgId) as EmailConfig | undefined;
  }

  /**
   * Convenience: get notifications config for an optional org.
   */
  getNotificationsConfig(orgId?: string): NotificationsConfig | undefined {
    return this.getModuleConfig(
      'notifications',
      orgId,
    ) as NotificationsConfig | undefined;
  }

  /**
   * Convenience: get insights config for an optional org.
   */
  getInsightsConfig(orgId?: string): InsightsConfig | undefined {
    return this.getModuleConfig('insights', orgId) as InsightsConfig | undefined;
  }

  /**
   * Generic getter using a dot-delimited path into the merged config.
   *
   * Examples:
   *   get('email.provider')
   *   get('notifications.channels.email.enabled', orgId)
   */
  get<T = unknown>(pathExpr: string, orgId?: string): T | undefined {
    const merged = this.getMergedConfig(orgId);
    if (!pathExpr) {
      return merged as unknown as T;
    }

    const parts = pathExpr.split('.');
    let current: any = merged;

    for (const part of parts) {
      if (current == null) {
        return undefined;
      }
      current = current[part];
    }

    return current as T | undefined;
  }

  /**
   * Returns whether a feature flag is enabled for a given org.
   *
   * Reads from:
   *   org_profiles.feature_flags[flagName]
   *
   * If the flag is not defined, returns `defaultValue` (false by default).
   */
  isFeatureEnabled(
    flagName: string,
    orgId?: string,
    defaultValue = false,
  ): boolean {
    const merged = this.getMergedConfig(orgId);
    const orgProfiles = merged.org_profiles as OrgProfilesConfig | undefined;
    const flags = orgProfiles?.feature_flags;
    if (!flags) {
      return defaultValue;
    }
    const value = flags[flagName];
    return typeof value === 'boolean' ? value : defaultValue;
  }
}
