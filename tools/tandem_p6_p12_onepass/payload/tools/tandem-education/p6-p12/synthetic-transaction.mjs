/** P6-P12 one-pass integration rehearsal: in-memory ONLY.
 * This is deliberately NOT an Orgo service, database adapter, controller, authority or publication path.
 */
import {createHash} from 'node:crypto';
const HASH=/^[a-f0-9]{64}$/;
const REF=/^[a-z0-9][a-z0-9-]{0,79}$/;
function deny(why){throw Error('TANDEM_BIGBANG_SANDBOX_DENIED: '+why);}
const obj=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===[...keys].sort().join(',');
export class SyntheticCaseStore {
 #committed = new Map(); #byIdempotency = new Map(); #pending = new Map();
 async transact({plan,requestId,actor,approval,grants,failAt=-1}={}){
   if(typeof requestId!=='string'||!REF.test(requestId))deny('invalid idempotency key');
   if(!plan||plan.status!=='REVIEW_ONLY'||plan.runtime_admitted!==false||plan.dispatch_allowed!==false||plan.may_publish_to_child!==false||plan.workflow_published!==false||plan.task_count!==11||!Array.isArray(plan.task_refs)||plan.task_refs.length!==11)deny('only pinned 11 step review plan');
   if(!obj(actor,['source','userId','tenantId','worldId'])||actor.source!=='synthetic-memory'||!REF.test(actor.userId)||actor.tenantId!==plan.tenant_id||actor.worldId!==plan.world_id)deny('synthetic teacher context required');
   if(!obj(approval,['source','status','tenantId','worldId','releaseId','scenarioRef'])||approval.source!=='synthetic-memory'||approval.status!=='approved'||approval.tenantId!==plan.tenant_id||approval.worldId!==plan.world_id||approval.releaseId!==plan.world_release_id||approval.scenarioRef!==plan.scenario_ref)deny('mock approval denied');
   if(!Array.isArray(grants)||grants.length!==11||grants.some(g=>!obj(g,['taskRef','source','active','worldId'])||g.source!=='synthetic-memory'||g.active!==true||g.worldId!==plan.world_id))deny('mock grants denied');
   if(plan.task_refs.some((r,i)=>!REF.test(r)||grants[i].taskRef!==r)||new Set(plan.task_refs).size!==11)deny('task reference mismatch');
   const digest=createHash('sha256').update(JSON.stringify({plan,actor,approval,grants})).digest('hex');
   const key=plan.tenant_id+'/'+requestId;
   const remembered=this.#byIdempotency.get(key);
   if(remembered && remembered.digest!==digest)deny('idempotency key reused with different request');
   if(remembered)return structuredClone(this.#committed.get(remembered.caseId));
   if(this.#pending.has(key)){const pending=this.#pending.get(key);if(pending.digest!==digest)deny('concurrent idempotency collision');return pending.promise.then(v=>structuredClone(v));}
   const task=this.#execute(key,digest,plan,failAt);
   this.#pending.set(key,{digest,promise:task});
   try{return structuredClone(await task);} finally{this.#pending.delete(key);}
 }
 async #execute(key,digest,plan,failAt){
   // No real DB or Orgo repositories: prepare everything privately and commit atomically to a JS Map.
   const caseId='synthetic-'+createHash('sha256').update(key+digest).digest('hex').slice(0,22);
   const tasks=[],events=[];
   for(let i=0;i<plan.task_refs.length;i++){
      if(i===failAt)deny('fault injected; no commit');
      const ref=plan.task_refs[i];
      tasks.push({task_ref:ref,status:'pending',synthetic:true});
      events.push({kind:'task_planned',task_ref:ref,case_id:caseId});
   }
   if(failAt===11)deny('transaction aborted at final step');
   const value={case_id:caseId,scenario_ref:plan.scenario_ref,organization_id:plan.tenant_id,world_id:plan.world_id,release_id:plan.world_release_id,
      status:'SYNTHETIC_IN_MEMORY_ONLY',tasks,events,case_count:1,task_count:11,app_db_writes:0,network_calls:0,runtime_admitted:false,dispatch_allowed:false,may_publish_to_child:false};
   this.#committed.set(caseId,value);this.#byIdempotency.set(key,{digest,caseId});
   return value;
 }
 get count(){return this.#committed.size;}
 get taskCount(){return [...this.#committed.values()].reduce((n,c)=>n+c.tasks.length,0);}
}
/** Ekole-like teacher projection used only to assert boundary invariants. NOT Ekole runtime code. */
export function projectSyntheticTeacher(caseRecord,viewer){
 if(!caseRecord||caseRecord.status!=='SYNTHETIC_IN_MEMORY_ONLY'||caseRecord.runtime_admitted!==false)deny('not an in-memory case');
 if(!obj(viewer,['source','role','tenantId','worldId'])||viewer.source!=='synthetic-memory'||viewer.role!=='teacher'||viewer.tenantId!==caseRecord.organization_id||viewer.worldId!==caseRecord.world_id)deny('teacher view denied');
 if(!Array.isArray(caseRecord.tasks)||caseRecord.tasks.length!==11||caseRecord.tasks.some(t=>!t.synthetic))deny('invalid synthetic tasks');
 return {format:'ekole.tandem-synthetic-teacher-projection/1.0',status:'PREVIEW_ONLY',scenario_ref:caseRecord.scenario_ref,task_count:caseRecord.tasks.length,
   task_refs:caseRecord.tasks.map(t=>t.task_ref),runtime_admitted:false,child_access:false,pii_included:false,workflow_published:false};
}
export function assertNoRuntime(w){
 if(!w || w.runtime_admitted!==false||w.dispatch_allowed!==false||w.may_publish_to_child!==false||w.app_db_writes!==0||w.network_calls!==0)deny('runtime flag or side effect asserted');
}
