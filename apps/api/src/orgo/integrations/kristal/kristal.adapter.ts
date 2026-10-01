import { DeliveryError, type IntegrationPort, type IntegrationReceipt, type IntegrationRequest } from '../port';
import { InteractionKernelHttpBridge } from '../interaction-kernel/http-bridge';
import { kristalBuildEnvelope, kristalRevisionEnvelope } from '../interaction-kernel/outbound';

/**
 * Orgo's Kristal provider now uses the ecosystem path:
 * Orgo -> Interaction Kernel -> Da'at -> Kristal v6.
 * It is not a native Kristal HTTP client and never mutates Kristal state directly.
 */
export class KristalAdapter implements IntegrationPort {
  private readonly bridge: InteractionKernelHttpBridge;

  constructor() {
    this.bridge = new InteractionKernelHttpBridge(
      process.env.DAAT_IK_URL,
      process.env.DAAT_IK_TOKEN,
      (request) => {
        try {
          if (request.operation === 'build') return kristalBuildEnvelope(request);
          if (request.operation === 'revise') return kristalRevisionEnvelope(request);
          throw new DeliveryError('UNSUPPORTED_OPERATION', false);
        } catch (error) {
          if (error instanceof DeliveryError) throw error;
          throw new DeliveryError('INVALID_KRISTAL_REQUEST', false);
        }
      },
    );
  }

  execute(request: IntegrationRequest): Promise<IntegrationReceipt> {
    return this.bridge.execute(request);
  }
}
