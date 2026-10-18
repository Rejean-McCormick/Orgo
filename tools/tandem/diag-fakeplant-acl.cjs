'use strict';
// Lecture seule depuis le conteneur API Orgo : aucune creation de compte / role / token.
const { PrismaClient } = require('@prisma/client');
const EXPECTED_UUID = '0c2d7244-a0c0-4a10-8f11-0389f275f133';
const db = new PrismaClient();

(async () => {
  try {
    const result = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const organization = await tx.organization.findUnique({
        where: { slug: 'fakeplant' },
        select: { id: true, slug: true, status: true },
      });
      if (!organization || organization.id !== EXPECTED_UUID || organization.status !== 'active') {
        throw new Error('TENANT_UUID_OU_ETAT_INATTENDU');
      }
      const orgId = organization.id;
      const scope = { organization_id: orgId };
      const [totalUsers, disabledUsers, activeUsers, profiles, roles, roleGrants,
        roleAssignments, tokens, validTokens, sessions, ssoIdentities,
        definitions, published, casesCount, tasksCount, integrations] = await Promise.all([
        tx.userAccount.count({ where: scope }),
        tx.userAccount.count({ where: { ...scope, status: 'disabled' } }),
        tx.userAccount.count({ where: { ...scope, status: 'active' } }),
        tx.personProfile.count({ where: scope }),
        tx.role.count({ where: scope }),
        tx.rolePermission.count({ where: { role: scope } }),
        tx.userRoleAssignment.count({ where: { user: scope, revoked_at: null } }),
        tx.apiToken.count({ where: scope }),
        tx.apiToken.count({ where: { ...scope, OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }] } }),
        tx.loginSession.count({ where: { ...scope, terminated_at: null, expires_at: { gt: new Date() } } }),
        tx.ssoIdentity.count({ where: scope }),
        tx.workflowDefinition.count({ where: scope }),
        tx.workflowVersion.count({ where: { definition: scope } }),
        tx.case.count({ where: scope }),
        tx.task.count({ where: scope }),
        tx.integrationOperation.count({ where: scope }),
      ]);
      return {
        ok: true,
        schema: 'koa.fakeplant-acl-audit/v1',
        tenant: organization.slug,
        organization_id: orgId,
        state: organization.status,
        users: { total: totalUsers, disabled: disabledUsers, active: activeUsers, person_profiles: profiles },
        acl: { roles_tenant: roles, role_permission_grants: roleGrants, active_role_assignments: roleAssignments,
               api_tokens: tokens, api_tokens_not_expired: validTokens, sessions_not_expired: sessions, sso_identities: ssoIdentities },
        operational: { workflow_definitions_tenant: definitions, published_workflow_versions_tenant: published,
                       cases: casesCount, tasks: tasksCount, integration_operations: integrations },
        note: 'Lecture seule. Les nombres ne prouvent pas les ACL effectives ou la connexion API; un test isole reste requis.',
      };
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('[ECHEC] ' + (error.message === 'TENANT_UUID_OU_ETAT_INATTENDU' ?
      'Tenant fakeplant absent ou UUID/etat inattendu.' :
      'Interrogation Prisma refusee (' + (error.code || error.name || 'UNKNOWN') + ').'));
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
})();
