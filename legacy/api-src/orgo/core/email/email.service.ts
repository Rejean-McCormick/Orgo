import { Injectable } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';

import { OrgoConfigService } from '../../config/config.service';
import { LogService } from '../logging/log.service';
import { FN_EMAIL_SEND } from '../functional-ids';

export interface ServiceError {
  code: string;
  message: string;
  // Free-form extra details; must be safe to log.
  details?: Record<string, unknown>;
}

export interface ServiceResult<T> {
  ok: boolean;
  data: T | null;
  error: ServiceError | null;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
}

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  headers?: Record<string, string>;
  attachments?: EmailAttachment[];
  /**
   * Optional explicit from header, e.g. `"Orgo" <no-reply@example.org>`.
   * If omitted, a default from the email config (or a safe fallback) will be used.
   */
  fromOverride?: string;
}

/**
 * Shape of the email config as returned by OrgoConfigService.
 * This mirrors the core parts of /config/email/email_config.yaml (Doc 5).
 */
export interface EmailConfig {
  smtp: {
    host: string;
    port: number;
    use_tls?: boolean;
    use_ssl?: boolean;
    username_env?: string;
    password_env?: string;
    connection_timeout_secs?: number;
    send_timeout_secs?: number;
    max_retries?: number;
    retry_backoff_secs?: number;
  };
  limits?: {
    max_email_size_mb?: number;
    allowed_attachment_mimetypes?: string[];
  };
}

/**
 * Result payload for a successful sendEmail call.
 */
export interface EmailSendData {
  messageId: string;
  accepted: string[];
  rejected: string[];
}

/**
 * Core EmailService for Orgo.
 *
 * Responsibilities (aligned with Core Services spec, Doc 5):
 *  - Send outbound email via SMTP using configuration from OrgoConfigService.
 *  - Enforce basic validation and configured size limits.
 *  - Apply retry + backoff on transient failures.
 *  - Emit structured log events via LogService.
 *
 * It returns the standard `{ ok, data, error }` result shape.
 */
@Injectable()
export class EmailService {
  private transporter: Transporter | null = null;

  constructor(
    private readonly config: OrgoConfigService,
    private readonly logService: LogService,
  ) {}

