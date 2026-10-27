/** P6-P12 integrated *offline* acceptance campaign; never authorizes or deploys. */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes,createHash,generateKeyPairSync} from 'node:crypto';
import {reviewPlan,parseStrictJson} from '../review-plan.mjs';
import {checkP5WorldsInterop} from '../p5-cross-repo-check.mjs';
import {verifyP5WorldWitness} from '../p5-verified-world.mjs';
import {SyntheticCaseStore,projectSyntheticTeacher,assertNoRuntime} from './synthetic-transaction.mjs';
const deny=m=>{throw Error('TANDEM_BIGBANG_DENIED: '+m);};
const shape=['format','mode','status','authority','scenario_ref','workflow_ref','tenant_id','world_id','world_release_id','intent_sha256','task_count','runtime_admitted','teacher_authorized','permissions_verified','world_release_verified','dispatch_allowed','may_publish_to_child'];
const fixedFlags=['runtime_admitted','teacher_authorized','permissions_verified','world_release_verified','dispatch_allowed','may_publish_to_child'];
export const blockedRuntimePhases=Object.freeze({
 P6:'Service-to-service mTLS transport, deployed peer identity, secret rotation and actual persistent World store not qualified',
 P7:'Persistent, revocable teacher approval and per-task child grants not connected to real authorities',
 P8:'Orgo Nest admission route, durable idempotency and real DB transaction not connected',
 P9:'Orgo workflow runtime, interaction_kernel events and authenticated Ekole view not connected',
 P10:'Full adversarial review, actual revocation races and privacy/legal signoff outstanding',
 P11:'Konnaxion/Konfid/IK/Capsule/Node Agent/diagnostics whole-system regression pending',
 P12:'TypeScript build, DB migrations, service deployment and VPS acceptance pending',
});
function parseRaw(path){const bytes=readFileSync(path);if(bytes.length>262144)deny('oversize local fixture');return {bytes,value:parseStrictJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes))};}
function requestFrom(intent,bytes){return {format:'akor.tandem-authority-request/1.0',mode:'synthetic',status:'AWAITING_SERVER_VERIFICATION',authority:'orgo',scenario_ref:intent.scenario_ref,workflow_ref:intent.workflow_ref,tenant_id:intent.tenant_id,world_id:intent.world_id,world_release_id:intent.world_release_id,intent_sha256:createHash('sha256').update(bytes).digest('hex'),task_count:intent.tasks.length,...Object.fromEntries(fixedFlags.map(f=>[f,false]))};}
export async function runOnePass({worldsRoot,requireRuntime=false}={}){
 if(!worldsRoot||typeof worldsRoot!=='string')deny('installed Worlds repository path required');
 const worlds=resolve(worldsRoot);
 const p5=await checkP5WorldsInterop(worlds);
 if(p5.status!=='PASS_SYNTHETIC_SIGNED_PREFLIGHT_ONLY'||p5.task_count!==11||p5.network_calls!==0)deny('P5 baseline failed');
 const i=parseRaw(fileURLToPath(new URL('../fixtures/fete-sorciere.intent.synthetic.json',import.meta.url)));
 const s=parseRaw(fileURLToPath(new URL('../fixtures/fete-sorciere.scope.synthetic.json',import.meta.url)));
 const plan=reviewPlan(i.value,s.value,i.bytes),request=requestFrom(i.value,i.bytes);
 if(plan.task_count!==11||plan.planned_case_count!==1)deny('scenario mismatch');
 // Actual P6 Worlds bridge code is imported across repositories, called IN PROCESS with mock mTLS data.
 const {createP6TrustedWorldBridge}=await import(pathToFileURL(resolve(worlds,'scripts/tandem-education/p6-p12-trusted-bridge.mjs')).href);
 const actor={actorType:'user',source:'api',actorUserId:'44444444-4444-4444-8444-444444444444',organizationId:plan.tenant_id,permissions:['education:admit']};
 const key=generateKeyPairSync('ed25519'),nowMs=1780000000000,fp=createHash('sha256').update(randomBytes(32)).digest('hex'),challenge=randomBytes(32).toString('base64url');
 const state={organizationId:plan.tenant_id,worldId:plan.world_id,releaseId:plan.world_release_id,currentReleaseId:plan.world_release_id,worldStatus:'active',releaseStatus:'current',membership:{userId:actor.actorUserId,worldId:plan.world_id,active:true,role:'member'}};
 const bridge=createP6TrustedWorldBridge({worldsService:{readTandemEducationScopeInternal:async()=>structuredClone(state)},signingKey:key.privateKey,keyId:'onepass-ephemeral',allowedOrgoPeers:new Map([['orgo-education',fp]])});
 const peerContext={authenticated:true,channel:'mutual-tls',peerName:'orgo-education',peerFingerprintSha256:fp,verifiedAtMs:nowMs-100};
 const envelope=await bridge({authorityRequest:request,actor,challenge,peerContext,nowMs:nowMs-100});
 const expected={organizationId:plan.tenant_id,worldId:plan.world_id,worldReleaseId:plan.world_release_id,actorUserId:actor.actorUserId,intentSha256:request.intent_sha256};
 verifyP5WorldWitness(envelope,{trustedPublicKeys:new Map([['onepass-ephemeral',key.publicKey]]),expected,challenge,nowMs});
 // The bridge contract cannot be bypassed by unauthenticated or header-only input.
 let denied=0;
 for(const bad of [{...peerContext,authenticated:false},{...peerContext,peerFingerprintSha256:'0'.repeat(64)}]){
   try{await bridge({authorityRequest:request,actor,challenge,peerContext:bad,nowMs});}catch{denied++;}
 }
 if(denied!==2)deny('P6 unauthenticated peer accepted');
 const store=new SyntheticCaseStore();
 const mockActor={source:'synthetic-memory',userId:'teacher-synthetic',tenantId:plan.tenant_id,worldId:plan.world_id};
 const approval={source:'synthetic-memory',status:'approved',tenantId:plan.tenant_id,worldId:plan.world_id,releaseId:plan.world_release_id,scenarioRef:plan.scenario_ref};
 const grants=plan.task_refs.map(taskRef=>({taskRef,source:'synthetic-memory',active:true,worldId:plan.world_id}));
 const input={plan,requestId:'fete-sorciere-synthetic-1',actor:mockActor,approval,grants};
 const [caseA,caseB]=await Promise.all([store.transact(input),store.transact(input)]);
 if(caseA.case_id!==caseB.case_id||store.count!==1||store.taskCount!==11)deny('concurrency/idempotence failed');
 assertNoRuntime(caseA);
 const projection=projectSyntheticTeacher(caseA,{source:'synthetic-memory',role:'teacher',tenantId:plan.tenant_id,worldId:plan.world_id});
 if(projection.task_count!==11||projection.pii_included!==false)deny('Ekole projection contract failed');
 // Independent fault-injection target: rollback MUST not commit partial Case/Task.
 const faultStore=new SyntheticCaseStore();let failed=false;
 try{await faultStore.transact({...input,requestId:'fete-sorciere-fault',failAt:6});}catch{failed=true;}
 if(!failed||faultStore.count!==0||faultStore.taskCount!==0)deny('transaction rollback failed');
 for(const bad of [{...approval,status:'revoked'},{...approval,releaseId:'55555555-5555-4555-8555-555555555555'}]){
   try{await new SyntheticCaseStore().transact({...input,approval:bad});}catch{denied++;}
 }
 if(denied!==4)deny('revocation or release mismatch accepted');
 const result={format:'tandem-education.p6-p12-one-pass-synthetic-qualification/1.0',status:'PASS_OFFLINE_SANDBOX_ONLY',
  repositories:['Orgo','Orgo_Worlds'],scenario_ref:plan.scenario_ref,task_count:11,synthetic_case_count:store.count,synthetic_task_count:store.taskCount,
  p5_signed_world_proof_verified:true,p6_mock_mutual_tls_contract_verified:true,p8_atomic_memory_simulated:true,p8_replay_deduplicated:true,p9_teacher_preview_simulated:true,p10_negative_checks_passed:true,
  production_ready:false,runtime_admitted:false,teacher_authorized:false,permissions_verified:false,world_release_verified:false,dispatch_allowed:false,may_publish_to_child:false,db_writes:0,network_calls:0,
  runtime_blockers:blockedRuntimePhases};
 if(requireRuntime)deny('RUNTIME_GATE_BLOCKED: '+Object.keys(blockedRuntimePhases).join(','));
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  const args=process.argv.slice(2);if((args.length!==2 && args.length!==3)||args[0]!=='--worlds'||(args.length===3&&args[2]!=='--require-runtime'))deny('Usage: node one-pass.mjs --worlds WORLDS_ROOT [--require-runtime]');
  console.log(JSON.stringify(await runOnePass({worldsRoot:args[1],requireRuntime:args.includes('--require-runtime')}),null,2));
  console.log('[OK] P6-P12 one-pass SYNTHETIC acceptance; real runtime BLOCKED');
 }catch(e){console.error('[DENIED]',e.message);process.exitCode=1;}
}
