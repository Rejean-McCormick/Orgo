import { PrismaClient } from "@prisma/client";
// Read-only report. Run against the legacy database before applying the new migrations.
const db = new PrismaClient();
try {
  const checks = {
    task_case_tenant:
      await db.$queryRaw`SELECT t.id FROM tasks t JOIN cases c ON c.id=t.case_id WHERE t.organization_id<>c.organization_id LIMIT 100`,
    task_owner_tenant:
      await db.$queryRaw`SELECT t.id FROM tasks t JOIN user_accounts u ON u.id=t.owner_user_id WHERE t.organization_id<>u.organization_id LIMIT 100`,
    hr_subject_tenant:
      await db.$queryRaw`SELECT h.id FROM hr_cases h JOIN person_profiles p ON p.id=h.subject_person_id WHERE h.organization_id<>p.organization_id LIMIT 100`,
    education_membership_tenant:
      await db.$queryRaw`SELECT m.id FROM learning_group_memberships m JOIN learning_groups g ON g.id=m.learning_group_id JOIN person_profiles p ON p.id=m.person_id WHERE g.organization_id<>p.organization_id LIMIT 100`,
    invalid_calendar_interval:
      await db.$queryRaw`SELECT id FROM maintenance_calendar_slots WHERE end_at<=start_at LIMIT 100`,
    legacy_credentials:
      await db.$queryRaw`SELECT id FROM user_accounts WHERE auth_provider='local' AND (password_hash IS NULL OR password_hash NOT LIKE 'scrypt:%') LIMIT 100`,
  };
  console.log(
    JSON.stringify(
      { generated_at: new Date().toISOString(), sample_limit: 100, checks },
      null,
      2,
    ),
  );
  if (Object.values(checks).some((rows) => rows.length)) process.exitCode = 2;
} finally {
  await db.$disconnect();
}
