import 'reflect-metadata';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { createApp } from '../../src/bootstrap';
import { Database } from '../../src/orgo/platform/database';
import { OutboxWorker } from '../../src/orgo/platform/outbox/worker.service';
import { EscalationService } from '../../src/orgo/modules/orchestration/escalation.service';
import {
  passwordHash,
  tokenHash,
} from '../../src/orgo/modules/identity/identity.service';
import { DeliveryError } from '../../src/orgo/integrations/port';

let app: INestApplication, db: Database, worker: OutboxWorker, base: string;
let tenant: string, otherTenant: string, userId: string, otherUserId: string;
let bearer: string, otherBearer: string;
// Test fixture transport is intentionally generic; production request boundaries use Zod.
async function api(
  path: string,
  method = 'GET',
  body?: unknown,
  key = randomUUID(),
  token = bearer,
) {
  const response = await fetch(`${base}/api/v3/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Idempotency-Key': key,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  return { status: response.status, ...result };
}
const taskInput = (extra = {}) => ({
  title: 'Repair pump',
  description: 'Pump stopped',
  type: 'maintenance',
  category: 'incident',
  label: '1.11',
  ...extra,
});
const caseInput = (extra = {}) => ({
  title: 'Pump incident',
  label: '1.11',
  ...extra,
});
const signalInput = (extra = {}) => ({
  title: 'Pump stopped',
  label: '1.11',
  type: 'maintenance',
  category: 'incident',
  source: 'api',
  ...extra,
});
const rules = (extra: unknown[] = []) => ({
  rules: [
    {
      id: 'intake',
      match: { category: 'incident' },
      actions: [
        {
          type: 'CREATE_CASE',
          input: { title: '$signal.title', label: '$signal.label' },
        },
        {
          type: 'CREATE_TASK',
          input: {
            title: '$signal.title',
            label: '$signal.label',
            type: '$signal.type',
            category: '$signal.category',
            case_id: '$case',
          },
        },
        ...extra,
      ],
    },
  ],
});
async function version(content = rules()) {
  const result = await api(
    `workflows/flow-${randomUUID()}/versions`,
    'POST',
    content,
  );
  assert.equal(result.status, 201, JSON.stringify(result));
  return result.data;
}
async function boot() {
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  db = app.get(Database);
  worker = app.get(OutboxWorker);
}
before(async () => {
  assert.ok(process.env.DATABASE_URL, 'Use a dedicated test database');
  await boot();
  const suffix = randomUUID();
  const a = await db.organization.create({
    data: {
      slug: `test-a-${suffix}`,
      display_name: 'A',
      status: 'active',
      timezone: 'UTC',
      default_locale: 'fr',
    },
  });
  const b = await db.organization.create({
    data: {
      slug: `test-b-${suffix}`,
      display_name: 'B',
      status: 'active',
      timezone: 'UTC',
      default_locale: 'fr',
    },
  });
  tenant = a.id;
  otherTenant = b.id;
  const digest = await passwordHash('test-password-123');
  const user = await db.userAccount.create({
    data: {
      organization_id: tenant,
      email: 'admin@example.test',
      display_name: 'Admin',
      password_hash: digest,
      auth_provider: 'local',
      status: 'active',
    },
  });
  userId = user.id;
  otherUserId = (
    await db.userAccount.create({
      data: {
        organization_id: otherTenant,
        email: 'other@example.test',
        display_name: 'Other',
        auth_provider: 'local',
        status: 'active',
      },
    })
  ).id;
  const role = await db.role.create({
    data: {
      organization_id: tenant,
      code: 'admin',
      display_name: 'Admin',
      description: '',
      is_system_role: true,
    },
  });
  const permission = await db.permission.upsert({
    where: { code: '*' },
    create: { code: '*', description: '*' },
    update: {},
  });
  await db.rolePermission.create({
    data: {
      role_id: role.id,
      permission_id: permission.id,
      granted_at: new Date(),
    },
  });
  await db.userRoleAssignment.create({
    data: {
      user_id: userId,
      role_id: role.id,
      scope_type: 'global',
      assigned_at: new Date(),
    },
  });
  const login = await api(
    'auth/login',
    'POST',
    { organization: a.slug, email: user.email, password: 'test-password-123' },
    randomUUID(),
    '',
  );
  assert.equal(login.status, 201, JSON.stringify(login));
  bearer = login.data.token;
  otherBearer = randomUUID();
  await db.apiToken.create({
    data: {
      organization_id: otherTenant,
      token_hash: tokenHash(otherBearer),
      name: 'test',
      scopes: ['*'],
    },
  });
});
after(async () => {
  if (app) await app.close();
});

test('runtime boots and readiness does not depend on Spaces or external providers', async () => {
  const response = await fetch(`${base}/health/ready`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.status, 'ready');
});
test('authentication and tenant boundary reject unauthenticated and spoofed input', async () => {
  assert.equal(
    (await api('tasks', 'GET', undefined, randomUUID(), '')).status,
    401,
  );
  const spoof = await fetch(`${base}/api/v3/tasks`, {
    headers: {
      Authorization: `Bearer ${bearer}`,
      'X-Organization-ID': otherTenant,
    },
  });
  assert.equal(spoof.status, 403);
  assert.equal(
    (await api('tasks', 'POST', taskInput({ organization_id: otherTenant })))
      .status,
    400,
  );
});
test('creation is idempotent, request conflicts do not duplicate tasks or events', async () => {
  const key = randomUUID(),
    body = taskInput();
  const first = await api('tasks', 'POST', body, key),
    second = await api('tasks', 'POST', body, key);
  assert.equal(first.status, 201, JSON.stringify(first));
  assert.deepEqual(first.data, second.data);
  assert.equal(
    (await api('tasks', 'POST', taskInput({ title: 'different' }), key)).status,
    409,
  );
  assert.equal(
    await db.taskEvent.count({ where: { task_id: first.data.task_id } }),
    1,
  );
  assert.equal(
    (
      await api(
        `tasks/${first.data.task_id}`,
        'GET',
        undefined,
        randomUUID(),
        otherBearer,
      )
    ).status,
    404,
  );
});
test('concurrent retries resolve to a single work identity', async () => {
  const key = randomUUID();
  const results = await Promise.all(
    Array.from({ length: 4 }, () => api('tasks', 'POST', taskInput(), key)),
  );
  for (const r of results) assert.equal(r.status, 201, JSON.stringify(r));
  assert.equal(new Set(results.map((r) => r.data.task_id)).size, 1);
});
test('cross-tenant ownership is blocked in the owner service and database', async () => {
  const bad = await api(
    'tasks',
    'POST',
    taskInput({ owner_user_id: otherUserId }),
  );
  assert.equal(bad.status, 400, JSON.stringify(bad));
  const good = await api('tasks', 'POST', taskInput());
  await assert.rejects(
    db.$transaction((tx) =>
      tx.task.update({
        where: { id: good.data.task_id },
        data: { owner_user_id: otherUserId },
      }),
    ),
  );
});
test('status changes enforce lifecycle, revision and immutable events', async () => {
  const created = await api('tasks', 'POST', taskInput()),
    id = created.data.task_id;
  assert.equal(
    (
      await api(`tasks/${id}/status`, 'PATCH', {
        status: 'ESCALATED',
        revision: 0,
      })
    ).status,
    409,
  );
  const running = await api(`tasks/${id}/status`, 'PATCH', {
    status: 'IN_PROGRESS',
    revision: 0,
  });
  assert.equal(running.data.revision, 1);
  assert.equal(
    (
      await api(`tasks/${id}/status`, 'PATCH', {
        status: 'COMPLETED',
        revision: 0,
      })
    ).status,
    409,
  );
  const completed = await api(`tasks/${id}/status`, 'PATCH', {
    status: 'COMPLETED',
    revision: 1,
  });
  assert.ok(completed.data.closed_at);
  assert.equal(
    (
      await api(`tasks/${id}/status`, 'PATCH', {
        status: 'IN_PROGRESS',
        revision: 2,
      })
    ).status,
    409,
  );
  const event = await db.workEvent.findFirstOrThrow({
    where: { aggregate_id: id },
  });
  await assert.rejects(
    db.$transaction((tx) =>
      tx.workEvent.update({
        where: { id: event.id },
        data: { event_type: 'forged' },
      }),
    ),
  );
});
test('assignments and comments persist through canonical Work paths', async () => {
  const created = await api('tasks', 'POST', taskInput()),
    id = created.data.task_id;
  const assigned = await api(`tasks/${id}/assignment`, 'PATCH', {
    owner_user_id: userId,
    revision: 0,
  });
  assert.equal(assigned.data.owner_user_id, userId);
  assert.equal(
    await db.taskAssignment.count({ where: { task_id: id, is_primary: true } }),
    1,
  );
  assert.equal(
    (await api(`tasks/${id}/comments`, 'POST', { body: 'Investigating' }))
      .status,
    201,
  );
  assert.equal(
    (await api(`tasks/${id}`)).data.comments[0].body,
    'Investigating',
  );
});
test('restricted cases and their tasks do not leak in lists, details or search', async () => {
  const parent = await api(
    'cases',
    'POST',
    caseInput({ visibility: 'RESTRICTED' }),
  );
  const task = await api(
    'tasks',
    'POST',
    taskInput({ case_id: parent.data.case_id, title: 'confidential-marker' }),
  );
  const limited = randomUUID();
  await db.apiToken.create({
    data: {
      organization_id: tenant,
      token_hash: tokenHash(limited),
      name: 'limited',
      scopes: ['work:read'],
    },
  });
  assert.equal(
    (
      await api(
        `cases/${parent.data.case_id}`,
        'GET',
        undefined,
        randomUUID(),
        limited,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await api(
        `tasks/${task.data.task_id}`,
        'GET',
        undefined,
        randomUUID(),
        limited,
      )
    ).status,
    404,
  );
  const list = await api(
    'tasks?search=confidential-marker',
    'GET',
    undefined,
    randomUUID(),
    limited,
  );
  assert.equal(list.data.total, 0);
});
test('simulation has no effects; ingestion commits before processing and pins a version', async () => {
  const v = await version();
  const before = await db.workEvent.count();
  const simulation = await api(`workflow-versions/${v.id}/simulate`, 'POST', {
    source: 'API',
    category: 'incident',
    title: 'Pump',
  });
  assert.equal(simulation.data.actions.length, 2);
  assert.equal(await db.workEvent.count(), before);
  const accepted = await api(
    'signals',
    'POST',
    signalInput({ workflow_version_id: v.id }),
  );
  assert.equal(accepted.status, 201, JSON.stringify(accepted));
  const id = accepted.data.id ?? accepted.data.signal_id;
  assert.equal(accepted.data.status, 'RECEIVED');
  assert.equal(
    await db.workflowInstance.count({ where: { signal_id: id } }),
    0,
  );
  assert.equal(await worker.tick(), true);
  const processed = await db.signal.findUniqueOrThrow({ where: { id } });
  assert.equal(processed.status, 'PROCESSED');
  assert.ok(processed.case_id);
  const instance = await db.workflowInstance.findFirstOrThrow({
    where: { signal_id: id },
  });
  assert.equal(instance.workflow_version_id, v.id);
  assert.equal(await db.signalTask.count({ where: { signal_id: id } }), 1);
  await assert.rejects(
    db.$transaction((tx) =>
      tx.workflowVersion.update({
        where: { id: v.id },
        data: { content_hash: 'tampered' },
      }),
    ),
  );
});
test('external reference deduplication rejects changed signal content', async () => {
  const external_reference = randomUUID();
  const first = await api(
    'signals',
    'POST',
    signalInput({ external_reference }),
  );
  const again = await api(
    'signals',
    'POST',
    signalInput({ external_reference }),
  );
  assert.equal(
    first.data.id ?? first.data.signal_id,
    again.data.id ?? again.data.signal_id,
  );
  assert.equal(
    (
      await api(
        'signals',
        'POST',
        signalInput({ external_reference, title: 'altered' }),
      )
    ).status,
    409,
  );
});
test('failed orchestration rolls back work but preserves accepted signal and dead message', async () => {
  const v = await version(
    rules([{ type: 'SET_METADATA', target: '$missing', input: {} }]),
  );
  const before = await db.case.count({ where: { organization_id: tenant } });
  const accepted = await api(
    'signals',
    'POST',
    signalInput({ workflow_version_id: v.id }),
  );
  const id = accepted.data.id ?? accepted.data.signal_id;
  await worker.tick();
  assert.equal(
    await db.case.count({ where: { organization_id: tenant } }),
    before,
  );
  assert.equal(
    (await db.signal.findUniqueOrThrow({ where: { id } })).status,
    'RECEIVED',
  );
  assert.equal(
    (await db.outboxMessage.findFirstOrThrow({ where: { aggregate_id: id } }))
      .status,
    'DEAD',
  );
});
test('integration success stores a receipt without changing Case lifecycle', async () => {
  const parent = await api('cases', 'POST', caseInput());
  const requested = await api('integration-operations', 'POST', {
    provider: 'kristal',
    operation: 'validate',
    subject_type: 'case',
    subject_id: parent.data.case_id,
  });
  assert.equal(requested.status, 201, JSON.stringify(requested));
  const keys: string[] = [];
  worker.adapters.kristal = {
    async execute(req) {
      keys.push(req.idempotency_key);
      return {
        status: 'succeeded',
        data: { valid: false },
        external_reference: 'receipt-1',
      };
    },
  };
  await worker.tick();
  const operation = await db.integrationOperation.findUniqueOrThrow({
    where: { id: requested.data.id },
  });
  assert.equal(operation.status, 'SUCCEEDED');
  assert.equal(operation.external_reference, 'receipt-1');
  assert.equal(
    (await db.case.findUniqueOrThrow({ where: { id: parent.data.case_id } }))
      .status,
    'open',
  );
  assert.equal(keys[0], `${tenant}:${operation.id}`);
});
test('retry and redrive retain the same integration identity', async () => {
  const parent = await api('cases', 'POST', caseInput());
  const requested = await api('integration-operations', 'POST', {
    provider: 'kristal',
    operation: 'validate',
    subject_type: 'case',
    subject_id: parent.data.case_id,
  });
  worker.adapters.kristal = {
    async execute() {
      throw new DeliveryError('PERMANENT', false);
    },
  };
  await worker.tick();
  const message = await db.outboxMessage.findFirstOrThrow({
    where: { aggregate_id: requested.data.id },
  });
  assert.equal(message.status, 'DEAD');
  assert.equal((await api(`outbox/${message.id}/redrive`, 'POST')).status, 201);
  worker.adapters.kristal = {
    async execute() {
      return { status: 'succeeded', data: {} };
    },
  };
  await worker.tick();
  assert.equal(
    (
      await db.integrationOperation.findUniqueOrThrow({
        where: { id: requested.data.id },
      })
    ).status,
    'SUCCEEDED',
  );
});
test('stale worker cannot acknowledge another worker lease', async () => {
  const parent = await api('cases', 'POST', caseInput());
  const requested = await api('integration-operations', 'POST', {
    provider: 'kristal',
    operation: 'validate',
    subject_type: 'case',
    subject_id: parent.data.case_id,
  });
  const claimed = await worker.claim();
  assert.ok(claimed);
  assert.equal(claimed.aggregate_id, requested.data.id);
  await db.outboxMessage.update({
    where: { id: claimed.id },
    data: { lock_token: randomUUID() },
  });
  await worker.handle(claimed);
  assert.equal(
    (await db.outboxMessage.findUniqueOrThrow({ where: { id: claimed.id } }))
      .status,
    'PROCESSING',
  );
  await db.outboxMessage.update({
    where: { id: claimed.id },
    data: { locked_until: new Date(0) },
  });
  await worker.tick();
  assert.equal(
    (await db.outboxMessage.findUniqueOrThrow({ where: { id: claimed.id } }))
      .status,
    'SUCCEEDED',
  );
});
test('deactivated intake actor cannot execute previously queued privileges', async () => {
  const v = await version();
  const accepted = await api(
    'signals',
    'POST',
    signalInput({ workflow_version_id: v.id }),
  );
  const id = accepted.data.id ?? accepted.data.signal_id;
  await db.userAccount.update({
    where: { id: userId },
    data: { status: 'disabled' },
  });
  await worker.tick();
  assert.equal(
    (await db.outboxMessage.findFirstOrThrow({ where: { aggregate_id: id } }))
      .status,
    'DEAD',
  );
  await db.userAccount.update({
    where: { id: userId },
    data: { status: 'active' },
  });
});
test('HR extension is atomic with canonical restricted work', async () => {
  const result = await api('hr/cases', 'POST', {
    case: caseInput(),
    task: taskInput(),
    case_code: randomUUID(),
  });
  assert.equal(result.status, 201, JSON.stringify(result));
  assert.equal(
    (await db.case.findUniqueOrThrow({ where: { id: result.data.case_id } }))
      .visibility,
    'RESTRICTED',
  );
  const before = await db.case.count();
  assert.equal(
    (
      await api('hr/cases', 'POST', {
        case: caseInput(),
        task: taskInput(),
        case_code: randomUUID(),
        subject_person_id: randomUUID(),
      })
    ).status,
    404,
  );
  assert.equal(await db.case.count(), before);
});
test('SLA escalation respects lifecycle; pending tasks remain pending', async () => {
  const pending = await api('tasks', 'POST', taskInput()),
    running = await api('tasks', 'POST', taskInput());
  await api(`tasks/${running.data.task_id}/status`, 'PATCH', {
    status: 'IN_PROGRESS',
    revision: 0,
  });
  await db.task.updateMany({
    where: { id: { in: [pending.data.task_id, running.data.task_id] } },
    data: { reactivity_deadline_at: new Date(0) },
  });
  await app.get(EscalationService).tick();
  assert.equal(
    (await db.task.findUniqueOrThrow({ where: { id: pending.data.task_id } }))
      .status,
    'PENDING',
  );
  assert.equal(
    (await db.task.findUniqueOrThrow({ where: { id: running.data.task_id } }))
      .status,
    'ESCALATED',
  );
});
test('offline replay is idempotent and reports revision conflicts per command', async () => {
  const commands = [
    { id: randomUUID(), operation: 'task.create', payload: taskInput() },
  ];
  const first = await api('sync/replay', 'POST', { commands });
  const second = await api('sync/replay', 'POST', { commands });
  assert.equal(first.data.results[0].ok, true);
  assert.deepEqual(first.data.results, second.data.results);
});
test(
  'native workers skip locked rows on independent connections',
  {
    skip:
      process.env.ORGO_TEST_ENGINE === 'pglite'
        ? 'PGlite multiplexes connections; native PostgreSQL CI covers simultaneous locks'
        : false,
  },
  async () => {
    const one = await db.outboxMessage.create({
      data: {
        organization_id: tenant,
        type: 'test',
        aggregate_id: randomUUID(),
        payload: {},
        correlation_id: 'test',
      },
    });
    const two = await db.outboxMessage.create({
      data: {
        organization_id: tenant,
        type: 'test',
        aggregate_id: randomUUID(),
        payload: {},
        correlation_id: 'test',
      },
    });
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM outbox_messages WHERE id = ${one.id}::uuid FOR UPDATE`;
      const claimed = await worker.claim();
      assert.equal(claimed?.id, two.id);
    });
    await db.outboxMessage.updateMany({
      where: { id: { in: [one.id, two.id] } },
      data: { status: 'DEAD', lock_token: null, locked_until: null },
    });
  },
);
test('API and worker restart rediscover durable state', async () => {
  const v = await version();
  const accepted = await api(
    'signals',
    'POST',
    signalInput({ workflow_version_id: v.id }),
  );
  const id = accepted.data.id ?? accepted.data.signal_id;
  await app.close();
  await boot();
  await worker.tick();
  assert.equal(
    (await db.signal.findUniqueOrThrow({ where: { id } })).status,
    'PROCESSED',
  );
  assert.equal((await api(`signals/${id}`)).status, 200);
});

