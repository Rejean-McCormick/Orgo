// apps/api/src/orgo/core/email/email.module.ts

import { Module } from '@nestjs/common';

import { PersistenceModule } from '../../../persistence/persistence.module';
import { LoggerModule } from '../logging/logger.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { TaskModule } from '../tasks/task.module';
import { OrgoConfigModule } from '../../config/config.module';

import { EmailService } from './email.service';
import { EmailParserService } from './email-parser.service';
import { EmailValidatorService } from './email-validator.service';
import { EmailIngestService } from './email-ingest.service';
import { EmailRouterService } from './email-router.service';

/**
 * EmailModule
 *
 * Wires up the Orgo email gateway (“email_gateway” core service):
 * - EmailIngestService: polling / fetching raw emails
 * - EmailParserService: normalisation into EMAIL_MESSAGE envelopes
 * - EmailValidatorService: size / attachment / field validation
 * - EmailRouterService: hand-off into the workflow engine
 * - EmailService: public façade used by other modules to send email
 *
 * Dependencies:
 * - PersistenceModule: access to the database (PrismaService)
 * - LoggerModule: structured logging for EMAIL / WORKFLOW categories
 * - WorkflowModule: to route parsed emails into workflows / tasks
 * - TaskModule: task creation / linkage when workflows produce tasks
 * - OrgoConfigModule: access to YAML-based email configuration
 */
@Module({
  imports: [
    PersistenceModule,
    LoggerModule,
    WorkflowModule,
    TaskModule,
    OrgoConfigModule,
  ],
  providers: [
    EmailService,
    EmailParserService,
    EmailValidatorService,
    EmailIngestService,
    EmailRouterService,
  ],
  exports: [
    EmailService,
    EmailParserService,
    EmailValidatorService,
    EmailIngestService,
    EmailRouterService,
  ],
})
export class EmailModule {}
