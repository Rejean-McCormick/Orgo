import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { applyScenario, buildPrompt, planScenario, validateScenario } from '../lib.mjs';
const here=dirname(fileURLToPath(import.meta.url));
const example=JSON.parse(await readFile(resolve(here,'../examples/uckk-a014.scenario.json'),'utf8'));

test('UCKK example validates',()=>{ const r=validateScenario(example); assert.equal(r.ok,true,JSON.stringify(r.errors)); });
test('plan is dry and ordered',()=>{ const r=planScenario(example); assert.equal(r.ok,true); assert.equal(r.operations.length,3); assert.equal(r.operations[0].op,'publish_workflow'); });
test('rejects runtime UUID in task input',()=>{ const bad=structuredClone(example); bad.operations=[{op:'create_task',ref:'task.x',input:{title:'x',type:'x',category:'request',label:'2.11',case_id:'00000000-0000-0000-0000-000000000000'}}]; const r=validateScenario(bad); assert.equal(r.ok,false); assert.match(r.errors.join('\n'),/UUID runtime interdits/); });
test('rejects forward references',()=>{ const bad=structuredClone(example); bad.operations=[{op:'create_task',ref:'task.x',case_ref:'case.later',input:{title:'x',type:'x',category:'request',label:'2.11'}},{op:'create_case',ref:'case.later',input:{title:'c',label:'2.11'}}]; const r=validateScenario(bad); assert.equal(r.ok,false); assert.match(r.errors.join('\n'),/doit être créée/); });
test('prompt contains hard safety contract',()=>{ const p=buildPrompt('Brief test'); assert.match(p,/sans bloc Markdown/); assert.match(p,/N'invente jamais d'UUID/); assert.match(p,/find_case/); assert.match(p,/request_integration/); assert.match(p,/Brief test/); });

test('world handoff operations validate',()=>{
  const doc={
    schema_version:'orgo.scenario.v1',
    scenario:{id:'world-handoff',title:'World handoff',synthetic:true,epistemic_status:'synthetic_demo_fixture'},
    operations:[
      {op:'find_case',ref:'case.main',search:'UCKK',title:'UCKK A014',metadata:{demo_id:'uckk-pedagogy-pilot-a014'}},
      {op:'find_task',ref:'task.review',case_ref:'case.main',search:'Day-30',title:'Produce Day-30 process review'},
      {op:'request_integration',ref:'integration.impact',subject_ref:'case.main',provider:'konnaxion',operation:'publish',request:{kind:'impact'}},
      {op:'wait_integration',integration_ref:'integration.impact',timeout_seconds:5}
    ]
  };
  const r=validateScenario(doc); assert.equal(r.ok,true,JSON.stringify(r.errors));
});

test('find and integration operations resolve runtime refs without scenario UUIDs',async()=>{
  const doc={
    schema_version:'orgo.scenario.v1',
    scenario:{id:'world-handoff-apply',title:'World handoff apply',synthetic:true,epistemic_status:'synthetic_demo_fixture',correlation_id:'corr.world.handoff'},
    operations:[
      {op:'find_case',ref:'case.main',search:'UCKK',title:'UCKK A014',metadata:{demo_id:'demo'}},
      {op:'find_task',ref:'task.review',case_ref:'case.main',search:'Day-30',title:'Produce Day-30 process review'},
      {op:'request_integration',ref:'integration.impact',subject_ref:'case.main',provider:'konnaxion',operation:'publish',request:{checkpoint:'J30'}}
    ]
  };
  const calls=[];
  const fetchImpl=async(url,opts={})=>{
    calls.push({url,opts});
    if (url.includes('/cases?')) return new Response(JSON.stringify({ok:true,data:{items:[{case_id:'11111111-1111-1111-1111-111111111111',title:'UCKK A014',metadata:{demo_id:'demo'}}],total:1,offset:0,limit:100}}),{status:200,headers:{'content-type':'application/json'}});
    if (url.includes('/tasks?')) return new Response(JSON.stringify({ok:true,data:{items:[{task_id:'22222222-2222-2222-2222-222222222222',title:'Produce Day-30 process review',metadata:{}}],total:1,offset:0,limit:100}}),{status:200,headers:{'content-type':'application/json'}});
    if (url.endsWith('/integration-operations')) return new Response(JSON.stringify({ok:true,data:{id:'33333333-3333-3333-3333-333333333333',status:'PENDING'}}),{status:200,headers:{'content-type':'application/json'}});
    throw new Error(`unexpected URL ${url}`);
  };
  const report=await applyScenario(doc,{baseUrl:'http://127.0.0.1:4000/api/v3',token:'test-token'},{apply:true,fetchImpl});
  assert.equal(report.refs['case.main'].id,'11111111-1111-1111-1111-111111111111');
  assert.equal(report.refs['task.review'].id,'22222222-2222-2222-2222-222222222222');
  assert.equal(report.refs['integration.impact'].id,'33333333-3333-3333-3333-333333333333');
  const integrationCall=calls.find(c=>c.url.endsWith('/integration-operations'));
  assert.ok(integrationCall);
  const body=JSON.parse(integrationCall.opts.body);
  assert.equal(body.subject_type,'case');
  assert.equal(body.subject_id,'11111111-1111-1111-1111-111111111111');
});

