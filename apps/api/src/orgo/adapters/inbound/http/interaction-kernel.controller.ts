import { Body, Controller, Inject, Post } from '@nestjs/common';
import type { ExecutionContext } from '../../../platform/contracts';
import { InteractionKernelService } from '../../../modules/interaction-kernel/interaction-kernel.service';
import { Ctx } from './boundary';

@Controller('ik')
export class InteractionKernelController {
  constructor(@Inject(InteractionKernelService) private readonly ik: InteractionKernelService) {}

  @Post('interactions')
  receive(@Ctx() ctx: ExecutionContext, @Body() body: unknown) {
    return this.ik.receive(ctx, body);
  }
}
