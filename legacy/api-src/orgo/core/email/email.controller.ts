import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { EmailService } from './email.service';
import { LogService } from '../logging/log.service';
import {
  FN_EMAIL_SEND,
  FN_EMAIL_SEND_TEST,
  FN_EMAIL_POLL_MAILBOX,
  FN_EMAIL_CONFIG_STATUS,
} from '../functional-ids';

/**
 * Standard Orgo result shape for Core Services.
 * EmailService implementations should return this shape.
 */
interface OrgoResult<T> {
  ok: boolean;
  data: T | null;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  } | null;
}

/**
 * Request body for sending an email (transactional / notification style).
 * This mirrors the logical EMAIL_MESSAGE envelope in Doc 5.
 */
export class SendEmailRequestDto {
  /**
   * Optional organization context; if omitted, EmailService should
   * resolve a default org / config (e.g. "default").
   */
  organizationId?: string;

  /**
   * Primary recipients (RFC822 email addresses).
   */
  to!: string[];

  /**
   * Optional CC recipients.
   */
  cc?: string[];

  /**
   * Optional BCC recipients.
   */
  bcc?: string[];

  /**
   * Subject line (required, non‑empty).
   */
  subject!: string;

  /**
   * Email body as plain text or HTML (EmailService will normalize).
   */
  body!: string;

  /**
   * Optional idempotency key so callers can safely retry a send
   * without creating duplicate outbound messages.
   */
  idempotencyKey?: string;
}

/**
 * Request body for sending a test email to verify configuration.
 * Slimmer than SendEmailRequestDto on purpose.
 */
export class SendTestEmailRequestDto {
  /**
   * Optional organization context for multi‑tenant config lookup.
   */
  organizationId?: string;

  /**
   * Target address for the test email.
   */
  to!: string;

  /**
   * Optional human‑friendly label for the test.
   * Used only for logging / templates.
   */
  label?: string;
}

/**
 * Request body for manually polling an inbound mailbox.
 */
export class PollMailboxRequestDto {
  /**
   * Optional organization context; if omitted, service will decide
   * which default mailbox / org to poll.
   */
  organizationId?: string;

  /**
   * Maximum number of messages to fetch in this run.
   * If omitted, EmailService will use its default batch size.
   */
  maxCount?: number;

  /**
   * If true, run parsing/validation without committing
   * side‑effects (debug / diagnostics mode).
   */
  dryRun?: boolean;
}

/**
 * Minimal response for a successful send.
 */
export class EmailSendResponseDto {
  /**
   * Identifier of the stored outbound email message, if any.
   */
  emailMessageId?: string;

  /**
   * Underlying provider / SMTP message identifier, if available.
   */
  providerMessageId?: string;

  /**
   * Whether the message has been handed off to the provider.
   */
  accepted!: boolean;
}

/**
 * Status snapshot for the outbound / inbound email configuration.
 */
export class EmailStatusResponseDto {
  outboundConfigured!: boolean;
  inboundConfigured!: boolean;
  lastSuccessfulOutboundAt?: string | null;
  lastSuccessfulInboundAt?: string | null;
  issues!: string[];
}

/**
 * Result of a manual mailbox poll.
 */
export class PollMailboxResponseDto {
  /**
   * Number of raw messages fetched from the mailbox.
   */
  fetched!: number;

  /**
   * Number of messages successfully parsed into EMAIL_MESSAGE envelopes.
   */
  parsed!: number;

  /**
   * Number of messages rejected due to validation / limits.
   */
  rejected!: number;
}

@ApiTags('email')
@Controller('api/v3/email')
export class EmailController {
  constructor(
    private readonly emailService: EmailService,
    private readonly logService: LogService,
  ) {}