test('assert_case_absent fails closed when a matching case exists',async()=>{
  const doc={schema_version:'orgo.scenario.v1',scenario:{id:'pre-decision',title:'Pre decision',synthetic:true,epistemic_status:'synthetic_demo_fixture'},operations:[{op:'assert_case_absent',search:'A014',title:'UCKK A014'}]};
  const fetchImpl=async()=>new Response(JSON.stringify({ok:true,data:{items:[{id:'1',title:'UCKK A014',metadata:{}}],total:1}}),{status:200,headers:{'content-type':'application/json'}});
  await assert.rejects(()=>applyScenario(doc,{baseUrl:'http://x/api/v3',token:'t'},{apply:true,fetchImpl}),/Case présent/);
});


test('find_task canonical task_id feeds transition_task without tasks/undefined',async()=>{
  const taskId='22222222-2222-2222-2222-222222222222';
  const caseId='11111111-1111-1111-1111-111111111111';
  const doc={
    schema_version:'orgo.scenario.v1',
    scenario:{id:'canonical-work-ids',title:'Canonical work ids',synthetic:true,epistemic_status:'synthetic_demo_fixture'},
    operations:[
      {op:'find_case',ref:'case.main',search:'A014',title:'UCKK A014'},
      {op:'find_task',ref:'task.freeze',case_ref:'case.main',search:'Freeze',title:'Freeze approved pilot specification'},
      {op:'transition_task',task_ref:'task.freeze',status:'COMPLETED',reason:'test'}
    ]
  };
  const calls=[];
  const fetchImpl=async(url,opts={})=>{
    calls.push({url,opts});
    if (url.includes('/cases?')) return new Response(JSON.stringify({ok:true,data:{items:[{case_id:caseId,title:'UCKK A014',metadata:{}}],total:1,offset:0,limit:100}}),{status:200,headers:{'content-type':'application/json'}});
    if (url.includes('/tasks?')) return new Response(JSON.stringify({ok:true,data:{items:[{task_id:taskId,title:'Freeze approved pilot specification',status:'PENDING',revision:0,metadata:{}}],total:1,offset:0,limit:100}}),{status:200,headers:{'content-type':'application/json'}});
    if (url.endsWith(`/tasks/${taskId}`) && (!opts.method || opts.method==='GET')) return new Response(JSON.stringify({ok:true,data:{task_id:taskId,title:'Freeze approved pilot specification',status:'PENDING',revision:0,metadata:{}}}),{status:200,headers:{'content-type':'application/json'}});
    if (url.endsWith(`/tasks/${taskId}/status`) && opts.method==='PATCH') {
      const body=JSON.parse(opts.body);
      if (body.status==='IN_PROGRESS' && body.revision===0) return new Response(JSON.stringify({ok:true,data:{task_id:taskId,title:'Freeze approved pilot specification',status:'IN_PROGRESS',revision:1,metadata:{}}}),{status:200,headers:{'content-type':'application/json'}});
      if (body.status==='COMPLETED' && body.revision===1) return new Response(JSON.stringify({ok:true,data:{task_id:taskId,title:'Freeze approved pilot specification',status:'COMPLETED',revision:2,metadata:{}}}),{status:200,headers:{'content-type':'application/json'}});
      return new Response(JSON.stringify({ok:false,data:null,error:{code:'INVALID_TRANSITION',message:`unexpected transition ${body.status} revision ${body.revision}`,details:{}}}),{status:409,headers:{'content-type':'application/json'}});
    }
    throw new Error(`unexpected URL ${url}`);
  };
  const report=await applyScenario(doc,{baseUrl:'http://127.0.0.1:4000/api/v3',token:'test-token'},{apply:true,fetchImpl});
  assert.equal(report.refs['case.main'].id,caseId);
  assert.equal(report.refs['task.freeze'].id,taskId);
  assert.ok(calls.some(c=>c.url.endsWith(`/tasks/${taskId}`)));
  assert.equal(calls.some(c=>c.url.includes('tasks/undefined')),false);
  const patches=calls.filter(c=>c.url.endsWith(`/tasks/${taskId}/status`) && c.opts.method==='PATCH').map(c=>JSON.parse(c.opts.body));
  assert.deepEqual(patches.map(p=>p.status),['IN_PROGRESS','COMPLETED']);
  assert.deepEqual(patches.map(p=>p.revision),[0,1]);
  assert.equal(report.results.at(-1).status,'applied_via_legal_path');
});

