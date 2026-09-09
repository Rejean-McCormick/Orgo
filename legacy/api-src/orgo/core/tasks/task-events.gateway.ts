import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

/**
 * Canonical Task enums (aligned with Orgo v3 specs).
 */
export type TaskStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'ON_HOLD'
  | 'COMPLETED'
  | 'FAILED'
  | 'ESCALATED'
  | 'CANCELLED';

export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type TaskSeverity = 'MINOR' | 'MODERATE' | 'MAJOR' | 'CRITICAL';

export type TaskVisibility = 'PUBLIC' | 'INTERNAL' | 'RESTRICTED' | 'ANONYMISED';

/**
 * Canonical Task JSON snapshot used in task events.
 * Field names match the Task JSON contract (API boundary) rather than DB column names.
 */
export interface TaskJsonSnapshot {
  task_id: string;
  organization_id: string;
  case_id?: string | null;

  source: 'email' | 'api' | 'manual' | 'sync';

  type: string;
  category: 'request' | 'incident' | 'update' | 'report' | 'distribution';
  subtype?: string | null;

  label: string;
  title: string;
  description: string;

  status: TaskStatus;
  priority: TaskPriority;
  severity: TaskSeverity;
  visibility: TaskVisibility;

  assignee_role?: string | null;
  created_by_user_id?: string | null;
  requester_person_id?: string | null;
  owner_role_id?: string | null;
  owner_user_id?: string | null;

  due_at?: string | null;
  reactivity_time?: string | null;
  reactivity_deadline_at?: string | null;
  escalation_level: number;
  closed_at?: string | null;

  metadata?: Record<string, unknown>;

  created_at: string;
  updated_at: string;
}

/**
 * Event types sent over the task event stream.
 */
export type TaskEventType =
  | 'TASK_CREATED'
  | 'TASK_UPDATED'
  | 'TASK_STATUS_CHANGED'
  | 'TASK_ESCALATED'
  | 'TASK_COMMENT_ADDED';

/**
 * Payload for a single task event delivered over WebSocket.
 *
 * Notes:
 * - `task` is a canonical Task JSON snapshot.
 * - `visibility` is duplicated from `task.visibility` for quick filtering.
 * - For RESTRICTED/ANONYMISED tasks, `recipient_user_ids` should be set so
 *   the gateway can restrict delivery to specific users.
 */
export interface TaskEventPayload {
  event_id: string;
  event_type: TaskEventType;
  organization_id: string;
  task_id: string;
  task: TaskJsonSnapshot;

  visibility: TaskVisibility;

  actor_user_id?: string | null;
  occurred_at: string; // ISO-8601 string (UTC)

  /**
   * Optional list of user IDs that are explicitly allowed to receive this event.
   * Used for RESTRICTED / ANONYMISED visibility.
   */
  recipient_user_ids?: string[];

  /**
   * Optional additional metadata about the event (non-PII).
   */
  meta?: Record<string, unknown>;
}

/**
 * Message name used by the gateway when pushing task events to clients.
 * Clients should subscribe to this message name.
 */
export const TASK_EVENTS_MESSAGE = 'task.events';

/**
 * Internal structure used for tracking a connected client.
 */
interface ConnectedClientInfo {
  organizationId: string;
  userId?: string;
}

/**
 * WebSocket gateway for streaming live Task events to web clients.
 *
 * Namespace:
 *   - `/task-events`
 *
 * Connection:
 *   - Clients SHOULD pass `organizationId` and (optionally) `userId` as query
 *     parameters in the WebSocket handshake:
 *
 *       io('/task-events', {
 *         query: { organizationId, userId },
 *       });
 *
 *   - `organizationId` is required; connections without it are rejected.
 *
 * Delivery rules:
 *   - PUBLIC / INTERNAL tasks → delivered to all clients in the organization room.
 *   - RESTRICTED / ANONYMISED tasks → delivered only to `recipient_user_ids`
 *     if provided; otherwise dropped (to avoid accidental leakage).
 */