  /**
   * Send a transactional / notification email.
   *
   * This endpoint is primarily intended for internal Orgo modules
   * and admin tools, not for bulk marketing.
   */
  @Post('send')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Send email',
    description:
      'Send a transactional / notification email using the configured SMTP account for the organization.',
  })
  @ApiResponse({
    status: 202,
    description: 'Email accepted for delivery.',
    type: EmailSendResponseDto,
  })
  async sendEmail(
    @Body() body: SendEmailRequestDto,
  ): Promise<EmailSendResponseDto> {
    const result: OrgoResult<EmailSendResponseDto> =
      await this.emailService.sendEmail(body);

    return this.unwrapResult(result, {
      functionalId: FN_EMAIL_SEND,
      action: 'sendEmail',
      identifier: body.idempotencyKey,
      successMessage: 'Email accepted for delivery',
    });
  }

  /**
   * Send a simple test email to verify outbound configuration.
   */
  @Post('test')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Send test email',
    description:
      'Send a simple test email to verify SMTP configuration for an organization.',
  })
  @ApiResponse({
    status: 202,
    description: 'Test email accepted for delivery.',
    type: EmailSendResponseDto,
  })
  async sendTestEmail(
    @Body() body: SendTestEmailRequestDto,
  ): Promise<EmailSendResponseDto> {
    const result: OrgoResult<EmailSendResponseDto> =
      await this.emailService.sendTestEmail(body);

    return this.unwrapResult(result, {
      functionalId: FN_EMAIL_SEND_TEST,
      action: 'sendTestEmail',
      identifier: body.to,
      successMessage: 'Test email accepted for delivery',
    });
  }

  /**
   * Return a lightweight snapshot of email gateway health for the org.
   */
  @Get('status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Email gateway status',
    description:
      'Return a snapshot of inbound/outbound email configuration and recent health checks.',
  })
  @ApiResponse({
    status: 200,
    description: 'Status information for email gateway.',
    type: EmailStatusResponseDto,
  })
  async getStatus(
    @Query('organizationId') organizationId?: string,
  ): Promise<EmailStatusResponseDto> {
    const result: OrgoResult<EmailStatusResponseDto> =
      await this.emailService.getStatus({ organizationId });

    return this.unwrapResult(result, {
      functionalId: FN_EMAIL_CONFIG_STATUS,
      action: 'getStatus',
      identifier: organizationId,
      successMessage: 'Email gateway status fetched',
    });
  }

  /**
   * Manually trigger a mailbox poll.
   *
   * This is mainly for development, diagnostics, or controlled
   * backfills; normal ingestion should run via background workers.
   */
  @Post('poll')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Poll inbound mailbox',
    description:
      'Manually poll the configured inbound mailbox and ingest up to `maxCount` messages.',
  })
  @ApiResponse({
    status: 200,
    description: 'Mailbox poll result.',
    type: PollMailboxResponseDto,
  })
  async pollMailbox(
    @Body() body: PollMailboxRequestDto,
  ): Promise<PollMailboxResponseDto> {
    const result: OrgoResult<PollMailboxResponseDto> =
      await this.emailService.pollMailbox(body);

    return this.unwrapResult(result, {
      functionalId: FN_EMAIL_POLL_MAILBOX,
      action: 'pollMailbox',
      identifier: body.organizationId,
      successMessage: 'Mailbox polled successfully',
    });
  }

  /**
   * Helper to unify handling of OrgoResult responses:
   *  - Logs success or failure.
   *  - Maps error codes to HTTP exceptions.
   *  - Returns the inner data on success.
   */
  private unwrapResult<T>(
    result: OrgoResult<T>,
    opts: {
      functionalId: string;
      action: string;
      identifier?: string | null;
      successMessage: string;
    },
  ): T {
    const { functionalId, action, identifier, successMessage } = opts;

    if (result.ok && result.data !== null) {
      this.logService.logEvent({
        category: 'EMAIL',
        logLevel: 'INFO',
        message: successMessage,
        identifier: identifier ?? undefined,
        metadata: {
          fn: functionalId,
          action,
        },
      });

      return result.data;
    }

    const error = result.error ?? {
      code: 'UNKNOWN_ERROR',
      message: 'Unknown error in EmailService',
    };

    this.logService.logEvent({
      category: 'EMAIL',
      logLevel: 'ERROR',
      message: error.message,
      identifier: identifier ?? undefined,
      metadata: {
        fn: functionalId,
        action,
        errorCode: error.code,
        errorDetails: error.details ?? undefined,
      },
    });

    const status = this.mapErrorCodeToHttpStatus(error.code);

    throw new HttpException(
      {
        code: error.code,
        message: error.message,
        details: error.details,
      },
      status,
    );
  }

  /**
   * Map Orgo core error codes to HTTP status codes.
   */
  private mapErrorCodeToHttpStatus(code: string): HttpStatus {
    if (code.endsWith('_VALIDATION_ERROR')) {
      return HttpStatus.BAD_REQUEST;
    }

    if (
      code === 'EMAIL_SEND_FAILED' ||
      code === 'EMAIL_PARSING_ERROR' ||
      code === 'EMAIL_GATEWAY_UNAVAILABLE'
    ) {
      return HttpStatus.BAD_GATEWAY;
    }

    return HttpStatus.INTERNAL_SERVER_ERROR;
  }
}
