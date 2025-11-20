import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Shape of a single email attachment as seen by the email gateway.
 * This is a logical view over the underlying email_attachments table.
 */
export interface EmailAttachment {
  filename?: string | null;
  contentType?: string | null; // MIME type, e.g. "application/pdf"
  size?: number | null; // size in bytes, if known
}

/**
 * Parsed email payload shape expected by the validator.
 * Typically produced by an EmailParserService before validation.
 */
export interface ParsedEmailPayload {
  subject?: string | null;
  fromAddress?: string | null;
  toAddresses?: string[] | null;
  ccAddresses?: string[] | null;
  bccAddresses?: string[] | null;
  textBody?: string | null;
  htmlBody?: string | null;
  attachments?: EmailAttachment[] | null;

  /**
   * Optional raw size hint (in bytes). If provided, this will be used as an
   * upper bound when computing total message size.
   */
  rawSizeBytes?: number | null;
}

/**
 * Canonical service error shape for Core Services:
 * aligns with Doc 5's `{ ok, data, error }` result contract. :contentReference[oaicite:0]{index=0}
 */
export interface ServiceError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Canonical service result wrapper used by core services. :contentReference[oaicite:1]{index=1}
 */
export interface ServiceResult<T> {
  ok: boolean;
  data: T | null;
  error: ServiceError | null;
}

/**
 * High‑level summary returned on successful validation.
 */
export interface EmailValidationSummary {
  totalSizeBytes: number;
  maxSizeBytes: number;
  attachmentCount: number;
}

/**
 * Email limits derived from configuration.
 * Mirrors the `limits` section of `email_config.yaml` in Doc 5. :contentReference[oaicite:2]{index=2}
 */
export interface EmailLimitsConfig {
  maxEmailSizeMb: number;
  allowedAttachmentMimetypes: string[];
}

/**
 * Email validator for the Email Gateway.
 *
 * Responsibilities (aligned with Doc 5 §4.3–4.4):
 *  - Enforce required fields on parsed email payloads.
 *  - Enforce max total email size (default 10MB, configurable).
 *  - Enforce allowed attachment MIME types.
 *  - Return a standard `{ ok, data, error }` result shape. :contentReference[oaicite:3]{index=3}
 */
@Injectable()
export class EmailValidatorService {
  private readonly logger = new Logger(EmailValidatorService.name);

  private readonly maxEmailSizeBytes: number;
  private readonly allowedAttachmentMimetypes: Set<string>;

  // Defaults taken from the email config example in the Core Services spec. :contentReference[oaicite:4]{index=4}
  private static readonly DEFAULT_MAX_EMAIL_SIZE_MB = 10;
  private static readonly DEFAULT_ALLOWED_MIMETYPES: string[] = [
    'application/pdf',
    'image/png',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];

  constructor(private readonly configService: ConfigService) {
    const limits = this.loadLimitsFromConfig();

    this.maxEmailSizeBytes = limits.maxEmailSizeMb * 1024 * 1024;
    this.allowedAttachmentMimetypes = new Set(
      limits.allowedAttachmentMimetypes.map((mt) => mt.toLowerCase()),
    );
  }

  /**
   * Validate a parsed email payload against Orgo's email limits and invariants.
   *
   * On success:
   *   { ok: true, data: { totalSizeBytes, maxSizeBytes, attachmentCount }, error: null }
   *
   * On failure:
   *   { ok: false, data: null, error: { code, message, details: { issues: [...] } } }
   */
  validateEmailPayload(
    payload: ParsedEmailPayload,
  ): ServiceResult<EmailValidationSummary> {
    const issues: Array<{
      code: string;
      message: string;
      field?: string;
      attachmentName?: string | null;
    }> = [];

    // 1. Required fields: subject, from, to, and at least one body. :contentReference[oaicite:5]{index=5}
    if (!payload.subject || !payload.subject.trim()) {
      issues.push({
        code: 'MISSING_SUBJECT',
        message: 'Email subject is required.',
        field: 'subject',
      });
    }

    if (!payload.fromAddress || !payload.fromAddress.trim()) {
      issues.push({
        code: 'MISSING_FROM_ADDRESS',
        message: 'From address is required.',
        field: 'fromAddress',
      });
    } else if (!this.isValidEmailAddress(payload.fromAddress)) {
      issues.push({
        code: 'INVALID_FROM_ADDRESS',
        message: 'From address is not a valid email address.',
        field: 'fromAddress',
      });
    }

    const toAddresses = payload.toAddresses ?? [];
    if (!Array.isArray(toAddresses) || toAddresses.length === 0) {
      issues.push({
        code: 'MISSING_TO_ADDRESSES',
        message: 'At least one recipient (to) address is required.',
        field: 'toAddresses',
      });
    } else {
      for (const addr of toAddresses) {
        if (!this.isValidEmailAddress(addr)) {
          issues.push({
            code: 'INVALID_TO_ADDRESS',
            message: `Recipient address "${addr}" is not valid.`,
            field: 'toAddresses',
          });
        }
      }
    }

    const hasTextBody = !!(payload.textBody && payload.textBody.trim());
    const hasHtmlBody = !!(payload.htmlBody && payload.htmlBody.trim());
    if (!hasTextBody && !hasHtmlBody) {
      issues.push({
        code: 'MISSING_BODY',
        message:
          'Email body is required (either textBody or htmlBody must be non-empty).',
        field: 'textBody/htmlBody',
      });
    }

    // 2. Attachment MIME type validation against allowed list. :contentReference[oaicite:6]{index=6}
    const attachments = payload.attachments ?? [];
    for (const attachment of attachments) {
      const contentType = (attachment.contentType ?? '').toLowerCase().trim();
      // If content type is missing or not allowed, treat as invalid.
      if (!contentType || !this.allowedAttachmentMimetypes.has(contentType)) {
        issues.push({
          code: 'EMAIL_ATTACHMENT_TYPE_NOT_ALLOWED',
          message: `Attachment "${
            attachment.filename ?? 'unnamed'
          }" has disallowed or unknown MIME type "${attachment.contentType ?? 'unknown'}".`,
          field: 'attachments',
          attachmentName: attachment.filename ?? null,
        });
      }
    }

    // 3. Total size validation (payload + attachments) vs configured max. :contentReference[oaicite:7]{index=7}
    const totalSizeBytes = this.computeApproximateSize(payload);
    if (totalSizeBytes > this.maxEmailSizeBytes) {
      issues.push({
        code: 'EMAIL_SIZE_EXCEEDED',
        message: `Email exceeds maximum size of ${this.maxEmailSizeBytes} bytes.`,
        field: 'rawSizeBytes',
      });
    }

    if (issues.length > 0) {
      this.logger.warn(
        `Email validation failed with ${issues.length} issue(s). First: ${issues[0].code} – ${issues[0].message}`,
      );

      return {
        ok: false,
        data: null,
        error: {
          code: 'EMAIL_VALIDATION_ERROR',
          message: 'Parsed email payload failed validation.',
          details: { issues },
        },
      };
    }

    const summary: EmailValidationSummary = {
      totalSizeBytes,
      maxSizeBytes: this.maxEmailSizeBytes,
      attachmentCount: attachments.length,
    };

    return {
      ok: true,
      data: summary,
      error: null,
    };
  }

