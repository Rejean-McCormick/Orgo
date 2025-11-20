import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PersistenceModule } from '../../../persistence/persistence.module';
import { LoggerModule } from '../logging/logger.module';
import { ConfigModule as OrgoConfigModule } from '../../config/config.module';
import { NotificationService } from './notification.service';

/**
 * NotificationModule
 *
 * Wires up the core NotificationService (notifier_service) with:
 * - Persistence (for storing notification records if needed),
 * - Orgo YAML config (notification_config.yaml),
 * - Structured logging.
 *
 * See:
 * - Doc 2 – Foundations (NOTIFICATION_CHANNEL / NOTIFICATION_SCOPE)
 * - Doc 5 – Core Services (Notification Service spec)
 */
@Module({
  imports: [
    // Nest env config (global, but safe to import here as well)
    ConfigModule,

    // Orgo-wide YAML configuration (notification_config.yaml, profiles, etc.)
    OrgoConfigModule,

    // Shared Prisma-based persistence layer
    PersistenceModule,

    // Structured logging (LOG_CATEGORY / LOG_LEVEL)
    LoggerModule,
  ],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
