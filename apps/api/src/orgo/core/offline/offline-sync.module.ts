// apps/api/src/orgo/core/offline/offline-sync.module.ts

import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SyncService } from './sync.service';

/**
 * OfflineSyncModule
 *
 * Core Services – Offline & Sync.
 *
 * Wires up SyncService, which coordinates sync sessions between offline
 * nodes (SQLite) and the central Postgres database using:
 *  - offline_nodes
 *  - sync_sessions
 *  - sync_conflicts
 *  - tasks
 *
 * Depends on:
 *  - DatabaseModule (DatabaseService / Prisma access).
 */
@Module({
  imports: [DatabaseModule],
  providers: [SyncService],
  exports: [SyncService],
})
export class OfflineSyncModule {}