  /**
   * Public entrypoint used by NotificationService and other core services.
   */
  async sendEmail(
    options: SendEmailOptions,
  ): Promise<ServiceResult<EmailSendData>> {
    const emailConfig = this.config.getEmailConfig?.() as EmailConfig | undefined;

    if (!emailConfig || !emailConfig.smtp) {
      this.logService.logEvent({
        category: 'EMAIL',
        logLevel: 'ERROR',
        message: 'Email config missing; cannot send email',
        identifier: FN_EMAIL_SEND,
        metadata: {
          reason: 'email_config_missing',
        },
      });

      return {
        ok: false,
        data: null,
        error: {
          code: 'EMAIL_CONFIG_ERROR',
          message: 'Email configuration is missing or invalid',
        },
      };
    }

    const validationError = this.validateOutgoingEmail(options, emailConfig);
    if (validationError) {
      this.logService.logEvent({
        category: 'EMAIL',
        logLevel: 'WARNING',
        message: 'Outgoing email validation failed',
        identifier: FN_EMAIL_SEND,
        metadata: {
          code: validationError.code,
          details: validationError.details,
        },
      });

      return {
        ok: false,
        data: null,
        error: validationError,
      };
    }

    try {
      const transporter = await this.ensureTransporter(emailConfig);
      const { to, cc, bcc } = this.normalizeRecipients(options);
      const from = this.resolveFrom(options, emailConfig);

      const mailOptions = {
        from,
        to,
        cc,
        bcc,
        subject: options.subject,
        text: options.text,
        html: options.html,
        replyTo: options.replyTo,
        headers: options.headers,
        attachments: options.attachments?.map((att) => ({
          filename: att.filename,
          content: att.content,
          contentType: att.contentType,
        })),
      };

      const maxRetries =
        emailConfig.smtp.max_retries !== undefined
          ? emailConfig.smtp.max_retries
          : 3;
      const retryBackoffSecs =
        emailConfig.smtp.retry_backoff_secs !== undefined
          ? emailConfig.smtp.retry_backoff_secs
          : 2;

      let lastError: unknown;

      for (let attempt = 1; attempt <= Math.max(1, maxRetries); attempt += 1) {
        try {
          const info = await transporter.sendMail(mailOptions);

          this.logService.logEvent({
            category: 'EMAIL',
            logLevel: 'INFO',
            message: 'Email sent',
            identifier: FN_EMAIL_SEND,
            metadata: {
              to,
              cc,
              bcc,
              messageId: info.messageId,
              attempt,
            },
          });

          return {
            ok: true,
            data: {
              messageId: info.messageId,
              accepted: Array.isArray(info.accepted)
                ? info.accepted.map(String)
                : [],
              rejected: Array.isArray(info.rejected)
                ? info.rejected.map(String)
                : [],
            },
            error: null,
          };
        } catch (err) {
          lastError = err;

          const transient = this.isTransientError(err);

          this.logService.logEvent({
            category: 'EMAIL',
            logLevel: transient ? 'WARNING' : 'ERROR',
            message: 'Email send attempt failed',
            identifier: FN_EMAIL_SEND,
            metadata: {
              to,
              attempt,
              transient,
              errorMessage:
                err instanceof Error ? err.message : 'Unknown error',
            },
          });

          const isLastAttempt =
            attempt === maxRetries || !transient || maxRetries <= 1;
          if (isLastAttempt) {
            break;
          }

          const backoffMs = retryBackoffSecs * 1000 * attempt;
          await this.sleep(backoffMs);
        }
      }

      const errorMessage =
        lastError instanceof Error
          ? lastError.message
          : 'Unknown error while sending email';

      this.logService.logEvent({
        category: 'EMAIL',
        logLevel: 'ERROR',
        message: 'Email send failed after retries',
        identifier: FN_EMAIL_SEND,
        metadata: {
          to: this.normalizeRecipients(options).to,
          errorMessage,
        },
      });

      return {
        ok: false,
        data: null,
        error: {
          code: 'EMAIL_SEND_FAILED',
          message: errorMessage,
        },
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown error in EmailService';

      this.logService.logEvent({
        category: 'EMAIL',
        logLevel: 'ERROR',
        message: 'Unexpected error in EmailService.sendEmail',
        identifier: FN_EMAIL_SEND,
        metadata: {
          errorMessage: message,
        },
      });

      return {
        ok: false,
        data: null,
        error: {
          code: 'EMAIL_UNEXPECTED_ERROR',
          message,
        },
      };
    }
  }

  /**
   * Validates the outgoing email against the minimal Orgo rules
   * and configured size limits.
   */
  private validateOutgoingEmail(
    options: SendEmailOptions,
    emailConfig: EmailConfig,
  ): ServiceError | null {
    const { to } = this.normalizeRecipients(options);

    if (!to.length) {
      return {
        code: 'EMAIL_VALIDATION_ERROR',
        message: 'At least one recipient is required',
        details: { field: 'to' },
      };
    }

    if (!options.subject || !options.subject.trim()) {
      return {
        code: 'EMAIL_VALIDATION_ERROR',
        message: 'Subject is required',
        details: { field: 'subject' },
      };
    }

    if (!options.text && !options.html) {
      return {
        code: 'EMAIL_VALIDATION_ERROR',
        message: 'Either text or html body is required',
        details: { field: 'text|html' },
      };
    }

    const maxMb = emailConfig.limits?.max_email_size_mb;
    if (maxMb && maxMb > 0) {
      const approxMb = this.approximateEmailSizeMb(options);
      if (approxMb > maxMb) {
        return {
          code: 'EMAIL_SIZE_EXCEEDED',
          message: `Email size ${approxMb.toFixed(
            2,
          )} MB exceeds configured maximum of ${maxMb} MB`,
          details: {
            approximateSizeMb: approxMb,
            maxAllowedMb: maxMb,
          },
        };
      }
    }

    const allowedTypes = emailConfig.limits?.allowed_attachment_mimetypes;
    if (allowedTypes && allowedTypes.length && options.attachments?.length) {
      const disallowed = new Set<string>();

      for (const att of options.attachments) {
        if (!att.contentType) {
          continue;
        }
        if (!allowedTypes.includes(att.contentType)) {
          disallowed.add(att.contentType);
        }
      }

      if (disallowed.size > 0) {
        return {
          code: 'EMAIL_ATTACHMENT_TYPE_NOT_ALLOWED',
          message: 'One or more attachment MIME types are not allowed',
          details: {
            disallowedTypes: Array.from(disallowed),
            allowedTypes,
          },
        };
      }
    }

    return null;
  }

  /**
   * Creates or returns a cached nodemailer transporter
   * based on the configured SMTP settings.
   */
  private async ensureTransporter(emailConfig: EmailConfig): Promise<Transporter> {
    if (this.transporter) {
      return this.transporter;
    }

    const { smtp } = emailConfig;

    if (!smtp.host || !smtp.port) {
      throw new Error('SMTP host and port must be configured');
    }

    const user =
      smtp.username_env && process.env[smtp.username_env]
        ? process.env[smtp.username_env]
        : undefined;
    const pass =
      smtp.password_env && process.env[smtp.password_env]
        ? process.env[smtp.password_env]
        : undefined;

    const secure =
      smtp.use_ssl !== undefined
        ? smtp.use_ssl
        : smtp.port === 465 || smtp.use_tls === true;

    const connectionTimeoutMs = (smtp.connection_timeout_secs ?? 10) * 1000;
    const socketTimeoutMs = (smtp.send_timeout_secs ?? 30) * 1000;

    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure,
      auth:
        user && pass
          ? {
              user,
              pass,
            }
          : undefined,
      connectionTimeout: connectionTimeoutMs,
      socketTimeout: socketTimeoutMs,
    });

