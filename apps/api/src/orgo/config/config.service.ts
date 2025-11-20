import { Injectable, Logger } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export type OrgoEnvironment = 'dev' | 'staging' | 'prod' | 'offline';

export interface ConfigMetadata {
  config_name: string;
  version: string;
  environment: OrgoEnvironment;
  last_updated: string;
  owner?: string;
  organization_id?: string;
}

export interface BaseConfig {
  metadata?: ConfigMetadata;
  // Allow arbitrary additional keys – each config file defines its own subtree.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

/**
 * Database config (database_connection.yaml)
 * Shape aligned with Doc 5 Core Services specification. :contentReference[oaicite:0]{index=0}
 */
export interface DatabasePoolConfig {
  min_connections?: number;
  max_connections?: number;
  idle_timeout_seconds?: number;
}

export interface PostgresDatabaseConfig {
  enabled?: boolean;
  url_env?: string;
  host?: string;
  port?: number;
  database?: string;
  schema?: string;
  user_env?: string;
  password_env?: string;
  pool?: DatabasePoolConfig;
}

export interface SqliteDatabaseConfig {
  enabled?: boolean;
  file_path?: string;
  timeout_seconds?: number;
}

export interface DatabaseConfig extends BaseConfig {
  postgres?: PostgresDatabaseConfig;
  sqlite?: SqliteDatabaseConfig;
}

/**
 * Email config (email_config.yaml) :contentReference[oaicite:1]{index=1}
 */
export interface SmtpConfig {
  host?: string;
  port?: number;
  use_tls?: boolean;
  use_ssl?: boolean;
  username_env?: string;
  password_env?: string;
  connection_timeout_secs?: number;
  send_timeout_secs?: number;
  max_retries?: number;
  retry_backoff_secs?: number;
}

export interface ImapConfig {
  host?: string;
  port?: number;
  use_ssl?: boolean;
  username_env?: string;
  password_env?: string;
  connection_timeout_secs?: number;
  read_timeout_secs?: number;
  folder?: string;
}

export interface EmailLimitsConfig {
  max_email_size_mb?: number;
  allowed_attachment_mimetypes?: string[];
}

export interface EmailConfig extends BaseConfig {
  smtp?: SmtpConfig;
  imap?: ImapConfig;
  limits?: EmailLimitsConfig;
}

/**
 * Logging config (logging_config.yaml) :contentReference[oaicite:2]{index=2}
 */
export type LogLevel = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
export type LogCategory =
  | 'WORKFLOW'
  | 'TASK'
  | 'SYSTEM'
  | 'SECURITY'
  | 'EMAIL';

export interface LoggingRootConfig {
  level?: LogLevel;
  format?: 'json' | 'text';
  log_dir?: string;
}

export interface LoggingCategoryConfig {
  file?: string;
  retention_days?: number;
  rotation?: 'daily' | 'weekly' | 'size';
  max_file_size_mb?: number;
}

export interface LoggingConfig extends BaseConfig {
  logging?: LoggingRootConfig;
  categories?: Partial<Record<LogCategory | string, LoggingCategoryConfig>>;
}

/**
 * Notification config (notification_config.yaml) :contentReference[oaicite:3]{index=3}
 */
export type NotificationChannel = 'EMAIL' | 'SMS' | 'IN_APP' | 'WEBHOOK';

export interface NotificationChannelsConfig {
  email?: {
    enabled?: boolean;
    sender_name?: string;
    sender_address?: string;
  };
  in_app?: {
    enabled?: boolean;
  };
  sms?: {
    enabled?: boolean;
  };
  webhook?: {
    enabled?: boolean;
  };
}

export interface NotificationTemplatesConfig {
  task_created?: string;
  task_assignment?: string;
  task_escalation?: string;
  task_completed?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [templateId: string]: any;
}

export interface NotificationConfig extends BaseConfig {
  notifications?: {
    default_channel?: NotificationChannel;
    channels?: NotificationChannelsConfig;
    templates?: NotificationTemplatesConfig;
  };
}

/**
 * Insights config (config.yaml – wrapper around `insights:` subtree). :contentReference[oaicite:4]{index=4}
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface InsightsConfig extends BaseConfig {
  insights?: any;
}

/**
 * Profiles YAML (organization_profiles.yaml – top-level `profiles:` map). :contentReference[oaicite:5]{index=5}
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ProfilesConfig {
  profiles: Record<string, any>;
}

export interface GlobalConfigSnapshot {
  environment: OrgoEnvironment;
  configBasePath: string;
  database: DatabaseConfig | null;
  email: EmailConfig | null;
  logging: LoggingConfig | null;
  notifications: NotificationConfig | null;
  insights: InsightsConfig | null;
  profiles: ProfilesConfig | null;
}

export class ConfigValidationError extends Error {
  constructor(message: string, public readonly filePath?: string) {
    super(filePath ? `${message} (config file: ${filePath})` : message);
  }
}

@Injectable()
export class ConfigService {
  private readonly logger = new Logger(ConfigService.name);

  private readonly env: OrgoEnvironment;
  private readonly basePath: string;

  private readonly cache = new Map<string, BaseConfig>();

  private static readonly VALID_ENVIRONMENTS: OrgoEnvironment[] = [
    'dev',
    'staging',
    'prod',
    'offline',
  ];

  private static readonly VALID_LOG_LEVELS: LogLevel[] = [
    'DEBUG',
    'INFO',
    'WARNING',
    'ERROR',
    'CRITICAL',
  ];

  private static readonly VALID_LOG_CATEGORIES: LogCategory[] = [
    'WORKFLOW',
    'TASK',
    'SYSTEM',
    'SECURITY',
    'EMAIL',
  ];

  private static readonly VALID_NOTIFICATION_CHANNELS: NotificationChannel[] =
    ['EMAIL', 'SMS', 'IN_APP', 'WEBHOOK'];

  constructor(private readonly nestConfig: NestConfigService) {
    this.env = this.resolveEnvironment();
    this.basePath = this.resolveBasePath();

    this.logger.log(
      `Initialising Orgo ConfigService (env="${this.env}", basePath="${this.basePath}")`,
    );

    // Validate core configs eagerly so the app fails fast on misconfiguration.
    this.ensureCoreConfigsLoaded();
  }

  /**
   * Returns the canonical Orgo environment inferred from env vars.
   */
  getEnvironment(): OrgoEnvironment {
    return this.env;
  }