test('email ingress uses authenticated tenancy and deduplicates message identity', async () => {
  const body = {
    message_id: randomUUID(),
    from: 'outside@example.test',
    to: ['intake@example.test'],
    subject: 'Mail signal',
    text: 'Body',
    label: '1.11',
  };
  const first = await api('ingress/email', 'POST', body),
    second = await api('ingress/email', 'POST', body);
  assert.equal(first.status, 201, JSON.stringify(first));
  assert.equal(first.data.id, second.data.id);
  assert.equal(first.data.organization_id, tenant);
  assert.equal(first.data.source, 'email');
});
test('routing applies deterministic configured ownership through Work', async () => {
  const rule = await api('routing/rules', 'POST', {
    name: 'Maintenance owner',
    task_type: 'maintenance',
    target_user_id: userId,
    weight: 100,
  });
  assert.equal(rule.status, 201, JSON.stringify(rule));
  const task = await api('tasks', 'POST', taskInput());
  const result = await api(`routing/tasks/${task.data.task_id}`, 'POST');
  assert.equal(result.data.routed, true);
  assert.equal(
    (await api(`tasks/${task.data.task_id}`)).data.owner_user_id,
    userId,
  );
});
test('maintenance and education persist extension links with canonical tasks', async () => {
  const asset = await api('maintenance/assets', 'POST', {
    name: 'Pump',
    category: 'equipment',
  });
  assert.equal(asset.status, 201);
  const maintenance = await api('maintenance/tasks', 'POST', {
    task: taskInput(),
    asset_id: asset.data.id,
  });
  assert.equal(maintenance.status, 201, JSON.stringify(maintenance));
  assert.equal(
    (
      await db.task.findUniqueOrThrow({
        where: { id: maintenance.data.task_id },
      })
    ).type,
    'maintenance',
  );
  const group = await api('education/groups', 'POST', {
    code: randomUUID(),
    name: 'Group',
  });
  const education = await api('education/tasks', 'POST', {
    task: taskInput(),
    learning_group_id: group.data.id,
  });
  assert.equal(education.status, 201, JSON.stringify(education));
  assert.equal(
    (await db.task.findUniqueOrThrow({ where: { id: education.data.task_id } }))
      .type,
    'education_support',
  );
});
test('in-app notifications are queued then delivered to their organization user', async () => {
  const result = await api('notifications', 'POST', {
    channel: 'in_app',
    recipient_user_id: userId,
    subject: 'Work update',
    body: 'A task is ready',
  });
  assert.equal(result.status, 201, JSON.stringify(result));
  assert.equal(result.data.status, 'queued');
  await worker.tick();
  const notifications = await api('notifications');
  assert.equal(
    notifications.data.find((n: { id: string }) => n.id === result.data.id)
      .status,
    'sent',
  );
});

