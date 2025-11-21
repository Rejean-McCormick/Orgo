// apps/api/src/orgo/core/notifications/notification.service.ts

import { Inject, Injectable, Logger } from '@nestjs/common';
import { OrgoConfigService } from '../../config/config.service';
import { OrgProfileService } from '../../config/org-profile.service';
import { LogService } from '../logging/log.service';
import { EmailService } from '../email/email.service';

/**
 * Injection token for a pluggable recipient resolver.
 * A provider must be bound to this token in the NotificationsModule.
 */
export const NOTIFICATION_RECIPIENT_RESOLVER = 'NOTIFICATION_RECIPIENT_RESOLVER';

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
 * This is a logical view aligned with the canonical Task model (Doc 5 §3.1 / Doc 8 §8.4.2).
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
 * NotificationService – orchestrates Task-driven notifications
 * across configured channels (email, in-app, etc.) (Doc 5 §7).
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly emailService: EmailService,
    private readonly orgProfileService: OrgProfileService,
    private readonly configService: OrgoConfigService,
    private readonly logService: LogService,
    @Inject(NOTIFICATION_RECIPIENT_RESOLVER)
    private readonly recipientResolver: NotificationRecipientResolver,
  ) {}

  /**
   * Public entry point: send notifications for a Task lifecycle event
   * (Doc 5 §7.3).
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

      const scope: NotificationScope =
        (profile?.notification_scope as NotificationScope) || 'department';

      const channels = this.selectChannelsForEvent(
        notificationConfig,
        eventType,
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

        await this.logService.logEvent({
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

        await this.logService.logEvent({
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

        await this.logService.logEvent({
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

      await this.logService.logEvent({
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

      await this.logService.logEvent({
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
   * Select channels to use for a given event, based on config.
   * At minimum, uses the default channel if enabled; also adds IN_APP
   * if enabled as a secondary channel.
   */
  private selectChannelsForEvent(
    config: NotificationConfig,
    eventType: TaskNotificationEventType,
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

    recipients.primary.forEach((recipient) => addRecipient(recipient, 'primary'));
    recipients.cc.forEach((recipient) => addRecipient(recipient, 'cc'));

    return result;
  }

  /**
   * Send email notification using EmailService (Doc 4 / Doc 5 §4.3).
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

    const result = await this.emailService.sendEmail({
      to,
      cc,
      subject,
      templateId,
      variables,
      senderName: config.channels.email.senderName,
      senderAddress: config.channels.email.senderAddress,
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
  }

  /**
   * Stub for in-app notifications. This should be wired to a persistence
   * layer and/or WebSocket gateway (e.g. TaskEventsGateway) later.
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

    // For now, we only log an in-app notification event.
    await this.logService.logEvent({
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
}
