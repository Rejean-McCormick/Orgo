import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../persistence/database.service';

export type SyncDirection = 'upload' | 'download' | 'bidirectional';

export interface OfflineTaskChange {
  /**
   * Operation performed on the offline node.
   * - insert: new task created on the offline node
   * - update: existing task updated on the offline node
   * - delete: task deleted/voided on the offline node (mapped to CANCELLED)
   */
  operation: 'insert' | 'update' | 'delete';

  /**
   * Task identifier as known on the server (tasks.id / task_id).
   * For inserts this can be omitted; for updates/deletes it should be provided
   * if the offline node already knows the server ID.
   */
  taskId?: string;

  /**
   * The client-side representation of the task after the operation.
   * This is stored/merged into the canonical tasks row.
   */
  data: Record<string, any>;

  /**
   * Snapshot of the server version that the client last saw when applying
   * this change. Used for optimistic concurrency / conflict detection.
   * If omitted, the change is applied with "last write wins" semantics.
   */
  serverVersion?: Record<string, any> | null;
}

export interface OfflineSyncPayload {
  /**
   * Tenant isolation key; this must match organizations.id.
   */
  organizationId: string;

  /**
   * Stable identifier for the offline node (e.g. device id / host slug).
   * Maps to offline_nodes.node_identifier.
   */
  nodeIdentifier: string;

  /**
   * Direction of sync:
   * - upload: client → server only
   * - download: server → client only
   * - bidirectional: upload then download in a single session
   */
  direction: SyncDirection;

  /**
   * Last successful sync timestamp as known by the client (ISO‑8601).
   * This is used as a hint when building the download snapshot.
   */
  clientLastSyncAt?: string | null;

  /**
   * Offline task changes to upload. Only used when direction includes "upload".
   */
  taskChanges?: OfflineTaskChange[];
}

export interface SyncSummary {
  uploadedTasks: number;
  createdTasks: number;
  updatedTasks: number;
  deletedTasks: number;
  conflicts: number;
  downloadedTasks: number;
}

export interface DownloadSnapshot {
  /**
   * Tasks changed on the server since last sync and relevant to this org.
   * Shape is the raw tasks rows; filtering/normalisation is handled by the client.
   */
  tasks: any[];
}

export interface SyncResult {
  sessionId: string;
  nodeId: string;
  direction: SyncDirection;
  summary: SyncSummary;
  /**
   * Optional download snapshot (only present when direction is "download"
   * or "bidirectional").
   */
  download?: DownloadSnapshot;
}

