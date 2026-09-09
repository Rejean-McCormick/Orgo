import { Module } from '@nestjs/common';
import { CaseService } from './case.service';
import { CaseController } from './case.controller';
import { CaseReviewService } from './case-review.service';
import { DatabaseModule } from '../database/database.module';

/**
 * CaseModule
 *
 * Core Services – Case Management
 * Wires up:
 *  - CaseService (create/fetch cases, link to tasks)
 *  - CaseReviewService (cyclic case review passes)
 *  - CaseController (HTTP API surface for cases)
 *
 * Depends on:
 *  - DatabaseModule (DatabaseService + RepositoryFactory)
 */
@Module({
  imports: [DatabaseModule],
  controllers: [CaseController],
  providers: [CaseService, CaseReviewService],
  exports: [CaseService, CaseReviewService],
})
export class CaseModule {}