  /**
   * Returns the absolute base path where Orgo YAML configs are expected.
   */
  getConfigBasePath(): string {
    return this.basePath;
  }

  /**
   * Returns a merged view of key Orgo configuration slices.
   */
  getGlobalConfig(): GlobalConfigSnapshot {
    return {
      environment: this.env,
      configBasePath: this.basePath,
      database: this.getDatabaseConfig(false),
      email: this.getEmailConfig(false),
      logging: this.getLoggingConfig(false),
      notifications: this.getNotificationConfig(false),
      insights: this.getInsightsConfig(false),
      profiles: this.getProfilesConfig(false),
    };
  }

  /**
   * Load and validate database_connection.yaml.
   */
  getDatabaseConfig(required = true): DatabaseConfig | null {
    const config = this.loadYamlFile<DatabaseConfig>(
      'database/database_connection.yaml',
      { required, validateMetadata: true },
    );
    if (!config) {
      return null;
    }
    this.validateDatabaseConfig(config, 'database/database_connection.yaml');
    return config;
  }

  /**
   * Load and validate email_config.yaml.
   */
  getEmailConfig(required = true): EmailConfig | null {
    const config = this.loadYamlFile<EmailConfig>('email/email_config.yaml', {
      required,
      validateMetadata: true,
    });
    if (!config) {
      return null;
    }
    this.validateEmailConfig(config, 'email/email_config.yaml');
    return config;
  }

  /**
   * Load and validate logging_config.yaml.
   */
  getLoggingConfig(required = true): LoggingConfig | null {
    const config = this.loadYamlFile<LoggingConfig>(
      'logging/logging_config.yaml',
      {
        required,
        validateMetadata: true,
      },
    );
    if (!config) {
      return null;
    }
    this.validateLoggingConfig(config, 'logging/logging_config.yaml');
    return config;
  }

