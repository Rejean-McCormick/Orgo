import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiProperty } from '@nestjs/swagger';

import { NotificationService } from './notification.service';

/**
 * Canonical notification channels and statuses as per Doc 1/Doc 2.
 * DB stores these as lower-case strings; API uses the same tokens.
 */
export enum NotificationChannel {
  EMAIL = 'email',
  SMS = 'sms',
  IN_APP = 'in_app',
  WEBHOOK = 'webhook',
}

export enum NotificationStatus {
  QUEUED = 'queued',
  SENT = 'sent',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

/**
 * Query DTO for listing notifications for the current user.
 * Filtering is intentionally minimal; more filters can be added later
 * (e.g. by template code, task, date range).
 */
export class ListNotificationsQueryDto {
  @ApiProperty({
    required: false,
    enum: NotificationChannel,
    description: 'Filter by notification channel (email, sms, in_app, webhook).',
  })
  channel?: NotificationChannel;

  @ApiProperty({
    required: false,
    enum: NotificationStatus,
    description: 'Filter by delivery status (queued, sent, failed, cancelled).',
  })
  status?: NotificationStatus;

  @ApiProperty({
    required: false,
    minimum: 1,
    maximum: 200,
    default: 50,
    description: 'Maximum number of items to return (1–200). Defaults to 50.',
  })
  limit?: number;

  @ApiProperty({
    required: false,
    description:
      'Opaque cursor for pagination; use the value returned as nextCursor from a previous call.',
  })
  cursor?: string;
}

/**
 * Logical Notification view returned by the API.
 * Fields mirror the logical Notification model over the notifications table.
 */
export class NotificationDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid', description: 'Tenant / organization identifier.' })
  organizationId!: string;

  @ApiProperty({ enum: NotificationChannel })
  channel!: NotificationChannel;

  @ApiProperty({ enum: NotificationStatus })
  status!: NotificationStatus;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'Recipient user id, if the notification is tied to a user account.',
  })
  recipientUserId!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'Recipient address (email/phone/webhook URL/device token) for non user-tied notifications.',
  })
  recipientAddress!: string | null;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'Related Task id, when the notification is tied to a Task lifecycle event.',
  })
  relatedTaskId!: string | null;

  @ApiProperty({
    type: 'object',
    description:
      'Channel-ready payload (for in_app: title/body + context; for email/webhook: rendered payload).',
    additionalProperties: true,
  })
  payload!: Record<string, unknown>;

  @ApiProperty({
    nullable: true,
    description: 'Time the notification was queued for delivery (ISO 8601, UTC).',
  })
  queuedAt!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Time the notification was sent successfully (ISO 8601, UTC).',
  })
  sentAt!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Time the notification failed permanently (ISO 8601, UTC).',
  })
  failedAt!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Error message captured when delivery fails.',
  })
  errorMessage!: string | null;
}

/**
 * Paginated notifications feed response.
 */
export class NotificationFeedResponseDto {
  @ApiProperty({ type: [NotificationDto] })
  items!: NotificationDto[];

  @ApiProperty({
    nullable: true,
    description:
      'Cursor to fetch the next page. Omitted/null when there are no more results.',
  })
  nextCursor?: string | null;
}

/**
 * DTO for sending an ad-hoc in-app notification.
 * This uses the NotificationService.sendInApp logical entrypoint from Doc 4.
 * Task-driven notifications (CREATED/ASSIGNED/ESCALATED/COMPLETED) are typically
 * triggered internally via sendTaskNotification, not via this controller.
 */
export class SendInAppNotificationDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Recipient user id within the current organization.',
  })
  recipientUserId!: string;

  @ApiProperty({
    maxLength: 200,
    description: 'Short title used in in-app banners/toasts.',
  })
  title!: string;

  @ApiProperty({
    maxLength: 2000,
    description: 'Body text shown in the in-app notification.',
  })
  body!: string;

  @ApiProperty({
    required: false,
    format: 'uuid',
    description: 'Optional related Task id to deep-link from the notification.',
  })
  relatedTaskId?: string;

  @ApiProperty({
    required: false,
    type: 'object',
    additionalProperties: true,
    description:
      'Optional extra metadata to embed in the payload (e.g. label, domain info, deep-link params).',
  })
  metadata?: Record<string, unknown>;
}

@ApiTags('notifications')
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @ApiOperation({
    summary: 'List notifications for the current user',
    description:
      'Returns a paginated feed of notifications (email, sms, in_app, webhook) for the authenticated user, filtered by channel/status as needed.',
  })
  @ApiResponse({
    status: 200,
    type: NotificationFeedResponseDto,
  })
  async listNotifications(
    @Query() query: ListNotificationsQueryDto,
  ): Promise<NotificationFeedResponseDto> {
    // Basic, defensive normalization of limit without assuming any specific validation pipe.
    const rawLimit = (query as any).limit;
    const numericLimit = rawLimit !== undefined ? Number(rawLimit) : NaN;
    const effectiveLimit =
      Number.isFinite(numericLimit) && numericLimit > 0
        ? Math.min(Math.max(Math.floor(numericLimit), 1), 200)
        : 50;

    const filters: ListNotificationsQueryDto = {
      ...query,
      limit: effectiveLimit,
    };

    // Multi-tenant + user scoping is handled inside NotificationService,
    // using whatever auth/context mechanism is wired into the app.
    return this.notificationService.listNotificationsForCurrentUser(filters);
  }

  @Post('in-app')
  @ApiOperation({
    summary: 'Send an ad-hoc in-app notification',
    description:
      'Queues an in-app notification to a single user in the current organization. Task-driven lifecycle notifications should use Task/Workflow services instead.',
  })
  @ApiResponse({
    status: 201,
    type: NotificationDto,
  })
  async sendInApp(
    @Body() body: SendInAppNotificationDto,
  ): Promise<NotificationDto> {
    return this.notificationService.sendInApp(body);
  }
}