test('email provenance and additive labels survive workflow execution', async () => {
  const v = await version(
    rules([{ type: 'ADD_LABEL', input: { label: '2.21' } }]),
  );
  const accepted = await api(
    'signals',
    'POST',
    signalInput({ source: 'email', workflow_version_id: v.id }),
  );
  assert.equal(accepted.status, 201);
  const id = accepted.data.signal_id;
  await worker.tick();
  const link = await db.signalTask.findFirstOrThrow({
    where: { signal_id: id },
  });
  const task = await db.task.findUniqueOrThrow({ where: { id: link.task_id } });
  assert.equal(task.source, 'email');
  assert.equal(task.label, '1.11');
  const labels = await db.entityLabel.findMany({
    where: { entity_id: task.id },
    include: { label: true },
  });
  assert.equal(labels[0].label.code, '2.21');
});

test('attachments preserve evidence and cannot cross tenant boundaries', async () => {
  const task = await api('tasks', 'POST', taskInput());
  const id = task.data.task_id,
    key = randomUUID(),
    payload = {
      filename: 'evidence.txt',
      media_type: 'text/plain',
      content_base64: Buffer.from('evidence').toString('base64'),
    };
  const first = await api(`work/task/${id}/attachments`, 'POST', payload, key);
  assert.equal(first.status, 201, JSON.stringify(first));
  const repeat = await api(`work/task/${id}/attachments`, 'POST', payload, key);
  assert.equal(first.data.id, repeat.data.id);
  assert.equal(
    (
      await api(
        `attachments/${first.data.id}`,
        'GET',
        undefined,
        randomUUID(),
        otherBearer,
      )
    ).status,
    404,
  );
  assert.equal(
    (await api(`attachments/${first.data.id}`)).data.content_base64,
    payload.content_base64,
  );
  assert.equal(
    (await api(`attachments/${first.data.id}`, 'DELETE')).status,
    200,
  );
  assert.equal((await api(`attachments/${first.data.id}`)).status, 404);
  const events = await api(`work/task/${id}/timeline`);
  assert.ok(
    events.data.items.some(
      (r: { event_type: string }) => r.event_type === 'AttachmentRemoved',
    ),
  );
});

