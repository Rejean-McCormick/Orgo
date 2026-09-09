import { ProcessManager } from './process-manager.service';
import { IdentityModule } from '../identity/identity.module';
import { RoutingService } from './routing.service';
import { Module } from '@nestjs/common';
import { WorkModule } from '../work/work.module';
import { WorkflowService } from './workflow.service';
import { ActionExecutor } from './actions';
import { OperationsService } from '../integrations/operations.service';
import { CommunicationsService } from '../communications/communications.service';
@Module({
  imports: [WorkModule, IdentityModule],
  providers: [
    ProcessManager,
    RoutingService,
    WorkflowService,
    ActionExecutor,
    OperationsService,
    CommunicationsService,
  ],
  exports: [
    ProcessManager,
    RoutingService,
    WorkflowService,
    OperationsService,
    CommunicationsService,
  ],
})
export class OrchestrationModule {}
