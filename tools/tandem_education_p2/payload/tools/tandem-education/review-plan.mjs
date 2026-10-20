/** Read-only Orgo review planner for synthetic classroom missions. No API/DB imports. */
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
const DENY=['runtime_admitted','teacher_authorized','permissions_verified','world_release_verified','dispatch_allowed','may_publish_to_child'];
function fail(msg){throw Error('ORGO_TANDEM_REVIEW_DENIED: '+msg);}
function strict(v,keys){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==[...keys].sort().join(','))fail('unknown/missing fields');}
function checkUuid(v){return typeof v==='string'&&UUID.test(v)&&v!=='00000000-0000-0000-0000-000000000000';}
export function reviewPlan(intent,scope,intentBytes){
 strict(intent,['format','mode','authority','scenario_ref','workflow_ref','tenant_id','world_id','world_release_id',
  'source_sha256','preview_sha256','tasks',...DENY]);
 if(intent.format!=='akor.tandem-execution-intent/1.0'||intent.mode!=='synthetic'||intent.authority!=='orgo')fail('wrong intent');
 strict(scope,['format','mode','authority','scenario_ref','tenant_id','world_id','world_release_id',
  'intent_sha256','scope_consistent',...DENY]);
 if(scope.format!=='orgo-worlds.tandem-scope-review/1.0'||scope.mode!=='synthetic'||scope.authority!=='orgo'||scope.scope_consistent!==true)fail('wrong scope report');
 for(const k of DENY)if(intent[k]!==false||scope[k]!==false)fail('fake authority claim');
 for(const k of ['tenant_id','world_id','world_release_id'])if(!checkUuid(intent[k])||scope[k]!==intent[k])fail('cross-scope mismatch');
 for(const k of ['source_sha256','preview_sha256'])if(typeof intent[k]!=='string'||!SHA.test(intent[k]))fail('invalid provenance hash');
 if(scope.scenario_ref!==intent.scenario_ref)fail('scenario mismatch');
 if(typeof scope.intent_sha256!=='string'||scope.intent_sha256!==createHash('sha256').update(intentBytes).digest('hex'))fail('stale or altered intent');
 for(const k of ['scenario_ref','workflow_ref'])if(typeof intent[k]!=='string'||!/^[a-z0-9][a-z0-9-]{0,79}$/.test(intent[k]))fail('bad identifier');
 if(!Array.isArray(intent.tasks)||intent.tasks.length<1||intent.tasks.length>50)fail('task bound');
 const ids=new Set();
 for(const t of intent.tasks){
   strict(t,['task_ref','role_code']);
   for(const k of ['task_ref','role_code'])if(typeof t[k]!=='string'||!/^[a-z0-9][a-z0-9-]{0,79}$/.test(t[k]))fail('invalid task/role');
   if(ids.has(t.task_ref))fail('duplicate task');ids.add(t.task_ref);
 }
 return {format:'orgo.tandem-synthetic-review-plan/1.0',status:'REVIEW_ONLY',
   scenario_ref:intent.scenario_ref,workflow_ref:intent.workflow_ref,tenant_id:intent.tenant_id,
   world_id:intent.world_id,world_release_id:intent.world_release_id,
   task_count:intent.tasks.length,planned_case_count:1,planned_task_count:intent.tasks.length,
   task_refs:intent.tasks.map(t=>t.task_ref),
   runtime_admitted:false,teacher_authorized:false,permissions_verified:false,
   world_release_verified:false,dispatch_allowed:false,may_publish_to_child:false,
   workflow_published:false,db_writes:0,network_calls:0};
}
/** Refuse duplicate keys at every nesting level before JSON.parse; bound depth. */
export function parseStrictJson(text) {
 let pos=0;
 const ws=()=>{while(pos<text.length && /\s/.test(text[pos]))pos++;};
 const readString=()=>{
   if(text[pos]!=='"')throw Error('JSON string expected');
   const start=pos++;
   for(;pos<text.length;pos++) {
     if(text[pos]==='\\') {pos++;continue;}
     if(text[pos]==='"') {pos++;return JSON.parse(text.slice(start,pos));}
   }
   throw Error('Incomplete JSON string');
 };
 function scan(depth){
   if(depth>32)throw Error('JSON nesting too deep');
   ws();
   if(text[pos]==='{'){
     pos++;ws();const seen=new Set();
     if(text[pos]==='}') {pos++;return;}
     while(true){
       ws();const key=readString();
       if(seen.has(key))throw Error('Duplicate JSON key: '+key);
       seen.add(key);ws();
       if(text[pos++]!==':')throw Error('JSON colon expected');
       scan(depth+1);ws();
       const sep=text[pos++];if(sep==='}')return;if(sep!==',')throw Error('JSON object delimiter expected');
     }
   }
   if(text[pos]==='['){
     pos++;ws();if(text[pos]===']'){pos++;return;}
     while(true){scan(depth+1);ws();const sep=text[pos++];if(sep===']')return;if(sep!==',')throw Error('JSON array delimiter expected');}
   }
   if(text[pos]==='"'){readString();return;}
   const value=text.slice(pos).match(/^(?:true|false|null|-(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
   if(!value)throw Error('Invalid JSON literal');
   pos+=value[0].length;
 }
 scan(0);ws();if(pos!==text.length)throw Error('Unexpected data after JSON');
 return JSON.parse(text);
}
export function readSmallJson(path){
 const s=fs.lstatSync(path);
 if(!s.isFile()||s.isSymbolicLink()||s.size<1||s.size>262144)fail('invalid local file');
 const bytes=fs.readFileSync(path);
 return {body:parseStrictJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),bytes};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.argv.length!==4)fail('Usage: node review-plan.mjs INTENT_JSON SCOPE_REPORT_JSON');
  const intent=readSmallJson(process.argv[2]), scope=readSmallJson(process.argv[3]);
  console.log(JSON.stringify(reviewPlan(intent.body,scope.body,intent.bytes),null,2));
 }catch(e){console.error('[REFUS]',e.message);process.exitCode=1;}
}
