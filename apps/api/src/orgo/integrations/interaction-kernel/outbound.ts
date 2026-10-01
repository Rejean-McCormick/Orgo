import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { IntegrationRequest } from '../port';
import {
  artifactRefSchema,
  KRISTAL_STANDARD_VERSION,
  type InteractionEnvelope,
} from './contracts';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const kristalBuildInput = z.object({
  mapping_profile: z.string().min(1).max(300),
  requested_outputs: z.array(z.string().min(1).max(200)).min(1).max(50),
  artifact_refs: z.array(artifactRefSchema).min(1).max(1000),
}).strict();

const kristalRevisionInput = z.object({
  reason: z.string().min(1).max(5000),
  mapping_profile: z.string().min(1).max(300),
  artifact_refs: z.array(artifactRefSchema).min(1).max(1000),
}).strict();

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

export function kristalBuildEnvelope(request: IntegrationRequest): InteractionEnvelope {
  const input = kristalBuildInput.parse(request.input);
  return {
    specversion: 'ik/1.1',
    id: request.operation_id || randomUUID(),
    class: 'command',
    time: new Date().toISOString(),
    profile: { id: 'kristal.build.request', version: '2.0.0' },
    source: { system: 'orgo', organization: request.organization_id },
    target: { system: 'daat', organization: request.organization_id },
    subject: request.subject,
    operation: 'build',
    correlation_id: request.correlation_id ?? request.operation_id,
    idempotency_key: request.idempotency_key,
    authority: { kind: 'operational-workflow' },
    data: {
      mapping_profile: input.mapping_profile,
      requested_outputs: input.requested_outputs,
      kristal_contract_set: KRISTAL_STANDARD_VERSION,
    },
    artifact_refs: input.artifact_refs,
    response: { acceptance_receipt: true, final_receipt: true },
  };
}

export function kristalRevisionEnvelope(request: IntegrationRequest): InteractionEnvelope {
  const input = kristalRevisionInput.parse(request.input);
  return {
    specversion: 'ik/1.1',
    id: request.operation_id || randomUUID(),
    class: 'command',
    time: new Date().toISOString(),
    profile: { id: 'kristal.revision.request', version: '2.0.0' },
    source: { system: 'orgo', organization: request.organization_id },
    target: { system: 'daat', organization: request.organization_id },
    subject: request.subject,
    operation: 'revise',
    correlation_id: request.correlation_id ?? request.operation_id,
    idempotency_key: request.idempotency_key,
    authority: { kind: 'operational-workflow' },
    data: {
      reason: input.reason,
      mapping_profile: input.mapping_profile,
    },
    artifact_refs: input.artifact_refs,
    response: { acceptance_receipt: true, final_receipt: true },
  };
}
