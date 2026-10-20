/** P3: deny-by-default *in-process* pre-admission for future authenticated Orgo adapter.
 * NOT a controller, token verifier, workflow dispatcher, policy receipt or approval.
 * Never uses client-supplied approval/World/participant objects as authority.
 * All readers must be server-owned, authenticated and transactional at future wiring.
 * Even when ports pass, this module ONLY returns a DRY-RUN result; NO apply is exposed.
 */
import {createHash} from 'node:crypto';
import {reviewPlan,parseStrictJson} from './review-plan.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA=/^[0-9a-f]{64}$/;
const DENY=['runtime_admitted','teacher_authorized','permissions_verified','world_release_verified','dispatch_allowed','may_publish_to_child'];
const FIELDS=['format','mode','status','authority','scenario_ref','workflow_ref','tenant_id','world_id','world_release_id','intent_sha256','task_count',...DENY];
function refuse(reason){throw Error('ORGO_P3_ADMISSION_DENIED: '+reason);}
function strict(v,keys){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==[...keys].sort().join(','))refuse('untrusted fields');}
function uuid(v){return typeof v==='string'&&UUID.test(v)&&v!=='00000000-0000-0000-0000-000000000000';}
/** No public HTTP handler; invoker must supply Orgo IdentityService-authenticated context. */
export async function inspectAdmissionPrerequisites({intentBytes,scopeReport,authorityRequest,actor,readWorld,readTeacherApproval,readParticipantGrants,nowMs=Date.now()}){
 if(!(intentBytes instanceof Uint8Array)||intentBytes.length<1||intentBytes.length>262144)refuse('intent bytes');
 const intent=parseStrictJson(new TextDecoder('utf-8',{fatal:true}).decode(intentBytes));
 const plan=reviewPlan(intent,scopeReport,intentBytes);
 strict(authorityRequest,FIELDS);
 if(authorityRequest.format!=='akor.tandem-authority-request/1.0'||authorityRequest.status!=='AWAITING_SERVER_VERIFICATION'||authorityRequest.mode!=='synthetic'||authorityRequest.authority!=='orgo')refuse('wrong request');
 for(const f of DENY)if(authorityRequest[f]!==false)refuse('forged authority');
 for(const f of ['tenant_id','world_id','world_release_id','scenario_ref','workflow_ref'])if(authorityRequest[f]!==intent[f])refuse('request scope mismatch');
 if(!SHA.test(authorityRequest.intent_sha256)||authorityRequest.intent_sha256!==createHash('sha256').update(intentBytes).digest('hex')||authorityRequest.task_count!==intent.tasks.length)refuse('stale request or task count');
 // AuthGuard/IdentityService must supply this context; never accept it from JSON body or headers.
 if(!actor||actor.actorType!=='user'||!uuid(actor.actorUserId)||actor.organizationId!==intent.tenant_id||!Array.isArray(actor.permissions)||!actor.permissions.includes('education:admit'))refuse('session actor lacks explicit admission scope');
 if(!Number.isFinite(nowMs)||nowMs<0)refuse('clock invalid');
 if([readWorld,readTeacherApproval,readParticipantGrants].some(fn=>typeof fn!=='function'))refuse('trusted adapter not connected');
 const lookup={actorUserId:actor.actorUserId,organizationId:actor.organizationId,worldId:intent.world_id,worldReleaseId:intent.world_release_id,intentSha256:authorityRequest.intent_sha256,taskRefs:plan.task_refs};
 let world,approval,grants;
 try {
   world=await readWorld(lookup);
   approval=await readTeacherApproval(lookup);
   grants=await readParticipantGrants(lookup);
 }catch{refuse('authority lookup failed');}
 // Verification of untrusted request cannot substitute for server-state lookups.
 if(!world||world.organizationId!==lookup.organizationId||world.worldId!==lookup.worldId||world.releaseId!==lookup.worldReleaseId||world.currentReleaseId!==lookup.worldReleaseId||world.worldStatus!=='active'||world.releaseStatus!=='current'||world.membership?.userId!==lookup.actorUserId||world.membership?.worldId!==lookup.worldId||world.membership?.active!==true||!['owner','maintainer','member'].includes(world.membership.role))refuse('World or membership not current');
 // Teacher approval MUST be server-recorded and bound to actor, scope and exact intent.
 if(!approval||approval.status!=='approved'||approval.teacherUserId!==lookup.actorUserId||approval.organizationId!==lookup.organizationId||approval.worldId!==lookup.worldId||approval.releaseId!==lookup.worldReleaseId||approval.intentSha256!==lookup.intentSha256||!Number.isFinite(approval.issuedAtMs)||!Number.isFinite(approval.expiresAtMs)||approval.issuedAtMs>nowMs||approval.issuedAtMs<nowMs-60000||approval.expiresAtMs<=nowMs||approval.expiresAtMs>approval.issuedAtMs+60000)refuse('missing, stale or mismatched teacher approval');
 // Check individual task coverage; synthetic participant refs only. No child PII accepted.
 if(!Array.isArray(grants)||grants.length!==intent.tasks.length)refuse('missing participant grants');
 const expected=new Set(plan.task_refs),seen=new Set();
 for(const grant of grants){
   if(!grant||Object.keys(grant).sort().join(',')!==['active','organizationId','participantRef','synthetic','taskRef','worldId'].sort().join(',')||grant.synthetic!==true||grant.active!==true||grant.organizationId!==lookup.organizationId||grant.worldId!==lookup.worldId||typeof grant.participantRef!=='string'||!/^[a-z0-9][a-z0-9-]{0,79}$/.test(grant.participantRef)||!expected.has(grant.taskRef)||seen.has(grant.taskRef))refuse('invalid task participant coverage');
   seen.add(grant.taskRef);
 }
 // Even when in-memory mocks pass this is NOT a runtime admission receipt, nor reusable authorization.
 return {format:'orgo.tandem-p3-admission-preflight/1.0',status:'DRY_RUN_ONLY_NO_RUNTIME_ADMISSION',
  scenario_ref:intent.scenario_ref,task_count:plan.task_count,planned_case_count:1,
  trusted_ports_exercised:3, runtime_admitted:false,teacher_authorized:false,
  permissions_verified:false,world_release_verified:false,dispatch_allowed:false,
  may_publish_to_child:false,workflow_published:false,db_writes:0,network_calls:0};
}
