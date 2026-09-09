import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OrgoClient, rowId } from '../../../web/src/orgo/api';

test('browser retries an uncertain mutation with its original idempotency key', async () => {
  const original = globalThis.fetch;
  const keys: string[] = [];
  let attempt = 0;
  globalThis.fetch = async (_url, options) => {
    keys.push(new Headers(options?.headers).get('Idempotency-Key')!);
    if (++attempt === 1) throw new TypeError('connection lost after commit');
    return new Response(
      JSON.stringify({ ok: true, data: { id: 'one' }, error: null }),
    );
  };
  try {
    const client = new OrgoClient('test');
    await assert.rejects(client.request('tasks', 'POST', { title: 'A' }));
    await client.request('tasks', 'POST', { title: 'A' });
    await client.request('tasks', 'POST', { title: 'A' });
    assert.equal(keys[0], keys[1]);
    assert.notEqual(keys[1], keys[2]);
  } finally {
    globalThis.fetch = original;
  }
});
test('related entities retain their own identity in case and task inspectors', () => {
  assert.equal(rowId({ id: 'comment', task_id: 'task' }), 'comment');
  assert.equal(rowId({ signal_id: 'signal', case_id: 'case' }), 'signal');
  assert.equal(rowId({ task_id: 'task', case_id: 'case' }), 'task');
});
