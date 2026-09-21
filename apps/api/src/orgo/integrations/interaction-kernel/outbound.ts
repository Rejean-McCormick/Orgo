import { randomUUID } from 'node:crypto';
import type { IntegrationRequest } from '../port';
import type { InteractionEnvelope } from './contracts';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function konnaxionImpactEnvelope(request: IntegrationRequest): InteractionEnvelope {
  const input = record(request.input);
  const data = {
    ...input,
    artifact_type: 'impact_update',
  };
  return {
    specversion: 'ik/1.1',
    id: request.operation_id || randomUUID(),
    class: 'command',
    time: new Date().toISOString(),
    profile: { id: 'accountability.impact.publish', version: '1.0.0' },
    source: { system: 'orgo', organization: request.organization_id },
    target: {
      system: 'konnaxion',
      organization: request.organization_id,
      ...(process.env.KONNAXION_IK_WORLD ? { world: process.env.KONNAXION_IK_WORLD } : {}),
    },
    subject: request.subject,
    operation: 'publish',
    correlation_id: request.correlation_id ?? request.operation_id,
    idempotency_key: request.idempotency_key,
    authority: { kind: 'operational-accountability' },
    data,
    artifact_refs: [],
    response: { acceptance_receipt: true, final_receipt: true },
  };
}
