import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';

/**
 * Direction of the email relative to Orgo.
 * Maps to email_direction_enum ('inbound' | 'outbound').
 */
export type EmailDirection = 'inbound' | 'outbound';

/**
 * Sensitivity classification for email_message.sensitivity.
 */
export type EmailSensitivity = 'normal' | 'sensitive' | 'highly_sensitive';

/**
 * Generic address shape from common IMAP/SMTP/mailparser libraries.
 */
export interface RawEmailAddressLike {
  address: string;
  name?: string | null;
}

export type RawEmailAddressInput =
  | string
  | RawEmailAddressLike
  | Array<string | RawEmailAddressLike>;

/**
 * Raw email payload as handed off by the Email Gateway / IMAP client.
 * This is intentionally generic and library‑agnostic.
 */
export interface RawEmailPayload {
  subject?: string | null;
  from?: RawEmailAddressInput | null;
  to?: RawEmailAddressInput | null;
  cc?: RawEmailAddressInput | null;
  bcc?: RawEmailAddressInput | null;

  text?: string | null;
  html?: string | null;

  headers?: Record<string, string | string[] | undefined>;
  messageId?: string | null;

  /**
   * Optional size in bytes reported by the mail server/client.
   * If not present, the parser will estimate the size.
   */
  sizeInBytes?: number | null;

  /**
   * Attachments as emitted by the mail client / library.
   * Only metadata fields used by Orgo are required here.
   */
  attachments?: RawEmailAttachment[];

  /**
   * When the message was received by the mailbox (inbound).
   */
  receivedAt?: Date | string | null;

  /**
   * When the message was sent (outbound).
   */
  sentAt?: Date | string | null;

  /**
   * Direction hint; if omitted, parser defaults to 'inbound'.
   */
  direction?: EmailDirection;
}

/**
 * Raw attachment payload from the mail client.
 * This is intentionally minimal and may be extended later.
 */
export interface RawEmailAttachment {
  filename?: string | null;
  contentType?: string | null;
  mimeType?: string | null; // some libraries use mimeType instead of contentType
  size?: number | null; // bytes, if available
  contentId?: string | null;
  cid?: string | null; // alias for contentId
  inline?: boolean | null;
}

/**
 * Normalised attachment metadata stored alongside EMAIL_MESSAGE.
 * Aligns with the logical EMAIL_MESSAGE schema (Doc 5 §3.2). :contentReference[oaicite:0]{index=0}
 */
export interface EmailAttachmentMeta {
  filename: string | null;
  contentType: string | null;
  sizeBytes: number;
  inline: boolean;
  contentId: string | null;
  /**
   * True if the attachment's MIME type is in the allowed list
   * configured for the deployment (email_config.yaml limits). :contentReference[oaicite:1]{index=1}
   */
  allowed: boolean;
}

/**
 * Logical EMAIL_MESSAGE envelope as produced by the parser.
 * Maps 1:1 to the EMAIL_MESSAGE logical view in Doc 5 §3.2. :contentReference[oaicite:2]{index=2}
 */
export interface EmailMessageEnvelope {
  emailMessageId: string;
  organizationId: string;
  emailAccountConfigId: string | null;
  threadId: string | null;

  messageIdHeader: string | null;

  direction: EmailDirection;

  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
  bccAddresses: string[];

  subject: string;
  receivedAt: Date | null;
  sentAt: Date | null;

  rawHeaders: Record<string, string | string[]>;
  textBody: string | null;
  htmlBody: string | null;

  relatedTaskId: string | null;
  sensitivity: EmailSensitivity;

  parsedMetadata: Record<string, unknown>;
  attachmentsMeta: EmailAttachmentMeta[];
  securityFlags: Record<string, unknown>;
}

/**
 * Context supplied by the Email Gateway when parsing a message.
 * Orgo‑specific fields (organization_id, linkage, config ids). 
 */
