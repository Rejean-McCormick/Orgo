// apps/api/src/orgo/core/logging/log.service.ts

import {
  Injectable,
  Logger as NestLogger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fsp } from 'fs';
import * as path from 'path';
import {
  FN_LOG_SECURITY_EVENT,
  FN_LOG_SYSTEM_EVENT,
  FunctionalId,
  isFunctionalId,
} from '../functional-ids';

/**
 * Canonical log categories (must align with Orgo LOG_CATEGORY enum).
 */
export enum LogCategory {
  WORKFLOW = 'WORKFLOW',
  TASK = 'TASK',
  SYSTEM = 'SYSTEM',
  SECURITY = 'SECURITY',
  EMAIL = 'EMAIL',
}

/**
 * Canonical log levels (must align with Orgo LOG_LEVEL enum).
 */
export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
  CRITICAL = 'CRITICAL',
}

/**
 * VISIBILITY enum used for log/event classification.
 * Mirrors the VISIBILITY enum used in Tasks/Cases and privacy docs.
 */
export const LOG_VISIBILITY_VALUES = [
  'PUBLIC',
  'INTERNAL',
  'RESTRICTED',
  'ANONYMISED',
] as const;

export type LogVisibility = (typeof LOG_VISIBILITY_VALUES)[number];

/**
 * Behaviour/profile-level logging detail (Doc 7 – logging_level).
 */
export const PROFILE_LOGGING_LEVEL_VALUES = [
  'minimal',
  'standard',
  'detailed',
  'audit',
] as const;

export type ProfileLoggingLevel =
  (typeof PROFILE_LOGGING_LEVEL_VALUES)[number];

export type LogFormat = 'json' | 'text';

export interface LoggingCategoryConfig {
  /**
   * File name for this category, relative to the configured logDir.
   * Example: "workflow_activity.log"
   */
  file: string;

  /**
   * How long to keep rotated files (in days) before deleting.
   */
  retentionDays: number;

  /**
   * Rotation strategy:
   * - "daily" / "weekly": intended for scheduled rotateLogs() calls.
   * - "size": rotate when file exceeds maxFileSizeMb.
   */
  rotation: 'daily' | 'weekly' | 'size';

  /**
   * Max file size in megabytes before size-based rotation.
   */
  maxFileSizeMb: number;
}

export interface LoggingConfig {
  /**
   * Minimum level to actually emit logs (DEBUG < INFO < WARNING < ERROR < CRITICAL).
   */
  level: LogLevel;

  /**
   * Output format for log lines.
   */
  format: LogFormat;

  /**
   * Root directory where category log files are written.
   */
  logDir: string;

  /**
   * Per-category file/retention/rotation configuration.
   */
  categories: Record<LogCategory, LoggingCategoryConfig>;
}

/**
 * Logical log event shape as persisted to log files.
 *
 * This matches the Core Services spec (Doc 5 §9.3) with additional optional
 * context fields for multi-tenant and functional ID tracing.
 */
export interface StructuredLogEvent {
  timestamp: string; // ISO8601 UTC
  level: LogLevel;
  category: LogCategory;
  message: string;
  /**
   * Optional correlation identifier (e.g. "task_id:123").
   */
  identifier?: string;
  /**
   * Tenant / organization scope (maps to organizations.id).
   */
  organizationId?: string;
  /**
   * Stable functional identifier for the originating operation.
   * (e.g. FN_LOG_SYSTEM_EVENT, FN_ALERT_ESCALATION_DELAY)
   */
  functionId?: FunctionalId | string;
  /**
   * Event-level visibility classification.
   */
  visibility?: LogVisibility;
  /**
   * Arbitrary structured metadata.
   * When privacy rules require sanitisation, this may contain only a minimal,
   * non-sensitive subset of the original payload.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Input payload for logEvent.
 *
 * This is the canonical TS form of log_event(category, log_level, message, ...)
 * from Doc 5 §9.3, extended with tenant/functional/visibility context.
 */
export interface LogEventInput {
  /**
   * Category token; case-insensitive string or enum. Invalid values are normalised to SYSTEM.
   */
  category: LogCategory | string;

