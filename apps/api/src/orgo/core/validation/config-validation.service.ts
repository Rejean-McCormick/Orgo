import { Injectable, Logger } from '@nestjs/common';

type OrgoEnvironment = 'dev' | 'staging' | 'prod' | 'offline';

const ORGO_ENVIRONMENTS: OrgoEnvironment[] = [
  'dev',
  'staging',
  'prod',
  'offline',
];

export interface ConfigMetadata {
  config_name: string;
  version: string;
  environment: OrgoEnvironment;
  last_updated: string;
  owner?: string;
  organization_id?: string;
  // Allow additional metadata keys without forcing a strict schema here
  // (domain modules and other services may extend this).
  [key: string]: unknown;
}

export interface ConfigValidationErrorDetail {
  /**
   * JSON-style path to the offending value, e.g. "metadata.version" or "smtp.host".
   * Empty string ("") refers to the root object.
   */
  path: string;
  message: string;
}

export interface StandardError {
  code: string;
  message: string;
  details?: {
    errors?: ConfigValidationErrorDetail[];
    [key: string]: unknown;
  };
}

export interface ValidationResult<T> {
  ok: boolean;
  data: T | null;
  error: StandardError | null;
}

/**
 * Represents one config entry in a bundle (e.g., email_config, database_connection).
 */
export interface ConfigBundleItem<TConfig = any> {
  name: string;
  config: TConfig;
  requiredKeys: string[];
}

/**
 * ConfigValidatorService (validation_core)
 *
 * Cross-cutting configuration validation utilities used by Core Services and modules.
 * Implements the standard result shape and metadata/env/version checks.
 */
@Injectable()
export class ConfigValidatorService {
  private readonly logger = new Logger(ConfigValidatorService.name);

  /**
   * Validates a single configuration object against:
   * - Common metadata rules (Doc 2 §3.2, Doc 5 §10.2).
   * - Presence and basic non-null checks for required keys.
   *
   * Returns the standard result shape:
   *   { ok: true, data: config, error: null } on success
   *   { ok: false, data: null, error: { code: "CONFIG_VALIDATION_ERROR", ... } } on failure
   */
  validateConfig<T extends Record<string, any>>(
    config: T | null | undefined,
    requiredKeys: string[] = [],
  ): ValidationResult<T> {
    const errors: ConfigValidationErrorDetail[] = [];

    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      errors.push({
        path: '',
        message: 'Config must be a non-null object.',
      });

      return this.buildFailure<T>(
        'Configuration is not a valid object.',
        errors,
      );
    }

    this.validateMetadata(config as Record<string, any>, errors);
    this.validateRequiredKeys(config as Record<string, any>, requiredKeys, errors);

    if (errors.length > 0) {
      return this.buildFailure<T>(
        'One or more configuration validation errors occurred.',
        errors,
      );
    }

