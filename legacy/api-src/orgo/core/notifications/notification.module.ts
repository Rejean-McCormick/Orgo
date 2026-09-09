import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PersistenceModule } from '../../../persistence/persistence.module';
import { LoggerModule } from '../logging/logger.module';
import { ConfigModule as OrgoConfigModule } from '../../config/config.module';
import { NotificationService } from './notification.service';

/**
 * NotificationModule
 *
 * Exposes NotificationService and integrates it with:
 * - Nest env config (ConfigModule),
 * - Orgo YAML config (notification_config.yaml),
 * - Shared persistence layer,
 * - Structured logging.
 */
@Module({
  imports: [
    ConfigModule,
    OrgoConfigModule,
    PersistenceModule,
    LoggerModule,
  ],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
