import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {inspectAdmissionPrerequisites} from './admission-prerequisites.mjs';
const intentBytes=readFileSync(new URL('./fixtures/fete-sorciere.intent.synthetic.json',import.meta.url));
const intent=JSON.parse(intentBytes),scopeReport=JSON.parse(readFileSync(new URL('./fixtures/fete-sorciere.scope.synthetic.json',import.meta.url)));
const actor={actorType:'user',actorUserId:'44444444-4444-4444-8444-444444444444',organizationId:intent.tenant_id,permissions:['education:admit']};
const authorityRequest={format:'akor.tandem-authority-request/1.0',mode:'synthetic',status:'AWAITING_SERVER_VERIFICATION',authority:'orgo',scenario_ref:intent.scenario_ref,workflow_ref:intent.workflow_ref,tenant_id:intent.tenant_id,world_id:intent.world_id,world_release_id:intent.world_release_id,intent_sha256:createHash('sha256').update(intentBytes).digest('hex'),task_count:11,runtime_admitted:false,teacher_authorized:false,permissions_verified:false,world_release_verified:false,dispatch_allowed:false,may_publish_to_child:false};
const nowMs=1780000000000;
const world={organizationId:intent.tenant_id,worldId:intent.world_id,releaseId:intent.world_release_id,currentReleaseId:intent.world_release_id,worldStatus:'active',releaseStatus:'current',membership:{userId:actor.actorUserId,worldId:intent.world_id,active:true,role:'member'}};
const approval={status:'approved',teacherUserId:actor.actorUserId,organizationId:intent.tenant_id,worldId:intent.world_id,releaseId:intent.world_release_id,intentSha256:authorityRequest.intent_sha256,issuedAtMs:nowMs-1000,expiresAtMs:nowMs+20000};
const grants=intent.tasks.map(t=>({taskRef:t.task_ref,participantRef:'synthetic-student',active:true,synthetic:true,organizationId:intent.tenant_id,worldId:intent.world_id}));
const args=()=>({intentBytes,scopeReport,authorityRequest,actor,nowMs,readWorld:async()=>structuredClone(world),readTeacherApproval:async()=>structuredClone(approval),readParticipantGrants:async()=>structuredClone(grants)});
test('dry run with in-memory port mocks NEVER produces Orgo admission or writes',async()=>{
 let r=await inspectAdmissionPrerequisites(args());assert.equal(r.task_count,11);
 assert.equal(r.status,'DRY_RUN_ONLY_NO_RUNTIME_ADMISSION');
 for(const f of ['runtime_admitted','teacher_authorized','permissions_verified','world_release_verified','dispatch_allowed','may_publish_to_child','workflow_published'])assert.equal(r[f],false);
 assert.equal(r.db_writes,0);assert.equal(r.network_calls,0);
});
test('deny missing authority ports and missing explicit Orgo session permission',async()=>{
 await assert.rejects(inspectAdmissionPrerequisites({...args(),readWorld:undefined}));
 await assert.rejects(inspectAdmissionPrerequisites({...args(),actor:{...actor,permissions:['*']}}));
 await assert.rejects(inspectAdmissionPrerequisites({...args(),actor:{...actor,actorType:'system'}}));
 await assert.rejects(inspectAdmissionPrerequisites({...args(),actor:{...actor,organizationId:'55555555-5555-4555-8555-555555555555'}}));
});
test('deny client forged approval/unknown child fields and mismatching hashes',async()=>{
 for(const change of [{teacher_authorized:true},{world_release_verified:true},{child_name:'fake'},{task_count:2},{intent_sha256:'0'.repeat(64)}])await assert.rejects(inspectAdmissionPrerequisites({...args(),authorityRequest:{...authorityRequest,...change}}));
});
test('deny stale, cross-release, replay-like and unapproved teacher record',async()=>{
 for(const change of [{status:'pending'},{issuedAtMs:nowMs-70000},{expiresAtMs:nowMs-1},{expiresAtMs:nowMs+70000},{teacherUserId:'55555555-5555-4555-8555-555555555555'},{intentSha256:'0'.repeat(64)},{releaseId:'55555555-5555-4555-8555-555555555555'}]){
 await assert.rejects(inspectAdmissionPrerequisites({...args(),readTeacherApproval:async()=>({...approval,...change})}));}
});
test('deny archived or cross-tenant World, removed membership',async()=>{
 for(const change of [{worldStatus:'archived'},{organizationId:'00000000-0000-4000-8000-000000000001'},{releaseStatus:'frozen'},{membership:{...world.membership,active:false}},{membership:null}])await assert.rejects(inspectAdmissionPrerequisites({...args(),readWorld:async()=>({...world,...change})}));
});
test('deny missing, duplicate, real identity or cross-world participants',async()=>{
 for(const change of [grants.slice(1),[...grants.slice(0,-1),grants[0]],grants.map(g=>({...g,synthetic:false})),grants.map(g=>({...g,worldId:'00000000-0000-4000-8000-000000000001'})),grants.map(g=>({...g,full_name:'someone'}))])await assert.rejects(inspectAdmissionPrerequisites({...args(),readParticipantGrants:async()=>change}));
});
test('deny P2 scope spoofing and network/DB not contacted',async()=>{
 await assert.rejects(inspectAdmissionPrerequisites({...args(),scopeReport:{...scopeReport,teacher_authorized:true}}));
 await assert.rejects(inspectAdmissionPrerequisites({...args(),readTeacherApproval:async()=>{throw Error('offline')}}));
});