test('durable human gates require a current revision and explicit approval', async () => {
  const { ProcessManager } = await import(
    '../../src/orgo/modules/orchestration/process-manager.service'
  );
  const processManager = app.get(ProcessManager);
  const task = await api('tasks', 'POST', taskInput());
  const created = await api('processes', 'POST', {
    title: 'Human decision',
    subject_type: 'task',
    subject_id: task.data.task_id,
    steps: [
      { kind: 'approval', title: 'Review', permission: 'workflows:approve' },
    ],
  });
  assert.equal(created.status, 201, JSON.stringify(created));
  await processManager.tick();
  let row = (await api(`processes/${created.data.id}`)).data;
  assert.equal(row.status, 'WAITING_HUMAN');
  const stale = await api(`processes/${row.id}/decision`, 'POST', {
    revision: row.revision + 1,
    decision: 'approve',
    reason: 'Review completed',
  });
  assert.equal(stale.status, 409);
  const approved = await api(`processes/${row.id}/decision`, 'POST', {
    revision: row.revision,
    decision: 'approve',
    reason: 'Review completed',
  });
  assert.equal(approved.status, 201, JSON.stringify(approved));
  await processManager.tick();
  row = (await api(`processes/${row.id}`)).data;
  assert.equal(row.status, 'COMPLETED');
  assert.equal(
    (await api(`tasks/${task.data.task_id}`)).data.status,
    'PENDING',
  );
});

