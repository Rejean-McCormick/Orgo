#!/usr/bin/env node
// Opt-in, idempotent FakePlant fixture projection into Orgo's *existing* Prisma models.
// This is not a Kristal live mount, not an HTTP endpoint, and does not export host deltas.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../../Orgo_Worlds/fakeplant/fixture');
const load = async name => JSON.parse(await readFile(resolve(root, name), 'utf8'));
async function validate() {
  const manifest = await load('MANIFEST.json');
  for (const [filename, expected] of Object.entries(manifest.sha256 ?? {})) {
    const bytes = await readFile(resolve(root, filename));
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (hash !== expected) throw new Error(`Fixture integrity mismatch: ${filename}`);
  }
  const people = (await load('employes.json')).employees;
  if (people?.length !== 900) throw new Error('Expected exactly 900 synthetic people');
  const ids = new Set(), emails = new Set();
  for (const p of people) {
    if (p.synthetic !== true || p.login_enabled !== false || p.orgo_identity !== 'external_only' ||
        p.security?.orgo_status !== 'disabled' || p.security?.no_password !== true ||
        !p.email.endsWith('@fakeplant.example.test') || ids.has(p.id) || emails.has(p.email)) {
      throw new Error(`Unsafe or duplicated identity: ${p.id}`);
    }
    ids.add(p.id); emails.add(p.email);
  }
  return people;
}

const args = new Set(process.argv.slice(2));
if ([...args].some(a => !['--apply','--confirm-fakeplant','--preview'].includes(a))) {
  throw new Error('Usage: node apps/api/scripts/fakeplant-people.mjs [--apply --confirm-fakeplant]');
}
const people = await validate();
console.log(`FAKEPLANT PREVIEW: ${people.length} disabled, synthetic identities; no password / no invitations`);
if (!args.has('--apply')) {
  console.log('READ ONLY. Run with --apply --confirm-fakeplant to write to the local Orgo database.');
} else {
  if (!args.has('--confirm-fakeplant')) throw new Error('Explicit --confirm-fakeplant required');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient();
  try {
    const result = await db.$transaction(async tx => {
      let organization = await tx.organization.findUnique({ where: {slug: 'fakeplant'} });
      if (!organization) {
        organization = await tx.organization.create({data: {
          slug: 'fakeplant', display_name: 'FakePlant — Simulation industrielle',
          status: 'active', timezone: 'America/Toronto', default_locale: 'fr-CA',
        }});
      } else if (organization.status !== 'active') {
        throw new Error('Existing FakePlant organization inactive; refusing to change status');
      }
      let created = 0, reused = 0, profilesCreated = 0;
      for (const person of people) {
        const email = person.email.toLowerCase();
        let user = await tx.userAccount.findUnique({
          where: { organization_id_email: { organization_id: organization.id, email } },
        });
        if (user && (user.status !== 'disabled' || user.auth_provider !== 'external_only' || user.password_hash !== null)) {
          throw new Error(`Existing account collision: ${email}`);
        }
        if (!user) {
          user = await tx.userAccount.create({data: {
            organization_id: organization.id, email, display_name: person.display_name,
            auth_provider: 'external_only', status: 'disabled', password_hash: null,
          }});
          created++;
        } else reused++;
        const profiles = await tx.personProfile.findMany({where: {
          organization_id: organization.id, external_reference: person.id,
        }});
        if (profiles.length > 1 || (profiles.length === 1 && profiles[0].linked_user_id !== user.id)) {
          throw new Error(`Portable ID collision / multiple matches: ${person.id}`);
        }
        if (!profiles.length) {
          await tx.personProfile.create({data: {
            organization_id: organization.id, linked_user_id: user.id,
            external_reference: person.id, full_name: person.display_name,
            confidentiality_level: 'normal',
          }});
          profilesCreated++;
        }
      }
      return {organization:organization.slug, created, reused, profilesCreated};
    }, { maxWait: 20000, timeout: 180000 });
    console.log(JSON.stringify({ok: true, ...result, note: 'Identity projection ONLY — not cases or live export'}, null, 2));
  } finally {
    await db.$disconnect();
  }
}
