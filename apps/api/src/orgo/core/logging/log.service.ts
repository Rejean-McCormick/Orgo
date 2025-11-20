import {
  Injectable,
  Logger as NestLogger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fsp } from 'fs';
import * as path from 'path';

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

export interface StructuredLogEvent {
  timestamp: string; // ISO8601 UTC
  level: LogLevel;
  category: LogCategory;
  message: string;
  identifier?: string;
  metadata?: Record<string, unknown>;
}

export interface LogEventInput {
  /**
   * Category token; case-insensitive string or enum. Invalid values are normalised to SYSTEM.
   */
  category: LogCategory | string;

  /**
   * Level token; case-insensitive string or enum. "WARN" is treated as "WARNING".
   */
  level: LogLevel | string;

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
 * - Provide helpers for security events and log rotation.
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
    const level = this.normalizeLevel(input.level);

    if (!this.shouldLog(level)) {
      return;
    }

    const event: StructuredLogEvent = {
      timestamp: (input.timestamp ?? new Date()).toISOString(),
      level,
      category,
      message: input.message,
      identifier: input.identifier,
      metadata: input.metadata,
    };

    const line =
      this.config.format === 'json'
        ? JSON.stringify(event)
        : this.formatTextLine(event);

    this.logToNest(level, line);
    void this.writeToFile(category, line);
  }

  /**
   * Convenience helper for SECURITY-category events.
   *
   * Example usage:
   *   logSecurityEvent('User login failed', { identifier: `user_id:${id}`, metadata: {...} });
   */
  logSecurityEvent(
    message: string,
    options: Omit<LogEventInput, 'category' | 'level' | 'message'> & {
      level?: LogLevel | string;
    } = {},
  ): void {
    this.logEvent({
      category: LogCategory.SECURITY,
      level: options.level ?? LogLevel.WARNING,
      message,
      identifier: options.identifier,
      metadata: options.metadata,
      timestamp: options.timestamp,
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

  private normalizeLevelToken(token?: string | null): LogLevel | null {
    if (!token) {
      return null;
    }

    const upper = token.toUpperCase().trim();

    if (upper === 'WARN') {
      return LogLevel.WARNING;
    }

    const values = Object.values(LogLevel);
    if (values.includes(upper as LogLevel)) {
      return upper as LogLevel;
    }

    this.logger.warn(
      `Unknown ORGO_LOG_LEVEL "${token}", falling back to default level.`,
    );
    return null;
  }

  private normalizeLevel(level: LogLevel | string): LogLevel {
    if (Object.values(LogLevel).includes(level as LogLevel)) {
      return level as LogLevel;
    }
    const normalised = this.normalizeLevelToken(String(level));
    return normalised ?? LogLevel.INFO;
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

  private shouldLog(level: LogLevel): boolean {
    return (
      LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[this.minLevel as LogLevel]
    );
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
