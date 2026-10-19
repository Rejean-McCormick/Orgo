'use strict';
// Requires Orgo API container with @prisma/client. No secret value is accepted.
const fs = require('node:fs');
const {PrismaClient} = require('@prisma/client');
const UUID = '0c2d7244-a0c0-4a10-8f11-0389f275f133';
const TOKEN = 'koa.fakeplant.ik-outbound-v1';
const PUBLISHER = 'koa.fakeplant.ik-e2e-publisher-v1';
const OLD = ['signals:write', 'workflows:execute'];
const NEW = ['signals:write', 'workflows:execute', 'signals:read', 'work:read', 'work:write', 'integrations:write'];
const [mode, oldPath, newPath] = process.argv.slice(2);
const PRINT = '__KOA_E2E_FIX_JSON__=';
function say(value){ console.log(PRINT+JSON.stringify(value)); }
function canonical(value){ if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value); }
function equal(a,b){return canonical(a)===canonical(b);}
function scopesEqual(a,b){return Array.isArray(a)&&a.length===b.length&&[...a].sort().join('|')===[...b].sort().join('|');}
function matchHash(s){return /^[a-f0-9]{64}$/.test(s||'');}
const digest = process.env.KOA_EXPECTED_OUTBOUND_HASH;
const tempDigest = process.env.KOA_TEMP_PUBLISHER_HASH;
(async()=>{
 const db=new PrismaClient({log:[]});
 try {
  if (!['audit','publish-token-create','publish-token-delete','scopes-update'].includes(mode))throw Error('Mode interdit');
  if(!matchHash(digest))throw Error('Empreinte IK manquante');
  const original=JSON.parse(fs.readFileSync(oldPath,'utf8'));
  const updated=JSON.parse(fs.readFileSync(newPath,'utf8'));
  if(!Array.isArray(original.rules)||original.rules.length!==1||!Array.isArray(original.rules[0].actions)||original.rules[0].actions.length!==3)throw Error('Workflow de reference invalide');
  const expected=structuredClone(original); expected.rules[0].actions[2].input.request.external_reference='$signal.id';expected.rules[0].actions[2].input.request.summary={kind:'operational_effect',status:'recorded'};
  if(!equal(expected,updated))throw Error('Workflow V2 modifie : refus');
  async function inspect(tx){
   const org=await tx.organization.findUnique({where:{id:UUID},select:{slug:true,status:true}});
   if(!org||org.slug!=='fakeplant'||org.status!=='active')throw Error('Tenant FakePlant non conforme');
   const [total,disabled,profiles]=await Promise.all([
    tx.userAccount.count({where:{organization_id:UUID}}),
    tx.userAccount.count({where:{organization_id:UUID,status:'disabled'}}),
    tx.personProfile.count({where:{organization_id:UUID}})
   ]);
   if(total!==900||disabled!==900||profiles!==900)throw Error('Personas non conformes');
   const code=(process.env.KONNAXION_DECISION_WORKFLOW_CODE||'').trim();
   if(code!=='konnaxion_decision_v1')throw Error('Code de workflow inattendu');
   const workflow=await tx.workflowDefinition.findUnique({where:{organization_id_code:{organization_id:UUID,code}},include:{versions:{orderBy:{version:'desc'},take:3}}});
   if(!workflow||!workflow.is_active)throw Error('Workflow non actif');
   const versions=workflow.versions;
   const isOld=workflow.version===1&&versions.length===1&&versions[0].version===1&&equal(versions[0].content,original);
   const isNew=workflow.version===2&&versions.length===2&&versions[0].version===2&&equal(versions[0].content,updated)&&versions[1].version===1&&equal(versions[1].content,original);
   if(!isOld&&!isNew)throw Error('Workflow ou versions differents : refus');
   const outbound=await tx.apiToken.findMany({where:{organization_id:UUID,name:TOKEN},select:{id:true,token_hash:true,scopes:true,expires_at:true}});
   if(outbound.length!==1||outbound[0].token_hash!==digest)throw Error('Jeton IK existant non conforme');
   if(!outbound[0].expires_at||outbound[0].expires_at.getTime()<=Date.now()+300000)throw Error('Jeton IK expire ou expire dans moins de cinq minutes');
   const isOldScopes=scopesEqual(outbound[0].scopes,OLD);
   const isNewScopes=scopesEqual(outbound[0].scopes,NEW);
   if(!isOldScopes&&!isNewScopes)throw Error('Permissions existantes inattendues');
   const publishers=await tx.apiToken.findMany({where:{organization_id:UUID,name:PUBLISHER},select:{id:true,token_hash:true}});
   if(publishers.length>1)throw Error('Jetons publisher multiples');
   return {outbound:outbound[0],publishers,workflow:isOld?'v1':'v2',scopes:isOldScopes?'initial':'e2e',expires_at:outbound[0].expires_at.toISOString(),total,disabled};
  }
  let result;
  if(mode==='audit'){
   result=await db.$transaction(async tx=>{await tx.$executeRaw`SET TRANSACTION READ ONLY`;const s=await inspect(tx);if(s.publishers.length)throw Error('Jeton de publication provisoire deja present');return {ok:true,mode:'audit',tenant:'fakeplant',workflow:s.workflow,scopes:s.scopes,expires_at:s.expires_at,disabled:s.disabled,read_only:true};});
  }else{
   if(mode.startsWith('publish-token-')&&!matchHash(tempDigest))throw Error('Empreinte jeton de publication manquante');
   result=await db.$transaction(async tx=>{
    const s=await inspect(tx);
    if(mode==='publish-token-create'){
     if(s.workflow!=='v1'||s.publishers.length)throw Error('Publication deja commencee ou terminee');
     const expiresAt=new Date(Date.now()+15*60000);
     const token=await tx.apiToken.create({data:{organization_id:UUID,name:PUBLISHER,token_hash:tempDigest,scopes:['workflows:write'],expires_at:expiresAt,created_by_user_id:null}});
     await tx.activityLog.create({data:{organization_id:UUID,user_id:null,session_id:null,actor_type:'system',action:'koa.fakeplant.e2e_publisher_created',target_type:'api_token',target_id:token.id,details:{expires_at:expiresAt.toISOString(),scopes:['workflows:write']}}});
     return {ok:true,mode,publisher_created:true};
    }
    if(mode==='publish-token-delete'){
     if(s.publishers.length!==1||s.publishers[0].token_hash!==tempDigest)throw Error('Jeton de publication non conforme');
     await tx.apiToken.delete({where:{id:s.publishers[0].id}});
     await tx.activityLog.create({data:{organization_id:UUID,user_id:null,session_id:null,actor_type:'system',action:'koa.fakeplant.e2e_publisher_revoked',target_type:'api_token',target_id:s.publishers[0].id,details:{}}});
     return {ok:true,mode,publisher_revoked:true};
    }
    if(s.publishers.length)throw Error('Jeton publisher toujours present');
    if(s.workflow!=='v2')throw Error('Workflow V2 non publie');
    if(s.scopes==='initial'){
     await tx.apiToken.update({where:{id:s.outbound.id},data:{scopes:NEW}});
     await tx.activityLog.create({data:{organization_id:UUID,user_id:null,session_id:null,actor_type:'system',action:'koa.fakeplant.ik_e2e_scopes_updated',target_type:'api_token',target_id:s.outbound.id,details:{scopes:NEW,expires_at:s.expires_at}}});
    }
    return {ok:true,mode,scopes:s.scopes==='initial'?'e2e-added':'already-e2e',expires_at:s.expires_at};
   });
  }
  say(result);
 }catch(error){
  const safe=String(error?.message||'erreur').replace(/[^a-zA-ZÀ-ÿ0-9 _.:,-]/g,' ').slice(0,190);
  say({ok:false,mode,error:safe});process.exitCode=1;
 }finally{await db.$disconnect();}
})();