export interface EmailParserContext {
  organizationId: string;
  emailAccountConfigId?: string | null;
  threadId?: string | null;
  relatedTaskId?: string | null;
  direction?: EmailDirection;
  /**
   * Optional override for sensitivity; if omitted, parser will derive
   * a conservative default based on headers/content.
   */
  sensitivityOverride?: EmailSensitivity;
}

/**
 * Limits and policy flags taken (eventually) from email_config.yaml. :contentReference[oaicite:4]{index=4}
 */
export interface EmailParserLimits {
  /**
   * Maximum email size (in bytes). Defaults to 10 MB if not provided.
   */
  maxEmailSizeBytes?: number;
  /**
   * Allowed MIME types for attachments; if empty/omitted, all attachment
   * types are accepted and simply marked as allowed=true.
   */
  allowedAttachmentMimeTypes?: string[];
  /**
   * If true (default), disallow emails that exceed the size limit.
   */
  enforceSizeLimit?: boolean;
}

/**
 * Standard result shape for Core Services (ok / data / error). :contentReference[oaicite:5]{index=5}
 */
export interface EmailParserResult<T> {
  ok: boolean;
  data: T | null;
  error: {
    code: EmailParserErrorCode;
    message: string;
    details?: Record<string, unknown>;
  } | null;
}

export type EmailParserErrorCode =
  | 'EMAIL_PARSING_ERROR'
  | 'EMAIL_VALIDATION_ERROR'
  | 'EMAIL_TOO_LARGE'
  | 'EMAIL_ATTACHMENT_TYPE_NOT_ALLOWED';

const DEFAULT_MAX_EMAIL_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB, matches email_config.yaml default. :contentReference[oaicite:6]{index=6}

@Injectable()
export class EmailParserService {
  private readonly logger = new Logger(EmailParserService.name);

  /**
   * Parse and normalise a raw email payload into an EmailMessageEnvelope.
   *
   * This method:
   *  - normalises addresses (from/to/cc/bcc),
   *  - parses / sanitises text & HTML bodies,
   *  - computes size and enforces max size limits (if configured),
   *  - normalises attachments metadata and flags disallowed MIME types,
   *  - extracts selected headers into parsedMetadata/securityFlags,
   *  - returns the standard Core Services result shape.
   */
  parseIncoming(
    raw: RawEmailPayload,
    context: EmailParserContext,
    limits: EmailParserLimits = {},
  ): EmailParserResult<EmailMessageEnvelope> {
    try {
      const normalized = this.toEnvelope(raw, context, limits);

      const validationError = this.validateEnvelope(normalized, limits);
      if (validationError) {
        return {
          ok: false,
          data: null,
          error: validationError,
        };
      }

      return {
        ok: true,
        data: normalized,
        error: null,
      };
    } catch (err: unknown) {
      this.logger.error('Unexpected error while parsing email', err as Error);

      return {
        ok: false,
        data: null,
        error: {
          code: 'EMAIL_PARSING_ERROR',
          message:
            err instanceof Error ? err.message : 'Unexpected email parsing error',
        },
      };
    }
  }

