export interface IntegrationRequest {
  operation_id: string;
  organization_id: string;
  operation: string;
  idempotency_key: string;
  correlation_id: string;
  subject: { type: string; id: string };
  input: unknown;
}
export interface IntegrationReceipt {
  status: 'succeeded' | 'accepted';
  external_reference?: string;
  data: Record<string, unknown>;
}
export interface IntegrationPort {
  execute(request: IntegrationRequest): Promise<IntegrationReceipt>;
}
export class DeliveryError extends Error {
  constructor(
    public code: string,
    public retryable = true,
  ) {
    super(code);
  }
}
