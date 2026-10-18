import test from 'node:test';
import assert from 'node:assert/strict';
import { tandemSsoPolicy, validateTandemSso, localLoginAllowed, localAutoLoginAllowedForTenant } from '../../src/orgo/modules/identity/tandem-sso-policy';
const env = {
  NODE_ENV: 'production',
  KOA_TANDEM_SSO_MODE: 'ready',
  KOA_TANDEM_ORGANIZATION: 'fakeplant',
  KOA_TANDEM_UNIVERSE: 'fakeplant',
  KOA_SHARED_OIDC_ISSUER: 'https://identity.example.test/realm',
  OIDC_ISSUER: 'https://identity.example.test/realm',
  OIDC_CLIENT_ID: 'orgo-client',
  ORGO_PUBLIC_URL: 'https://fakeplant.orgo.konnaxion.com',
};
test('standalone mode does not change existing login behavior', () => {
  assert.equal(tandemSsoPolicy({}).mode, 'off');
  assert.equal(localLoginAllowed('fakeplant', 'any@example.test', {}), true);
});
test('ready requires the same exact OIDC issuer as Konnaxion', () => {
  assert.equal(validateTandemSso(env).mode, 'ready');
  assert.throws(() => validateTandemSso({...env, KOA_SHARED_OIDC_ISSUER: 'https://other.test'}));
  assert.throws(() => validateTandemSso({...env, OIDC_CLIENT_ID: ''}));
  assert.throws(() => validateTandemSso({...env, ORGO_PUBLIC_URL: 'http://example.test'}));
});
test('enforcement only affects target tenant and preserves explicit recovery login', () => {
  const enforced = {...env, KOA_TANDEM_SSO_MODE: 'enforce', KOA_SSO_BREAKGLASS_EMAIL: 'recovery@example.test'};
  assert.equal(localLoginAllowed('fakeplant', 'person@example.test', enforced), false);
  assert.equal(localLoginAllowed('other', 'person@example.test', enforced), true);
  assert.equal(localLoginAllowed('fakeplant', 'RECOVERY@example.test', enforced), true);
  assert.equal(localAutoLoginAllowedForTenant('fakeplant', enforced), false);
  assert.equal(localAutoLoginAllowedForTenant('other', enforced), true);
  assert.throws(() => validateTandemSso({...enforced, KOA_SSO_BREAKGLASS_EMAIL: ''}));
});
test('unknown mode and insecure production URLs fail closed', () => {
  assert.throws(() => validateTandemSso({...env, KOA_TANDEM_SSO_MODE: 'unknown'}));
  assert.throws(() => validateTandemSso({...env, OIDC_ISSUER: 'http://localhost:9000', KOA_SHARED_OIDC_ISSUER: 'http://localhost:9000'}));
});
