import { DeliveryError } from '../../../integrations/port';
/** Operator-configured gateway, never a recipient-supplied URL. */
export async function deliverHttpChannel(
  channel: 'sms' | 'webhook',
  input: {
    id: string;
    organization_id: string;
    recipient: string;
    subject: string;
    body: string;
    correlation_id: string;
  },
) {
  const endpoint = process.env[`${channel.toUpperCase()}_GATEWAY_URL`],
    token = process.env[`${channel.toUpperCase()}_GATEWAY_TOKEN`];
  if (!endpoint) throw new DeliveryError('CHANNEL_UNCONFIGURED');
  const url = new URL(endpoint);
  if (
    url.protocol !== 'https:' &&
    !(
      process.env.NODE_ENV !== 'production' &&
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1'].includes(url.hostname)
    )
  )
    throw new DeliveryError('INSECURE_CHANNEL_URL', false);
  try {
    const response = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `${input.organization_id}:${input.id}`,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ ...input, channel }),
    });
    if (!response.ok)
      throw new DeliveryError(
        `CHANNEL_HTTP_${response.status}`,
        response.status >= 500 || [408, 425, 429].includes(response.status),
      );
    const reader = response.body?.getReader();
    if (!reader) throw new DeliveryError('CHANNEL_INVALID_RECEIPT', false);
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 16000) {
        await reader.cancel();
        throw new DeliveryError('CHANNEL_INVALID_RECEIPT', false);
      }
      chunks.push(part.value);
    }
    const receipt = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
      status?: string;
    };
    if (receipt.status !== 'delivered')
      throw new DeliveryError('CHANNEL_NOT_DELIVERED');
  } catch (e) {
    if (e instanceof DeliveryError) throw e;
    throw new DeliveryError('CHANNEL_TRANSPORT_ERROR');
  }
}