  /**
   * Level token; case-insensitive string or enum. "WARN" is treated as "WARNING".
   * Callers may use either `level` or `logLevel` (to mirror the spec).
   * If both are omitted, defaults to INFO.
   */
  level?: LogLevel | string;
  logLevel?: LogLevel | string;

  /**
   * Human-readable message.
   */
  message: string;

  /**
   * Optional correlation identifier (e.g. "task_id:123").
   */
  identifier?: string;

  /**
   * Arbitrary structured metadata that will be serialised into the log line.
   */
  metadata?: Record<string, unknown>;

  /**
   * Optional timestamp; if omitted, current time (in UTC) is used.
   */
  timestamp?: Date;

  /**
   * Stable functional identifier for the operation emitting this event.
   * When provided, it is normalised against FunctionalId and attached
   * as both top-level `functionId` and metadata.functionId/fn.
   */
  functionId?: FunctionalId | string;

  /**
   * Tenant / organization scope (maps to organizations.id).
   */
  organizationId?: string;

  /**
   * Optional user context for traceability. These are forwarded into metadata.
   */
  actorUserId?: string;
  actorRoleId?: string;

  /**
   * Visibility classification (PUBLIC / INTERNAL / RESTRICTED / ANONYMISED).
   * Used together with profileLoggingLevel / sanitizeMetadata to decide
   * whether to include or strip potentially sensitive metadata.
   */
  visibility?: LogVisibility | string;

  /**
   * Organization profile logging_level ("minimal" | "standard" | "detailed" | "audit")
   * if known to the caller (see profiles logging_level).
   */
  profileLoggingLevel?: ProfileLoggingLevel;

  /**
   * Force scrubbing of sensitive metadata fields regardless of profileLoggingLevel.
   * When true, only safe structural context (e.g. organizationId, functionId,
   * visibility) is retained in metadata; arbitrary payload fields are dropped.
   */
  sanitizeMetadata?: boolean;
}

/**
 * Numeric severity ranking for log levels (for threshold comparisons).
 */
const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 10,
  [LogLevel.INFO]: 20,
  [LogLevel.WARNING]: 30,
  [LogLevel.ERROR]: 40,
  [LogLevel.CRITICAL]: 50,
};

/**
 * Default per-category logging configuration, aligned with the core logging spec.
 * (Doc 5 §9.2 – logging_config).
 */
const DEFAULT_CATEGORY_CONFIG: Record<LogCategory, LoggingCategoryConfig> = {
  [LogCategory.WORKFLOW]: {
    file: 'workflow_activity.log',
    retentionDays: 180,
    rotation: 'weekly',
    maxFileSizeMb: 50,
  },
  [LogCategory.TASK]: {
    file: 'task_execution.log',
    retentionDays: 365,
    rotation: 'weekly',
    maxFileSizeMb: 50,
  },
  [LogCategory.SYSTEM]: {
    file: 'system_activity.log',
    retentionDays: 180,
    rotation: 'weekly',
    maxFileSizeMb: 50,
  },
  [LogCategory.SECURITY]: {
    file: 'security_events.log',
    retentionDays: 730,
    rotation: 'weekly',
    maxFileSizeMb: 20,
  },
  [LogCategory.EMAIL]: {
    file: 'email_events.log',
    retentionDays: 180,
    rotation: 'weekly',
    maxFileSizeMb: 50,
  },
};

/**
 * Core logging service for Orgo.
 *
 * Responsibilities:
 * - Provide a single structured logEvent entry point.
 * - Enforce canonical LOG_CATEGORY / LOG_LEVEL tokens.
 * - Honour a minimum log level threshold.
 * - Write structured JSON/text lines to per-category log files.
 * - Attach functional IDs and tenant/visibility context to events.
 * - Provide helpers for security/system events and log rotation.
 */
@Injectable()
export class LogService implements OnModuleInit {
  private readonly logger = new NestLogger(LogService.name);
  private readonly config: LoggingConfig;
  private readonly minLevel: LogLevel;

  constructor(private readonly configService: ConfigService) {
    this.config = this.buildConfigFromEnv();
    this.minLevel = this.config.level;
  }

  async onModuleInit(): Promise<void> {
    await this.ensureLogDirectoryExists();
  }

