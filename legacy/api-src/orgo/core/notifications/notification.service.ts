// apps/api/src/orgo/core/notifications/notification.service.ts

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { Request } from 'express';

import { OrgoConfigService } from '../../config/config.service';
import { OrgProfileService } from '../../config/org-profile.service';
import { FeatureFlagService } from '../../config/feature-flag.service';
import type { FeatureFlagEvaluationContext } from '../../config/feature-flag.service';
import { LogService } from '../logging/log.service';
import { EmailService } from '../email/email.service';
import { PrismaService } from './././persistence/prisma/prisma.service';
import type {
  ListNotificationsQueryDto,
  NotificationChannel as ApiNotificationChannel,
  NotificationStatus as ApiNotificationStatus,
  NotificationDto,
  NotificationFeedResponseDto,
  SendInAppNotificationDto,
} from './notification.controller';

/**
 * Injection token for a pluggable recipient resolver.
 * A provider must be bound to this token in the NotificationsModule.
 */
export const NOTIFICATION_RECIPIENT_RESOLVER =
  'NOTIFICATION_RECIPIENT_RESOLVER';

/**
 * Canonical notification channels (Doc 2 §2.8 / Doc 5 §7).
 */
export type NotificationChannel = 'EMAIL' | 'SMS' | 'IN_APP' | 'WEBHOOK';

/**
 * Canonical notification scopes (Doc 2 §2.8, Doc 7 profiles.notification_scope).
 */
export type NotificationScope = 'user' | 'team' | 'department' | 'org_wide';

/**
 * Supported task lifecycle notification events (Doc 5 §7.3).
 */
export type TaskNotificationEventType =
  | 'CREATED'
  | 'ASSIGNED'
  | 'ESCALATED'
  | 'COMPLETED';

/**
 * Canonical VISIBILITY enum (JSON / service form).
 */
export type TaskVisibility = 'PUBLIC' | 'INTERNAL' | 'RESTRICTED' | 'ANONYMISED';

/**
 * Standard service-level error shape (Doc 5 §2.4).
 */
export interface ServiceError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Standard result shape (Doc 5 §2.4).
 */
export interface ServiceResult<T> {
  ok: boolean;
  data: T | null;
  error: ServiceError | null;
}

/**
 * Minimal Task payload required to send notifications.
 * Logical view aligned with the canonical Task model (Doc 5 §3.1 / Doc 8 §8.4.2).
 */
export interface NotifiableTask {
  taskId: string;
  organizationId: string;

  title: string;
  description: string;
  label: string;

  status: string;
  priority: string;
  severity: string;
  visibility: TaskVisibility;

  source: 'email' | 'api' | 'manual' | 'sync';

  ownerRoleId?: string | null;
  ownerUserId?: string | null;
  assigneeRole?: string | null;

  createdByUserId?: string | null;
  requesterPersonId?: string | null;

  metadata?: Record<string, unknown>;
}

/**
 * Recipient representation for notifications across channels.
 */
export interface NotificationRecipient {
  userId?: string;
  email?: string | null;
  displayName?: string | null;
  /**
   * Optional per-recipient channel override.
   * If omitted, all selected channels are used.
   */
  preferredChannels?: NotificationChannel[];
}

/**
 * Result of resolving recipients for a task notification.
 */
export interface ResolvedNotificationRecipients {
  primary: NotificationRecipient[];
  cc: NotificationRecipient[];
}

/**
 * Dispatch result for a single channel.
 */
export interface NotificationChannelDispatchResult {
  channel: NotificationChannel;
  success: boolean;
  recipients: string[]; // normalized recipient identifiers (typically emails or user IDs)
  cc?: string[];
  error?: string;
  providerMetadata?: Record<string, unknown>;
}

/**
 * Summary for a Task notification operation.
 */
export interface TaskNotificationDispatchSummary {
  taskId: string;
  organizationId: string;
  eventType: TaskNotificationEventType;
  scope: NotificationScope;
  suppressed: boolean;
  suppressionReason?: string;
  channels: NotificationChannelDispatchResult[];
}

/**
 * Normalised Notification configuration (Doc 5 §7.2), as exposed by OrgoConfigService.
 */
export interface NotificationConfig {
  defaultChannel: NotificationChannel;
  channels: {
    email: {
      enabled: boolean;
      senderName: string;
      senderAddress: string;
    };
    inApp: {
      enabled: boolean;
    };
    sms?: {
      enabled: boolean;
    };
    webhook?: {
      enabled: boolean;
      endpoint?: string;
    };
  };
  templates: {
    taskCreated: string;
    taskAssignment: string;
    taskEscalation: string;
    taskCompleted: string;
  };
}

