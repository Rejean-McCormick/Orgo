import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ikRequestFingerprint,
  interactionEnvelope,
  kristalArtifactReadyData,
} from '../../src/orgo/integrations/interaction-kernel/contracts';
import {
  kristalBuildEnvelope,
  kristalRevisionEnvelope,
} from '../../src/orgo/integrations/interaction-kernel/outbound';

const envelope = () => interactionEnvelope.parse({
  specversion: 'ik/1.1',
  id: '01J00000000000000000000002',
  class: 'command',
  time: '2026-09-21T12:00:00Z',
  profile: { id: 'governance.decision.execute', version: '1.0.0' },
  source: { system: 'konnaxion' },
  target: { system: 'orgo', organization: '60f51ca2-c845-45aa-bc7e-2c62e53dfc5a' },
  subject: { type: 'decision', id: '5201' },
  correlation_id: 'decision:5201',
  idempotency_key: 'decision:5201:r1:orgo:tenant:default:execute:v1',
  authority: { kind: 'governance-mandate' },
  data: { decision_revision: '1' },
  artifact_refs: [{ owner: { system: 'konnaxion' }, artifact_type: 'konnaxion.decision_record', artifact_id: 'konnaxion:decision_record:5201', version: '1', integrity: { algorithm: 'sha256', digest: 'a'.repeat(64) } }],
});

const request = {
  operation_id: 'op-1',
  organization_id: '60f51ca2-c845-45aa-bc7e-2c62e53dfc5a',
  idempotency_key: 'idem-1',
  correlation_id: 'corr-1',
  subject: { type: 'case', id: 'case-1' },
};
const sourceArtifact = {
  owner: { system: 'orgo', organization: request.organization_id },
  artifact_type: 'orgo.case_snapshot',
  artifact_id: 'orgo:case:case-1:r2:sha256:' + 'b'.repeat(64),
  version: '2',
  integrity: { algorithm: 'sha256' as const, digest: 'b'.repeat(64) },
  content: { id: 'case-1', revision: 2, title: 'Example' },
};

test('IK fingerprint ignores transport identity and time', () => {
  const a = envelope();
  const b = { ...a, id: '01J00000000000000000000003', time: '2026-09-21T13:00:00Z' };
  assert.equal(ikRequestFingerprint(a), ikRequestFingerprint(b));
});

test('Kristal build request targets Da’at and pins Standard 6.0.0', () => {
  const value = kristalBuildEnvelope({
    ...request,
    operation: 'build',
    input: {
      mapping_profile: 'orgo.work-snapshot/kristal-v6',
      requested_outputs: ['kristal-state', 'validation-report'],
      artifact_refs: [sourceArtifact],
    },
  });
  assert.deepEqual(value.profile, { id: 'kristal.build.request', version: '2.0.0' });
  assert.equal(value.target?.system, 'daat');
  assert.equal((value.data as any).kristal_contract_set, '6.0.0');
  assert.equal(value.artifact_refs[0].artifact_type, 'orgo.case_snapshot');
});

test('Kristal revision request uses the v2 revision profile', () => {
  const value = kristalRevisionEnvelope({
    ...request,
    operation: 'revise',
    input: {
      reason: 'Human-reviewed correction',
      mapping_profile: 'orgo.work-snapshot/kristal-v6',
      artifact_refs: [sourceArtifact],
    },
  });
  assert.deepEqual(value.profile, { id: 'kristal.revision.request', version: '2.0.0' });
  assert.equal(value.operation, 'revise');
});

test('Kristal artifact ready v2 accepts the v6 kristal-state stage', () => {
  assert.deepEqual(kristalArtifactReadyData.parse({ build_ref: 'build-1', stage: 'kristal-state' }), {
    build_ref: 'build-1',
    stage: 'kristal-state',
  });
});

test('Kor work status payload accepts the 1.1.0 checkpoint contract', async () => {
  const { korWorkStatusSubmitData } = await import('../../src/orgo/integrations/interaction-kernel/contracts');
  assert.deepEqual(korWorkStatusSubmitData.parse({
    schema_version: '1.1.0',
    work_ref: '00000000-0000-4000-8000-000000000001',
    checkpoint_ref: 'konvergence-e2e',
    reported_at: '2026-10-03T12:00:00Z',
    report: 'Checkpoint submitted from Kor.',
  }), {
    schema_version: '1.1.0',
    work_ref: '00000000-0000-4000-8000-000000000001',
    checkpoint_ref: 'konvergence-e2e',
    reported_at: '2026-10-03T12:00:00Z',
    report: 'Checkpoint submitted from Kor.',
  });
});
