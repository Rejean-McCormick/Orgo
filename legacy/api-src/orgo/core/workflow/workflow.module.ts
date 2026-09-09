import { Module, forwardRef } from '@nestjs/common';
import { PersistenceModule } from '../../../persistence/persistence.module';
import { TaskModule } from '../tasks/task.module';
import { WorkflowEngineService } from './workflow-engine.service';
import { EscalationService } from './escalation.service';
import { WorkflowController } from './workflow.controller';

@Module({
  imports: [
    PersistenceModule,
    forwardRef(() => TaskModule),
  ],
  controllers: [WorkflowController],
  providers: [WorkflowEngineService, EscalationService],
  exports: [WorkflowEngineService, EscalationService],
})
export class WorkflowModule {}
