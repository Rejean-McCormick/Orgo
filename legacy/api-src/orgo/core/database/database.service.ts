import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../../persistence/prisma/prisma.service';

export type DatabaseMode = 'ONLINE' | 'OFFLINE';

export type OrgoErrorCode =
  | 'DB_CONFIG_ERROR'
  | 'DB_UNKNOWN_TABLE'
  | 'DB_QUERY_FAILED'
  | 'UNSUPPORTED_DB_MODE';

export interface OrgoError {
  code: OrgoErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Standard Orgo result shape (Doc 5 §2.4).
 * ok: true  -> data is set, error is null
 * ok: false -> data is null, error is set
 *
 * Implemented as a discriminated union so TypeScript can narrow correctly.
 */
export interface OrgoSuccess<T> {
  ok: true;
  data: T;
  error: null;
}

export interface OrgoFailure {
  ok: false;
  data: null;
  error: OrgoError;
}

export type OrgoResult<T> = OrgoSuccess<T> | OrgoFailure;

/**
 * Core Database Service for Orgo v3.
 *
 * Responsibilities (Doc 4 & Doc 5):
 * - Provide a single, central entry point to the Prisma client:
 *     DatabaseService.getPrismaClient()
 * - Implement logical persistence helpers:
 *     connectToDatabase, fetchRecords, insertRecord, updateRecord
 * - Align with the standard Orgo result shape for all operations.
 *
 * Notes:
 * - ONLINE mode uses Postgres via Prisma and DATABASE_URL (validated by ConfigModule).
 * - OFFLINE mode (SQLite) is not implemented in this starter and returns UNSUPPORTED_DB_MODE.
 */
@Injectable()
export class DatabaseService {
  private readonly logger = new Logger(DatabaseService.name);

  /**
   * Underlying Prisma client.
   * PrismaService is already configured to connect using DATABASE_URL and
   * calls $connect() in its own onModuleInit hook.
   */
  private readonly prisma: PrismaService;

  /**
   * Cached database URL, primarily for diagnostics and downstream utilities.
   */
  private readonly databaseUrl: string;

  private hasConnected = false;

  constructor(
    prismaService: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.prisma = prismaService;

    // DATABASE_URL is validated at startup by ConfigModule (environment-variables.ts),
    // but we defensively re-check here for clarity.
    const url = this.configService.get<string>('DATABASE_URL');
    if (!url) {
      this.logger.error(
        'DATABASE_URL is not set. Check your environment (.env) configuration.',
      );
      // In bootstrap, a hard failure here is acceptable; downstream OrgoResult
      // codes (DB_CONFIG_ERROR) are used for runtime connection issues.
      throw new Error('DATABASE_URL is required but was not provided.');
    }

    this.databaseUrl = url;
  }

  /**
   * Canonical entry point for anything that needs direct Prisma access.
   *
   * Functional inventory reference:
   *   Core Services / Database Ops → DatabaseService.getPrismaClient
   *   (Doc 4 – Functional Code‑Name Inventory)
   */
  getPrismaClient(): PrismaClient {
    return this.prisma;
  }

  /**
   * Returns the DATABASE_URL used by Prisma, for diagnostics / health checks.
   */
  getDatabaseUrl(): string {
    return this.databaseUrl;
  }

  /**
   * Connect to the database in the requested mode.
   *
   * Logical contract from Doc 5 §8.3 (connect_to_database).
   *
   * In this starter:
   * - Only ONLINE (Postgres via Prisma) is supported.
   * - OFFLINE (SQLite) is not implemented yet and returns UNSUPPORTED_DB_MODE.
   */
  async connectToDatabase(
    mode: DatabaseMode = 'ONLINE',
  ): Promise<OrgoResult<PrismaClient>> {
    if (mode === 'OFFLINE') {
      this.logger.error(
        "Database mode 'OFFLINE' requested, but offline/SQLite support is not implemented in this build.",
      );

      return {
        ok: false,
        data: null,
        error: {
          code: 'UNSUPPORTED_DB_MODE',
          message:
            "Database mode 'OFFLINE' is not supported in this deployment.",
          details: { mode },
        },
      };
    }

    try {
      if (!this.hasConnected) {
        await this.prisma.$connect();
        this.hasConnected = true;
        this.logger.log(
          'Successfully connected to the primary database (ONLINE).',
        );
      }

      return {
        ok: true,
        data: this.prisma,
        error: null,
      };
    } catch (err) {
      const error = err as Error;

      this.logger.error(
        `Failed to connect to database in mode '${mode}': ${error.message}`,
        error.stack,
      );

      return {
        ok: false,
        data: null,
        error: {
          code: 'DB_CONFIG_ERROR',
          message: 'Failed to connect to the database.',
          details: {
            mode,
            error: error.message,
          },
        },
      };
    }
  }

