import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonical,
  DomainError,
  hash,
  isBroadcast,
  label,
  parse,
  requirePermission,
  transition,
} from '../../src/orgo/platform/contracts';
import {
  evaluate,
  resolveInput,
} from '../../src/orgo/modules/orchestration/evaluator';
import { workflowSchema } from '../../src/orgo/modules/orchestration/workflow.contract';
import { retryDelay } from '../../src/orgo/platform/outbox/worker.service';
import { HttpBridge } from '../../src/orgo/integrations/http-bridge';
import {
  passwordHash,
  passwordMatches,
} from '../../src/orgo/modules/identity/identity.service';

test('canonical fingerprint ignores object order but preserves arrays', () => {
  assert.equal(hash({ b: 1, a: [2, 3] }), hash({ a: [2, 3], b: 1 }));
  assert.notEqual(hash([1, 2]), hash([2, 1]));
  assert.equal(canonical({ a: undefined }), '{}');
});
test('task lifecycle terminal states and illegal escalation are rejected', () => {
  transition('task', 'PENDING', 'IN_PROGRESS');
  transition('task', 'IN_PROGRESS', 'ESCALATED');
  for (const terminal of ['COMPLETED', 'FAILED', 'CANCELLED'])
    assert.throws(
      () => transition('task', terminal, 'IN_PROGRESS'),
      DomainError,
    );
  assert.throws(() => transition('task', 'PENDING', 'ESCALATED'), DomainError);
});
test('case lifecycle permits reopening but archived is terminal', () => {
  transition('case', 'resolved', 'in_progress');
  assert.throws(() => transition('case', 'archived', 'open'), DomainError);
});
test('labels validate category/subcategory and broadcast bases', () => {
  parse(label, '101.94.Operations.Safety');
  assert.throws(() => parse(label, '0.96.x'));
  assert.equal(isBroadcast('100.11'), true);
  assert.equal(isBroadcast('101.11'), false);
});
test('workflow evaluation is deterministic and leaves inputs unchanged', () => {
  const content = parse(workflowSchema, {
    rules: [
      {
        id: 'rule',
        match: {
          category: 'incident',
          keywordsAny: ['pump'],
          metadata: { site: 'A' },
        },
        actions: [{ type: 'CREATE_CASE', input: { title: '$signal.title' } }],
      },
    ],
  });
  const before = canonical(content),
    ctx = {
      organizationId: 'tenant',
      source: 'API' as const,
      category: 'incident',
      title: 'PUMP failed',
      metadata: { site: 'A' },
    };
  const result = evaluate(content, ctx);
  assert.equal(result.length, 1);
  assert.deepEqual(result, evaluate(content, ctx));
  assert.equal(canonical(content), before);
  assert.equal(
    evaluate(content, { ...ctx, metadata: { site: 'B' } }).length,
    0,
  );
});
test('unknown actions, duplicate rule ids and unknown criteria are rejected', () => {
  for (const raw of [
    { rules: [{ id: 'a', match: {}, actions: [{ type: 'ARBITRARY_CODE' }] }] },
    {
      rules: [
        {
          id: 'a',
          match: { sourceX: 'API' },
          actions: [{ type: 'CREATE_TASK' }],
        },
      ],
    },
    {
      rules: Array(2).fill({
        id: 'a',
        match: {},
        actions: [{ type: 'CREATE_TASK' }],
      }),
    },
  ])
    assert.throws(() => parse(workflowSchema, raw));
});
test('references are explicit; inherited properties are never bindings', () => {
  assert.deepEqual(resolveInput({ id: '$case' }, { case: 'abc' }), {
    id: 'abc',
  });
  assert.throws(() => resolveInput('$constructor', {}), DomainError);
  assert.throws(() => resolveInput('$unknown', {}), DomainError);
});
test('retry backoff is bounded and jittered', () => {
  assert.equal(
    retryDelay(1, () => 0),
    1000,
  );
  assert.equal(
    retryDelay(1, () => 1),
    2000,
  );
  assert.ok(retryDelay(100) <= 3600000);
});
test('passwords use salted hashes and verify correctly', async () => {
  const first = await passwordHash('a-test-password');
  assert.notEqual(first, await passwordHash('a-test-password'));
  assert.equal(await passwordMatches('a-test-password', first), true);
  assert.equal(await passwordMatches('wrong', first), false);
});
test('unconfigured provider and false approval receipts fail closed', async () => {
  const request = {
    operation_id: 'op',
    organization_id: 'org',
    operation: 'validate',
    idempotency_key: 'key',
    correlation_id: 'corr',
    subject: { type: 'case', id: 'id' },
    input: {},
  };
  await assert.rejects(
    new HttpBridge(undefined, undefined, ['validate']).execute(request),
    /PROVIDER_UNCONFIGURED/,
  );
  const invalid = new HttpBridge(
    'https://example.test/bridge',
    undefined,
    ['validate'],
    async () => new Response(JSON.stringify({ status: 'pending' })),
  );
  await assert.rejects(invalid.execute(request), /INVALID_RECEIPT/);
  const accepted = new HttpBridge(
    'https://example.test/bridge',
    undefined,
    ['validate'],
    async () =>
      new Response(
        JSON.stringify({ status: 'succeeded', data: { valid: false } }),
      ),
  );
  assert.deepEqual((await accepted.execute(request)).data, { valid: false }); // delivery success is NOT semantic validation
});
