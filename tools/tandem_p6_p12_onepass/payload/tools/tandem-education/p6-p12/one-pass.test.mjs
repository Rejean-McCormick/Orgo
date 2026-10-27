import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {reviewPlan} from '../review-plan.mjs';
import {SyntheticCaseStore,projectSyntheticTeacher,assertNoRuntime} from './synthetic-transaction.mjs';
import {blockedRuntimePhases} from './one-pass.mjs';
const intentBytes=readFileSync(new URL('../fixtures/fete-sorciere.intent.synthetic.json',import.meta.url));
const scope=JSON.parse(readFileSync(new URL('../fixtures/fete-sorciere.scope.synthetic.json',import.meta.url)));
const plan=reviewPlan(JSON.parse(intentBytes),scope,intentBytes);
const actor={source:'synthetic-memory',userId:'teacher-synthetic',tenantId:plan.tenant_id,worldId:plan.world_id};
const approval={source:'synthetic-memory',status:'approved',tenantId:plan.tenant_id,worldId:plan.world_id,releaseId:plan.world_release_id,scenarioRef:plan.scenario_ref};
const grants=plan.task_refs.map(taskRef=>({taskRef,source:'synthetic-memory',active:true,worldId:plan.world_id}));
const input={plan,actor,approval,grants,requestId:'intg-1'};
test('P8 synthetic transaction creates 1 Case 11 Tasks with no actual DB operations',async()=>{
 const db=new SyntheticCaseStore();const out=await db.transact(input);assert.equal(out.case_count,1);assert.equal(out.task_count,11);assert.equal(db.count,1);assert.equal(db.taskCount,11);assertNoRuntime(out);
});
test('P8 idempotence: 20 concurrent identical calls produce a single synthetic Case',async()=>{
 const db=new SyntheticCaseStore();const cases=await Promise.all(Array.from({length:20},()=>db.transact(input)));
 assert.equal(new Set(cases.map(c=>c.case_id)).size,1);assert.equal(db.count,1);assert.equal(db.taskCount,11);
});
test('P8 same idempotency key cannot be reused for another request',async()=>{
 const db=new SyntheticCaseStore();await db.transact(input);
 await assert.rejects(db.transact({...input,actor:{...actor,userId:'teacher-other'}}),/idempotency/i);
});
test('P8 concurrent conflicting idempotency requests are rejected',async()=>{
 const db=new SyntheticCaseStore();const first=db.transact(input);
 await assert.rejects(db.transact({...input,actor:{...actor,userId:'different-teacher'}}));
 await first;assert.equal(db.count,1);
});
test('P8 fault injection at each task prevents partial commits',async()=>{
 for(let faultAt=0;faultAt<=11;faultAt++){
  const db=new SyntheticCaseStore();await assert.rejects(db.transact({...input,failAt:faultAt}));assert.equal(db.count,0);assert.equal(db.taskCount,0);
 }
});
test('P7 teacher approval revoked / cross-release / absent grants denied',async()=>{
 const bad=[{approval:{...approval,status:'revoked'}},{approval:{...approval,releaseId:'another-release'}},{grants:grants.slice(0,10)},{grants:grants.map((g,i)=>i===0?{...g,worldId:'wrong-world'}:g)}];
 for(const patch of bad)await assert.rejects(new SyntheticCaseStore().transact({...input,...patch}));
});
test('P7 no client-proclaimed real rights or external child identifiers accepted',async()=>{
 for(const patch of [{actor:{...actor,source:'client-claim'}},{approval:{...approval,source:'akorteacherauthorized'}},{grants:grants.map((g,i)=>i===0?{...g,participantName:'real child'}:g)},{plan:{...plan,runtime_admitted:true}},{plan:{...plan,dispatch_allowed:true}}])
 await assert.rejects(new SyntheticCaseStore().transact({...input,...patch}));
});
test('P9 teacher preview only; cross tenant / World / child reader denied',async()=>{
 const out=await new SyntheticCaseStore().transact(input);
 const teacher={source:'synthetic-memory',role:'teacher',tenantId:plan.tenant_id,worldId:plan.world_id};
 const p=projectSyntheticTeacher(out,teacher);assert.equal(p.task_count,11);assert.equal(p.pii_included,false);assert.equal(p.child_access,false);
 for(const patch of [{role:'child'},{tenantId:'other'},{worldId:'other'},{source:'header'}])assert.throws(()=>projectSyntheticTeacher(out,{...teacher,...patch}));
});
test('P10 refuses unknown scenario step, synthetic flag escalation and injected private data',async()=>{
 for(const patch of [{plan:{...plan,task_count:12}},{plan:{...plan,task_refs:[...plan.task_refs,'rogue']}},{grants:grants.map((g,i)=>i===0?{...g,synthetic:false}:g)}])await assert.rejects(new SyntheticCaseStore().transact({...input,...patch}));
});
test('P11/P12 runtime release gate always remains explicitly blocked',()=>{
 assert.deepEqual(Object.keys(blockedRuntimePhases),['P6','P7','P8','P9','P10','P11','P12']);
 const x={runtime_admitted:false,dispatch_allowed:false,may_publish_to_child:false,app_db_writes:0,network_calls:0};assertNoRuntime(x);
 assert.throws(()=>assertNoRuntime({...x,runtime_admitted:true}));assert.throws(()=>assertNoRuntime({...x,app_db_writes:1}));
});