test('accepted external work waits for authenticated callback without approving the Case', async () => {
  const { ProcessManager } = await import(
    '../../src/orgo/modules/orchestration/process-manager.service'
  );
  const processManager = app.get(ProcessManager),
    previous = worker.adapters.kristal;
  worker.adapters.kristal = {
    execute: async () => ({
      status: 'accepted',
      external_reference: 'pending-1',
      data: {},
    }),
  };
  try {
    const subject = (await api('cases', 'POST', caseInput())).data;
    const process = (
      await api('processes', 'POST', {
        title: 'External wait',
        subject_type: 'case',
        subject_id: subject.case_id,
        steps: [
          {
            kind: 'integration',
            title: 'Validate',
            request: {
              provider: 'kristal',
              operation: 'validate',
              request: {},
            },
          },
        ],
      })
    ).data;
    await processManager.tick();
    const row = (await api(`processes/${process.id}`)).data;
    for (let i = 0; i < 10; i++) {
      await worker.tick();
      const op = await db.integrationOperation.findUniqueOrThrow({
        where: { id: row.operation_id },
      });
      if (op.receipt) break;
    }
    await processManager.tick();
    assert.equal(
      (await api(`processes/${row.id}`)).data.status,
      'WAITING_EXTERNAL',
    );
    const callback = await api(
      `integration-operations/${row.operation_id}/receipt`,
      'POST',
      {
        status: 'succeeded',
        external_reference: 'validated-1',
        data: { validated: true },
      },
    );
    assert.equal(callback.status, 201, JSON.stringify(callback));
    await processManager.tick();
    await processManager.tick();
    assert.equal((await api(`processes/${row.id}`)).data.status, 'COMPLETED');
    assert.equal((await api(`cases/${subject.case_id}`)).data.status, 'open');
    assert.equal(
      (
        await api(
          `integration-operations/${row.operation_id}/receipt`,
          'POST',
          { status: 'failed', data: {} },
        )
      ).status,
      409,
    );
  } finally {
    worker.adapters.kristal = previous;
  }
});

