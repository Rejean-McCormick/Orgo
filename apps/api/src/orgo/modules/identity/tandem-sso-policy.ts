/** Staged tandem login policy. Does not grant roles or create identities. */
export type TandemSsoMode = 'off' | 'ready' | 'enforce';
export type TandemPolicyEnv = Record<string, string | undefined>;

export function tandemSsoPolicy(env: TandemPolicyEnv = process.env) {
  const raw = (env.KOA_TANDEM_SSO_MODE || 'off').trim();
  if (!['off', 'ready', 'enforce'].includes(raw)) {
    throw new Error('KOA_TANDEM_SSO_MODE must be off, ready, or enforce');
  }
  const mode = raw as TandemSsoMode;
  const organization = (env.KOA_TANDEM_ORGANIZATION || '').trim();
  const universe = (env.KOA_TANDEM_UNIVERSE || '').trim();
  const breakglass = (env.KOA_SSO_BREAKGLASS_EMAIL || '').trim().toLowerCase();
  return { mode, organization, universe, breakglass };
}

export function validateTandemSso(env: TandemPolicyEnv = process.env): ReturnType<typeof tandemSsoPolicy> {
  const policy = tandemSsoPolicy(env);
  if (policy.mode === 'off') return policy;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(policy.organization) ||
      !/^[a-z0-9][a-z0-9-]*$/.test(policy.universe)) {
    throw new Error('Tandem SSO requires explicit KOA_TANDEM_ORGANIZATION and KOA_TANDEM_UNIVERSE slugs');
  }
  const issuer = (env.OIDC_ISSUER || '').trim();
  const shared = (env.KOA_SHARED_OIDC_ISSUER || '').trim();
  if (!issuer || !shared || issuer !== shared) {
    throw new Error('OIDC_ISSUER and KOA_SHARED_OIDC_ISSUER must match exactly');
  }
  if (!(env.OIDC_CLIENT_ID || '').trim() || !(env.ORGO_PUBLIC_URL || '').trim()) {
    throw new Error('Tandem SSO requires OIDC_CLIENT_ID and ORGO_PUBLIC_URL');
  }
  for (const [name, url] of [['OIDC_ISSUER', issuer], ['ORGO_PUBLIC_URL', env.ORGO_PUBLIC_URL || '']]) {
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new Error(`${name} must be an absolute URL`); }
    const devLocal = env.NODE_ENV !== 'production' && parsed.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
    if ((parsed.protocol !== 'https:' && !devLocal) || parsed.username || parsed.password || parsed.hash) {
      throw new Error(`${name} requires HTTPS (localhost HTTP only outside production)`);
    }
  }
  if (policy.mode === 'enforce' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(policy.breakglass)) {
    throw new Error('enforce mode requires KOA_SSO_BREAKGLASS_EMAIL as explicit recovery identity');
  }
  return policy;
}

/** Enforced for a single tenant; an explicitly named recovery account stays usable. */
export function localLoginAllowed(organization: string, email: string, env: TandemPolicyEnv = process.env): boolean {
  const policy = validateTandemSso(env);
  return policy.mode !== 'enforce' || organization !== policy.organization ||
    email.toLowerCase().trim() === policy.breakglass;
}

export function localAutoLoginAllowedForTenant(organization: string, env: TandemPolicyEnv = process.env): boolean {
  const policy = validateTandemSso(env);
  return policy.mode !== 'enforce' || policy.organization !== organization;
}