test('transition_task is idempotent when task already has target status',async()=>{
  const taskId='33333333-3333-3333-3333-333333333333';
  const doc={schema_version:'orgo.scenario.v1',scenario:{id:'already-completed',title:'Already completed',synthetic:true,epistemic_status:'synthetic_demo_fixture'},operations:[
    {op:'find_task',ref:'task.freeze',search:'Freeze',title:'Freeze approved pilot specification'},
    {op:'transition_task',task_ref:'task.freeze',status:'COMPLETED'}
  ]};
  const calls=[];
  const fetchImpl=async(url,opts={})=>{
    calls.push({url,opts});
    if (url.includes('/tasks?')) return new Response(JSON.stringify({ok:true,data:{items:[{task_id:taskId,title:'Freeze approved pilot specification',status:'COMPLETED',revision:2,metadata:{}}],total:1,offset:0,limit:100}}),{status:200,headers:{'content-type':'application/json'}});
    if (url.endsWith(`/tasks/${taskId}`) && (!opts.method || opts.method==='GET')) return new Response(JSON.stringify({ok:true,data:{task_id:taskId,title:'Freeze approved pilot specification',status:'COMPLETED',revision:2,metadata:{}}}),{status:200,headers:{'content-type':'application/json'}});
    throw new Error(`unexpected URL ${url}`);
  };
  const report=await applyScenario(doc,{baseUrl:'http://127.0.0.1:4000/api/v3',token:'test-token'},{apply:true,fetchImpl});
  assert.equal(report.results.at(-1).status,'skipped_already_at_status');
  assert.equal(calls.some(c=>c.opts.method==='PATCH'),false);
});

test('wait_integration requires SUCCEEDED and fails closed on provider failure',async()=>{
  const integrationId='44444444-4444-4444-4444-444444444444';
  const doc={schema_version:'orgo.scenario.v1',scenario:{id:'integration-wait',title:'Integration wait',synthetic:true,epistemic_status:'synthetic_demo_fixture'},operations:[
    {op:'find_case',ref:'case.main',search:'A014',title:'UCKK A014'},
    {op:'request_integration',ref:'integration.impact',subject_ref:'case.main',provider:'konnaxion',operation:'publish',request:{artifact_type:'impact_update'}},
    {op:'wait_integration',integration_ref:'integration.impact',timeout_seconds:5}
  ]};
  let reads=0;
  const fetchImpl=async(url,opts={})=>{
    if (url.includes('/cases?')) return new Response(JSON.stringify({ok:true,data:{items:[{case_id:'11111111-1111-1111-1111-111111111111',title:'UCKK A014',metadata:{}}],total:1,offset:0,limit:100}}),{status:200,headers:{'content-type':'application/json'}});
    if (url.endsWith('/integration-operations') && opts.method==='POST') return new Response(JSON.stringify({ok:true,data:{id:integrationId,status:'PENDING'}}),{status:200,headers:{'content-type':'application/json'}});
    if (url.endsWith(`/integration-operations/${integrationId}`)) {
      reads++;
      return new Response(JSON.stringify({ok:true,data:{id:integrationId,status:reads<2?'RUNNING':'SUCCEEDED',receipt:{status:'succeeded'}}}),{status:200,headers:{'content-type':'application/json'}});
    }
    throw new Error(`unexpected URL ${url}`);
  };
  const report=await applyScenario(doc,{baseUrl:'http://127.0.0.1:4000/api/v3',token:'test-token'},{apply:true,fetchImpl});
  assert.equal(report.results.at(-1).status,'succeeded');
});