    return {
      ok: true,
      data: config as T,
      error: null,
    };
  }

  /**
   * Validates a bundle (set) of configuration objects.
   *
   * Each item is validated independently using validateConfig; any error in any
   * item produces a single CONFIG_VALIDATION_ERROR result containing all errors
   * with namespaced paths ("<configName>.<path>").
   *
   * On success, returns only the items that validated successfully in `data`.
   */
  validateConfigBundle(
    items: ConfigBundleItem[],
  ): ValidationResult<ConfigBundleItem[]> {
    const errors: ConfigValidationErrorDetail[] = [];
    const validItems: ConfigBundleItem[] = [];

    for (const item of items) {
      const result = this.validateConfig(item.config, item.requiredKeys);

      if (!result.ok && result.error && result.error.details?.errors) {
        for (const err of result.error.details.errors) {
          errors.push({
            path: item.name
              ? `${item.name}${err.path ? `.${err.path}` : ''}`
              : err.path,
            message: err.message,
          });
        }
      } else if (result.ok) {
        validItems.push(item);
      }
    }

    if (errors.length > 0) {
      return this.buildFailure<ConfigBundleItem[]>(
        'One or more configuration bundle validation errors occurred.',
        errors,
      );
    }

    return {
      ok: true,
      data: validItems,
      error: null,
    };
  }

  /**
   * Validates common metadata for all YAML/JSON configs under /config.
   *
   * Enforces:
   * - metadata exists and is an object
   * - metadata.config_name is non-empty
   * - metadata.environment ∈ ENVIRONMENT = { dev, staging, prod, offline }
   * - metadata.version matches ^3\.[0-9]+$ (Orgo v3 configs)
   * - metadata.last_updated is a valid YYYY-MM-DD date
   * - metadata.organization_id is "default" or a slug-like identifier
   */
  private validateMetadata(
    config: Record<string, any>,
    errors: ConfigValidationErrorDetail[],
  ): void {
    const meta = config.metadata;

    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
      errors.push({
        path: 'metadata',
        message: 'Metadata object is required on all configuration files.',
      });
      return;
    }

    const {
      config_name: configName,
      environment,
      version,
      last_updated: lastUpdated,
      organization_id: organizationId,
    } = meta as Record<string, any>;

    if (typeof configName !== 'string' || configName.trim().length === 0) {
      errors.push({
        path: 'metadata.config_name',
        message: 'metadata.config_name must be a non-empty string.',
      });
    }

    if (
      typeof environment !== 'string' ||
      !ORGO_ENVIRONMENTS.includes(environment as OrgoEnvironment)
    ) {
      errors.push({
        path: 'metadata.environment',
        message: `metadata.environment must be one of: ${ORGO_ENVIRONMENTS.join(
          ', ',
        )}.`,
      });
    }

    if (typeof version !== 'string' || !/^3\.\d+$/.test(version)) {
      errors.push({
        path: 'metadata.version',
        message:
          'metadata.version must match the pattern ^3\\.[0-9]+$ for Orgo v3 configs.',
      });
    }

    if (typeof lastUpdated !== 'string' || !this.isValidIsoDate(lastUpdated)) {
      errors.push({
        path: 'metadata.last_updated',
        message:
          'metadata.last_updated must be a valid date string in YYYY-MM-DD format.',
      });
    }

    if (organizationId !== undefined) {
      if (
        typeof organizationId !== 'string' ||
        organizationId.trim().length === 0
      ) {
        errors.push({
          path: 'metadata.organization_id',
          message:
            'metadata.organization_id, if provided, must be a non-empty string.',
        });
      } else if (
        organizationId !== 'default' &&
        !/^[a-zA-Z0-9_-]+$/.test(organizationId)
      ) {
        errors.push({
          path: 'metadata.organization_id',
          message:
            'metadata.organization_id must be "default" or a slug/identifier containing only letters, numbers, underscore or dash.',
        });
      }
    }
  }

  /**
   * Ensures required top-level keys exist and are not null/undefined/empty-string.
   */
  private validateRequiredKeys(
    config: Record<string, any>,
    requiredKeys: string[],
    errors: ConfigValidationErrorDetail[],
  ): void {
    for (const key of requiredKeys) {
      if (!(key in config)) {
        errors.push({
          path: key,
          message: `Missing required configuration key "${key}".`,
        });
        continue;
      }

      const value = config[key];

      if (
        value === null ||
        value === undefined ||
        (typeof value === 'string' && value.trim().length === 0)
      ) {
        errors.push({
          path: key,
          message: `Configuration key "${key}" must not be null, undefined or an empty string.`,
        });
      }
    }
  }

  /**
   * Basic YYYY-MM-DD validator using a regex + Date.parse.
   */
  private isValidIsoDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }

    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp);
  }

  /**
   * Builds a CONFIG_VALIDATION_ERROR result and logs it using Nest's Logger.
   */
  private buildFailure<T>(
    message: string,
    errors: ConfigValidationErrorDetail[],
  ): ValidationResult<T> {
    const error: StandardError = {
      code: 'CONFIG_VALIDATION_ERROR',
      message,
      details: {
        errors,
      },
    };

    this.logger.error(
      `[CONFIG_VALIDATION_ERROR] ${message}`,
      errors.map((e) => `${e.path || '<root>'}: ${e.message}`).join('; '),
    );

    return {
      ok: false,
      data: null,
      error,
    };
  }
}