  /**
   * Load and validate notification_config.yaml.
   */
  getNotificationConfig(required = true): NotificationConfig | null {
    const config = this.loadYamlFile<NotificationConfig>(
      'notifications/notification_config.yaml',
      { required, validateMetadata: true },
    );
    if (!config) {
      return null;
    }
    this.validateNotificationConfig(
      config,
      'notifications/notification_config.yaml',
    );
    return config;
  }

  /**
   * Load and validate insights/config.yaml.
   */
  getInsightsConfig(required = true): InsightsConfig | null {
    const config = this.loadYamlFile<InsightsConfig>('insights/config.yaml', {
      required,
      validateMetadata: true,
    });
    if (!config) {
      return null;
    }
    // Additional invariants for insights are mostly enforced by Insights module itself;
    // here we only validate common metadata.
    return config;
  }

  /**
   * Load profiles YAML (organization profiles). This file uses per-profile metadata
   * rather than a single top-level metadata block, so metadata validation is skipped. :contentReference[oaicite:6]{index=6}
   */
  getProfilesConfig(required = true): ProfilesConfig | null {
    const config = this.loadYamlFile<ProfilesConfig>(
      'profiles/organization_profiles.yaml',
      {
        required,
        validateMetadata: false,
      },
    );
    if (!config) {
      return null;
    }
    if (!config.profiles || typeof config.profiles !== 'object') {
      throw new ConfigValidationError(
        'Profiles config must contain a top-level "profiles" map',
        'profiles/organization_profiles.yaml',
      );
    }
    return config;
  }

  /**
   * Placeholder for future updates via admin APIs.
   * Aligns with Doc 4 entry ConfigService.updateServiceConfig. :contentReference[oaicite:7]{index=7}
   *
   * This method is intentionally conservative and only supports in-process updates;
   * persisting config changes back to YAML and writing audit logs should be handled
   * by a dedicated configuration management flow.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async updateServiceConfig(
    // e.g. "email", "logging", "database", "notifications", "insights"
    logicalServiceName: string,
    // New config subtree to apply (already validated at DTO level).
    value: any,
  ): Promise<void> {
    this.logger.warn(
      `updateServiceConfig("${logicalServiceName}") called, but dynamic persistence is not yet implemented. ` +
        'You can implement YAML write-back and audit logging here when enabling the admin config UI.',
    );
    // No-op for now – config is read-only at runtime.
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private resolveEnvironment(): OrgoEnvironment {
    const explicit =
      this.nestConfig.get<string>('ORGO_ENV') ?? process.env.ORGO_ENV;
    const nodeEnv =
      this.nestConfig.get<string>('NODE_ENV') ?? process.env.NODE_ENV;

    let raw = (explicit ?? nodeEnv ?? 'dev').toLowerCase();

    if (raw === 'development') {
      raw = 'dev';
    }
    if (raw === 'production') {
      raw = 'prod';
    }

    if (
      (ConfigService.VALID_ENVIRONMENTS as string[]).includes(
        raw as OrgoEnvironment,
      )
    ) {
      return raw as OrgoEnvironment;
    }

    this.logger.warn(
      `Unknown environment "${raw}", falling back to "dev". Expected one of: ${ConfigService.VALID_ENVIRONMENTS.join(
        ', ',
      )}`,
    );
    return 'dev';
  }

  private resolveBasePath(): string {
    const override =
      this.nestConfig.get<string>('ORGO_CONFIG_BASE_PATH') ??
      process.env.ORGO_CONFIG_BASE_PATH;

    if (override) {
      return path.resolve(override);
    }

    // At runtime the API app usually executes from apps/api or apps/api/dist.
    // Going two levels up reaches the monorepo root, then /config.
    return path.resolve(process.cwd(), '..', '..', 'config');
  }

  /**
   * Eagerly load and validate core configs so the app fails fast on misconfiguration.
   */
  private ensureCoreConfigsLoaded(): void {
    try {
      // Database & logging are required for any serious deployment.
      this.getDatabaseConfig(true);
      this.getLoggingConfig(true);

      // Email, notifications and insights may be optional; load if present.
      this.getEmailConfig(false);
      this.getNotificationConfig(false);
      this.getInsightsConfig(false);
      this.getProfilesConfig(false);
    } catch (error) {
      if (error instanceof ConfigValidationError) {
        this.logger.error(error.message);
      } else {
        this.logger.error(
          `Unexpected error while loading Orgo config: ${
            (error as Error)?.message ?? String(error)
          }`,
        );
      }
      // Re-throw so NestJS fails the bootstrap process.
      throw error;
    }
  }

