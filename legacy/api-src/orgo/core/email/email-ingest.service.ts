import {
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import * as crypto from 'crypto';

import { PersistenceService } from '../persistence/persistence.service';
import { EmailParserService } from './email-parser.service';
import { EmailValidatorService } from './email-validator.service';
import { EmailRouterService } from './email-router.service';
import { LogService } from '../logging/log.service';

/**
 * Injection token for the low‑level mailbox client (IMAP/POP/etc.).
 * A concrete implementation should be registered against this token.
 */
export const EMAIL_MAILBOX_CLIENT = Symbol('EMAIL_MAILBOX_CLIENT');

/**
 * Injection token for attachment storage (e.g. S3, GCS, local FS).
 */
export const EMAIL_ATTACHMENT_STORAGE = Symbol('EMAIL_ATTACHMENT_STORAGE');

/**
 * Standard error shape used across Core Services.
 */
export interface StandardError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Standard result shape (`ok` / `data` / `error`) – locked for v3 Core Services.
 */
export interface StandardResult<T> {
  ok: boolean;
  data: T | null;
  error: StandardError | null;
}

/**
 * Connection information for an IMAP/POP mailbox.
 * Concrete mailbox clients can extend this via intersection types if needed.
 */
export interface MailboxConnectionOptions {
  host: string;
  port: number;
  useSsl: boolean;
  username: string;
  password: string;
  folder: string;
}

/**
 * Raw email as returned by the mailbox client before parsing.
 */
export interface MailboxRawEmail {
  remoteId: string;
  raw: Buffer | string;
  receivedAt?: Date;
  sizeBytes?: number;
}

/**
 * Raw email with multi‑tenant context attached (org + config).
 * This is what we pass into the EmailParserService.
 */
export interface RawEmail extends MailboxRawEmail {
  organizationId: string;
  emailAccountConfigId: string;
}

/**
 * Canonical parsed email payload compatible with the `email_messages` /
 * `email_threads` tables and the EMAIL_MESSAGE logical view.
 */
export interface ParsedEmail {
  organizationId: string;
  emailAccountConfigId: string;

  externalThreadKey?: string | null;
  messageIdHeader?: string | null;
  direction: 'inbound' | 'outbound';

  fromAddress: string;
  toAddresses: string[];
  ccAddresses?: string[];
  bccAddresses?: string[];

  subject: string;
  receivedAt?: Date | null;
  sentAt?: Date | null;

  rawHeaders?: string | null;
  textBody?: string | null;
  htmlBody?: string | null;

  sensitivity?: 'normal' | 'sensitive' | 'highly_sensitive';

  attachments?: ParsedEmailAttachment[];
}

/**
 * Parsed attachment; the storage backend will receive `content` and return
 * a storage key that we store in `email_attachments`.
 */
export interface ParsedEmailAttachment {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  content: Buffer;
  checksum?: string;
}

/**
 * Low‑level mailbox client abstraction. A concrete implementation should hide
 * IMAP/POP details and return MailboxRawEmail objects.
 */
export interface MailboxClient {
  fetchUnreadMessages(
    connection: MailboxConnectionOptions,
    maxMessages: number,
  ): Promise<MailboxRawEmail[]>;

  /**
   * Optional hook to mark messages as processed on the remote server.
   * Implementations may no‑op if they rely on server‑side flags already.
   */
  markMessagesAsProcessed?(
    connection: MailboxConnectionOptions,
    remoteIds: string[],
  ): Promise<void>;
}

/**
 * Attachment storage abstraction; concrete implementations can use S3, GCS, etc.
 */
export interface EmailAttachmentStorage {
  saveAttachment(
    storageKey: string,
    content: Buffer,
    metadata: { mimeType: string; sizeBytes: number },
  ): Promise<void>;
}

/**
 * Allowed event types in `email_processing_events`.
 */
export type EmailProcessingEventType =
  | 'parsed'
  | 'classification_succeeded'
  | 'classification_failed'
  | 'task_created'
  | 'linked_to_existing_task'
  | 'dropped';

/**
 * Shape of an `email_account_configs` row as used by this service.
 * Field names match the DB schema.
 */
export interface EmailAccountConfigRecord {
  id: string;
  organization_id: string;
  label: string;
  imap_host: string;
  imap_port: number;
  imap_use_ssl: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_use_ssl: boolean;
  username: string;
  encrypted_password: string;
  polling_interval_seconds: number;
  last_successful_poll_at: Date | null;
  is_active: boolean;
}

/**
 * Per‑batch ingestion summary – mirrors what we track in `email_ingestion_batches`.
 */
export interface EmailIngestionBatchResult {
  batchId: string;
  emailAccountConfigId: string;
  organizationId: string;
  totalFetched: number;
  persistedMessages: number;
  failedMessages: number;
  status: 'completed' | 'failed';
  errorSummary?: string;
}

/**
 * Options for polling mailboxes.
 *
 * If `emailAccountConfigId` is provided, only that account is polled.
 * If `organizationId` is provided, all active accounts for that org are polled.
 * If neither is provided, all active accounts are polled (multi‑tenant).
 */
export interface PollMailboxOptions {
  organizationId?: string;
  emailAccountConfigId?: string;
  maxMessages?: number;
}

@Injectable()
export class EmailIngestService {
  private readonly logger = new Logger(EmailIngestService.name);

  constructor(
    private readonly persistence: PersistenceService,
    private readonly emailParser: EmailParserService,
    private readonly emailValidator: EmailValidatorService,
    private readonly emailRouter: EmailRouterService,
    private readonly logService: LogService,
    @Inject(EMAIL_MAILBOX_CLIENT)
    private readonly mailboxClient: MailboxClient,
    @Optional()
    @Inject(EMAIL_ATTACHMENT_STORAGE)
    private readonly attachmentStorage?: EmailAttachmentStorage,
  ) {}

  /**
   * Polls one or more mailboxes based on the provided options and ingests new
   * messages into `email_messages` / `email_attachments`, recording a row in
   * `email_ingestion_batches` for each polled account.
   */
  async pollMailbox(
    options: PollMailboxOptions = {},
  ): Promise<StandardResult<EmailIngestionBatchResult[]>> {
    const maxMessages = options.maxMessages ?? 50;

    try {
      const where: Record<string, unknown> = {
        is_active: true,
      };

      if (options.emailAccountConfigId) {
        where.id = options.emailAccountConfigId;
      }

      if (options.organizationId) {
        where.organization_id = options.organizationId;
      }

      const configsResult = await this.persistence.fetchRecords(
        'email_account_configs',
        where,
      );

      if (!configsResult.ok || !configsResult.data) {
        const error: StandardError = {
          code: 'EMAIL_INGEST_CONFIG_FETCH_FAILED',
          message: 'Failed to load email account configurations for polling',
          details: configsResult.error ?? undefined,
        };

        this.logService.logEvent({
          category: 'EMAIL',
          logLevel: 'ERROR',
          message: error.message,
          identifier: 'email_ingest:pollMailbox',
          metadata: { where, error },
        });

        return {
          ok: false,
          data: null,
          error,
        };
      }

      const configs = configsResult.data as EmailAccountConfigRecord[];

      if (!configs.length) {
        // Nothing to do – treat as success with an empty result set.
        return {
          ok: true,
          data: [],
          error: null,
        };
      }

      // Process accounts in parallel; each account is isolated at the mailbox
      // and DB level, so this is safe and lowers end‑to‑end latency.
      const batchResults = await Promise.all(
        configs.map((config) =>
          this.ingestForAccountConfig(config, maxMessages),
        ),
      );

      const anyFailed = batchResults.some(
        (result) => result.status === 'failed',
      );

      return {
        ok: !anyFailed,
        data: batchResults,
        error: anyFailed
          ? {
              code: 'EMAIL_INGEST_PARTIAL_FAILURE',
              message: 'One or more email ingestion batches failed',
              details: {
                failedBatchIds: batchResults
                  .filter((r) => r.status === 'failed')
                  .map((r) => r.batchId),
              },
            }
          : null,
      };
    } catch (err: unknown) {
      const error: StandardError = {
        code: 'EMAIL_INGEST_ERROR',
        message: 'Unhandled error while polling mailboxes',
        details: {
          error:
            err instanceof Error ? err.message : (err as string | unknown),
        },
      };

      this.logService.logEvent({
        category: 'EMAIL',
        logLevel: 'ERROR',
        message: error.message,
        identifier: 'email_ingest:pollMailbox',
        metadata: error.details,
      });

      this.logger.error(
        `Unhandled error while polling mailboxes: ${
          err instanceof Error ? err.stack ?? err.message : String(err)
        }`,
      );

      return {
        ok: false,
        data: null,
        error,
      };
    }
  }

  /**
   * Ingests emails for a single `email_account_configs` record.
   * Creates an `email_ingestion_batches` row and updates it as messages
   * are processed.
   */
  private async ingestForAccountConfig(
    config: EmailAccountConfigRecord,
    maxMessages: number,
  ): Promise<EmailIngestionBatchResult> {
    const startedAt = new Date();

    const batchInsert = await this.persistence.insertRecord(
      'email_ingestion_batches',
      {
        email_account_config_id: config.id,
        started_at: startedAt,
        finished_at: null,
        message_count: 0,
        status: 'running',
        error_summary: null,
      },
    );

    const batchId =
      batchInsert.ok && batchInsert.data
        ? (batchInsert.data as { id: string }).id
        : undefined;

    if (!batchId) {
      const errorSummary = 'Failed to create email_ingestion_batches row';

      this.logService.logEvent({
        category: 'EMAIL',
        logLevel: 'ERROR',
        message: errorSummary,
        identifier: `email_ingest:batch:${config.id}`,
        metadata: { configId: config.id, error: batchInsert.error },
      });

      return {
        batchId: 'unknown',
        emailAccountConfigId: config.id,
        organizationId: config.organization_id,
        totalFetched: 0,
        persistedMessages: 0,
        failedMessages: 0,
        status: 'failed',
        errorSummary,
      };
    }

    let totalFetched = 0;
    let persistedMessages = 0;
    let failedMessages = 0;
    const errors: string[] = [];

    const connection: MailboxConnectionOptions = {
      host: config.imap_host,
      port: config.imap_port,
      useSsl: config.imap_use_ssl,
      username: config.username,
      password: this.decryptPassword(config.encrypted_password),
      folder: 'INBOX',
    };

    try {
      const rawMessages = await this.mailboxClient.fetchUnreadMessages(
        connection,
        maxMessages,
      );

      totalFetched = rawMessages.length;

      for (const mail of rawMessages) {
        const rawEmail: RawEmail = {
          ...mail,
          organizationId: config.organization_id,
          emailAccountConfigId: config.id,
        };

        const success = await this.ingestSingleEmail(batchId, config, rawEmail);

        if (success) {
          persistedMessages += 1;
        } else {
          failedMessages += 1;
        }
      }

      // Mark messages as processed on the remote server, if supported.
      if (this.mailboxClient.markMessagesAsProcessed && rawMessages.length) {
        const remoteIds = rawMessages.map((m) => m.remoteId);
        try {
          await this.mailboxClient.markMessagesAsProcessed(
            connection,
            remoteIds,
          );
        } catch (err: unknown) {
          const message =
            'Failed to mark messages as processed on remote mailbox';
          errors.push(
            err instanceof Error ? err.message : String(err ?? 'unknown'),
          );

          this.logService.logEvent({
            category: 'EMAIL',
            logLevel: 'WARNING',
            message,
            identifier: `email_ingest:markProcessed:${batchId}`,
            metadata: { configId: config.id, error: errors[errors.length - 1] },
          });

          this.logger.warn(
            `${message}: ${
              err instanceof Error ? err.stack ?? err.message : String(err)
            }`,
          );
        }
      }

      const status: 'completed' | 'failed' =
        failedMessages > 0 && persistedMessages === 0 ? 'failed' : 'completed';
      const errorSummary =
        errors.length > 0 ? errors.join('; ').slice(0, 1024) : null;

      await this.persistence.updateRecord(
        'email_ingestion_batches',
        { id: batchId },
        {
          finished_at: new Date(),
          message_count: totalFetched,
          status,
          error_summary: errorSummary,
        },
      );

      if (status === 'completed') {
        await this.persistence.updateRecord(
          'email_account_configs',
          { id: config.id },
          {
            last_successful_poll_at: new Date(),
          },
        );
      }

      return {
        batchId,
        emailAccountConfigId: config.id,
        organizationId: config.organization_id,
        totalFetched,
        persistedMessages,
        failedMessages,
        status,
        errorSummary: errorSummary ?? undefined,
      };
    } catch (err: unknown) {
      const message =
        'Unhandled error while ingesting emails for account config';
      const errorText =
        err instanceof Error ? err.message : String(err ?? 'unknown');

      errors.push(errorText);

      this.logService.logEvent({
        category: 'EMAIL',
        logLevel: 'ERROR',
        message,
        identifier: `email_ingest:batch:${batchId}`,
        metadata: { configId: config.id, error: errorText },
      });

      this.logger.error(
        `${message} (config=${config.id}, batch=${batchId}): ${
          err instanceof Error ? err.stack ?? err.message : String(err)
        }`,
      );

      await this.persistence.updateRecord(
        'email_ingestion_batches',
        { id: batchId },
        {
          finished_at: new Date(),
          message_count: totalFetched,
          status: 'failed',
          error_summary: errors.join('; ').slice(0, 1024),
        },
      );

      return {
        batchId,
        emailAccountConfigId: config.id,
        organizationId: config.organization_id,
        totalFetched,
        persistedMessages,
        failedMessages,
        status: 'failed',
        errorSummary: errors.join('; ').slice(0, 1024),
      };
    }
  }

  /**
   * Ingests a single raw email: parse → validate → persist → route to workflow.
   * Returns `true` if the email was successfully persisted to `email_messages`,
   * regardless of downstream routing outcome.
   */
  private async ingestSingleEmail(
    batchId: string,
    config: EmailAccountConfigRecord,
    rawEmail: RawEmail,
  ): Promise<boolean> {
    try {
      const parseResult = await this.emailParser.parseIncoming(rawEmail);

      if (!parseResult || !parseResult.ok || !parseResult.data) {
        const message = 'Failed to parse incoming email';

        this.logService.logEvent({
          category: 'EMAIL',
          logLevel: 'ERROR',
          message,
          identifier: `email_ingest:parse:${batchId}`,
          metadata: {
            configId: config.id,
            remoteId: rawEmail.remoteId,
            error: parseResult?.error ?? null,
          },
        });

        this.logger.error(
          `${message} (config=${config.id}, remoteId=${rawEmail.remoteId})`,
        );

        return false;
      }

      const parsed = parseResult.data as ParsedEmail;

      const validateResult = await this.emailValidator.validateEmailPayload(
        parsed,
      );

      if (!validateResult || !validateResult.ok) {
        const message = 'Incoming email failed validation';

        this.logService.logEvent({
          category: 'EMAIL',
          logLevel: 'ERROR',
          message,
          identifier: `email_ingest:validate:${batchId}`,
          metadata: {
            configId: config.id,
            remoteId: rawEmail.remoteId,
            error: validateResult?.error ?? null,
          },
        });

        this.logger.error(
          `${message} (config=${config.id}, remoteId=${rawEmail.remoteId})`,
        );

        return false;
      }

      const { emailMessageId } = await this.persistParsedEmail(
        parsed,
        config.organization_id,
      );

      await this.createProcessingEvent(emailMessageId, 'parsed', {
        batchId,
        remoteId: rawEmail.remoteId,
      });

      // Route into workflows / tasks; failures here are logged and recorded as
      // classification failures but do not retroactively delete the message.
      try {
        await this.emailRouter.routeToWorkflow({
          emailMessageId,
          organizationId: config.organization_id,
          emailAccountConfigId: config.id,
        });

        await this.createProcessingEvent(
          emailMessageId,
          'classification_succeeded',
          {
            batchId,
            remoteId: rawEmail.remoteId,
          },
        );
      } catch (err: unknown) {
        const errorText =
          err instanceof Error ? err.message : String(err ?? 'unknown');

        await this.createProcessingEvent(
          emailMessageId,
          'classification_failed',
          {
            batchId,
            remoteId: rawEmail.remoteId,
            error: errorText,
          },
        );

        this.logService.logEvent({
          category: 'EMAIL',
          logLevel: 'ERROR',
          message:
            'Failed to route ingested email into workflow (classification_failed)',
          identifier: `email_ingest:route:${batchId}`,
          metadata: {
            configId: config.id,
            emailMessageId,
            error: errorText,
          },
        });

        this.logger.error(
          `Failed to route ingested email into workflow (emailMessageId=${emailMessageId}): ${
            err instanceof Error ? err.stack ?? err.message : String(err)
          }`,
        );
      }

      return true;
    } catch (err: unknown) {
      const message = 'Unhandled error while ingesting single email';
      const errorText =
        err instanceof Error ? err.message : String(err ?? 'unknown');

      this.logService.logEvent({
        category: 'EMAIL',
        logLevel: 'ERROR',
        message,
        identifier: `email_ingest:single:${batchId}`,
        metadata: {
          configId: config.id,
          remoteId: rawEmail.remoteId,
          error: errorText,
        },
      });

      this.logger.error(
        `${message} (config=${config.id}, remoteId=${rawEmail.remoteId}): ${
          err instanceof Error ? err.stack ?? err.message : String(err)
        }`,
      );

      return false;
    }
  }

  /**
   * Persists a parsed email into `email_threads`, `email_messages`, and
   * `email_attachments`. Returns the new `email_message_id`.
   */
  private async persistParsedEmail(
    parsed: ParsedEmail,
    organizationId: string,
  ): Promise<{ emailMessageId: string }> {
    const messageTimestamp =
      parsed.receivedAt ?? parsed.sentAt ?? new Date();

    const externalThreadKey =
      parsed.externalThreadKey ??
      parsed.messageIdHeader ??
      this.buildSyntheticThreadKey(parsed);

    // Find or create the email_thread for this conversation.
    let threadId: string | null = null;

    if (externalThreadKey) {
      const existingThreadsResult = await this.persistence.fetchRecords(
        'email_threads',
        {
          organization_id: organizationId,
          external_thread_key: externalThreadKey,
        },
      );

      const existingThreads =
        (existingThreadsResult.ok && existingThreadsResult.data) || [];

      if (existingThreads.length > 0) {
        const existing = existingThreads[0] as { id: string };

        threadId = existing.id;

        // Update last_message_at on the existing thread.
        await this.persistence.updateRecord(
          'email_threads',
          { id: threadId },
          {
            last_message_at: messageTimestamp,
            subject_snapshot: parsed.subject,
          },
        );
      } else {
        const createdThread = await this.persistence.insertRecord(
          'email_threads',
          {
            organization_id: organizationId,
            external_thread_key: externalThreadKey,
            subject_snapshot: parsed.subject,
            primary_task_id: null,
            last_message_at: messageTimestamp,
          },
        );

        if (createdThread.ok && createdThread.data) {
          threadId = (createdThread.data as { id: string }).id;
        }
      }
    }

    const messageInsert = await this.persistence.insertRecord(
      'email_messages',
      {
        organization_id: organizationId,
        email_account_config_id: parsed.emailAccountConfigId,
        thread_id: threadId,
        message_id_header: parsed.messageIdHeader ?? null,
        direction: parsed.direction,
        from_address: parsed.fromAddress,
        to_addresses: parsed.toAddresses,
        cc_addresses: parsed.ccAddresses ?? null,
        bcc_addresses: parsed.bccAddresses ?? null,
        subject: parsed.subject,
        received_at: parsed.receivedAt ?? null,
        sent_at: parsed.sentAt ?? null,
        raw_headers: parsed.rawHeaders ?? null,
        text_body: parsed.textBody ?? null,
        html_body: parsed.htmlBody ?? null,
        related_task_id: null,
        sensitivity: parsed.sensitivity ?? 'normal',
      },
    );

    if (!messageInsert.ok || !messageInsert.data) {
      throw new Error('Failed to insert email_messages row');
    }

    const emailMessage = messageInsert.data as { id: string };
    const emailMessageId = emailMessage.id;

    // Persist attachments if we have a storage backend and any attachments.
    if (parsed.attachments && parsed.attachments.length > 0) {
      await this.persistAttachments(emailMessageId, parsed.attachments);
    }

    return { emailMessageId };
  }

  /**
   * Persists `email_attachments` rows and optionally writes attachment content
   * to the configured storage backend (S3/GCS/local).
   */
  private async persistAttachments(
    emailMessageId: string,
    attachments: ParsedEmailAttachment[],
  ): Promise<void> {
    if (!attachments.length) {
      return;
    }

    if (!this.attachmentStorage) {
      // If we have no storage backend, we log a warning and skip attachments.
      this.logService.logEvent({
        category: 'EMAIL',
        logLevel: 'WARNING',
        message:
          'Skipping attachment persistence because no attachment storage backend is configured',
        identifier: `email_ingest:attachments:${emailMessageId}`,
        metadata: { attachmentsCount: attachments.length },
      });
      return;
    }

    let index = 0;

    for (const attachment of attachments) {
      index += 1;

      const storageKey = this.buildAttachmentStorageKey(
        emailMessageId,
        index,
        attachment.fileName,
      );
      const checksum =
        attachment.checksum ?? this.computeChecksum(attachment.content);

      await this.attachmentStorage.saveAttachment(
        storageKey,
        attachment.content,
        {
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
        },
      );

      await this.persistence.insertRecord('email_attachments', {
        email_message_id: emailMessageId,
        file_name: attachment.fileName,
        mime_type: attachment.mimeType,
        size_bytes: attachment.sizeBytes,
        storage_key: storageKey,
        checksum,
      });
    }
  }

  /**
   * Writes an `email_processing_events` row for the given message.
   * Failures here are logged but do not fail the caller.
   */
  private async createProcessingEvent(
    emailMessageId: string,
    eventType: EmailProcessingEventType,
    details: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.persistence.insertRecord('email_processing_events', {
        email_message_id: emailMessageId,
        event_type: eventType,
        details,
        created_at: new Date(),
      });
    } catch (err: unknown) {
      const errorText =
        err instanceof Error ? err.message : String(err ?? 'unknown');

      this.logService.logEvent({
        category: 'EMAIL',
        logLevel: 'ERROR',
        message: 'Failed to record email_processing_event',
        identifier: `email_ingest:event:${emailMessageId}`,
        metadata: {
          emailMessageId,
          eventType,
          error: errorText,
        },
      });

      this.logger.error(
        `Failed to record email_processing_event (emailMessageId=${emailMessageId}, eventType=${eventType}): ${
          err instanceof Error ? err.stack ?? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Placeholder decryptor for `email_account_configs.encrypted_password`.
   * In production, this should delegate to a KMS/secret manager and never
   * expose plaintext secrets in logs.
   */
  private decryptPassword(encrypted: string): string {
    // TODO: Replace with real decryption using KMS/secret management.
    return encrypted;
  }

  /**
   * Builds a synthetic thread key when no provider‑native thread identifier
   * is available. This is best‑effort and primarily used for grouping
   * messages that share the same subject and sender.
   */
  private buildSyntheticThreadKey(parsed: ParsedEmail): string {
    const subject = parsed.subject?.trim().toLowerCase() ?? '';
    const from = parsed.fromAddress?.trim().toLowerCase() ?? '';
    const hash = crypto
      .createHash('sha256')
      .update(`${from}::${subject}`)
      .digest('hex')
      .slice(0, 16);

    return `synthetic:${hash}`;
  }

  /**
   * Builds an attachment storage key under a simple, deterministic path.
   */
  private buildAttachmentStorageKey(
    emailMessageId: string,
    index: number,
    fileName: string,
  ): string {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `email/${emailMessageId}/${index}-${safeName}`;
  }

  /**
   * Computes a SHA‑256 checksum for attachment content.
   */
  private computeChecksum(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }
}
