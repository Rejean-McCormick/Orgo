// apps/api/src/orgo/backbone/organizations/organization.module.ts

import { Module } from '@nestjs/common';
import { PersistenceModule } from '../../../persistence/persistence.module';
import { LoggerModule } from '../../core/logging/logger.module';
import { OrgoConfigModule } from '../../config/config.module';
import { OrganizationService } from './organization.service';
import { OrganizationController } from './organization.controller';

/**
 * OrganizationModule
 *
 * NestJS module for the multi-tenant backbone "organizations" slice.
 * - Exposes OrganizationService and OrganizationController.
 * - Depends on:
 *   - PersistenceModule (Prisma access to `organizations`, `organization_profiles`, etc.)
 *   - LoggerModule (structured logging / audit)
 *   - OrgoConfigModule (organization profiles, feature flags, global config)
 */
@Module({
  imports: [
    PersistenceModule,
    LoggerModule,
    OrgoConfigModule,
  ],
  controllers: [OrganizationController],
  providers: [OrganizationService],
  exports: [OrganizationService],
})
export class OrganizationModule {}
