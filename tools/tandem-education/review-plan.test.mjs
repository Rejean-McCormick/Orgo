import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readSmallJson,reviewPlan,parseStrictJson} from './review-plan.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'fixtures');
const i=readSmallJson(path.join(root,'fete-sorciere.intent.synthetic.json'));
const s=readSmallJson(path.join(root,'fete-sorciere.scope.synthetic.json')).body;
const copy=v=>JSON.parse(JSON.stringify(v));
test('Orgo 11 step plan remains review only without operations',()=>{
 const p=reviewPlan(i.body,s,i.bytes);
 assert.equal(p.task_count,11);assert.equal(p.db_writes,0);assert.equal(p.network_calls,0);
 for(const key of ['dispatch_allowed','runtime_admitted','teacher_authorized','permissions_verified','world_release_verified','may_publish_to_child'])assert.equal(p[key],false);
 assert.equal(p.workflow_published,false);
});
test('cannot inject child PII or rogue task',()=>{
 const x=copy(i.body);x.tasks[0].child_name='synthetic-but-private';
 assert.throws(()=>reviewPlan(x,s,i.bytes),/fields/);
 const y=copy(i.body);y.tasks.push({...y.tasks[0]});
 assert.throws(()=>reviewPlan(y,s,i.bytes),/duplicate/);
});
test('reject fake approvals from Akor and Worlds',()=>{
 for(const key of ['teacher_authorized','permissions_verified','runtime_admitted','dispatch_allowed']){
  const x=copy(i.body);x[key]=true;assert.throws(()=>reviewPlan(x,s,i.bytes),/authority/);
  const y=copy(s);y[key]=true;assert.throws(()=>reviewPlan(i.body,y,i.bytes),/authority/);
 }
});
test('reject wrong organization, world, release or stale review hash',()=>{
 for(const key of ['tenant_id','world_id','world_release_id']){
  const bad=copy(s);bad[key]='44444444-4444-4444-8444-444444444444';
  assert.throws(()=>reviewPlan(i.body,bad,i.bytes),/mismatch/);
 }
 const bad=copy(s);bad.intent_sha256='a'.repeat(64);
 assert.throws(()=>reviewPlan(i.body,bad,i.bytes),/altered/);
});

test('reject duplicate keys, escaped duplicate keys and excessive nesting',()=>{
  assert.throws(()=>parseStrictJson('{"tenant_id":"one","tenant_id":"two"}'),/Duplicate JSON key/);
  assert.throws(()=>parseStrictJson('{"task":{"a":1,"a":2}}'),/Duplicate JSON key/);
  assert.throws(()=>parseStrictJson('{"a":1,"\\u0061":2}'),/Duplicate JSON key/);
  assert.throws(()=>parseStrictJson('['.repeat(40)+'0'+']'.repeat(40)),/nesting too deep/);
  assert.deepEqual(parseStrictJson('{"nested":[{"ok":true}],"x":2}'),{nested:[{ok:true}],x:2});
});
