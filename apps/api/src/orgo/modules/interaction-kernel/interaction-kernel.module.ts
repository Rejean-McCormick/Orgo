import { Module } from '@nestjs/common';
import { PlatformModule } from '../../platform/platform.module';
import { IntakeModule } from '../intake/intake.module';
import { OrchestrationModule } from '../orchestration/orchestration.module';
import { InteractionKernelController } from '../../adapters/inbound/http/interaction-kernel.controller';
import { InteractionKernelService } from './interaction-kernel.service';

@Module({
  imports: [PlatformModule, IntakeModule, OrchestrationModule],
  controllers: [InteractionKernelController],
  providers: [InteractionKernelService],
  exports: [InteractionKernelService],
})
export class InteractionKernelModule {}