  /**
   * Main entry point: write a structured log event.
   *
   * This method is intentionally "fire-and-forget" from the caller’s perspective;
   * file I/O is performed asynchronously and errors are logged to the Nest logger.
   */
  logEvent(input: LogEventInput): void {
    const category = this.normalizeCategory(input.category);
    const level = this.resolveLevel(input);

    if (!this.shouldLog(level)) {
      return;
    }

    const timestamp = (input.timestamp ?? new Date()).toISOString();
    const visibility = this.normalizeVisibilityToken(
      input.visibility as string | undefined,
    );
    const normalizedFunctionId = this.normalizeFunctionId(input.functionId);

    const metadata = this.buildSafeMetadata({
      baseMetadata: input.metadata,
      organizationId: input.organizationId,
      functionId: normalizedFunctionId,
      actorUserId: input.actorUserId,
      actorRoleId: input.actorRoleId,
      visibility,
      profileLoggingLevel: input.profileLoggingLevel,
      sanitizeMetadata: input.sanitizeMetadata,
    });

    const event: StructuredLogEvent = {
      timestamp,
      level,
      category,
      message: input.message,
      identifier: input.identifier,
      organizationId: input.organizationId,
      functionId: normalizedFunctionId,
      visibility,
      metadata,
    };

    const line =
      this.config.format === 'json'
        ? JSON.stringify(event)
        : this.formatTextLine(event);

    this.logToNest(level, line);
    void this.writeToFile(category, line);
  }

  /**
   * Convenience helper for SYSTEM-category events.
   *
   * Uses FN_LOG_SYSTEM_EVENT by default when no functionId is provided.
   */
  logSystemEvent(
    message: string,
    options: Omit<LogEventInput, 'category' | 'message'> = {},
  ): void {
    const { functionId, ...rest } = options;

    this.logEvent({
      ...rest,
      category: LogCategory.SYSTEM,
      message,
      functionId: functionId ?? FN_LOG_SYSTEM_EVENT,
    });
  }

  /**
   * Convenience helper for SECURITY-category events.
   *
   * Example usage:
   *   logSecurityEvent('User login failed', {
   *     identifier: `user_id:${id}`,
   *     organizationId,
   *     actorUserId,
   *     metadata: {...},
   *   });
   *
   * Default level is WARNING when not explicitly provided.
   * Uses FN_LOG_SECURITY_EVENT by default when no functionId is provided.
   */
  logSecurityEvent(
    message: string,
    options: Omit<LogEventInput, 'category' | 'message'> & {
      level?: LogLevel | string;
    } = {},
  ): void {
    const { level, logLevel, functionId, ...rest } = options;

    this.logEvent({
      ...rest,
      category: LogCategory.SECURITY,
      message,
      // Preserve explicit level/logLevel if provided, otherwise default WARNING.
      level: level ?? logLevel ?? LogLevel.WARNING,
      functionId: functionId ?? FN_LOG_SECURITY_EVENT,
    });
  }

