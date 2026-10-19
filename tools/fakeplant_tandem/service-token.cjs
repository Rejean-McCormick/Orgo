'use strict';
// Local operator bootstrap only. The token secret stays on Windows; Docker receives its SHA-256 only.
const { PrismaClient } = require('@prisma/client');
const ORG = '0c2d7244-a0c0-4a10-8f11-0389f275f133';
const SLUG = 'fakeplant';
const NAME = 'koa.fakeplant.fp-s01-scoped-v1';
const SCOPES = ['work:read', 'work:write'];
const action = process.argv[2];
if (!['--preview', '--create'].includes(action)) {
  console.error('[ECHEC] Utiliser --preview ou --create.'); process.exit(2);
}
const digest = process.env.KOA_FAKEPLANT_TOKEN_SHA256 ?? '';
if (action === '--create' && !/^[0-9a-f]{64}$/.test(digest)) {
  console.error('[ECHEC] Empreinte SHA-256 du jeton absente ou invalide.'); process.exit(2);
}
async function verify(tx) {
  const org = await tx.organization.findUnique({where:{slug:SLUG},select:{id:true,status:true}});
  if (!org || org.id !== ORG || org.status !== 'active') throw new Error('Tenant FakePlant inactif, absent ou UUID different : aucune ecriture.');
  const [total, disabled, profiles, otherTokens] = await Promise.all([
    tx.userAccount.count({where:{organization_id:ORG}}),
    tx.userAccount.count({where:{organization_id:ORG,status:'disabled'}}),
    tx.personProfile.count({where:{organization_id:ORG}}),
    tx.apiToken.count({where:{organization_id:ORG}}),
  ]);
  if (total !== 900 || disabled !== 900 || profiles !== 900) throw new Error('Identites FakePlant inattendues (900 disabled / 900 profils requis).');
  if (otherTokens !== 0) throw new Error('Un ou plusieurs jetons FakePlant existent deja : ne pas creer un deuxieme jeton automatiquement.');
  return {tenant:SLUG,organization_id:ORG,comptes:total,comptes_disabled:disabled,profils:profiles,jetons_existants:otherTokens,scopes:SCOPES,expires_after_hours:24};
}
(async()=>{
  const db = new PrismaClient();
  try {
    if (action==='--preview') {
      const details=await db.$transaction(async(tx)=>{ await tx.$executeRaw`SET TRANSACTION READ ONLY`;return verify(tx); });
      console.log(JSON.stringify({ok:true,mode:'preview',ecriture:false,...details},null,2));
      return;
    }
    const expiresAt = new Date(Date.now() + 24*60*60*1000);
    const result=await db.$transaction(async(tx)=>{
      const details=await verify(tx);
      const token=await tx.apiToken.create({
        data:{organization_id:ORG,token_hash:digest,name:NAME,scopes:SCOPES,expires_at:expiresAt,created_by_user_id:null},
        select:{id:true,name:true,expires_at:true,scopes:true},
      });
      await tx.activityLog.create({data:{organization_id:ORG,user_id:null,session_id:null,actor_type:'system',action:'koa.fakeplant.bootstrap_scoped_token',target_type:'api_token',target_id:token.id,details:{purpose:'FP-S01 only / local E2E',scopes:SCOPES,expires_at:expiresAt.toISOString(),operator:'local_docker_bootstrap'}}});
      return {details,token};
    });
    console.log(JSON.stringify({ok:true,created:true,tenant:SLUG,organization_id:ORG,token_id:result.token.id,scopes:SCOPES,expires_at:result.token.expires_at,secret_printed:false,audit_log:true},null,2));
  } catch(err) {
    console.error('[REFUS] '+String(err && err.message || err).slice(0,300));
    process.exitCode=1;
  } finally {await db.$disconnect();}
})();
