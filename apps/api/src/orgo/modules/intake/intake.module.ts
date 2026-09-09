import { Module } from '@nestjs/common';
import { WorkModule } from '../work/work.module';
import { OrchestrationModule } from '../orchestration/orchestration.module';
import { IntakeService } from './intake.service';
@Module({
  imports: [WorkModule, OrchestrationModule],
  providers: [IntakeService],
  exports: [IntakeService],
})
export class IntakeModule {}