  /**
   * Load email limits from configuration.
   *
   * This implementation uses environment variables via Nest ConfigService:
   *   - EMAIL_MAX_SIZE_MB (number, defaults to 10)
   *   - EMAIL_ALLOWED_ATTACHMENT_MIMETYPES (comma‑separated list of MIME types)
   *
   * This is intentionally compatible with the `email_config.yaml` structure
   * described in Doc 5; a future Orgo config loader can hydrate these into
   * environment variables or ConfigService keys. :contentReference[oaicite:8]{index=8}
   */
  private loadLimitsFromConfig(): EmailLimitsConfig {
    const maxSizeFromEnv = this.configService.get<number | string>(
      'EMAIL_MAX_SIZE_MB',
    );
    const maxEmailSizeMb =
      typeof maxSizeFromEnv === 'number'
        ? maxSizeFromEnv
        : maxSizeFromEnv
        ? Number.parseInt(maxSizeFromEnv, 10)
        : EmailValidatorService.DEFAULT_MAX_EMAIL_SIZE_MB;

    const allowedFromEnv = this.configService.get<string>(
      'EMAIL_ALLOWED_ATTACHMENT_MIMETYPES',
    );

    const allowedAttachmentMimetypes =
      typeof allowedFromEnv === 'string' && allowedFromEnv.trim().length > 0
        ? allowedFromEnv
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
        : EmailValidatorService.DEFAULT_ALLOWED_MIMETYPES;

    return {
      maxEmailSizeMb:
        Number.isFinite(maxEmailSizeMb) && maxEmailSizeMb > 0
          ? maxEmailSizeMb
          : EmailValidatorService.DEFAULT_MAX_EMAIL_SIZE_MB,
      allowedAttachmentMimetypes,
    };
  }

  /**
   * Compute an approximate total size of the email (in bytes), using:
   *  - rawSizeBytes if provided (as an upper bound),
   *  - otherwise, the UTF‑8 byte length of key string fields plus attachment sizes.
   */
  private computeApproximateSize(payload: ParsedEmailPayload): number {
    // If a raw size hint is provided and positive, trust it.
    if (typeof payload.rawSizeBytes === 'number' && payload.rawSizeBytes > 0) {
      return payload.rawSizeBytes;
    }

    let total = 0;

    const addString = (value?: string | null) => {
      if (!value) return;
      total += Buffer.byteLength(value, 'utf8');
    };

    addString(payload.subject);
    addString(payload.fromAddress);

    (payload.toAddresses ?? []).forEach(addString);
    (payload.ccAddresses ?? []).forEach(addString);
    (payload.bccAddresses ?? []).forEach(addString);

    addString(payload.textBody);
    addString(payload.htmlBody);

    for (const attachment of payload.attachments ?? []) {
      if (typeof attachment.size === 'number' && attachment.size > 0) {
        total += attachment.size;
      }
      addString(attachment.filename ?? undefined);
      addString(attachment.contentType ?? undefined);
    }

    return total;
  }

  /**
   * Very conservative RFC‑2822‑style email address validator.
   * This is intentionally simple; higher‑fidelity validation can be added later.
   */
  private isValidEmailAddress(address: string): boolean {
    const trimmed = address.trim();
    if (!trimmed) {
      return false;
    }

    // Basic pattern: local@domain with at least one dot in the domain.
    const basicEmailRegex =
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    return basicEmailRegex.test(trimmed);
  }
}