  /**
   * Convert the raw payload and context into an EmailMessageEnvelope.
   * This method is pure and throws only on truly unexpected conditions;
   * policy validation is handled separately in validateEnvelope().
   */
  private toEnvelope(
    raw: RawEmailPayload,
    context: EmailParserContext,
    limits: EmailParserLimits,
  ): EmailMessageEnvelope {
    const direction: EmailDirection = context.direction ?? raw.direction ?? 'inbound';
    const rawHeaders = this.normaliseHeaders(raw.headers ?? {});
    const subject = (raw.subject ?? '').trim();

    const fromList = this.normaliseAddressList(raw.from);
    const fromAddress = fromList[0] ?? '';

    const toAddresses = this.normaliseAddressList(raw.to);
    const ccAddresses = this.normaliseAddressList(raw.cc);
    const bccAddresses = this.normaliseAddressList(raw.bcc);

    const { textBody, htmlBody } = this.normaliseBodies(raw.text, raw.html);

    const { attachmentsMeta, hadDisallowedAttachments } =
      this.normaliseAttachments(raw.attachments ?? [], limits);

    const estimatedSizeBytes = this.estimateEmailSize(
      raw,
      textBody,
      htmlBody,
      attachmentsMeta,
    );

    const messageIdHeader =
      raw.messageId ??
      (rawHeaders['message-id'] as string | undefined) ??
      null;

    const receivedAt = this.normaliseDate(raw.receivedAt);
    const sentAt = this.normaliseDate(raw.sentAt);

    const sensitivity =
      context.sensitivityOverride ??
      this.deriveSensitivity(subject, textBody, rawHeaders);

    const securityFlags = this.deriveSecurityFlags(rawHeaders);

    const parsedMetadata: Record<string, unknown> = {
      rawSizeBytes: raw.sizeInBytes ?? null,
      estimatedSizeBytes,
      hadDisallowedAttachments,
      attachmentCount: attachmentsMeta.length,
      hasHtmlBody: htmlBody !== null,
      hasTextBody: textBody !== null,
      messageIdHeader,
      direction,
    };

    return {
      emailMessageId: randomUUID(),
      organizationId: context.organizationId,
      emailAccountConfigId: context.emailAccountConfigId ?? null,
      threadId: context.threadId ?? null,
      messageIdHeader,
      direction,
      fromAddress,
      toAddresses,
      ccAddresses,
      bccAddresses,
      subject,
      receivedAt,
      sentAt,
      rawHeaders,
      textBody,
      htmlBody,
      relatedTaskId: context.relatedTaskId ?? null,
      sensitivity,
      parsedMetadata,
      attachmentsMeta,
      securityFlags,
    };
  }

