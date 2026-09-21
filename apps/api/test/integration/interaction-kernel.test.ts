import 'reflect-metadata';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { createApp } from '../../src/bootstrap';
import { Database } from '../../src/orgo/platform/database';
import { OutboxWorker } from '../../src/orgo/platform/outbox/worker.service';
import { WorkflowService } from '../../src/orgo/modules/orchestration/workflow.service';
import { tokenHash } from '../../src/orgo/modules/identity/identity.service';
import type { ExecutionContext } from '../../src/orgo/platform/contracts';

let app: INestApplication;
let db: Database;
let worker: OutboxWorker;
let workflow: WorkflowService;
let base = '';
let tenant = '';
let bearer = '';
const workflowCode = `ik-qualification-${randomUUID()}`;
const previousEnv = {
  workflow: process.env.KONNAXION_DECISION_WORKFLOW_CODE,
  label: process.env.KONNAXION_DECISION_LABEL,
  type: process.env.KONNAXION_DECISION_TYPE,
  category: process.env.KONNAXION_DECISION_CATEGORY,
  severity: process.env.KONNAXION_DECISION_SEVERITY,
};

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function postIk(body: unknown, key: string) {
  const response = await fetch(`${base}/api/v3/ik/interactions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`,
      'Idempotency-Key': key,
      'X-Correlation-ID': 'decision:5201',
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, ...(await response.json()) } as any;
}

function envelope(key: string, revision = '1') {
  return {
    specversion: 'ik/1.1',
    id: randomUUID(),
    class: 'command',
    time: new Date().toISOString(),
    profile: { id: 'governance.decision.execute', version: '1.0.0' },
    source: { system: 'konnaxion' },
    target: { system: 'orgo', organization: tenant },
    subject: { type: 'decision', id: '5201' },
    correlation_id: 'decision:5201',
    idempotency_key: key,
    authority: {
      kind: 'governance-mandate',
      claims: ['authority://konnaxion/decision/5201'],
    },
    data: { decision_revision: revision },
    artifact_refs: [
      {
        owner: { system: 'konnaxion' },
        artifact_type: 'konnaxion.decision_record',
        artifact_id: 'konnaxion:decision_record:5201',
        version: revision,
        integrity: { algorithm: 'sha256', digest: 'a'.repeat(64) },
      },
    ],
    response: { acceptance_receipt: true, final_receipt: true },
  };
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'Use a dedicated test database');
  process.env.KONNAXION_DECISION_WORKFLOW_CODE = workflowCode;
  process.env.KONNAXION_DECISION_LABEL = '1.11';
  process.env.KONNAXION_DECISION_TYPE = 'governance_decision';
  process.env.KONNAXION_DECISION_CATEGORY = 'request';
  process.env.KONNAXION_DECISION_SEVERITY = 'MODERATE';

  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  db = app.get(Database);
  worker = app.get(OutboxWorker);
  workflow = app.get(WorkflowService);

  const org = await db.organization.create({
    data: {
      slug: `ik-${randomUUID()}`,
      display_name: 'IK qualification',
      status: 'active',
      timezone: 'UTC',
      default_locale: 'en-CA',
    },
  });
  tenant = org.id;

  const adminCtx: ExecutionContext = {
    organizationId: tenant,
    actorUserId: null,
    actorType: 'system',
    permissions: ['*'],
    roleIds: [],
    correlationId: randomUUID(),
    source: 'api',
  };
  await db.$transaction((tx) =>
    workflow.publish(
      adminCtx,
      workflowCode,
      {
        rules: [
          {
            id: 'konnaxion-decision',
            enabled: true,
            match: {
              source: 'API',
              type: 'governance_decision',
              category: 'request',
            },
            actions: [
              {
                type: 'CREATE_CASE',
                input: {
                  title: '$signal.title',
                  description: '$signal.description',
                  label: '$signal.label',
                  severity: '$signal.severity',
                },
              },
              {
                type: 'CREATE_TASK',
                input: {
                  title: '$signal.title',
                  description: 'Execute governed Konnaxion decision',
                  type: 'governance_execution',
                  category: 'request',
                  label: '$signal.label',
                  severity: '$signal.severity',
                  case_id: '$case',
                },
              },
            ],
          },
        ],
      },
      tx,
    ),
  );

  bearer = randomUUID();
  await db.apiToken.create({
    data: {
      organization_id: tenant,
      token_hash: tokenHash(bearer),
      name: 'konnaxion-ik-qualification',
      scopes: [
        'signals:write',
        'signals:read',
        'workflows:execute',
        'work:write',
        'work:read',
      ],
    },
  });
});

after(async () => {
  if (app) await app.close();
  restore('KONNAXION_DECISION_WORKFLOW_CODE', previousEnv.workflow);
  restore('KONNAXION_DECISION_LABEL', previousEnv.label);
  restore('KONNAXION_DECISION_TYPE', previousEnv.type);
  restore('KONNAXION_DECISION_CATEGORY', previousEnv.category);
  restore('KONNAXION_DECISION_SEVERITY', previousEnv.severity);
});

test('Konnaxion decision admission creates one Signal and worker creates one Case/Task with replay safety', async () => {
  const key = `decision:5201:r1:orgo:${tenant}:default:execute:v1`;
  const firstEnvelope = envelope(key);
  const first = await postIk(firstEnvelope, key);
  assert.equal(first.status, 201, JSON.stringify(first));
  assert.equal(first.data.status, 'accepted');
  const signalId = first.data.data.signal_id as string;
  assert.ok(signalId);

  const replayEnvelope = { ...firstEnvelope, id: randomUUID(), time: new Date().toISOString() };
  const replay = await postIk(replayEnvelope, key);
  assert.equal(replay.status, 201, JSON.stringify(replay));
  assert.deepEqual(replay.data, first.data);
  assert.equal(await db.signal.count({ where: { organization_id: tenant } }), 1);

  const conflict = await postIk(envelope(key, '2'), key);
  assert.equal(conflict.status, 409, JSON.stringify(conflict));
  assert.equal(conflict.error.code, 'IK_IDEMPOTENCY_CONFLICT');
  assert.equal(await db.signal.count({ where: { organization_id: tenant } }), 1);

  assert.equal(await worker.tick(), true);
  const signal = await db.signal.findUniqueOrThrow({ where: { id: signalId } });
  assert.equal(signal.status, 'PROCESSED');
  assert.ok(signal.case_id);
  assert.equal(
    await db.case.count({ where: { organization_id: tenant, id: signal.case_id! } }),
    1,
  );
  assert.equal(
    await db.task.count({ where: { organization_id: tenant, case_id: signal.case_id! } }),
    1,
  );
  assert.equal(
    await db.workflowInstance.count({ where: { organization_id: tenant, signal_id: signalId } }),
    1,
  );
});