/**
 * SyncService
 *
 * Coordinates sync sessions between SQLite‑backed offline nodes and the
 * central Postgres database using:
 *  - offline_nodes
 *  - sync_sessions
 *  - sync_conflicts
 *  - tasks
 *
 * This service is intentionally generic and does not embed domain logic.
 * It works with the canonical Task model and multi‑tenant invariants.
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * High-level entry point for synchronising an offline node.
   *
   * 1. Ensures offline_nodes row exists for (organizationId, nodeIdentifier).
   * 2. Creates a sync_sessions row in "running" state.
   * 3. Applies uploaded changes (if direction === upload|bidirectional).
   * 4. Builds a download snapshot (if direction === download|bidirectional).
   * 5. Marks the sync_sessions row as completed/failed with summary + error.
   * 6. Updates offline_nodes.last_sync_at on success.
   */
  async syncOfflineNode(payload: OfflineSyncPayload): Promise<SyncResult> {
    const { organizationId, nodeIdentifier, direction } = payload;

    if (!organizationId) {
      throw new Error('organizationId is required for offline sync');
    }
    if (!nodeIdentifier) {
      throw new Error('nodeIdentifier is required for offline sync');
    }
    if (!direction) {
      throw new Error('direction is required for offline sync');
    }

    const prisma = this.getPrismaClient();

    const summary: SyncSummary = {
      uploadedTasks: 0,
      createdTasks: 0,
      updatedTasks: 0,
      deletedTasks: 0,
      conflicts: 0,
      downloadedTasks: 0,
    };

    // 1. Ensure offline_nodes row exists
    const offlineNode = await this.ensureOfflineNode(
      prisma,
      organizationId,
      nodeIdentifier,
    );

    // 2. Start sync session
    const session = await this.startSyncSession(
      prisma,
      offlineNode.id,
      direction,
    );

    let download: DownloadSnapshot | undefined;

    try {
      // 3. Apply upload changes
      if (direction === 'upload' || direction === 'bidirectional') {
        await this.applyTaskUploadChanges(
          prisma,
          session.id,
          organizationId,
          payload.taskChanges ?? [],
          summary,
        );
      }

      // 4. Build download snapshot
      if (direction === 'download' || direction === 'bidirectional') {
        download = await this.buildDownloadSnapshot(
          prisma,
          organizationId,
          offlineNode,
          payload.clientLastSyncAt,
          summary,
        );
      }

      // 5. Mark session as completed
      await this.completeSyncSession(prisma, session.id, 'completed', summary);

      // 6. Update offline_nodes.last_sync_at
      await prisma.offline_nodes.update({
        where: { id: offlineNode.id },
        data: { last_sync_at: new Date() },
      });

      this.logger.log(
        `Offline sync completed for node=${nodeIdentifier} org=${organizationId} direction=${direction}`,
      );

      return {
        sessionId: session.id,
        nodeId: offlineNode.id,
        direction,
        summary,
        download,
      };
    } catch (error) {
      this.logger.error(
        `Offline sync failed for node=${nodeIdentifier} org=${organizationId}: ${
          (error as Error).message
        }`,
        (error as Error).stack,
      );

      await this.completeSyncSession(
        prisma,
        session.id,
        'failed',
        summary,
        error,
      );

      throw error;
    }
  }

  /**
   * Convenience entry point for task‑only upload jobs (e.g. queue job
   * orgo.db.sync-offline). It simply delegates to syncOfflineNode with
   * direction "upload".
   */
  async syncOfflineTasks(payload: OfflineSyncPayload): Promise<SyncResult> {
    return this.syncOfflineNode({ ...payload, direction: 'upload' });
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Obtain a PrismaClient from the DatabaseService. The DatabaseService in the
   * Orgo stack is expected to expose either:
   *  - getPrismaClient(): PrismaClient
   *  - prisma: PrismaClient
   *
   * This method handles both shapes and falls back to the raw service for
   * test/mocked implementations.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getPrismaClient(): any {
    const anyDb = this.db as any;

    if (typeof anyDb.getPrismaClient === 'function') {
      return anyDb.getPrismaClient();
    }

    if (anyDb.prisma) {
      return anyDb.prisma;
    }

    return anyDb;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async ensureOfflineNode(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma: any,
    organizationId: string,
    nodeIdentifier: string,
  ): Promise<any> {
    const existing = await prisma.offline_nodes.findFirst({
      where: {
        organization_id: organizationId,
        node_identifier: nodeIdentifier,
      },
    });

    if (existing) {
      return existing;
    }

    this.logger.log(
      `Creating offline node for org=${organizationId}, node=${nodeIdentifier}`,
    );

    return prisma.offline_nodes.create({
      data: {
        organization_id: organizationId,
        node_identifier: nodeIdentifier,
        status: 'active', // offline_nodes.status enum: active | inactive | retired
        last_sync_at: null,
      },
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async startSyncSession(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma: any,
    offlineNodeId: string,
    direction: SyncDirection,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    return prisma.sync_sessions.create({
      data: {
        offline_node_id: offlineNodeId,
        direction,
        status: 'running', // sync_sessions.status enum: running | completed | failed
        started_at: new Date(),
        summary: {},
        error_message: null,
      },
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async completeSyncSession(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma: any,
    sessionId: string,
    status: 'completed' | 'failed',
    summary: SyncSummary,
    error?: unknown,
  ): Promise<void> {
    await prisma.sync_sessions.update({
      where: { id: sessionId },
      data: {
        status,
        finished_at: new Date(),
        summary,
        error_message: error ? String((error as Error).message ?? error) : null,
      },
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async applyTaskUploadChanges(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma: any,
    sessionId: string,
    organizationId: string,
    changes: OfflineTaskChange[],
    summary: SyncSummary,
  ): Promise<void> {
    if (!changes.length) {
      return;
    }

    summary.uploadedTasks += changes.length;

    for (const change of changes) {
      const baseTaskId =
        change.taskId ??
        (change.data.task_id as string | undefined) ??
        (change.data.id as string | undefined);

      switch (change.operation) {
        case 'insert': {
          await prisma.tasks.create({
            data: {
              ...change.data,
              organization_id: organizationId,
            },
          });
          summary.createdTasks += 1;
          break;
        }

        case 'update': {
          if (!baseTaskId) {
            this.logger.warn(
              'Skipping offline update without taskId or data.id',
            );
            continue;
          }

          const serverRow = await prisma.tasks.findUnique({
            where: { id: baseTaskId },
          });

          if (!serverRow) {
            // If server no longer has the row, treat as create.
            await prisma.tasks.create({
              data: {
                ...change.data,
                organization_id: organizationId,
              },
            });
            summary.createdTasks += 1;
            break;
          }

          if (this.hasVersionConflict(serverRow, change.serverVersion)) {
            await this.recordConflict(
              prisma,
              sessionId,
              'task',
              baseTaskId,
              serverRow,
              change.data,
            );
            summary.conflicts += 1;
            break;
          }

          await prisma.tasks.update({
            where: { id: baseTaskId },
            data: change.data,
          });
          summary.updatedTasks += 1;
          break;
        }

        case 'delete': {
          if (!baseTaskId) {
            this.logger.warn(
              'Skipping offline delete without taskId or data.id',
            );
            continue;
          }

          const serverRow = await prisma.tasks.findUnique({
            where: { id: baseTaskId },
          });

          if (!serverRow) {
            // Already deleted on the server; nothing to do.
            break;
          }

          if (this.hasVersionConflict(serverRow, change.serverVersion)) {
            await this.recordConflict(
              prisma,
              sessionId,
              'task',
              baseTaskId,
              serverRow,
              change.data,
            );
            summary.conflicts += 1;
            break;
          }

          // Map delete to a canonical CANCELLED transition; we do not hard‑delete
          // tasks because they are part of the audit trail.
          await prisma.tasks.update({
            where: { id: baseTaskId },
            data: {
              status: 'CANCELLED',
              closed_at: new Date(),
            },
          });
          summary.deletedTasks += 1;
          break;
        }

        default: {
          this.logger.warn(
            `Unknown offline task operation: ${(change as any).operation}`,
          );
          break;
        }
      }
    }
  }

  /**
   * Returns true if there is a conflict between the current server row and the
   * version the client claims to have seen.
   *
   * Conflict heuristic:
   *  - If client provided serverVersion.updated_at and it differs from the
   *    current server updated_at, treat as conflict.
   *  - If no version information is provided, no conflict is detected.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private hasVersionConflict(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    serverRow: any,
    clientServerVersion?: Record<string, any> | null,
  ): boolean {
    if (!clientServerVersion) {
      return false;
    }

    const serverUpdatedAt =
      serverRow.updated_at ?? serverRow.updatedAt ?? serverRow.updated_at_utc;
    const clientUpdatedAt =
      clientServerVersion.updated_at ??
      clientServerVersion.updatedAt ??
      clientServerVersion.updated_at_utc;

    if (!serverUpdatedAt || !clientUpdatedAt) {
      return false;
    }

    const serverTime = new Date(serverUpdatedAt).getTime();
    const clientTime = new Date(clientUpdatedAt).getTime();

    return serverTime !== clientTime;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async recordConflict(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma: any,
    sessionId: string,
    entityType: string,
    entityId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    serverVersion: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    clientVersion: any,
  ): Promise<void> {
    await prisma.sync_conflicts.create({
      data: {
        sync_session_id: sessionId,
        entity_type: entityType,
        entity_id: entityId,
        server_version: serverVersion,
        client_version: clientVersion,
        resolution_strategy: 'manual_review',
        resolved: false,
        resolved_at: null,
        resolved_by_user_id: null,
      },
    });

    this.logger.warn(
      `Recorded sync conflict for entity_type=${entityType} entity_id=${entityId} session_id=${sessionId}`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async buildDownloadSnapshot(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma: any,
    organizationId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    offlineNode: any,
    clientLastSyncAt: string | null | undefined,
    summary: SyncSummary,
  ): Promise<DownloadSnapshot> {
    const lastSync =
      clientLastSyncAt ??
      (offlineNode.last_sync_at
        ? new Date(offlineNode.last_sync_at).toISOString()
        : null);

    const lastSyncDate = lastSync ? new Date(lastSync) : new Date(0);

    const tasks = await prisma.tasks.findMany({
      where: {
        organization_id: organizationId,
        updated_at: {
          gt: lastSyncDate,
        },
      },
    });

    summary.downloadedTasks = tasks.length;

    return { tasks };
  }
}
