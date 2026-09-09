import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  EmailService,
  EmailAddress,
} from '../../core/email/email.service';

export type AnalyticsExportFormat = 'csv' | 'json';

export interface AnalyticsExportFilters {
  orgId?: string;
  projectId?: string;
  userId?: string;
  from?: Date | string;
  to?: Date | string;
  eventTypes?: string[];
  [key: string]: unknown;
}

export interface AnalyticsExportRequest {
  /**
   * Export format. Defaults to "csv" if omitted.
   */
  format?: AnalyticsExportFormat;

  /**
   * Filters for the analytics query.
   */
  filters: AnalyticsExportFilters;

  /**
   * Timezone identifier for interpreting date filters (e.g. "UTC", "America/New_York").
   * If omitted, a default can be provided via configuration.
   */
  timezone?: string;

  /**
   * ID of the user requesting the export. Used for logging/auditing and storage metadata.
   */
  requestedByUserId: string;

  /**
   * Optional human‑readable label for the export, used in filenames and logs.
   */
  label?: string;
}

export interface AnalyticsExportResult {
  fileName: string;
  mimeType: string;
  size: number;
  rowCount: number;
  truncated: boolean;
  buffer: Buffer;
  url?: string;
  storageKey?: string;
}

export interface AnalyticsExportEmailOptions {
  to: EmailAddress | EmailAddress[];
  subject?: string;
  text?: string;
  html?: string;
}

export type AnalyticsDataRow = Record<string, unknown>;

export interface AnalyticsExportQuery {
  filters: AnalyticsExportFilters;
  timezone?: string;
}

export interface AnalyticsQueryService {
  /**
   * Returns rows suitable for export, already filtered/aggregated according to the query.
   */
  queryForExport(query: AnalyticsExportQuery): Promise<AnalyticsDataRow[]>;
}

export interface AnalyticsExportStoragePayload {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  metadata?: Record<string, unknown>;
}

export interface AnalyticsExportStorageResult {
  url?: string;
  storageKey?: string;
}

export interface AnalyticsExportStorage {
  /**
   * Persist an export file and return its storage location.
   */
  saveExport(
    payload: AnalyticsExportStoragePayload,
  ): Promise<AnalyticsExportStorageResult>;
}

export const ANALYTICS_QUERY_SERVICE = Symbol('ANALYTICS_QUERY_SERVICE');
export const ANALYTICS_EXPORT_STORAGE = Symbol('ANALYTICS_EXPORT_STORAGE');

@Injectable()
export class AnalyticsExportService {
  private readonly logger = new Logger(AnalyticsExportService.name);
  private readonly maxRows: number;
  private readonly defaultFormat: AnalyticsExportFormat;
  private readonly defaultTimezone: string;

  constructor(
    @Inject(ANALYTICS_QUERY_SERVICE)
    private readonly analyticsQueryService: AnalyticsQueryService,
    private readonly configService: ConfigService,
    @Optional()
    @Inject(ANALYTICS_EXPORT_STORAGE)
    private readonly storage?: AnalyticsExportStorage,
    @Optional()
    private readonly emailService?: EmailService,
  ) {
    const fromConfig = this.configService.get<number>(
      'INSIGHTS_EXPORT_MAX_ROWS',
    );
    const fromEnv = process.env.INSIGHTS_EXPORT_MAX_ROWS
      ? parseInt(process.env.INSIGHTS_EXPORT_MAX_ROWS, 10)
      : undefined;

    this.maxRows =
      (fromConfig && fromConfig > 0 && fromConfig) ||
      (fromEnv && fromEnv > 0 && fromEnv) ||
      100_000;

    const defaultFormat =
      this.configService.get<AnalyticsExportFormat>(
        'INSIGHTS_EXPORT_DEFAULT_FORMAT',
      ) ?? 'csv';
    this.defaultFormat = defaultFormat === 'json' ? 'json' : 'csv';

    this.defaultTimezone =
      this.configService.get<string>('INSIGHTS_DEFAULT_TIMEZONE') ??
      'UTC';
  }

  /**
   * Generate an analytics export and return the file contents and metadata.
   *
   * If a storage implementation is configured, the generated file is also persisted,
   * and its URL / storage key returned in the result.
   */
  async export(
    request: AnalyticsExportRequest,
  ): Promise<AnalyticsExportResult> {
    this.validateRequest(request);

    const format = request.format ?? this.defaultFormat;
    const timezone = request.timezone ?? this.defaultTimezone;

    const rows =
      (await this.analyticsQueryService.queryForExport({
        filters: request.filters ?? {},
        timezone,
      })) ?? [];

    let truncated = false;
    let limitedRows = rows;

    if (this.maxRows && rows.length > this.maxRows) {
      truncated = true;
      limitedRows = rows.slice(0, this.maxRows);
    }

    const { buffer, mimeType } = this.formatRows(limitedRows, format);
    const fileName = this.buildFileName(request, format);

    let url: string | undefined;
    let storageKey: string | undefined;

    if (this.storage) {
      try {
        const stored = await this.storage.saveExport({
          fileName,
          mimeType,
          buffer,
          metadata: {
            orgId: request.filters.orgId,
            projectId: request.filters.projectId,
            userId: request.filters.userId,
            requestedByUserId: request.requestedByUserId,
            label: request.label,
            format,
            rowCount: limitedRows.length,
            truncated,
            timezone,
          },
        });

        url = stored.url;
        storageKey = stored.storageKey;
      } catch (err) {
        const error = err as Error;
        this.logger.error(
          `Failed to persist analytics export "${fileName}": ${error.message}`,
        );
        // Continue and return the in‑memory file even if storage fails.
      }
    }

    const size = buffer.byteLength;

    this.logger.debug(
      `Generated analytics export "${fileName}" for user "${request.requestedByUserId}" with ${limitedRows.length} row(s)${
        truncated ? ' (truncated)' : ''
      }.`,
    );

    return {
      fileName,
      mimeType,
      size,
      rowCount: limitedRows.length,
      truncated,
      buffer,
      url,
      storageKey,
    };
  }