  /**
   * Load a YAML file from the config base path, optionally validate metadata,
   * and cache the result for subsequent calls.
   */
  private loadYamlFile<T extends BaseConfig>(
    relativePath: string,
    options: { required?: boolean; validateMetadata?: boolean } = {},
  ): T | null {
    const { required = true, validateMetadata = true } = options;

    if (this.cache.has(relativePath)) {
      return this.cache.get(relativePath) as T;
    }

    const absolutePath = path.resolve(this.basePath, relativePath);

    if (!fs.existsSync(absolutePath)) {
      const message = `Config file not found at ${absolutePath}`;
      if (required) {
        throw new ConfigValidationError(message, relativePath);
      }
      this.logger.warn(message);
      return null;
    }

    const fileContents = fs.readFileSync(absolutePath, 'utf8');
    const parsed = yaml.load(fileContents) as T;

    if (!parsed || typeof parsed !== 'object') {
      throw new ConfigValidationError(
        'Config file did not contain a YAML object at the top level',
        relativePath,
      );
    }

    if (validateMetadata) {
      this.validateMetadata(parsed, relativePath);
    }

    this.cache.set(relativePath, parsed);
    return parsed;
  }

  private validateMetadata(config: BaseConfig, relativePath: string): void {
    if (!config.metadata || typeof config.metadata !== 'object') {
      throw new ConfigValidationError(
        'Missing or invalid "metadata" section',
        relativePath,
      );
    }

    const { config_name, version, environment, last_updated } = config.metadata;

    if (!config_name || typeof config_name !== 'string') {
      throw new ConfigValidationError(
        '"metadata.config_name" must be a non-empty string',
        relativePath,
      );
    }

    if (!version || typeof version !== 'string') {
      throw new ConfigValidationError(
        '"metadata.version" must be a non-empty string',
        relativePath,
      );
    }

    // Doc 2: version must match ^3\.[0-9]+$ for Orgo v3 configs. :contentReference[oaicite:8]{index=8}
    const versionPattern = /^3\.[0-9]+$/;
    if (!versionPattern.test(version)) {
      throw new ConfigValidationError(
        `"metadata.version" must match ${versionPattern.source} for Orgo v3 configs`,
        relativePath,
      );
    }

    if (!environment || typeof environment !== 'string') {
      throw new ConfigValidationError(
        '"metadata.environment" must be set',
        relativePath,
      );
    }

    if (
      !ConfigService.VALID_ENVIRONMENTS.includes(
        environment as OrgoEnvironment,
      )
    ) {
      throw new ConfigValidationError(
        `"metadata.environment" must be one of ${ConfigService.VALID_ENVIRONMENTS.join(
          ', ',
        )}`,
        relativePath,
      );
    }

    if (!last_updated || typeof last_updated !== 'string') {
      throw new ConfigValidationError(
        '"metadata.last_updated" must be a non-empty string in YYYY-MM-DD format',
        relativePath,
      );
    }

    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!datePattern.test(last_updated)) {
      throw new ConfigValidationError(
        '"metadata.last_updated" must be in YYYY-MM-DD format',
        relativePath,
      );
    }
  }

  private validateDatabaseConfig(
    config: DatabaseConfig,
    relativePath: string,
  ): void {
    const postgresEnabled = !!config.postgres?.enabled;
    const sqliteEnabled = !!config.sqlite?.enabled;

    // Doc 2/5: exactly one of postgres.enabled / sqlite.enabled may be true. 
    if (postgresEnabled && sqliteEnabled) {
      throw new ConfigValidationError(
        'Only one of postgres.enabled or sqlite.enabled can be true',
        relativePath,
      );
    }

    if (!postgresEnabled && !sqliteEnabled) {
      this.logger.warn(
        `Neither Postgres nor SQLite is enabled in ${relativePath} – database-dependent services may fail.`,
      );
    }

    if (config.postgres?.pool) {
      const { min_connections, max_connections } = config.postgres.pool;
      if (
        typeof min_connections === 'number' &&
        typeof max_connections === 'number' &&
        min_connections > max_connections
      ) {
        throw new ConfigValidationError(
          'postgres.pool.min_connections must be <= postgres.pool.max_connections',
          relativePath,
        );
      }
    }

    if (sqliteEnabled && !config.sqlite?.file_path) {
      this.logger.warn(
        `SQLite is enabled but "sqlite.file_path" is not set in ${relativePath}`,
      );
    }
  }

  private validateEmailConfig(
    config: EmailConfig,
    relativePath: string,
  ): void {
    const hasSmtpHost = !!config.smtp?.host;
    const hasImapHost = !!config.imap?.host;

    // Doc 2/5: at least one of SMTP/IMAP should be configured. 
    if (!hasSmtpHost && !hasImapHost) {
      this.logger.warn(
        `Neither SMTP nor IMAP host is configured in ${relativePath} – email send/receive may be disabled.`,
      );
    }

    if (!config.limits) {
      throw new ConfigValidationError(
        '"limits" section is required in email config',
        relativePath,
      );
    }

    if (
      typeof config.limits.max_email_size_mb !== 'number' ||
      config.limits.max_email_size_mb <= 0
    ) {
      throw new ConfigValidationError(
        '"limits.max_email_size_mb" must be a positive number',
        relativePath,
      );
    }

    if (
      !Array.isArray(config.limits.allowed_attachment_mimetypes) ||
      config.limits.allowed_attachment_mimetypes.length === 0
    ) {
      throw new ConfigValidationError(
        '"limits.allowed_attachment_mimetypes" must be a non-empty array',
        relativePath,
      );
    }
  }

  private validateLoggingConfig(
    config: LoggingConfig,
    relativePath: string,
  ): void {
    if (!config.logging) {
      throw new ConfigValidationError(
        'Missing "logging" root block in logging config',
        relativePath,
      );
    }

    const level = config.logging.level;
    if (
      level &&
      !ConfigService.VALID_LOG_LEVELS.includes(level as LogLevel)
    ) {
      throw new ConfigValidationError(
        `"logging.level" must be one of ${ConfigService.VALID_LOG_LEVELS.join(
          ', ',
        )}`,
        relativePath,
      );
    }

    if (config.categories) {
      Object.keys(config.categories).forEach((categoryKey) => {
        if (
          !ConfigService.VALID_LOG_CATEGORIES.includes(
            categoryKey as LogCategory,
          )
        ) {
          this.logger.warn(
            `Unknown log category "${categoryKey}" in ${relativePath} – this is allowed but will not map to a canonical LOG_CATEGORY value.`,
          );
        }
      });
    }
  }

  private validateNotificationConfig(
    config: NotificationConfig,
    relativePath: string,
  ): void {
    if (!config.notifications) {
      throw new ConfigValidationError(
        'Missing "notifications" root block in notification config',
        relativePath,
      );
    }

    const { default_channel } = config.notifications;

    if (
      default_channel &&
      !ConfigService.VALID_NOTIFICATION_CHANNELS.includes(
        default_channel as NotificationChannel,
      )
    ) {
      throw new ConfigValidationError(
        `"notifications.default_channel" must be one of ${ConfigService.VALID_NOTIFICATION_CHANNELS.join(
          ', ',
        )}`,
        relativePath,
      );
    }

    if (!config.notifications.templates) {
      this.logger.warn(
        `No notification templates defined under "notifications.templates" in ${relativePath}`,
      );
    }
  }
}
