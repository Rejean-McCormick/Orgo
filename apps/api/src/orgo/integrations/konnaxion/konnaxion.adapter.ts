import { InteractionKernelHttpBridge } from '../interaction-kernel/http-bridge';
import { konnaxionImpactEnvelope } from '../interaction-kernel/outbound';

export class KonnaxionAdapter extends InteractionKernelHttpBridge {
  constructor() {
    super(
      process.env.KONNAXION_IK_URL,
      process.env.KONNAXION_IK_TOKEN,
      konnaxionImpactEnvelope,
    );
  }
}
