/** P5 CROSS-REPO module-compatibility smoke test with in-memory synthetic state.
 * Absolutely no real WorldsService instantiated, HTTP, DB or workflow execution.
 */
import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {inspectP5SignedWorldPreview} from './p5-signed-world-preview.mjs';
const fail=(m)=>{throw Error('TANDEM_P5_CHAIN_DENIED: '+m);};
export async function checkP5WorldsInterop(worldsRoot){
 if(typeof worldsRoot!=='string'||!worldsRoot)fail('Worlds path required');
 const file=resolve(worldsRoot,'scripts','tandem-education','p5-signed-world-witness.mjs');
 const {issueP5WorldWitness}=await import(pathToFileURL(file).href);
 const intentBytes=readFileSync(new URL('./fixtures/fete-sorciere.intent.synthetic.json',import.meta.url));
 const otherBytes=readFileSync(join(resolve(worldsRoot),'scripts/tandem-education/fixtures/fete-sorciere.intent.synthetic.json'));
 if(!intentBytes.equals(otherBytes))fail('scenario fixture bytes differ');
 const intent=JSON.parse(intentBytes),scopeReport=JSON.parse(readFileSync(new URL('./fixtures/fete-sorciere.scope.synthetic.json',import.meta.url)));
 if(intent.tasks.length!==11)fail('11 step fixture required');
 const hash=createHash('sha256').update(intentBytes).digest('hex');
 const request={format:'akor.tandem-authority-request/1.0',mode:'synthetic',status:'AWAITING_SERVER_VERIFICATION',authority:'orgo',scenario_ref:intent.scenario_ref,workflow_ref:intent.workflow_ref,tenant_id:intent.tenant_id,world_id:intent.world_id,world_release_id:intent.world_release_id,intent_sha256:hash,task_count:intent.tasks.length,...Object.fromEntries(['runtime_admitted','teacher_authorized','permissions_verified','world_release_verified','dispatch_allowed','may_publish_to_child'].map(k=>[k,false]))};
 const actor={actorType:'user',source:'api',actorUserId:'44444444-4444-4444-8444-444444444444',organizationId:intent.tenant_id,permissions:['education:admit']};
 const worldState={organizationId:intent.tenant_id,worldId:intent.world_id,releaseId:intent.world_release_id,currentReleaseId:intent.world_release_id,worldStatus:'active',releaseStatus:'current',membership:{userId:actor.actorUserId,worldId:intent.world_id,active:true,role:'member'}};
 const keys=generateKeyPairSync('ed25519');const nowMs=1780000000000;
 const approval={status:'approved',teacherUserId:actor.actorUserId,organizationId:intent.tenant_id,worldId:intent.world_id,releaseId:intent.world_release_id,intentSha256:hash,issuedAtMs:nowMs-1000,expiresAtMs:nowMs+20000};
 const grants=intent.tasks.map(t=>({taskRef:t.task_ref,participantRef:'synthetic-child',active:true,synthetic:true,organizationId:intent.tenant_id,worldId:intent.world_id}));
 let issued=0;
 const o={enabled:true,identityService:{authenticate:async()=>({...actor})},sessionToken:'s'.repeat(40),tenantId:intent.tenant_id,intentBytes,scopeReport,authorityRequest:request,
   readSignedWorld:async(lookup,challenge)=>{
    issued++;
    if(lookup.intentSha256!==hash||lookup.actorUserId!==actor.actorUserId)fail('incorrect lookup');
    return issueP5WorldWitness({request,actor,worldsService:{readTandemEducationScopeInternal:async()=>structuredClone(worldState)},signingKey:keys.privateKey,keyId:'p5-test',challenge,nowMs:nowMs-100});
   },
   trustedWorldPublicKeys:new Map([['p5-test',keys.publicKey]]),readTeacherApproval:async()=>({...approval}),readParticipantGrants:async()=>grants.map(g=>({...g})),nowMs};
 const preview=await inspectP5SignedWorldPreview(o);
 if(preview.task_count!==11||preview.planned_case_count!==1||preview.runtime_admitted!==false||preview.db_writes!==0||preview.network_calls!==0||issued!==1)fail('non-admitting chain regression');
 let denied=false;
 try{await inspectP5SignedWorldPreview({...o,readTeacherApproval:async()=>({...approval,status:'revoked'})});}catch{denied=true;}
 if(!denied)fail('revoked approval accepted');
 denied=false;
 try{await inspectP5SignedWorldPreview({...o,readSignedWorld:async(l,c)=>issueP5WorldWitness({request,actor,worldsService:{readTandemEducationScopeInternal:async()=>({...worldState,worldStatus:'archived'})},signingKey:keys.privateKey,keyId:'p5-test',challenge:c,nowMs:nowMs-100})});}catch{denied=true;}
 if(!denied)fail('archived World accepted');
 return {format:'tandem-education.p5-cross-repo-offline/1.0',status:'PASS_SYNTHETIC_SIGNED_PREFLIGHT_ONLY',repositories:['Orgo','Orgo_Worlds'],scenario_ref:'fete-sorciere',task_count:11,planned_case_count:1,signed_world_proof_verified:true,negative_authority_checks_passed:true,identity_session_simulated:true,teacher_approval_simulated:true,world_store_simulated:true,interservice_transport_connected:false,teacher_approval_register_connected:false,participant_grants_register_connected:false,runtime_admitted:false,teacher_authorized:false,permissions_verified:false,world_release_verified:false,dispatch_allowed:false,may_publish_to_child:false,db_writes:0,network_calls:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{if(process.argv.length!==3)fail('Usage: node p5-cross-repo-check.mjs WORLDS_REPO');console.log(JSON.stringify(await checkP5WorldsInterop(process.argv[2]),null,2));console.log('[OK] P5 cross repo signed preflight offline PASS');}
 catch(e){console.error('[FAIL]',e.message);process.exitCode=1;}
}
