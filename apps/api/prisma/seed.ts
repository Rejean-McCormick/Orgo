import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { passwordHash } from '../src/orgo/modules/identity/identity.service';

async function seed() {
  const password = process.env.ORGO_ADMIN_PASSWORD;
  if (!password || password.length < 12)
    throw new Error('Set ORGO_ADMIN_PASSWORD to at least 12 characters.');
  const db = new PrismaClient();
  try {
    const slug = process.env.ORGO_ORGANIZATION ?? 'orgo';
    const email = (
      process.env.ORGO_ADMIN_EMAIL ?? 'admin@example.test'
    ).toLowerCase();
    const digest = await passwordHash(password);
    await db.$transaction(async (tx) => {
      const organization = await tx.organization.upsert({
        where: { slug },
        create: {
          slug,
          display_name: process.env.ORGO_ORGANIZATION_NAME ?? 'Orgo',
          status: 'active',
          timezone: 'UTC',
          default_locale: 'en-CA',
        },
        update: {
          default_locale: 'en-CA',
        },
      });
      const user = await tx.userAccount.upsert({
        where: {
          organization_id_email: { organization_id: organization.id, email },
        },
        create: {
          organization_id: organization.id,
          email,
          display_name: 'Administrator',
          password_hash: digest,
          auth_provider: 'local',
          status: 'active',
        },
        update: {
          display_name: 'Administrator',
        },
      });
      const role = await tx.role.upsert({
        where: {
          organization_id_code: {
            organization_id: organization.id,
            code: 'administrator',
          },
        },
        create: {
          organization_id: organization.id,
          code: 'administrator',
          display_name: 'Administrator',
          description: 'Orgo administration',
          is_system_role: true,
        },
        update: {
          display_name: 'Administrator',
          description: 'Orgo administration',
        },
      });
      const permission = await tx.permission.upsert({
        where: { code: '*' },
        create: { code: '*', description: 'All organization permissions' },
        update: {},
      });
      if (
        !(await tx.rolePermission.findFirst({
          where: { role_id: role.id, permission_id: permission.id },
        }))
      )
        await tx.rolePermission.create({
          data: {
            role_id: role.id,
            permission_id: permission.id,
            granted_at: new Date(),
          },
        });
      if (
        !(await tx.userRoleAssignment.findFirst({
          where: { user_id: user.id, role_id: role.id, revoked_at: null },
        }))
      )
        await tx.userRoleAssignment.create({
          data: {
            user_id: user.id,
            role_id: role.id,
            assigned_at: new Date(),
            scope_type: 'global',
          },
        });
      await tx.organizationProfile.upsert({
        where: { organization_id: organization.id },
        create: {
          organization_id: organization.id,
          profile_code: 'general',
          version: 1,
          reactivity_profile: { default_seconds: 43200 },
          transparency_profile: {},
          pattern_sensitivity_profile: {},
          retention_profile: {},
        },
        update: {},
      });
    });
    console.log(
      'Organization and administrator provisioned. Existing passwords are preserved.',
    );
  } finally {
    await db.$disconnect();
  }
}
seed().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
