import { z } from 'zod';
import {
  DeliveryError,
  IntegrationPort,
  IntegrationReceipt,
  IntegrationRequest,
} from './port';
const receiptSchema = z
  .object({
    status: z.enum(['succeeded', 'accepted']),
    external_reference: z.string().max(1000).optional(),
    data: z.record(z.unknown()).default({}),
  })
  .strict();

/** Explicit Orgo bridge protocol, NOT a claim about a provider's native HTTP API. */
export class HttpBridge implements IntegrationPort {
  private failures = 0;
  private openUntil = 0;
  private active = 0;
  constructor(
    private readonly endpoint: string | undefined,
    private readonly token: string | undefined,
    private readonly allowedOperations: readonly string[],
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  async execute(request: IntegrationRequest): Promise<IntegrationReceipt> {
    if (!this.allowedOperations.includes(request.operation))
      throw new DeliveryError('UNSUPPORTED_OPERATION', false);
    if (!this.endpoint) throw new DeliveryError('PROVIDER_UNCONFIGURED');
    if (this.openUntil > Date.now()) throw new DeliveryError('CIRCUIT_OPEN');
    if (this.active >= 4) throw new DeliveryError('PROVIDER_BUSY');
    const url = new URL(this.endpoint);
    if (
      url.protocol !== 'https:' &&
      !(
        process.env.NODE_ENV !== 'production' &&
        ['localhost', '127.0.0.1'].includes(url.hostname)
      )
    )
      throw new DeliveryError('INSECURE_PROVIDER_URL', false);
    this.active++;
    try {
      const response = await this.fetcher(url, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': request.idempotency_key,
          'X-Correlation-ID': request.correlation_id,
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify(request),
      });
      if (!response.ok)
        throw new DeliveryError(
          `PROVIDER_HTTP_${response.status}`,
          [408, 409, 425, 429].includes(response.status) ||
            response.status >= 500,
        );
      const reader = response.body?.getReader();
      let size = 0;
      const chunks: Uint8Array[] = [];
      if (!reader) throw new DeliveryError('INVALID_RECEIPT', false);
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 256000) {
          await reader.cancel();
          throw new DeliveryError('RECEIPT_TOO_LARGE', false);
        }
        chunks.push(part.value);
      }
      let value: unknown;
      try {
        value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw new DeliveryError('INVALID_RECEIPT', false);
      }
      const result = receiptSchema.safeParse(value);
      if (!result.success) throw new DeliveryError('INVALID_RECEIPT', false);
      this.failures = 0;
      this.openUntil = 0;
      return result.data;
    } catch (error) {
      if (++this.failures >= 5) this.openUntil = Date.now() + 30000;
      throw error instanceof DeliveryError
        ? error
        : new DeliveryError('PROVIDER_TRANSPORT_ERROR');
    } finally {
      this.active--;
    }
  }
}
