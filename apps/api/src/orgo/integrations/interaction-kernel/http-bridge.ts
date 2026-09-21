import { z } from 'zod';
import { DeliveryError, type IntegrationPort, type IntegrationReceipt, type IntegrationRequest } from '../port';
import type { InteractionEnvelope } from './contracts';

const receiptSchema = z.object({
  specversion: z.literal('ik/1.1').optional(),
  record_type: z.literal('receipt').optional(),
  status: z.enum(['succeeded', 'accepted']),
  external_reference: z.string().max(1000).nullable().optional(),
  data: z.record(z.unknown()).default({}),
}).passthrough();

export class InteractionKernelHttpBridge implements IntegrationPort {
  private failures = 0;
  private openUntil = 0;
  private active = 0;
  constructor(
    private readonly endpoint: string | undefined,
    private readonly token: string | undefined,
    private readonly buildEnvelope: (request: IntegrationRequest) => InteractionEnvelope,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  async execute(request: IntegrationRequest): Promise<IntegrationReceipt> {
    if (!this.endpoint) throw new DeliveryError('PROVIDER_UNCONFIGURED');
    if (!this.token) throw new DeliveryError('PROVIDER_TOKEN_UNCONFIGURED', false);
    if (this.openUntil > Date.now()) throw new DeliveryError('CIRCUIT_OPEN');
    if (this.active >= 4) throw new DeliveryError('PROVIDER_BUSY');
    const url = new URL(this.endpoint);
    const loopback = ['localhost', '127.0.0.1'].includes(url.hostname);
    const explicitLocalDockerHttp =
      process.env.ORGO_ALLOW_INSECURE_LOCAL_PROVIDER_HTTP === 'true' &&
      ['localhost', '127.0.0.1', 'host.docker.internal'].includes(url.hostname);
    if (
      url.protocol !== 'https:' &&
      !(process.env.NODE_ENV !== 'production' && loopback) &&
      !explicitLocalDockerHttp
    )
      throw new DeliveryError('INSECURE_PROVIDER_URL', false);
    const envelope = this.buildEnvelope(request);
    this.active++;
    try {
      const response = await this.fetcher(url, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': String(envelope.idempotency_key ?? request.idempotency_key),
          'X-Correlation-ID': String(envelope.correlation_id ?? request.correlation_id),
          'X-Interaction-Kernel-Version': 'ik/1.1',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify(envelope),
      });
      if (!response.ok)
        throw new DeliveryError(`PROVIDER_HTTP_${response.status}`, [408,409,425,429].includes(response.status) || response.status >= 500);
      const value = await response.json();
      const result = receiptSchema.safeParse(value);
      if (!result.success) throw new DeliveryError('INVALID_RECEIPT', false);
      this.failures = 0;
      this.openUntil = 0;
      return {
        status: result.data.status,
        ...(result.data.external_reference ? { external_reference: result.data.external_reference } : {}),
        data: result.data.data,
      };
    } catch (error) {
      if (++this.failures >= 5) this.openUntil = Date.now() + 30000;
      throw error instanceof DeliveryError ? error : new DeliveryError('PROVIDER_TRANSPORT_ERROR');
    } finally {
      this.active--;
    }
  }
}
