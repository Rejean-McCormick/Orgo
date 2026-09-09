import { EvidenceService } from './modules/work/evidence.service';
import { ProcessManager } from './modules/orchestration/process-manager.service';
import { DomainManagement } from './modules/domains/domain-management.service';
import { Module } from '@nestjs/common';
import { PlatformModule } from './platform/platform.module';
import { WorkModule } from './modules/work/work.module';
import { OrchestrationModule } from './modules/orchestration/orchestration.module';
import { IntakeModule } from './modules/intake/intake.module';
import { IdentityModule } from './modules/identity/identity.module';
import { DomainsService } from './modules/domains/domains.service';
import { InsightsService } from './modules/insights/insights.service';
import { OutboxWorker } from './platform/outbox/worker.service';
import { EscalationService } from './modules/orchestration/escalation.service';
@Module({
  imports: [
    PlatformModule,
    WorkModule,
    OrchestrationModule,
    IntakeModule,
    IdentityModule,
  ],
  providers: [
    EvidenceService,
    DomainManagement,
    DomainsService,
    InsightsService,
    OutboxWorker,
    EscalationService,
  ],
  exports: [
    EvidenceService,
    DomainManagement,
    PlatformModule,
    WorkModule,
    OrchestrationModule,
    IntakeModule,
    IdentityModule,
    DomainsService,
    InsightsService,
    OutboxWorker,
    EscalationService,
  ],
})
export class RuntimeModule {}
