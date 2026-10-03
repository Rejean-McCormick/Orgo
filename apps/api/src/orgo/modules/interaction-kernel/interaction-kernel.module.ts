import { Module } from '@nestjs/common';
import { PlatformModule } from '../../platform/platform.module';
import { IntakeModule } from '../intake/intake.module';
import { OrchestrationModule } from '../orchestration/orchestration.module';
import { WorkModule } from '../work/work.module';
import { InteractionKernelController } from '../../adapters/inbound/http/interaction-kernel.controller';
import { InteractionKernelService } from './interaction-kernel.service';

@Module({
  imports: [PlatformModule, IntakeModule, OrchestrationModule, WorkModule],
  controllers: [InteractionKernelController],
  providers: [InteractionKernelService],
  exports: [InteractionKernelService],
})
export class InteractionKernelModule {}