test('scoped roles read and mutate only their explicit Work perimeter', async () => {
  const { IdentityService } = await import(
    '../../src/orgo/modules/identity/identity.service'
  );
  const user = (
    await api('users', 'POST', {
      email: `scope-${randomUUID()}@example.test`,
      display_name: 'Team member',
      password: 'local-test-password-123',
    })
  ).data;
  const role = (
    await api('roles', 'POST', {
      code: `team-${randomUUID()}`,
      display_name: 'Team work',
      permissions: ['work:read', 'work:write'],
    })
  ).data;
  const grant = await api(`identity/users/${user.id}/scopes`, 'POST', {
    role_id: role.id,
    scope_type: 'team',
    scope_reference: 'alpha',
  });
  assert.equal(grant.status, 201, JSON.stringify(grant));
  const session = await app.get(IdentityService).session(tenant, user.id);
  const inside = await api(
    'tasks',
    'POST',
    taskInput({ access_scope_type: 'team', access_scope_reference: 'alpha' }),
    randomUUID(),
    session.token,
  );
  assert.equal(inside.status, 201, JSON.stringify(inside));
  assert.equal(
    (
      await api(
        'tasks',
        'POST',
        taskInput({
          access_scope_type: 'team',
          access_scope_reference: 'beta',
        }),
        randomUUID(),
        session.token,
      )
    ).status,
    403,
  );
  const outside = (
    await api(
      'tasks',
      'POST',
      taskInput({ access_scope_type: 'team', access_scope_reference: 'beta' }),
    )
  ).data;
  assert.equal(
    (
      await api(
        `tasks/${outside.task_id}`,
        'GET',
        undefined,
        randomUUID(),
        session.token,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await api(
        `tasks/${inside.data.task_id}/status`,
        'PATCH',
        { status: 'IN_PROGRESS', revision: 0 },
        randomUUID(),
        session.token,
      )
    ).status,
    200,
  );
  await api(`identity/scopes/${grant.data.id}`, 'DELETE');
  assert.equal(
    (
      await api(
        `tasks/${inside.data.task_id}`,
        'GET',
        undefined,
        randomUUID(),
        session.token,
      )
    ).status,
    403,
  );
});

test('calendar reservations reject overlaps and accept non-overlapping intervals', async () => {
  const asset = (
    await api('maintenance/assets', 'POST', {
      name: 'Reserved asset',
      category: 'machine',
    })
  ).data;
  const slot = {
    asset_id: asset.id,
    title: 'Inspection',
    start_at: '2030-01-01T09:00:00Z',
    end_at: '2030-01-01T10:00:00Z',
  };
  assert.equal((await api('maintenance/calendar', 'POST', slot)).status, 201);
  assert.equal(
    (await api('maintenance/calendar', 'POST', { ...slot, title: 'Conflict' }))
      .status,
    409,
  );
  assert.equal(
    (
      await api('maintenance/calendar', 'POST', {
        ...slot,
        start_at: '2030-01-01T10:00:00Z',
        end_at: '2030-01-01T11:00:00Z',
      })
    ).status,
    201,
  );
});

test('MIME envelope attachments remain accessible only through Signal authorization', async () => {
  const input = {
    message_id: randomUUID(),
    from: 'source@example.test',
    to: ['intake@example.test'],
    subject: 'Evidence',
    text: 'See attached',
    label: '1.11',
    attachments: [
      {
        filename: 'proof.txt',
        media_type: 'text/plain',
        content_base64: Buffer.from('proof').toString('base64'),
      },
    ],
  };
  const result = await api('ingress/email', 'POST', input);
  assert.equal(result.status, 201, JSON.stringify(result));
  const envelope = await api(`ingress/email/${result.data.id}`);
  assert.equal(envelope.data.attachments[0].content_base64, undefined);
  assert.equal(
    (await api(`ingress/email/${result.data.id}/attachments/0`)).data
      .content_base64,
    input.attachments[0].content_base64,
  );
  assert.equal(
    (
      await api(
        `ingress/email/${result.data.id}/attachments/0`,
        'GET',
        undefined,
        randomUUID(),
        otherBearer,
      )
    ).status,
    404,
  );
});