  /**
   * Rotate all category log files according to their configured rotation strategy.
   *
   * This is intended to be called periodically (e.g. via a cron job).
   * - For rotation: "daily" / "weekly", the current file is always rotated on invocation.
   * - For rotation: "size", this method delegates to size-based rotation as a fallback
   *   (size-based rotation is also applied on each write).
   */
  async rotateLogs(referenceDate: Date = new Date()): Promise<void> {
    const tasks: Promise<void>[] = [];

    for (const [categoryKey, categoryConfig] of Object.entries(
      this.config.categories,
    )) {
      const category = categoryKey as LogCategory;
      tasks.push(
        this.rotateCategoryLogs(category, categoryConfig, referenceDate).catch(
          (error) => {
            this.logger.error(
              `Failed to rotate logs for category "${category}": ${
                (error as Error).message
              }`,
            );
          },
        ),
      );
    }

    await Promise.all(tasks);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private buildConfigFromEnv(): LoggingConfig {
    const envLevel = this.configService.get<string>('ORGO_LOG_LEVEL');
    const envFormat = this.configService.get<string>('ORGO_LOG_FORMAT');
    const envDir = this.configService.get<string>('ORGO_LOG_DIR');

    const level =
      this.normalizeLevelToken(envLevel) ?? LogLevel.INFO; // default INFO

    const format: LogFormat =
      envFormat && envFormat.toLowerCase() === 'text' ? 'text' : 'json';

    const logDir =
      envDir && envDir.trim().length > 0
        ? path.resolve(envDir)
        : path.resolve(process.cwd(), 'logs');

    // Deep clone default category config so we can mutate per-instance safely
    const categories: Record<LogCategory, LoggingCategoryConfig> =
      {} as Record<LogCategory, LoggingCategoryConfig>;

    for (const [key, cfg] of Object.entries(DEFAULT_CATEGORY_CONFIG)) {
      const category = key as LogCategory;
      categories[category] = { ...cfg };
    }

    return {
      level,
      format,
      logDir,
      categories,
    };
  }

  private async ensureLogDirectoryExists(): Promise<void> {
    try {
      await fsp.mkdir(this.config.logDir, { recursive: true });
    } catch (error) {
      this.logger.error(
        `Failed to ensure log directory "${this.config.logDir}": ${
          (error as Error).message
        }`,
      );
    }
  }

  private normalizeLevelToken(token?: string | null): LogLevel | undefined {
    if (!token) {
      return undefined;
    }

    const upper = token.toUpperCase().trim();

    switch (upper) {
      case 'DEBUG':
        return LogLevel.DEBUG;
      case 'INFO':
        return LogLevel.INFO;
      case 'WARN':
      case 'WARNING':
        return LogLevel.WARNING;
      case 'ERROR':
        return LogLevel.ERROR;
      case 'CRITICAL':
        return LogLevel.CRITICAL;
      default:
        this.logger.warn(
          `Unknown log level token "${token}", falling back to default.`,
        );
        return undefined;
    }
  }

  /**
   * Normalise a severity value from LogEventInput.
   * Accepts both level/logLevel and defaults to INFO when neither is set.
   */
  private resolveLevel(input: LogEventInput): LogLevel {
    const candidate = input.level ?? input.logLevel ?? LogLevel.INFO;
    return this.normalizeLevel(candidate);
  }

  private normalizeLevel(level: LogLevel | string): LogLevel {
    if (Object.values(LogLevel).includes(level as LogLevel)) {
      return level as LogLevel;
    }

    const token = this.normalizeLevelToken(String(level));
    return token ?? LogLevel.INFO;
  }

  private normalizeCategory(category: LogCategory | string): LogCategory {
    if (Object.values(LogCategory).includes(category as LogCategory)) {
      return category as LogCategory;
    }

    const upper = String(category).toUpperCase().trim();
    const found = Object.values(LogCategory).find((c) => c === upper);

    if (found) {
      return found;
    }

    this.logger.warn(
      `Unknown log category "${category}", defaulting to SYSTEM.`,
    );
    return LogCategory.SYSTEM;
  }

  private normalizeVisibilityToken(
    visibility?: string | LogVisibility | null,
  ): LogVisibility | undefined {
    if (!visibility) {
      return undefined;
    }

    const upper = String(visibility).toUpperCase().trim();
    if (
      (LOG_VISIBILITY_VALUES as readonly string[]).includes(upper)
    ) {
      return upper as LogVisibility;
    }

    this.logger.warn(
      `Unknown log visibility "${visibility}", defaulting to INTERNAL.`,
    );
    return 'INTERNAL';
  }

  private normalizeFunctionId(
    functionId?: FunctionalId | string,
  ): FunctionalId | string | undefined {
    if (!functionId) {
      return undefined;
    }

    const token = String(functionId).trim();
    if (!token) {
      return undefined;
    }

    if (isFunctionalId(token)) {
      return token;
    }

    // Allow non-canonical functional IDs but keep them as plain strings.
    this.logger.warn(
      `Non-canonical functionalId "${token}" used in log event.`,
    );
    return token;
  }

  private shouldLog(level: LogLevel): boolean {
    return (
      LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[this.minLevel as LogLevel]
    );
  }

  /**
   * Build metadata for a log event, attaching tenant/functional/actor/visibility
   * context and applying privacy rules when required.
   */
  private buildSafeMetadata(input: {
    baseMetadata?: Record<string, unknown>;
    organizationId?: string;
    functionId?: FunctionalId | string;
    actorUserId?: string;
    actorRoleId?: string;
    visibility?: LogVisibility;
    profileLoggingLevel?: ProfileLoggingLevel;
    sanitizeMetadata?: boolean;
  }): Record<string, unknown> | undefined {
    const effectiveVisibility = input.visibility;
    const shouldSanitize = this.shouldSanitizeMetadata(
      effectiveVisibility,
      input.profileLoggingLevel,
      input.sanitizeMetadata,
    );

    // If we must sanitize, keep only structural, non-sensitive context.
    if (shouldSanitize) {
      const sanitized: Record<string, unknown> = {};

      if (input.organizationId) {
        sanitized.organizationId = input.organizationId;
      }

      if (input.functionId) {
        sanitized.functionId = input.functionId;
        sanitized.fn = input.functionId;
      }

      if (effectiveVisibility) {
        sanitized.visibility = effectiveVisibility;
      }

      if (input.actorUserId) {
        sanitized.actorUserId = input.actorUserId;
      }

      if (input.actorRoleId) {
        sanitized.actorRoleId = input.actorRoleId;
      }

      return Object.keys(sanitized).length > 0 ? sanitized : undefined;
    }

    // No sanitisation required → merge full metadata payload plus context.
    const metadata: Record<string, unknown> = {
      ...(input.baseMetadata ?? {}),
    };

    if (input.organizationId && metadata.organizationId == null) {
      metadata.organizationId = input.organizationId;
    }

    if (input.functionId) {
      if (metadata.functionId == null) {
        metadata.functionId = input.functionId;
      }
      if (metadata.fn == null) {
        metadata.fn = input.functionId;
      }
    }

    if (input.actorUserId && metadata.actorUserId == null) {
      metadata.actorUserId = input.actorUserId;
    }

    if (input.actorRoleId && metadata.actorRoleId == null) {
      metadata.actorRoleId = input.actorRoleId;
    }

    if (effectiveVisibility && metadata.visibility == null) {
      metadata.visibility = effectiveVisibility;
    }

    return Object.keys(metadata).length > 0 ? metadata : undefined;
  }

  /**
   * Decide whether metadata should be stripped down to non-sensitive context.
   *
   * Behaviour:
   * - explicit sanitizeMetadata=true → always sanitize.
   * - visibility=ANONYMISED → always sanitize.
   * - visibility=RESTRICTED and profileLoggingLevel is missing or "minimal"
   *   → sanitize to avoid leaking sensitive fields in operational logs.
   */
  private shouldSanitizeMetadata(
    visibility?: LogVisibility,
    profileLoggingLevel?: ProfileLoggingLevel,
    explicit?: boolean,
  ): boolean {
    if (explicit) {
      return true;
    }

    if (!visibility) {
      return false;
    }

    if (visibility === 'ANONYMISED') {
      return true;
    }

    if (
      visibility === 'RESTRICTED' &&
      (!profileLoggingLevel || profileLoggingLevel === 'minimal')
    ) {
      return true;
    }

    return false;
  }

  private formatTextLine(event: StructuredLogEvent): string {
    const parts: string[] = [
      event.timestamp,
      event.level,
      event.category,
      event.identifier ?? '-',
      event.message,
    ];

    if (event.metadata && Object.keys(event.metadata).length > 0) {
      parts.push(JSON.stringify(event.metadata));
    }

    return parts.join(' | ');
  }

  private logToNest(level: LogLevel, message: string): void {
    switch (level) {
      case LogLevel.DEBUG:
        this.logger.debug(message);
        break;
      case LogLevel.INFO:
        this.logger.log(message);
        break;
      case LogLevel.WARNING:
        this.logger.warn(message);
        break;
      case LogLevel.ERROR:
      case LogLevel.CRITICAL:
        this.logger.error(message);
        break;
      default:
        this.logger.log(message);
        break;
    }
  }

  private async writeToFile(
    category: LogCategory,
    line: string,
  ): Promise<void> {
    const categoryConfig = this.config.categories[category];
    if (!categoryConfig) {
      return;
    }

    const filePath = path.join(this.config.logDir, categoryConfig.file);

    try {
      // Size-based rotation is always enforced as a safeguard.
      await this.rotateIfNeededBySize(
        filePath,
        categoryConfig.maxFileSizeMb,
        categoryConfig.retentionDays,
      );

      await fsp.appendFile(filePath, line + '\n', { encoding: 'utf8' });
    } catch (error) {
      this.logger.error(
        `Failed to write log file "${filePath}": ${
          (error as Error).message
        }`,
      );
    }
  }

  private async rotateIfNeededBySize(
    filePath: string,
    maxFileSizeMb: number,
    retentionDays: number,
  ): Promise<void> {
    let stats;
    try {
      stats = await fsp.stat(filePath);
    } catch (error) {
      // ENOENT = file does not exist yet → nothing to rotate
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw error;
    }

    const maxBytes = maxFileSizeMb * 1024 * 1024;
    if (stats.size <= maxBytes) {
      return;
    }

    await this.rotateSingleFile(filePath, retentionDays);
  }

  private async rotateCategoryLogs(
    category: LogCategory,
    categoryConfig: LoggingCategoryConfig,
    referenceDate: Date,
  ): Promise<void> {
    const filePath = path.join(this.config.logDir, categoryConfig.file);

    // For daily/weekly rotation, we simply rotate the current file if it exists.
    if (categoryConfig.rotation === 'daily') {
      await this.rotateIfExists(filePath, categoryConfig.retentionDays);
    } else if (categoryConfig.rotation === 'weekly') {
      await this.rotateIfExists(filePath, categoryConfig.retentionDays);
    } else if (categoryConfig.rotation === 'size') {
      await this.rotateIfNeededBySize(
        filePath,
        categoryConfig.maxFileSizeMb,
        categoryConfig.retentionDays,
      );
    } else {
      this.logger.warn(
        `Unknown rotation strategy "${
          categoryConfig.rotation as string
        }" for category "${category}".`,
      );
    }

    // referenceDate is currently unused, but kept for future time-based policies.
    void referenceDate;
  }

  private async rotateIfExists(
    filePath: string,
    retentionDays: number,
  ): Promise<void> {
    try {
      await fsp.stat(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return; // nothing to rotate
      }
      throw error;
    }

    await this.rotateSingleFile(filePath, retentionDays);
  }

  private async rotateSingleFile(
    filePath: string,
    retentionDays: number,
  ): Promise<void> {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath, path.extname(filePath));
    const ext = path.extname(filePath) || '.log';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    const rotatedPath = path.join(dir, `${base}.${timestamp}${ext}`);

    try {
      await fsp.rename(filePath, rotatedPath);
    } catch (error) {
      this.logger.error(
        `Failed to rotate log file "${filePath}": ${
          (error as Error).message
        }`,
      );
      return;
    }

    await this.cleanupOldRotatedFiles(dir, base, ext, retentionDays);
  }

  private async cleanupOldRotatedFiles(
    dir: string,
    base: string,
    ext: string,
    retentionDays: number,
  ): Promise<void> {
    const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
    const now = Date.now();

    let entries: string[];
    try {
      entries = await fsp.readdir(dir);
    } catch (error) {
      this.logger.error(
        `Failed to read log directory "${dir}" for cleanup: ${
          (error as Error).message
        }`,
      );
      return;
    }

    const prefix = `${base}.`;

    const candidates = entries.filter(
      (name) => name.startsWith(prefix) && name.endsWith(ext),
    );

    const deletions: Promise<void>[] = [];

    for (const name of candidates) {
      const fullPath = path.join(dir, name);
      deletions.push(
        (async () => {
          try {
            const stats = await fsp.stat(fullPath);
            const ageMs = now - stats.mtime.getTime();
            if (ageMs > retentionMs) {
              await fsp.unlink(fullPath);
            }
          } catch (error) {
            this.logger.error(
              `Failed to evaluate or delete rotated log file "${fullPath}": ${
                (error as Error).message
              }`,
            );
          }
        })(),
      );
    }

    await Promise.all(deletions);
  }
}
