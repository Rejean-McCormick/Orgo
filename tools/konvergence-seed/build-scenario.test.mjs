import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScenario } from './build-scenario.mjs';
import { validateScenario } from '../scenario-injector/lib.mjs';

test('Konvergence cases become a valid deterministic Orgo scenario', () => {
  const source = {
    contract: 'koa-orgo-sim/v1',
    cases: [{
      case_id: 'CASE-ONE-001', title: 'Case one', origin_world: 'demo', origin_topic: 'topic', status: 'open', mandate: 'Do the thing',
      tasks: [{ task: 'First task', owner: 'actor_demo' }],
    }],
  };
  const first = buildScenario(source);
  const second = buildScenario(source);
  assert.deepEqual(first, second);
  assert.equal(validateScenario(first).ok, true, JSON.stringify(validateScenario(first).errors));
  assert.equal(first.operations[0].input.metadata.source_case_id, 'CASE-ONE-001');
  assert.equal(first.operations[1].input.metadata.konvergence_owner_ref, 'actor_demo');
});
