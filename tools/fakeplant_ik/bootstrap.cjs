'use strict';
// A local operator bootstrap for the API container's CURRENT Orgo DB.
// Docker receives only SHA256 token digests, never bearer secrets.
const fs = require('node:fs');
const { PrismaClient } = require('@prisma/client');
const ORG = '0c2d7244-a0c0-4a10-8f11-0389f275f133';
const PUBLISHER = 'koa.fakeplant.ik-publisher-temp-v1';
const OUTBOUND = 'koa.fakeplant.ik-outbound-v1';
const PUBLISHER_SCOPES = ['workflows:write'];
const OUTBOUND_SCOPES = ['signals:write', 'workflows:execute'];
const MARKER = '__KOA_FP_IK__=';
const mode = process.argv[2];
const filename = process.argv[3];
const digest = process.env.KOA_IK_TOKEN_SHA256 || '';
const validModes = ['audit', 'publisher-create', 'publisher-delete', 'outbound-create', 'outbound-delete'];
if (!validModes.includes(mode) || !filename) { console.error('[REFUS] Arguments invalides'); process.exit(2); }
const write = mode !== 'audit';
if (write && !/^[0-9a-f]{64}$/.test(digest)) { console.error('[REFUS] Empreinte SHA256 manquante'); process.exit(2); }
const workflow = JSON.parse(fs.readFileSync(filename, 'utf8'));
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
const matches = x => canonical(x) === canonical(workflow);
async function getBase(tx) {
  const org = await tx.organization.findUnique({ where: { slug: 'fakeplant' }, select: { id: true, status: true } });
  if (!org || org.id !== ORG || org.status !== 'active') throw Error('FakePlant absent, inactif ou UUID different');
  const [users, disabled, profiles] = await Promise.all([
    tx.userAccount.count({ where: { organization_id: ORG } }),
    tx.userAccount.count({ where: { organization_id: ORG, status: 'disabled' } }),
    tx.personProfile.count({ where: { organization_id: ORG } }),
  ]);
  if (users !== 900 || disabled !== 900 || profiles !== 900) throw Error('Identites FakePlant non conformes');
  const code = process.env.KONNAXION_DECISION_WORKFLOW_CODE?.trim();
  if (!code || !/^[a-z0-9][a-z0-9_-]{0,99}$/.test(code)) throw Error('KONNAXION_DECISION_WORKFLOW_CODE non configure');
  if (process.env.KONNAXION_DECISION_LABEL !== '1.11' ||
      process.env.KONNAXION_DECISION_TYPE !== 'governance_decision' ||
      process.env.KONNAXION_DECISION_CATEGORY !== 'request' ||
      process.env.KONNAXION_DECISION_SEVERITY !== 'MODERATE') throw Error('Routage de decision incompatible avec le workflow de test');
  const def = await tx.workflowDefinition.findUnique({where:{organization_id_code:{organization_id:ORG,code}}, include:{versions:{orderBy:{version:'desc'},take:1}}});
  let status = 'absent';
  if (def) status = (def.is_active && def.versions.length === 1 && matches(def.versions[0].content)) ? 'identique' : 'CONFLIT';
  const tokens = await tx.apiToken.findMany({where:{organization_id:ORG,name:{in:[PUBLISHER,OUTBOUND]}},select:{id:true,name:true,scopes:true,expires_at:true}});
  return {ok:true,tenant:'fakeplant',organization_id:ORG,users,disabled,profiles,
    workflow_code:code,workflow_status:status,workflow_version: def?.versions?.[0]?.version || null,
    publisher_tokens: tokens.filter(x=>x.name===PUBLISHER).length,
    outbound_tokens: tokens.filter(x=>x.name===OUTBOUND).length,
    intended_scopes:OUTBOUND_SCOPES};
}
function report(obj){process.stdout.write(MARKER + JSON.stringify(obj) + '\n');}
(async () => {
  const db = new PrismaClient({log:[]});
  try {
    if (mode === 'audit') {
      const result = await db.$transaction(async tx => {await tx.$executeRaw`SET TRANSACTION READ ONLY`;return getBase(tx);});
      report({...result,read_only:true}); return;
    }
    const result = await db.$transaction(async tx => {
      const base = await getBase(tx);
      if (mode==='publisher-create' || mode==='outbound-create') {
        if (base.workflow_status === 'CONFLIT') throw Error('Workflow existant different : refus');
        if (base.publisher_tokens !== 0 || base.outbound_tokens !== 0) throw Error('Jeton IK/publisher existant : refus de doublon');
        if (mode==='outbound-create' && base.workflow_status !== 'identique') throw Error('Workflow non publie ou different');
        const name=mode==='publisher-create'?PUBLISHER:OUTBOUND;
        const scopes=mode==='publisher-create'?PUBLISHER_SCOPES:OUTBOUND_SCOPES;
        const expires_at=new Date(Date.now() + (mode==='publisher-create'?15:24*60)*60000);
        const token=await tx.apiToken.create({data:{organization_id:ORG,name,token_hash:digest,scopes,expires_at,created_by_user_id:null},select:{id:true,expires_at:true}});
        await tx.activityLog.create({data:{organization_id:ORG,user_id:null,session_id:null,actor_type:'system',action:'koa.fakeplant.ik_token_issued',target_type:'api_token',target_id:token.id,details:{name,scopes,expires_at:expires_at.toISOString(),source:'local_operator'}}});
        return {ok:true,mode,name,token_id:token.id,expires_at:token.expires_at,secret_printed:false};
      }
      const name=mode==='publisher-delete'?PUBLISHER:OUTBOUND;
      const deleted=await tx.apiToken.deleteMany({where:{organization_id:ORG,name,token_hash:digest}});
      if (deleted.count !== 1) throw Error('Jeton a supprimer introuvable ou deja modifie');
      await tx.activityLog.create({data:{organization_id:ORG,user_id:null,session_id:null,actor_type:'system',action:'koa.fakeplant.ik_token_revoked',target_type:'api_token',target_id:null,details:{name,source:'local_operator'}}});
      return {ok:true,mode,name,revoked:1};
    });
    report(result);
  } catch (error) {
    // Never print URLs, database connection strings, credential values or SQL.
    const safe=String(error?.message||'').replace(/[^a-zA-ZÀ-ÿ0-9 _.:,-]/g,' ').slice(0,150);
    report({ok:false,mode,error:safe}); process.exitCode=1;
  } finally {await db.$disconnect();}
})();