@WebSocketGateway({
  namespace: '/task-events',
  cors: {
    origin: true,
    credentials: true,
  },
})
export class TaskEventsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  public server!: Server;

  private readonly logger = new Logger(TaskEventsGateway.name);

  /**
   * Map of socket.id → ConnectedClientInfo.
   */
  private readonly clients = new Map<string, ConnectedClientInfo>();

  /**
   * Reverse index of user_id → Set<socket.id>.
   * Used to target RESTRICTED / ANONYMISED events to specific users.
   */
  private readonly userIndex = new Map<string, Set<string>>();

  afterInit(): void {
    this.logger.log('TaskEventsGateway initialized');
  }

  async handleConnection(client: Socket): Promise<void> {
    const organizationId =
      this.extractString(client.handshake.query.organizationId) ??
      this.extractString(client.handshake.query.organization_id);

    const userId =
      this.extractString(client.handshake.query.userId) ??
      this.extractString(client.handshake.query.user_id);

    if (!organizationId) {
      this.logger.warn(
        `Rejecting connection ${client.id}: missing organizationId in handshake query`,
      );
      client.disconnect(true);
      return;
    }

    this.registerClient(client, {
      organizationId,
      userId,
    });

    this.logger.debug(
      `Client ${client.id} connected for org ${organizationId}` +
        (userId ? ` (user ${userId})` : ''),
    );
  }

  async handleDisconnect(client: Socket): Promise<void> {
    this.unregisterClient(client.id);
  }

  /**
   * Optional explicit identify message. This can be used to update the
   * organization/user binding after the initial handshake, for example
   * after a token-based authentication flow.
   *
   * Payload:
   *   { organizationId: string; userId?: string }
   */
  @SubscribeMessage('identify')
  handleIdentify(
    @MessageBody()
    data: { organizationId?: string; userId?: string },
    @ConnectedSocket() client: Socket,
  ): void {
    const current = this.clients.get(client.id);

    const organizationId = data.organizationId ?? current?.organizationId;
    const userId = data.userId ?? current?.userId;

    if (!organizationId) {
      this.logger.warn(
        `identify message from ${client.id} missing organizationId; ignoring`,
      );
      return;
    }

    this.registerClient(client, { organizationId, userId });

    this.logger.debug(
      `Client ${client.id} identified for org ${organizationId}` +
        (userId ? ` (user ${userId})` : ''),
    );
  }

  /**
   * Optional ping/pong to keep connections alive and for simple diagnostics.
   */
  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket): { type: 'pong' } {
    this.logger.debug(`Received ping from ${client.id}`);
    return { type: 'pong' };
  }

  /**
   * Broadcast a Task event to the appropriate set of clients.
   *
   * This method is intended to be called from TaskService / domain services
   * whenever a relevant Task lifecycle event occurs.
   */
  public broadcastTaskEvent(event: TaskEventPayload): void {
    const {
      organization_id: organizationId,
      visibility,
      recipient_user_ids: recipientUserIds,
      event_type: eventType,
      task_id: taskId,
    } = event;

    if (!organizationId) {
      this.logger.warn(
        `Dropping task event without organization_id (task_id=${taskId}, type=${eventType})`,
      );
      return;
    }

    if (visibility === 'RESTRICTED' || visibility === 'ANONYMISED') {
      if (!recipientUserIds || recipientUserIds.length === 0) {
        this.logger.warn(
          `Dropping ${visibility} task event with no recipient_user_ids (task_id=${taskId}, type=${eventType})`,
        );
        return;
      }

      for (const userId of recipientUserIds) {
        this.emitToUser(userId, event);
      }

      return;
    }

    // PUBLIC / INTERNAL – broadcast to all clients in the organization room.
    const roomName = this.getOrganizationRoom(organizationId);
    this.server.to(roomName).emit(TASK_EVENTS_MESSAGE, event);
  }

  /**
   * Register or update a connected client and place it in the appropriate
   * organization room and user index.
   */
  private registerClient(client: Socket, info: ConnectedClientInfo): void {
    // Remove any previous registration first.
    this.unregisterClient(client.id);

    this.clients.set(client.id, info);

    // Join per-organization room.
    const roomName = this.getOrganizationRoom(info.organizationId);
    client.join(roomName);

    // Index by user, if available.
    if (info.userId) {
      let sockets = this.userIndex.get(info.userId);
      if (!sockets) {
        sockets = new Set<string>();
        this.userIndex.set(info.userId, sockets);
      }
      sockets.add(client.id);
    }
  }

  /**
   * Remove a client from all tracking structures.
   */
  private unregisterClient(clientId: string): void {
    const info = this.clients.get(clientId);
    if (!info) {
      return;
    }

    this.clients.delete(clientId);

    if (info.userId) {
      const sockets = this.userIndex.get(info.userId);
      if (sockets) {
        sockets.delete(clientId);
        if (sockets.size === 0) {
          this.userIndex.delete(info.userId);
        }
      }
    }

    this.logger.debug(
      `Client ${clientId} disconnected from org ${info.organizationId}` +
        (info.userId ? ` (user ${info.userId})` : ''),
    );
  }

  /**
   * Emit an event to all sockets associated with a given user ID.
   */
  private emitToUser(userId: string, event: TaskEventPayload): void {
    const sockets = this.userIndex.get(userId);
    if (!sockets || sockets.size === 0) {
      this.logger.debug(
        `No active sockets for user ${userId}; task event not delivered`,
      );
      return;
    }

    for (const socketId of sockets) {
      this.server.to(socketId).emit(TASK_EVENTS_MESSAGE, event);
    }
  }

  /**
   * Derive the room name for a given organization.
   */
  private getOrganizationRoom(organizationId: string): string {
    return `org:${organizationId}`;
  }

  /**
   * Helper to normalize a value from the WebSocket handshake query into a string.
   */
  private extractString(value: unknown): string | undefined {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }

    if (Array.isArray(value)) {
      const first = value[0];
      if (typeof first === 'string' && first.trim().length > 0) {
        return first.trim();
      }
    }

    return undefined;
  }
}