  /**
   * Validate a normalised EmailMessageEnvelope against hard requirements
   * (required fields, size limit, attachment policy).
   */
  private validateEnvelope(
    envelope: EmailMessageEnvelope,
    limits: EmailParserLimits,
  ): EmailParserResult<EmailMessageEnvelope>['error'] {
    // Required fields: subject, from, at least one recipient, and some body.
    if (!envelope.subject) {
      return {
        code: 'EMAIL_VALIDATION_ERROR',
        message: "Missing required field 'subject'",
        details: { field: 'subject' },
      };
    }

    if (!envelope.fromAddress) {
      return {
        code: 'EMAIL_VALIDATION_ERROR',
        message: "Missing required field 'fromAddress'",
        details: { field: 'fromAddress' },
      };
    }

    if (
      envelope.toAddresses.length === 0 &&
      envelope.ccAddresses.length === 0 &&
      envelope.bccAddresses.length === 0
    ) {
      return {
        code: 'EMAIL_VALIDATION_ERROR',
        message: 'Email must have at least one recipient',
        details: { field: 'to/cc/bcc' },
      };
    }

    if (!envelope.textBody && !envelope.htmlBody) {
      return {
        code: 'EMAIL_VALIDATION_ERROR',
        message: 'Email must have a text or HTML body',
        details: { field: 'textBody/htmlBody' },
      };
    }

    // Size limit enforcement (if enabled).
    const enforceSizeLimit = limits.enforceSizeLimit ?? true;
    const maxBytes =
      typeof limits.maxEmailSizeBytes === 'number'
        ? limits.maxEmailSizeBytes
        : DEFAULT_MAX_EMAIL_SIZE_BYTES;

    if (enforceSizeLimit) {
      const estimatedSize = envelope.parsedMetadata.estimatedSizeBytes;
      if (typeof estimatedSize === 'number' && estimatedSize > maxBytes) {
        return {
          code: 'EMAIL_TOO_LARGE',
          message: `Email exceeds maximum size: ${estimatedSize} bytes > ${maxBytes} bytes`,
          details: { estimatedSizeBytes: estimatedSize, maxEmailSizeBytes: maxBytes },
        };
      }
    }

    // Attachment policy: if allowedAttachmentMimeTypes is non‑empty,
    // disallow attachments whose contentType is not in the list.
    const allowedTypes = limits.allowedAttachmentMimeTypes ?? [];
    if (allowedTypes.length > 0) {
      const hasForbidden = envelope.attachmentsMeta.some(
        (a) => a.contentType && !allowedTypes.includes(a.contentType),
      );

      if (hasForbidden) {
        return {
          code: 'EMAIL_ATTACHMENT_TYPE_NOT_ALLOWED',
          message: 'One or more attachments have disallowed MIME types',
          details: {
            allowedAttachmentMimeTypes: allowedTypes,
          },
        };
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Normalisation helpers
  // ---------------------------------------------------------------------------

  private normaliseHeaders(
    headers: Record<string, string | string[] | undefined>,
  ): Record<string, string | string[]> {
    const out: Record<string, string | string[]> = {};

    for (const [key, value] of Object.entries(headers)) {
      if (typeof value === 'undefined') {
        continue;
      }
      const canonicalKey = key.toLowerCase();
      out[canonicalKey] = value;
    }

    return out;
  }

  private normaliseAddressList(
    value?: RawEmailAddressInput | null,
  ): string[] {
    if (!value) {
      return [];
    }

    const items = Array.isArray(value) ? value : [value];
    const result: string[] = [];

    for (const item of items) {
      if (typeof item === 'string') {
        result.push(...this.extractEmailAddressesFromString(item));
      } else if (item && typeof item.address === 'string') {
        const parsed = this.extractEmailAddressesFromString(item.address);
        result.push(...parsed);
      }
    }

    return result.filter(Boolean);
  }

  private extractEmailAddressesFromString(raw: string): string[] {
    if (!raw) {
      return [];
    }

    // Handle comma‑separated lists like "A <a@example.org>, b@example.org"
    const parts = raw.split(',').map((p) => p.trim());
    const result: string[] = [];

    for (const part of parts) {
      if (!part) continue;

      const angleMatch = part.match(/<([^>]+)>/);
      if (angleMatch && angleMatch[1]) {
        result.push(angleMatch[1].trim());
      } else {
        result.push(part.trim());
      }
    }

    return result;
  }

  private normaliseBodies(
    text?: string | null,
    html?: string | null,
  ): { textBody: string | null; htmlBody: string | null } {
    const rawText = text?.trim() ?? '';
    const rawHtml = html?.trim() ?? '';

    let textBody: string | null = rawText || null;
    let htmlBody: string | null = rawHtml || null;

    if (!textBody && htmlBody) {
      textBody = this.extractPlainTextFromHtml(htmlBody) || null;
    }

    if (htmlBody) {
      htmlBody = this.sanitiseHtml(htmlBody);
    }

    return { textBody, htmlBody };
  }

  private extractPlainTextFromHtml(html: string): string {
    // Remove script/style blocks.
    let text = html.replace(
      /<(script|style)[^>]*>[\s\S]*?<\/\1>/gi,
      '',
    );
    // Strip tags.
    text = text.replace(/<[^>]+>/g, ' ');
    // Collapse whitespace.
    text = text.replace(/\s+/g, ' ').trim();
    return text;
  }

  private sanitiseHtml(html: string): string {
    let out = html;

    // Remove script/style tags completely.
    out = out.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');

    // Basic sanitisation for inline event handlers and javascript: URLs.
    out = out.replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '');
    out = out.replace(/javascript:/gi, '');

    return out;
  }

  private normaliseAttachments(
    rawAttachments: RawEmailAttachment[],
    limits: EmailParserLimits,
  ): { attachmentsMeta: EmailAttachmentMeta[]; hadDisallowedAttachments: boolean } {
    const allowedTypes = limits.allowedAttachmentMimeTypes ?? [];
    const attachmentsMeta: EmailAttachmentMeta[] = [];
    let hadDisallowed = false;

    for (const raw of rawAttachments) {
      const filename = raw.filename ?? null;
      const contentType = (raw.contentType ?? raw.mimeType ?? null)?.toLowerCase() ?? null;
      const sizeBytes = typeof raw.size === 'number' && raw.size > 0 ? raw.size : 0;
      const contentId = (raw.contentId ?? raw.cid ?? null) || null;
      const inline = Boolean(raw.inline);

      let allowed = true;
      if (allowedTypes.length > 0 && contentType) {
        allowed = allowedTypes.includes(contentType);
        if (!allowed) {
          hadDisallowed = true;
        }
      }

      attachmentsMeta.push({
        filename,
        contentType,
        sizeBytes,
        inline,
        contentId,
        allowed,
      });
    }

    return { attachmentsMeta, hadDisallowedAttachments: hadDisallowed };
  }

  private estimateEmailSize(
    raw: RawEmailPayload,
    textBody: string | null,
    htmlBody: string | null,
    attachments: EmailAttachmentMeta[],
  ): number {
    if (typeof raw.sizeInBytes === 'number' && raw.sizeInBytes > 0) {
      return raw.sizeInBytes;
    }

    let total = 0;

    const accumulate = (value: string | null | undefined) => {
      if (!value) return;
      // Approximate: 1 char ≈ 1 byte (good enough for limit checks).
      total += value.length;
    };

    accumulate(raw.subject ?? null);
    accumulate(textBody);
    accumulate(htmlBody);

    for (const attachment of attachments) {
      total += attachment.sizeBytes;
    }

    return total;
  }

  private normaliseDate(value?: Date | string | null): Date | null {
    if (!value) return null;
    if (value instanceof Date) return value;

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed;
  }

  private deriveSensitivity(
    subject: string,
    textBody: string | null,
    headers: Record<string, string | string[]>,
  ): EmailSensitivity {
    // Very conservative and generic heuristic:
    //  - if headers mark content as confidential, treat as 'sensitive'
    //  - otherwise, look for common sensitivity hints in subject/body.
    const classificationHeader =
      (headers['sensitivity'] as string | undefined) ??
      (headers['x-classification'] as string | undefined) ??
      '';

    const lcClassification = classificationHeader.toLowerCase();
    if (
      lcClassification.includes('confidential') ||
      lcClassification.includes('restricted')
    ) {
      return 'sensitive';
    }

    const text = `${subject} ${textBody ?? ''}`.toLowerCase();
    if (
      text.includes('confidential') ||
      text.includes('harassment') ||
      text.includes('medical') ||
      text.includes('patient') ||
      text.includes('complaint')
    ) {
      return 'sensitive';
    }

    return 'normal';
  }

  private deriveSecurityFlags(
    headers: Record<string, string | string[]>,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    const contentType = (headers['content-type'] as string | undefined) ?? '';
    const lcContentType = contentType.toLowerCase();

    result.pgpEncrypted =
      lcContentType.includes('multipart/encrypted') ||
      lcContentType.includes('application/pgp-encrypted') ||
      this.headerContains(headers, 'x-pgp-encrypted', 'yes');

    result.spamScore = this.parseFloatHeader(headers, 'x-spam-score');
    result.spamStatus = (headers['x-spam-status'] as string | undefined) ?? null;

    return result;
  }

  private headerContains(
    headers: Record<string, string | string[]>,
    key: string,
    needle: string,
  ): boolean {
    const value = headers[key.toLowerCase()];
    if (!value) return false;

    if (Array.isArray(value)) {
      return value.some((v) => v.toLowerCase().includes(needle.toLowerCase()));
    }

    return value.toLowerCase().includes(needle.toLowerCase());
  }

  private parseFloatHeader(
    headers: Record<string, string | string[]>,
    key: string,
  ): number | null {
    const value = headers[key.toLowerCase()];
    if (!value) return null;

    const s = Array.isArray(value) ? value[0] : value;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }
}
