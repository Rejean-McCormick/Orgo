import test from 'node:test';
import assert from 'node:assert/strict';
import { ikRequestFingerprint, interactionEnvelope } from '../../src/orgo/integrations/interaction-kernel/contracts';

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

test('IK fingerprint ignores transport identity and time', () => {
  const a = envelope();
  const b = { ...a, id: '01J00000000000000000000003', time: '2026-09-21T13:00:00Z' };
  assert.equal(ikRequestFingerprint(a), ikRequestFingerprint(b));
});
