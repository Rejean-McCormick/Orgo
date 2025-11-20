// apps/api/src/orgo/orgo.module.ts

import { Module } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';

import { PersistenceModule } from '../persistence/persistence.module';

import { LoggerModule } from './core/logging/logger.module';
import { PayloadValidationPipe } from './core/validation/payload-validation.pipe';
import { ConfigValidationService } from './core/validation/config-validation.service';

import { TaskModule } from './core/tasks/task.module';
import { CaseModule } from './core/cases/case.module';
import { WorkflowModule } from './core/workflow/workflow.module';
import { LabelsModule } from './core/labels/labels.module';
import { OrgoConfigModule } from './config/config.module';

@Module({
  imports: [
    // DB / Prisma access
    PersistenceModule,

    // Cross-cutting infrastructure
    LoggerModule,
    OrgoConfigModule,

    // Core Orgo services
    TaskModule,
    CaseModule,
    WorkflowModule,
    LabelsModule,
  ],
  providers: [
    // Validate Orgo YAML/config bundles at startup
    ConfigValidationService,

    // Global payload validation (DTO + enum enforcement)
    {
      provide: APP_PIPE,
      useClass: PayloadValidationPipe,
    },
  ],
  exports: [
    // Re-export key feature modules so consumers can just import OrgoModule
    LoggerModule,
    OrgoConfigModule,
    TaskModule,
    CaseModule,
    WorkflowModule,
    LabelsModule,
  ],
})
export class OrgoModule {}
