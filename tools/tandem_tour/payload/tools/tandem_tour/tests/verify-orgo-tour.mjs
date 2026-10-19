/** Offline, read-only regression contracts. Run with Node >=22 and --experimental-strip-types. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = (p) => readFileSync(path.join(root, p), 'utf8');
const policy = await import(new URL('../../../apps/api/src/orgo/modules/identity/local-autologin-policy.ts', import.meta.url));
const allow = policy.localAutoLoginAllowed;
const dev = {NODE_ENV:'development',ORGO_LOCAL_AUTO_LOGIN:'true',ORGO_PUBLIC_URL:'http://localhost:3000'};
test('production denies passwordless login irrespective of public URL', () => {
  for (const peer of ['127.0.0.1','::1','::ffff:127.0.0.1'])
    assert.equal(allow({...dev,NODE_ENV:'production'},peer),false);
});
test('autologin remains disabled by default', () => {
  assert.equal(allow({...dev,ORGO_LOCAL_AUTO_LOGIN:'false'},'127.0.0.1'),false);
  assert.equal(allow({...dev,ORGO_LOCAL_AUTO_LOGIN:undefined},'127.0.0.1'),false);
});
test('autologin needs local direct TCP peer', () => {
  for (const peer of ['172.18.0.1','192.168.1.2','198.51.100.3','']) assert.equal(allow(dev,peer),false);
});
test('dev loopback HTTP remains explicit and tightly scoped', () => {
  for (const peer of ['127.0.0.1','::1','::ffff:127.0.0.1']) assert.equal(allow(dev,peer),true);
});
test('autologin fails closed without valid explicit loopback origin', () => {
  for (const url of ['', 'not-url','https://example.test','http://example.test','http://u:p@localhost','http://localhost/#fragment'])
    assert.equal(allow({...dev,ORGO_PUBLIC_URL:url},'127.0.0.1'),false);
});
test('controller relies on direct socket peer, never a spoofable header', () => {
  const auth=src('apps/api/src/orgo/adapters/inbound/http/auth.controller.ts');
  assert.match(auth,/localAutoLoginAllowed\(process\.env, req\.socket\.remoteAddress\)/);
  assert.doesNotMatch(auth,/localAutoLoginAllowed\(process\.env, req\.ip\)/);
});
test('SSO OIDC is still explicitly linked by issuer and subject', () => {
  const oidc=src('apps/api/src/orgo/modules/identity/oidc.service.ts');
  assert.match(oidc,/issuer:\s*config\.issuer,/);
  assert.match(oidc,/subject:\s*claims\.sub,/);
  assert.match(oidc,/if \(!link\) throw fail\(\)/);
});
test('legacy OIDC link cannot bypass synthetic / disabled account guard', () => {
  const oidc=src('apps/api/src/orgo/modules/identity/oidc.service.ts');
  const index=oidc.indexOf('const human = await this.db.userAccount.findFirst');
  const session=oidc.lastIndexOf('return this.identity.session');
  assert.ok(index>0 && session>index);
  const check=oidc.slice(index,session);
  assert.match(check,/organization_id:\s*attempt\.organization_id/);
  assert.match(check,/status:\s*'active'/);
  assert.match(check,/auth_provider:\s*\{\s*not:\s*'external_only'\s*\}/);
  assert.match(check,/organization:\s*\{\s*status:\s*'active'\s*\}/);
  assert.match(check,/if \(!human\) throw fail\(\)/);
});
test('default staged tandem SSO remains off and ACL belongs to Orgo', () => {
  const source=src('apps/api/src/orgo/modules/identity/tandem-sso-policy.ts');
  assert.match(source,/KOA_TANDEM_SSO_MODE \|\| 'off'/);
  const access=src('apps/api/src/orgo/modules/identity/identity.service.ts');
  assert.match(access,/scope_type/);
  assert.match(access,/organization_id === organizationId/);
});
test('IK remains scoped by authenticated tenant with no workflow mutation', () => {
  const source=src('apps/api/src/orgo/modules/interaction-kernel/interaction-kernel.service.ts');
  assert.match(source,/envelope\.target\.organization !== ctx\.organizationId/);
  assert.match(source,/IK_IDEMPOTENCY_CONFLICT/);
  assert.match(source,/governance\.decision\.execute/);
});
test('durable callbacks and outbox remain configured', () => {
  assert.match(src('apps/api/src/orgo/modules/integrations/operations.service.ts'),/RECEIPT_CONFLICT/);
  assert.match(src('apps/api/src/orgo/platform/outbox/worker.service.ts'),/FOR UPDATE SKIP LOCKED/);
});
test('no network or migration invoked by the contract runner', () => {
  assert.match(src('docs/Technical-Reference/TANDEM_TOUR_ORGO_2026-10-18.md'),/aucune migration/i);
});
