#!/usr/bin/env node
// Opt-in, idempotent FakePlant fixture projection into Orgo's *existing* Prisma models.
// This is not a Kristal live mount, not an HTTP endpoint, and does not export host deltas.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { stat } from 'node:fs/promises';

const here = dirname(fileURLToPath(import.meta.url));
const roots = [
  process.env.FAKEPLANT_FIXTURE_ROOT,
  resolve(here, '../../../../../Konnaxion/Konnaxion_Worlds/universes/fakeplant/fixture'),
  resolve(here, '../../../../Orgo_Worlds/fakeplant/fixture'),
  resolve(here, '../../../../Orgo_Worlds/world-packs/fakeplant/fixture'),
].filter(Boolean);
let root;
for (const candidate of roots) {
  try { if ((await stat(resolve(candidate, 'MANIFEST.json'))).isFile()) { root = resolve(candidate); break; } }
  catch { /* candidate not mounted */ }
}
if (!root) throw new Error('FakePlant fixture missing: set FAKEPLANT_FIXTURE_ROOT or install canonical Konnaxion_Worlds fixture');
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
if ([...args].some(a => !['--apply','--confirm-fakeplant','--preview','--check-db'].includes(a))) {
  throw new Error('Usage: node apps/api/scripts/fakeplant-people.mjs [--apply --confirm-fakeplant]');
}
if (args.has('--apply') && (args.has('--preview') || args.has('--check-db'))) {
  throw new Error('Mode conflit: --apply ne se combine pas avec --preview ou --check-db');
}
const people = await validate();
// Reject divergent copies if the sibling Orgo_Worlds fixture exists.
const mirror = resolve(here, '../../../../Orgo_Worlds/fakeplant/fixture');
if (mirror !== root) {
  try {
    const other = await readFile(resolve(mirror, 'employes.json'));
    const original = await readFile(resolve(root, 'employes.json'));
    if (createHash('sha256').update(other).digest('hex') !== createHash('sha256').update(original).digest('hex'))
      throw new Error('FakePlant identity drift: Konnaxion_Worlds and Orgo_Worlds fixtures differ');
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
}
console.log(`FAKEPLANT PREVIEW: ${people.length} disabled, synthetic identities; no password / no invitations`);
console.log('Fixture:', root);
if (!args.has('--apply') && !args.has('--check-db')) {
  console.log('READ ONLY. Aucun compte cree. Importer uniquement via le lanceur Docker confirme.');
} else {
  const expectedUuid = (process.env.FAKEPLANT_EXPECTED_ORGO_UUID || '').trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(expectedUuid)) {
    throw new Error('FAKEPLANT_EXPECTED_ORGO_UUID requis et valide');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required (containeur API Orgo)');
  if (args.has('--apply') && !args.has('--confirm-fakeplant')) {
    throw new Error('Explicit --confirm-fakeplant required');
  }
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient();
  try {
    if (args.has('--check-db')) {
      const state = await db.$transaction(async tx => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const organization = await tx.organization.findUnique({
          where: {slug: 'fakeplant'}, select: {id: true, status: true}
        });
        if (!organization || organization.id.toLowerCase() !== expectedUuid || organization.status !== 'active') {
          throw new Error('Organisation FakePlant absente, inactive ou UUID different');
        }
        const filter = {organization_id: organization.id};
        return {
          tenant: 'fakeplant', organization_id: organization.id,
          utilisateurs: await tx.userAccount.count({where: filter}),
          utilisateurs_disabled: await tx.userAccount.count({where: {...filter, status:'disabled'}}),
          profils: await tx.personProfile.count({where: filter}),
          dossiers: await tx.case.count({where: filter}),
          taches: await tx.task.count({where: filter}),
          lecture_seule: true,
        };
      });
      console.log(JSON.stringify({ok:true, ...state}, null, 2));
    } else {
      const result = await db.$transaction(async tx => {
      const organization = await tx.organization.findUnique({where: {slug: 'fakeplant'}});
      if (!organization) throw new Error('Tenant fakeplant absent: creation automatique interdite');
      if (organization.id.toLowerCase() !== expectedUuid) {
        throw new Error('UUID tenant inattendu: import interdit');
      }
      if (organization.status !== 'active') {
        throw new Error('Tenant fakeplant inactif: import interdit');
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
      return {organization:organization.slug, organization_id: organization.id, created, reused, profilesCreated};
    }, { maxWait: 20000, timeout: 180000 });
      console.log(JSON.stringify({ok: true, ...result, note: 'Identites uniquement, pas de workflows ni ACL'}, null, 2));
    }
  } finally {
    await db.$disconnect();
  }
}