/**
 * Minimal Org profile view used here (Doc 7).
 */
export interface OrgProfile {
  notification_scope: NotificationScope;
}

/**
 * Contract for a pluggable recipient resolver.
 * Implementation is responsible for mapping roles/users/profiles → concrete recipients.
 */
export interface NotificationRecipientResolver {
  resolveTaskRecipients(params: {
    task: NotifiableTask;
    eventType: TaskNotificationEventType;
    scope: NotificationScope;
  }): Promise<ResolvedNotificationRecipients>;
}

/**
 * DB-level channel and status enums, matching notification_channel_enum /
 * notification_status_enum (Doc 1, Module 7).
 */
type NotificationChannelDb = 'email' | 'sms' | 'in_app' | 'webhook';
type NotificationStatusDb = 'queued' | 'sent' | 'failed' | 'cancelled';

interface AuthContext {
  organizationId: string;
  userId: string;
}

interface RequestWithAuthContext extends Request {
  organizationId?: string;
  userId?: string;
  user?: {
    organizationId?: string;
    userId?: string;
    [key: string]: unknown;
  };
}

/**
 * NotificationService – orchestrates Task-driven notifications
 * across configured channels (email, in-app, etc.) (Doc 5 §7),
 * and persists them into the notifications table.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly emailService: EmailService,
    private readonly orgProfileService: OrgProfileService,
    private readonly configService: OrgoConfigService,
    private readonly logService: LogService,
    private readonly prisma: PrismaService,
    private readonly featureFlagService: FeatureFlagService,
    @Inject(NOTIFICATION_RECIPIENT_RESOLVER)
    private readonly recipientResolver: NotificationRecipientResolver,
    @Inject(REQUEST) @Optional()
    private readonly request?: RequestWithAuthContext,
  ) {}

  /**
   * Public entry point: send notifications for a Task lifecycle event
   * (Doc 5 §7.3). This is invoked by task/case/workflow engines (NOTIFY actions).
   */
  async sendTaskNotification(
    task: NotifiableTask,
    eventType: TaskNotificationEventType,
  ): Promise<ServiceResult<TaskNotificationDispatchSummary>> {
    if (!task || !task.taskId || !task.organizationId) {
      return {
        ok: false,
        data: null,
        error: {
          code: 'NOTIFICATION_INVALID_TASK',
          message: 'Task and its identifiers are required to send notifications',
        },
      };
    }

    try {
      const [notificationConfig, profile] = await Promise.all([
        this.loadNotificationConfig(task.organizationId),
        this.orgProfileService.loadProfile(
          task.organizationId,
        ) as Promise<OrgProfile>,
      ]);

      const scope = this.normaliseNotificationScope(
        profile?.notification_scope,
      );

      const featureContext: FeatureFlagEvaluationContext = {
        organizationId: task.organizationId,
        userId: task.createdByUserId ?? null,
      };

      // Global per-org notifications flag. If disabled, all task notifications
      // are suppressed regardless of config.
      const notificationsEnabled = await this.isFeatureFlagEnabledOrUnset(
        'orgo.notifications.enabled',
        task.organizationId,
        featureContext,
      );

      if (!notificationsEnabled) {
        const summary: TaskNotificationDispatchSummary = {
          taskId: task.taskId,
          organizationId: task.organizationId,
          eventType,
          scope,
          suppressed: true,
          suppressionReason:
            'Notifications disabled for organization via feature flag',
          channels: [],
        };

        await this.safeLogEvent({
          category: 'TASK',
          logLevel: 'INFO',
          message: 'Notification suppressed: notifications globally disabled',
          identifier: `task_id:${task.taskId}`,
          metadata: { eventType, scope },
        });

        return {
          ok: true,
          data: summary,
          error: null,
        };
      }

      let channels = this.selectChannelsForEvent(notificationConfig, eventType);

      // Per-channel flags (email / in_app / sms / webhook).
      channels = await this.filterChannelsByFeatureFlags(
        channels,
        task.organizationId,
        featureContext,
      );

      if (channels.length === 0) {
        const summary: TaskNotificationDispatchSummary = {
          taskId: task.taskId,
          organizationId: task.organizationId,
          eventType,
          scope,
          suppressed: true,
          suppressionReason: 'No enabled notification channels for event',
          channels: [],
        };

        await this.safeLogEvent({
          category: 'TASK',
          logLevel: 'INFO',
          message: 'Notification suppressed: no enabled channels',
          identifier: `task_id:${task.taskId}`,
          metadata: { eventType, scope },
        });

        return {
          ok: true,
          data: summary,
          error: null,
        };
      }

      const recipients = await this.recipientResolver.resolveTaskRecipients({
        task,
        eventType,
        scope,
      });

      const hasAnyResolvedRecipient =
        recipients.primary.length > 0 || recipients.cc.length > 0;

      if (!hasAnyResolvedRecipient) {
        const summary: TaskNotificationDispatchSummary = {
          taskId: task.taskId,
          organizationId: task.organizationId,
          eventType,
          scope,
          suppressed: true,
          suppressionReason: 'No recipients resolved for notification',
          channels: [],
        };

        await this.safeLogEvent({
          category: 'TASK',
          logLevel: 'INFO',
          message: 'Notification suppressed: no recipients',
          identifier: `task_id:${task.taskId}`,
          metadata: { eventType, scope, visibility: task.visibility },
        });

        return {
          ok: true,
          data: summary,
          error: null,
        };
      }

      const recipientsByChannel = this.splitRecipientsByChannel(recipients);

      const hasRecipientsForAtLeastOneChannel = channels.some((channel) => {
        const channelRecipients = recipientsByChannel[channel];

        if (channel === 'EMAIL') {
          const to = this.extractEmails(channelRecipients.primary);
          const cc = this.extractEmails(channelRecipients.cc);
          return to.length > 0 || cc.length > 0;
        }

        if (channel === 'IN_APP') {
          const identifiers = this.extractInAppRecipientIdentifiers(
            channelRecipients.primary,
            channelRecipients.cc,
          );
          return identifiers.length > 0;
        }

        // For unimplemented channels (SMS/WEBHOOK), we keep the original
        // preference-based behaviour.
        return (
          channelRecipients.primary.length > 0 ||
          channelRecipients.cc.length > 0
        );
      });

      if (!hasRecipientsForAtLeastOneChannel) {
        const summary: TaskNotificationDispatchSummary = {
          taskId: task.taskId,
          organizationId: task.organizationId,
          eventType,
          scope,
          suppressed: true,
          suppressionReason:
            'No recipients resolved for any of the selected notification channels',
          channels: [],
        };

        await this.safeLogEvent({
          category: 'TASK',
          logLevel: 'INFO',
          message:
            'Notification suppressed: recipients have no matching channel preferences',
          identifier: `task_id:${task.taskId}`,
          metadata: {
            eventType,
            scope,
            visibility: task.visibility,
            channels,
          },
        });

        return {
          ok: true,
          data: summary,
          error: null,
        };
      }

      const channelResults: NotificationChannelDispatchResult[] = [];

      for (const channel of channels) {
        const channelRecipients = recipientsByChannel[channel];

        switch (channel) {
          case 'EMAIL': {
            const to = this.extractEmails(channelRecipients.primary);
            const cc = this.extractEmails(channelRecipients.cc);

            const result = await this.sendEmailTaskNotification(
              task,
              eventType,
              notificationConfig,
              to,
              cc,
            );
            channelResults.push(result);
            break;
          }

          case 'IN_APP': {
            const recipientIdentifiers = this.extractInAppRecipientIdentifiers(
              channelRecipients.primary,
              channelRecipients.cc,
            );

            const result = await this.sendInAppTaskNotification(
              task,
              eventType,
              recipientIdentifiers,
            );
            channelResults.push(result);
            break;
          }

          default: {
            const normalised = this.normaliseRecipientIdentifiers(
              channelRecipients,
            );
            channelResults.push({
              channel,
              success: false,
              recipients: normalised.to,
              cc: normalised.cc,
              error: 'Channel not implemented',
            });
            break;
          }
        }
      }

      const summary: TaskNotificationDispatchSummary = {
        taskId: task.taskId,
        organizationId: task.organizationId,
        eventType,
        scope,
        suppressed: false,
        channels: channelResults,
      };

      await this.safeLogEvent({
        category: 'TASK',
        logLevel: 'INFO',
        message: 'Task notifications dispatched',
        identifier: `task_id:${task.taskId}`,
        metadata: {
          eventType,
          scope,
          channels: channelResults.map((c) => ({
            channel: c.channel,
            success: c.success,
          })),
        },
      });

      return {
        ok: true,
        data: summary,
        error: null,
      };
    } catch (err) {
      const error = err as Error;
      this.logger.error(
        `Failed to send notifications for task ${task.taskId} (${eventType}): ${error.message}`,
        error.stack,
      );

      await this.safeLogEvent({
        category: 'TASK',
        logLevel: 'ERROR',
        message: 'Task notification failed',
        identifier: `task_id:${task.taskId}`,
        metadata: {
          eventType,
          error: error.message,
        },
      });

      return {
        ok: false,
        data: null,
        error: {
          code: 'NOTIFICATION_ERROR',
          message: error.message,
        },
      };
    }
  }

  /**
   * List notifications for the current user (notifications feed API).
   * Multi-tenant + user scoping is derived from the request context.
   */
  async listNotificationsForCurrentUser(
    filters: ListNotificationsQueryDto,
  ): Promise<NotificationFeedResponseDto> {
    const { organizationId, userId } = this.getAuthContextOrThrow();

    const limit =
      typeof filters.limit === 'number' && Number.isFinite(filters.limit)
        ? Math.min(Math.max(Math.floor(filters.limit), 1), 200)
        : 50;

    const where: any = {
      organization_id: organizationId,
      recipient_user_id: userId,
    };

    if (filters.channel) {
      where.channel = filters.channel;
    }

    if (filters.status) {
      where.status = filters.status;
    }

    const query: any = {
      where,
      orderBy: {
        queued_at: 'desc',
      },
      take: limit + 1,
    };

    if (filters.cursor) {
      query.cursor = { id: filters.cursor };
      query.skip = 1;
    }

    const rows = await this.prisma.notification.findMany(query);

    const hasMore = rows.length > limit;
    const slice = rows.slice(0, limit);

    const items: NotificationDto[] = slice.map((row: any) => ({
      id: row.id,
      organizationId: row.organization_id,
      channel: row.channel as ApiNotificationChannel,
      status: row.status as ApiNotificationStatus,
      recipientUserId: row.recipient_user_id,
      recipientAddress: row.recipient_address,
      relatedTaskId: row.related_task_id,
      payload: (row.payload ?? {}) as Record<string, unknown>,
      queuedAt: row.queued_at ? row.queued_at.toISOString() : null,
      sentAt: row.sent_at ? row.sent_at.toISOString() : null,
      failedAt: row.failed_at ? row.failed_at.toISOString() : null,
      errorMessage: row.error_message ?? null,
    }));

    return {
      items,
      nextCursor: hasMore ? rows[limit].id : null,
    };
  }

  /**
   * Send an ad-hoc in-app notification to a single user in the current org.
   * Used by the /api/v3/notifications/in-app endpoint.
   */
  async sendInApp(body: SendInAppNotificationDto): Promise<NotificationDto> {
    const { organizationId, userId } = this.getAuthContextOrThrow();

    if (!body.recipientUserId) {
      throw new BadRequestException('recipientUserId is required');
    }
    if (!body.title || !body.title.trim()) {
      throw new BadRequestException('title is required');
    }
    if (!body.body || !body.body.trim()) {
      throw new BadRequestException('body is required');
    }

    const featureContext: FeatureFlagEvaluationContext = {
      organizationId,
      userId,
    };

    const inAppEnabled = await this.isFeatureFlagEnabledOrUnset(
      'orgo.notifications.in_app',
      organizationId,
      featureContext,
    );

    if (!inAppEnabled) {
      throw new ForbiddenException(
        'In-app notifications are disabled for this organization',
      );
    }

    const now = new Date();

    const payload: Record<string, unknown> = {
      title: body.title,
      body: body.body,
      ...(body.metadata ? { metadata: body.metadata } : {}),
      ...(body.relatedTaskId ? { relatedTaskId: body.relatedTaskId } : {}),
      triggeredByUserId: userId,
    };

    const record = await this.prisma.notification.create({
      data: {
        organization_id: organizationId,
        channel: 'in_app',
        status: 'sent',
        recipient_user_id: body.recipientUserId,
        recipient_address: null,
        template_id: null,
        payload,
        related_task_id: body.relatedTaskId ?? null,
        queued_at: now,
        sent_at: now,
        failed_at: null,
        error_message: null,
      },
    });

    await this.safeLogEvent({
      category: 'TASK',
      logLevel: 'INFO',
      message: 'Ad-hoc in-app notification created',
      identifier: `notification_id:${record.id}`,
      metadata: {
        recipientUserId: body.recipientUserId,
        relatedTaskId: body.relatedTaskId ?? null,
      },
    });

    return {
      id: record.id,
      organizationId: record.organization_id,
      channel: record.channel as ApiNotificationChannel,
      status: record.status as ApiNotificationStatus,
      recipientUserId: record.recipient_user_id,
      recipientAddress: record.recipient_address,
      relatedTaskId: record.related_task_id,
      payload: (record.payload ?? {}) as Record<string, unknown>,
      queuedAt: record.queued_at ? record.queued_at.toISOString() : null,
      sentAt: record.sent_at ? record.sent_at.toISOString() : null,
      failedAt: record.failed_at ? record.failed_at.toISOString() : null,
      errorMessage: record.error_message ?? null,
    };
  }

  /**
   * Load and normalise notification configuration for an organization
   * (Doc 5 §7.2). Delegates to OrgoConfigService.
   */
  private async loadNotificationConfig(
    organizationId: string,
  ): Promise<NotificationConfig> {
    const config =
      await this.configService.getNotificationConfig(organizationId);

    if (!config) {
      throw new Error(
        `Notification configuration not found for organization ${organizationId}`,
      );
    }

    return config;
  }

  /**
   * Normalise org notification scope coming from OrgProfile into the canonical
   * NotificationScope enum, falling back to "department" for unknown/missing values
   * (Doc 2 §2.8 / Doc 7).
   */
  private normaliseNotificationScope(
    rawScope: string | null | undefined,
  ): NotificationScope {
    if (
      rawScope === 'user' ||
      rawScope === 'team' ||
      rawScope === 'department' ||
      rawScope === 'org_wide'
    ) {
      return rawScope;
    }

    return 'department';
  }

  /**
   * Select channels to use for a given event, based on config.
   * At minimum, uses the default channel if enabled; also adds IN_APP
   * if enabled as a secondary channel.
   */
  private selectChannelsForEvent(
    config: NotificationConfig,
    _eventType: TaskNotificationEventType,
  ): NotificationChannel[] {
    const channels: NotificationChannel[] = [];

    if (this.isChannelEnabled(config, config.defaultChannel)) {
      channels.push(config.defaultChannel);
    }

    // Enable IN_APP as a secondary channel for key lifecycle events if configured.
    if (
      this.isChannelEnabled(config, 'IN_APP') &&
      !channels.includes('IN_APP')
    ) {
      channels.push('IN_APP');
    }

    // Hook point: per-event channel routing could be added here.
    // For now, all events share the same channel selection logic.

    return channels;
  }

  private isChannelEnabled(
    config: NotificationConfig,
    channel: NotificationChannel,
  ): boolean {
    switch (channel) {
      case 'EMAIL':
        return !!config.channels.email?.enabled;
      case 'IN_APP':
        return !!config.channels.inApp?.enabled;
      case 'SMS':
        return !!config.channels.sms?.enabled;
      case 'WEBHOOK':
        return !!config.channels.webhook?.enabled;
      default:
        return false;
    }
  }

  /**
   * Filter eligible channels based on per-channel feature flags.
   * Missing flags do not gate behaviour (config remains the source of truth).
   */
  private async filterChannelsByFeatureFlags(
    channels: NotificationChannel[],
    organizationId: string,
    context: FeatureFlagEvaluationContext,
  ): Promise<NotificationChannel[]> {
    if (!this.featureFlagService || channels.length === 0) {
      return channels;
    }

    const enabledChannels: NotificationChannel[] = [];

    for (const channel of channels) {
      const flagCode = this.getChannelFeatureFlagCode(channel);
      const enabled = await this.isFeatureFlagEnabledOrUnset(
        flagCode,
        organizationId,
        context,
      );
      if (enabled) {
        enabledChannels.push(channel);
      }
    }

    return enabledChannels;
  }

  private getChannelFeatureFlagCode(channel: NotificationChannel): string {
    switch (channel) {
      case 'EMAIL':
        return 'orgo.notifications.email';
      case 'SMS':
        return 'orgo.notifications.sms';
      case 'IN_APP':
        return 'orgo.notifications.in_app';
      case 'WEBHOOK':
        return 'orgo.notifications.webhook';
      default:
        return 'orgo.notifications.unknown';
    }
  }

  /**
   * Check whether a recipient allows a given channel based on preferredChannels.
   * If preferredChannels is empty/undefined, all channels are allowed.
   */
  private doesRecipientAllowChannel(
    recipient: NotificationRecipient,
    channel: NotificationChannel,
  ): boolean {
    const { preferredChannels } = recipient;
    if (!preferredChannels || preferredChannels.length === 0) {
      return true;
    }
    return preferredChannels.includes(channel);
  }

  /**
   * Split resolved recipients into per-channel buckets, respecting
   * per-recipient preferredChannels.
   */
  private splitRecipientsByChannel(
    recipients: ResolvedNotificationRecipients,
  ): Record<
    NotificationChannel,
    { primary: NotificationRecipient[]; cc: NotificationRecipient[] }
  > {
    const result: Record<
      NotificationChannel,
      { primary: NotificationRecipient[]; cc: NotificationRecipient[] }
    > = {
      EMAIL: { primary: [], cc: [] },
      SMS: { primary: [], cc: [] },
      IN_APP: { primary: [], cc: [] },
      WEBHOOK: { primary: [], cc: [] },
    };

    const addRecipient = (
      recipient: NotificationRecipient,
      type: 'primary' | 'cc',
    ) => {
      (['EMAIL', 'SMS', 'IN_APP', 'WEBHOOK'] as NotificationChannel[]).forEach(
        (channel) => {
          if (this.doesRecipientAllowChannel(recipient, channel)) {
            result[channel][type].push(recipient);
          }
        },
      );
    };

    recipients.primary.forEach((recipient) =>
      addRecipient(recipient, 'primary'),
    );
    recipients.cc.forEach((recipient) => addRecipient(recipient, 'cc'));

    return result;
  }

  /**
   * Send email notification using EmailService (Doc 4 / Doc 5 §4.3).
   * Provider failures are captured as a channel-level error so that
   * the overall notification operation can still return a structured result.
   * Each send is also persisted into the notifications table.
   */
  private async sendEmailTaskNotification(
    task: NotifiableTask,
    eventType: TaskNotificationEventType,
    config: NotificationConfig,
    to: string[],
    cc: string[],
  ): Promise<NotificationChannelDispatchResult> {
    if (to.length === 0 && cc.length === 0) {
      return {
        channel: 'EMAIL',
        success: false,
        recipients: [],
        cc: [],
        error: 'No email recipients resolved',
      };
    }

    const templateId = this.getTemplateIdForEvent(config, eventType);
    const subject = this.buildEmailSubject(task, eventType);
    const variables = this.buildEmailTemplateVariables(task, eventType);

    const payloadForPersistence: Record<string, unknown> = {
      subject,
      templateId,
      variables,
      to,
      cc,
      eventType,
      taskId: task.taskId,
    };

    try {
      const result = await this.emailService.sendEmail({
        to,
        cc,
        subject,
        templateId,
        variables,
        senderName: config.channels.email.senderName,
        senderAddress: config.channels.email.senderAddress,
      });

      const status: NotificationStatusDb = result.ok ? 'sent' : 'failed';

      await this.persistNotificationRecord({
        organizationId: task.organizationId,
        channel: 'EMAIL',
        status,
        recipientUserId: null,
        recipientAddress: to[0] ?? cc[0] ?? null,
        templateId,
        relatedTaskId: task.taskId,
        payload: payloadForPersistence,
        errorMessage: result.ok ? null : result.error?.message ?? undefined,
      });

      if (!result.ok) {
        this.logger.warn(
          `Email notification failed for task ${task.taskId} (${eventType}): ${result.error?.message}`,
        );
      }

      return {
        channel: 'EMAIL',
        success: result.ok,
        recipients: to,
        cc,
        error: result.ok ? undefined : result.error?.message,
        providerMetadata: result.data ?? undefined,
      };
    } catch (err) {
      const error = err as Error;
      this.logger.error(
        `Email notification threw for task ${task.taskId} (${eventType}): ${error.message}`,
        error.stack,
      );

      await this.persistNotificationRecord({
        organizationId: task.organizationId,
        channel: 'EMAIL',
        status: 'failed',
        recipientUserId: null,
        recipientAddress: to[0] ?? cc[0] ?? null,
        templateId,
        relatedTaskId: task.taskId,
        payload: payloadForPersistence,
        errorMessage: error.message,
      });

      return {
        channel: 'EMAIL',
        success: false,
        recipients: to,
        cc,
        error: error.message,
      };
    }
  }

  /**
   * In-app notifications for task events.
   * Currently persisted into notifications table with status=sent and
   * channel-ready payload (title/description + recipients/metadata).
   */
  private async sendInAppTaskNotification(
    task: NotifiableTask,
    eventType: TaskNotificationEventType,
    recipientIdentifiers: string[],
  ): Promise<NotificationChannelDispatchResult> {
    if (recipientIdentifiers.length === 0) {
      return {
        channel: 'IN_APP',
        success: false,
        recipients: [],
        error: 'No in-app recipients resolved',
      };
    }

    const payload: Record<string, unknown> = {
      taskId: task.taskId,
      organizationId: task.organizationId,
      eventType,
      recipients: recipientIdentifiers,
      title: this.buildEmailSubject(task, eventType),
      description: task.description,
    };

    await this.persistNotificationRecord({
      organizationId: task.organizationId,
      channel: 'IN_APP',
      status: 'sent',
      recipientUserId: null,
      recipientAddress: null,
      templateId: null,
      relatedTaskId: task.taskId,
      payload,
    });

    await this.safeLogEvent({
      category: 'TASK',
      logLevel: 'INFO',
      message: 'In-app notification emitted',
      identifier: `task_id:${task.taskId}`,
      metadata: {
        eventType,
        recipients: recipientIdentifiers,
      },
    });

    return {
      channel: 'IN_APP',
      success: true,
      recipients: recipientIdentifiers,
    };
  }

  private getTemplateIdForEvent(
    config: NotificationConfig,
    eventType: TaskNotificationEventType,
  ): string {
    switch (eventType) {
      case 'CREATED':
        return config.templates.taskCreated;
      case 'ASSIGNED':
        return config.templates.taskAssignment;
      case 'ESCALATED':
        return config.templates.taskEscalation;
      case 'COMPLETED':
        return config.templates.taskCompleted;
      default:
        // Fallback to created template for unknown events (should not occur).
        return config.templates.taskCreated;
    }
  }

  private buildEmailSubject(
    task: NotifiableTask,
    eventType: TaskNotificationEventType,
  ): string {
    const prefix = (() => {
      switch (eventType) {
        case 'CREATED':
          return '[Task Created]';
        case 'ASSIGNED':
          return '[Task Assigned]';
        case 'ESCALATED':
          return '[Task Escalated]';
        case 'COMPLETED':
          return '[Task Completed]';
        default:
          return '[Task Update]';
      }
    })();

    return `${prefix} ${task.title}`;
  }

  private buildEmailTemplateVariables(
    task: NotifiableTask,
    eventType: TaskNotificationEventType,
  ): Record<string, unknown> {
    return {
      taskId: task.taskId,
      organizationId: task.organizationId,
      title: task.title,
      description: task.description,
      label: task.label,
      status: task.status,
      priority: task.priority,
      severity: task.severity,
      visibility: task.visibility,
      source: task.source,
      ownerRoleId: task.ownerRoleId ?? null,
      ownerUserId: task.ownerUserId ?? null,
      assigneeRole: task.assigneeRole ?? null,
      createdByUserId: task.createdByUserId ?? null,
      requesterPersonId: task.requesterPersonId ?? null,
      metadata: task.metadata ?? {},
      eventType,
    };
  }

  /**
   * Normalise a single recipient identifier for logging / unimplemented channels.
   * Preference order: email → userId → displayName.
   */
  private normaliseRecipientIdentifier(
    recipient: NotificationRecipient,
  ): string | null {
    const email = (recipient.email || '').trim();
    if (email.length > 0) {
      return email;
    }

    const userId = (recipient.userId || '').trim();
    if (userId.length > 0) {
      return userId;
    }

    const displayName = (recipient.displayName || '').trim();
    if (displayName.length > 0) {
      return displayName;
    }

    return null;
  }

  private normaliseRecipientIdentifiers(recipients: {
    primary: NotificationRecipient[];
    cc: NotificationRecipient[];
  }): { to: string[]; cc: string[] } {
    const to = recipients.primary
      .map((recipient) => this.normaliseRecipientIdentifier(recipient))
      .filter((identifier): identifier is string => !!identifier);

    const cc = recipients.cc
      .map((recipient) => this.normaliseRecipientIdentifier(recipient))
      .filter((identifier): identifier is string => !!identifier);

    return { to, cc };
  }

  /**
   * Extract identifiers for IN_APP notifications.
   * Prefers userId; falls back to normalised identifiers if none present.
   * (Fixes the earlier malformed spread syntax).
   */
  private extractInAppRecipientIdentifiers(
    primaryRecipients: NotificationRecipient[],
    ccRecipients: NotificationRecipient[],
  ): string[] {
    const byUserId = [...primaryRecipients, ...ccRecipients]
      .map((recipient) => (recipient.userId || '').trim())
      .filter((userId) => userId.length > 0);

    if (byUserId.length > 0) {
      return byUserId;
    }

    const normalised = this.normaliseRecipientIdentifiers({
      primary: primaryRecipients,
      cc: ccRecipients,
    });

    return [...normalised.to, ...normalised.cc];
  }

  private extractEmails(recipients: NotificationRecipient[]): string[] {
    return recipients
      .map((r) => (r.email || '').trim())
      .filter((email) => email.length > 0);
  }

  /**
   * Persist a notification into the notifications table.
   * This is the central "queue" primitive for all channels; current
   * implementation persists final status (sent/failed) with channel-ready payload.
   */
  private async persistNotificationRecord(params: {
    organizationId?: string | null;
    channel: NotificationChannel;
    status: NotificationStatusDb;
    recipientUserId?: string | null;
    recipientAddress?: string | null;
    templateId?: string | null;
    relatedTaskId?: string | null;
    payload: Record<string, unknown>;
    queuedAt?: Date | null;
    sentAt?: Date | null;
    failedAt?: Date | null;
    errorMessage?: string | null;
  }): Promise<void> {
    const {
      organizationId,
      channel,
      status,
      recipientUserId,
      recipientAddress,
      templateId,
      relatedTaskId,
      payload,
      queuedAt,
      sentAt,
      failedAt,
      errorMessage,
    } = params;

    if (!organizationId) {
      // Without an org context we cannot enforce multi-tenant boundaries; skip persistence.
      return;
    }

    const now = new Date();
    const queuedAtEffective = queuedAt ?? now;

    try {
      await this.prisma.notification.create({
        data: {
          organization_id: organizationId,
          channel: this.toDbChannel(channel),
          status,
          recipient_user_id: recipientUserId ?? null,
          recipient_address: recipientAddress ?? null,
          template_id: templateId ?? null,
          payload,
          related_task_id: relatedTaskId ?? null,
          queued_at: queuedAtEffective,
          sent_at: sentAt ?? (status === 'sent' ? now : null),
          failed_at: failedAt ?? (status === 'failed' ? now : null),
          error_message: errorMessage ?? null,
        },
      });
    } catch (err) {
      const error = err as Error;
      this.logger.error(
        `Failed to persist notification record (channel=${channel}, status=${status}): ${error.message}`,
        error.stack,
      );
    }
  }

  private toDbChannel(channel: NotificationChannel): NotificationChannelDb {
    switch (channel) {
      case 'EMAIL':
        return 'email';
      case 'SMS':
        return 'sms';
      case 'IN_APP':
        return 'in_app';
      case 'WEBHOOK':
        return 'webhook';
      default:
        return 'email';
    }
  }

  /**
   * Resolve auth context (organizationId + userId) from the current request.
   * Used to enforce multi-tenant and per-user scoping for the feed and ad-hoc
   * in-app notifications.
   */
  private getAuthContextFromRequest(): AuthContext | null {
    const req = this.request as RequestWithAuthContext | undefined;
    if (!req) {
      return null;
    }

    const userFromReq = (req as any).user || {};

    const organizationId =
      (userFromReq && (userFromReq.organizationId as string | undefined)) ??
      (req as any).organizationId ??
      null;

    const userId =
      (userFromReq && (userFromReq.userId as string | undefined)) ??
      (req as any).userId ??
      (userFromReq && (userFromReq.id as string | undefined)) ??
      null;

    if (!organizationId || !userId) {
      return null;
    }

    return { organizationId, userId };
  }

  private getAuthContextOrThrow(): AuthContext {
    const ctx = this.getAuthContextFromRequest();
    if (!ctx) {
      throw new UnauthorizedException(
        'Authentication context is not available for notifications',
      );
    }
    return ctx;
  }

  /**
   * Feature flag helper: if the flag does not exist, treat it as "not gating"
   * and fall back to configuration (returns true).
   */
  private async isFeatureFlagEnabledOrUnset(
    code: string,
    organizationId: string | null,
    context: FeatureFlagEvaluationContext,
  ): Promise<boolean> {
    if (!this.featureFlagService) {
      return true;
    }

    try {
      const flag = await this.featureFlagService.getFlag(code, organizationId);

      if (!flag) {
        // No explicit flag configured; do not gate behaviour.
        return true;
      }

      return this.featureFlagService.isFeatureEnabled(code, {
        organizationId,
        context,
      });
    } catch (err) {
      const error = err as Error;
      this.logger.warn(
        `Feature flag evaluation failed for ${code} (org=${organizationId ?? 'null'}): ${error.message}. Defaulting to enabled.`,
      );
      return true;
    }
  }

  /**
   * Safely log notification-related events without allowing logging failures
   * to break the notification flow (Doc 5 §2.4).
   */
  private async safeLogEvent(event: {
    category: string;
    logLevel: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
    message: string;
    identifier?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.logService.logEvent({
        ...event,
        metadata: {
          ...(event.metadata ?? {}),
          component: 'NotificationService',
        },
      });
    } catch (err) {
      const error = err as Error;
      this.logger.warn(
        `Failed to log notification event (${event.message}): ${error.message}`,
      );
    }
  }
}