  /**
   * Generate an analytics export and email it to the specified recipient(s).
   *
   * If a storage backend is configured and returns a URL, the email body will
   * refer to the download link. Otherwise, the file is attached directly.
   */
  async exportAndEmail(
    request: AnalyticsExportRequest,
    emailOptions: AnalyticsExportEmailOptions,
  ): Promise<AnalyticsExportResult> {
    if (!this.emailService) {
      throw new Error(
        'EmailService is not configured for AnalyticsExportService.',
      );
    }

    const result = await this.export(request);

    const subject =
      emailOptions.subject ??
      `Your analytics export "${result.fileName}" is ready`;

    const defaultTextParts: string[] = [];

    defaultTextParts.push(
      `Your analytics export "${result.fileName}" is ready.`,
    );

    if (result.url) {
      defaultTextParts.push('');
      defaultTextParts.push(`Download link: ${result.url}`);
    } else {
      defaultTextParts.push('');
      defaultTextParts.push(
        'The export file is attached to this email.',
      );
    }

    const text =
      emailOptions.text ?? defaultTextParts.join('\n');

    const attachments =
      result.url != null
        ? undefined
        : [
            {
              filename: result.fileName,
              content: result.buffer,
              contentType: result.mimeType,
            },
          ];

    await this.emailService.send({
      to: emailOptions.to,
      subject,
      text,
      html: emailOptions.html,
      attachments,
    });

    return result;
  }

  private validateRequest(request: AnalyticsExportRequest): void {
    if (!request) {
      throw new BadRequestException('Export request is required.');
    }

    if (!request.requestedByUserId?.toString().trim()) {
      throw new BadRequestException(
        'requestedByUserId is required for analytics export.',
      );
    }

    if (!request.filters || typeof request.filters !== 'object') {
      throw new BadRequestException(
        'filters are required for analytics export.',
      );
    }

    if (
      request.format &&
      request.format !== 'csv' &&
      request.format !== 'json'
    ) {
      throw new BadRequestException(
        `Unsupported export format "${request.format}".`,
      );
    }
  }

  private formatRows(
    rows: AnalyticsDataRow[],
    format: AnalyticsExportFormat,
  ): { buffer: Buffer; mimeType: string } {
    if (format === 'json') {
      const json = this.formatAsJson(rows);
      return {
        buffer: Buffer.from(json, 'utf8'),
        mimeType: 'application/json',
      };
    }

    const csv = this.formatAsCsv(rows);
    return {
      buffer: Buffer.from(csv, 'utf8'),
      mimeType: 'text/csv',
    };
  }

  private formatAsJson(rows: AnalyticsDataRow[]): string {
    if (!rows.length) {
      return '[]';
    }

    return JSON.stringify(rows);
  }

  private formatAsCsv(rows: AnalyticsDataRow[]): string {
    if (!rows.length) {
      return '';
    }

    const headerSet = new Set<string>();

    for (const row of rows) {
      Object.keys(row || {}).forEach((key) => headerSet.add(key));
    }

    const headers = Array.from(headerSet);
    const lines: string[] = [];

    lines.push(headers.join(','));

    for (const row of rows) {
      const values = headers.map((header) =>
        this.escapeCsvValue((row as any)[header]),
      );
      lines.push(values.join(','));
    }

    return lines.join('\n');
  }

  private escapeCsvValue(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }

    const str = String(value);
    if (
      str.includes('"') ||
      str.includes(',') ||
      str.includes('\n') ||
      str.includes('\r')
    ) {
      const escaped = str.replace(/"/g, '""');
      return `"${escaped}"`;
    }

    return str;
  }

  private buildFileName(
    request: AnalyticsExportRequest,
    format: AnalyticsExportFormat,
  ): string {
    const labelPart = request.label
      ? request.label.toString().trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
      : request.filters.orgId
      ? String(request.filters.orgId)
      : 'analytics';

    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-');

    const safeLabel = labelPart.replace(/^-+|-+$/g, '') || 'analytics';

    return `analytics-export-${safeLabel}-${timestamp}.${format}`;
  }
}