    // Verify connection once at startup of the transporter.
    try {
      await transporter.verify();
      this.logService.logEvent({
        category: 'EMAIL',
        logLevel: 'INFO',
        message: 'SMTP transport verified',
        identifier: FN_EMAIL_SEND,
        metadata: {
          host: smtp.host,
          port: smtp.port,
        },
      });
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Failed to verify SMTP connection';

      this.logService.logEvent({
        category: 'EMAIL',
        logLevel: 'ERROR',
        message: 'SMTP verification failed',
        identifier: FN_EMAIL_SEND,
        metadata: {
          host: smtp.host,
          port: smtp.port,
          errorMessage: message,
        },
      });

      // Let callers see the failure as EMAIL_CONFIG_ERROR or EMAIL_SEND_FAILED.
      throw new Error(`SMTP verification failed: ${message}`);
    }

    this.transporter = transporter;
    return transporter;
  }

  private normalizeRecipients(options: SendEmailOptions): {
    to: string[];
    cc: string[];
    bcc: string[];
  } {
    const normalize = (value?: string | string[]): string[] => {
      if (!value) return [];
      if (Array.isArray(value)) {
        return value
          .map((v) => v.trim())
          .filter((v) => v.length > 0);
      }
      return value
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v.length > 0);
    };

    return {
      to: normalize(options.to),
      cc: normalize(options.cc),
      bcc: normalize(options.bcc),
    };
  }

  /**
   * Resolve the "from" header from overrides or configuration.
   */
  private resolveFrom(
    options: SendEmailOptions,
    _emailConfig: EmailConfig,
  ): string {
    if (options.fromOverride && options.fromOverride.trim()) {
      return options.fromOverride.trim();
    }

    // Fallback; notification_config should typically provide a better sender.
    return 'Orgo System <no-reply@orgo.local>';
  }

  /**
   * Very rough approximation of email size in MB, used to enforce limits.
   * This is deliberately conservative and avoids buffering full MIME output.
   */
  private approximateEmailSizeMb(options: SendEmailOptions): number {
    let bytes = 0;

    const add = (value?: string) => {
      if (!value) return;
      bytes += Buffer.byteLength(value, 'utf8');
    };

    add(
      Array.isArray(options.to) ? options.to.join(',') : options.to ?? '',
    );
    add(
      Array.isArray(options.cc) ? options.cc.join(',') : options.cc ?? '',
    );
    add(
      Array.isArray(options.bcc)
        ? options.bcc.join(',')
        : options.bcc ?? '',
    );
    add(options.subject);
    add(options.text);
    add(options.html);

    if (options.attachments) {
      for (const att of options.attachments) {
        if (typeof att.content === 'string') {
          bytes += Buffer.byteLength(att.content, 'utf8');
        } else {
          bytes += att.content.length;
        }
        add(att.filename);
        if (att.contentType) add(att.contentType);
      }
    }

    return bytes / (1024 * 1024);
  }

  /**
   * Heuristic detection of transient SMTP / network errors.
   * Used to decide whether to retry.
   */
  private isTransientError(err: unknown): boolean {
    if (!err || typeof err !== 'object') {
      return false;
    }

    const anyErr = err as { code?: string; responseCode?: number };

    const transientNodeErrorCodes = new Set([
      'ETIMEDOUT',
      'ECONNRESET',
      'EAI_AGAIN',
      'ECONNREFUSED',
      'ENOTFOUND',
    ]);

    if (anyErr.code && transientNodeErrorCodes.has(anyErr.code)) {
      return true;
    }

    // For SMTP codes, treat typical resource/availability issues as transient.
    if (typeof anyErr.responseCode === 'number') {
      const code = anyErr.responseCode;
      if (
        code === 421 || // Service not available, closing transmission channel
        code === 450 || // Requested mail action not taken: mailbox unavailable
        code === 451 || // Local error in processing
        code === 452 // Insufficient system storage
      ) {
        return true;
      }
    }

    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