  /**
   * Fetch records from a logical table / Prisma model.
   *
   * Logical contract from Doc 5 §8.3 (fetch_records).
   *
   * This uses Prisma delegates dynamically:
   *   const delegate = (prisma as any)[table];
   *   delegate.findMany({ where })
   *
   * @param table Prisma model name (e.g. "user", "tasks", "cases").
   * @param where Optional filter object (Prisma "where" clause).
   * @param mode  ONLINE / OFFLINE (ONLINE only in this build).
   */
  async fetchRecords<T = unknown>(
    table: string,
    where?: Record<string, unknown>,
    mode: DatabaseMode = 'ONLINE',
  ): Promise<OrgoResult<T[]>> {
    const connection = await this.connectToDatabase(mode);
    if (!connection.ok) {
      return {
        ok: false,
        data: null,
        error: connection.error,
      };
    }

    const prisma = connection.data;

    try {
      const delegate = (prisma as any)[table];
      if (!delegate || typeof delegate.findMany !== 'function') {
        return {
          ok: false,
          data: null,
          error: {
            code: 'DB_UNKNOWN_TABLE',
            message: `Prisma model '${table}' does not exist on the Prisma client.`,
            details: { table },
          },
        };
      }

      const rows = await delegate.findMany({
        // Prisma treats undefined as "not provided"; passing an empty object is also fine.
        where: where ?? {},
      });

      return {
        ok: true,
        data: rows as T[],
        error: null,
      };
    } catch (err) {
      const error = err as Error;
      this.logger.error(
        `Failed to fetch records from table '${table}': ${error.message}`,
        error.stack,
      );

      return {
        ok: false,
        data: null,
        error: {
          code: 'DB_QUERY_FAILED',
          message: 'Failed to fetch records from the database.',
          details: {
            table,
            where,
            error: error.message,
          },
        },
      };
    }
  }

  /**
   * Insert a record into a logical table / Prisma model.
   *
   * Logical contract from Doc 5 §8.3 (insert_record).
   *
   * @param table Prisma model name.
   * @param data  Data object matching the Prisma model "create" input.
   * @param mode  ONLINE / OFFLINE (ONLINE only in this build).
   */
  async insertRecord<T = unknown>(
    table: string,
    data: Record<string, unknown>,
    mode: DatabaseMode = 'ONLINE',
  ): Promise<OrgoResult<T>> {
    const connection = await this.connectToDatabase(mode);
    if (!connection.ok) {
      return {
        ok: false,
        data: null,
        error: connection.error,
      };
    }

    const prisma = connection.data;

    try {
      const delegate = (prisma as any)[table];
      if (!delegate || typeof delegate.create !== 'function') {
        return {
          ok: false,
          data: null,
          error: {
            code: 'DB_UNKNOWN_TABLE',
            message: `Prisma model '${table}' does not exist on the Prisma client.`,
            details: { table },
          },
        };
      }

      const created = await delegate.create({ data });

      return {
        ok: true,
        data: created as T,
        error: null,
      };
    } catch (err) {
      const error = err as Error;
      this.logger.error(
        `Failed to insert record into table '${table}': ${error.message}`,
        error.stack,
      );

      return {
        ok: false,
        data: null,
        error: {
          code: 'DB_QUERY_FAILED',
          message: 'Failed to insert record into the database.',
          details: {
            table,
            data,
            error: error.message,
          },
        },
      };
    }
  }

  /**
   * Update a record in a logical table / Prisma model.
   *
   * Logical contract from Doc 5 §8.3 (update_record).
   *
   * @param table   Prisma model name.
   * @param key     Primary key / unique key filter (Prisma "where" clause).
   * @param updates Partial data to update (Prisma "data" clause).
   * @param mode    ONLINE / OFFLINE (ONLINE only in this build).
   */
  async updateRecord<T = unknown>(
    table: string,
    key: Record<string, unknown>,
    updates: Record<string, unknown>,
    mode: DatabaseMode = 'ONLINE',
  ): Promise<OrgoResult<T>> {
    const connection = await this.connectToDatabase(mode);
    if (!connection.ok) {
      return {
        ok: false,
        data: null,
        error: connection.error,
      };
    }

    const prisma = connection.data;

    try {
      const delegate = (prisma as any)[table];
      if (!delegate || typeof delegate.update !== 'function') {
        return {
          ok: false,
          data: null,
          error: {
            code: 'DB_UNKNOWN_TABLE',
            message: `Prisma model '${table}' does not exist on the Prisma client.`,
            details: { table },
          },
        };
      }

      const updated = await delegate.update({
        where: key,
        data: updates,
      });

      return {
        ok: true,
        data: updated as T,
        error: null,
      };
    } catch (err) {
      const error = err as Error;
      this.logger.error(
        `Failed to update record in table '${table}': ${error.message}`,
        error.stack,
      );

      return {
        ok: false,
        data: null,
        error: {
          code: 'DB_QUERY_FAILED',
          message: 'Failed to update record in the database.',
          details: {
            table,
            key,
            updates,
            error: error.message,
          },
        },
      };
    }
  }
}
