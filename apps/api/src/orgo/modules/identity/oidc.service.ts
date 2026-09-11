import { Injectable, Inject } from '@nestjs/common';
import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import { z } from 'zod';
import { Database } from '../../platform/database';
import { DomainError } from '../../platform/contracts';
import { IdentityService, tokenHash } from './identity.service';
const fail = () =>
  new DomainError(
    'SSO_REJECTED',
    'Unable to authenticate this SSO session',
    401,
  );
export const oidcUrl = (raw: string) => {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new DomainError('SSO_CONFIGURATION', 'Invalid OIDC URL', 503);
  }
  const localDevelopment =
    process.env.NODE_ENV !== 'production' &&
    u.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '::1'].includes(u.hostname);
  if (
    (u.protocol !== 'https:' && !localDevelopment) ||
    u.username ||
    u.password ||
    u.hash
  )
    throw new DomainError(
      'SSO_CONFIGURATION',
      'OIDC URLs require HTTPS except localhost in non-production',
      503,
    );
  return u;
};
async function boundedJson(url: string, init: RequestInit = {}) {
  oidcUrl(url);
  const response = await fetch(url, {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw fail();
  const reader = response.body?.getReader();
  if (!reader) throw fail();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const r = await reader.read();
    if (r.done) break;
    size += r.value.length;
    if (size > 256000) {
      await reader.cancel();
      throw fail();
    }
    chunks.push(r.value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw fail();
  }
}
@Injectable()
export class OidcService {
  constructor(
    @Inject(Database) private db: Database,
    @Inject(IdentityService) private identity: IdentityService,
  ) {}
  private config() {
    const issuer = process.env.OIDC_ISSUER,
      client = process.env.OIDC_CLIENT_ID,
      base = process.env.ORGO_PUBLIC_URL;
    if (!issuer || !client || !base)
      throw new DomainError('SSO_UNAVAILABLE', 'SSO is not configured', 503);
    oidcUrl(issuer);
    const callback = oidcUrl(base);
    callback.pathname = '/sso';
    callback.search = '';
    return { issuer, client, callback: callback.toString() };
  }
  private async discover() {
    const config = this.config();
    const discovery = z
      .object({
        issuer: z.string(),
        authorization_endpoint: z.string(),
        token_endpoint: z.string(),
        jwks_uri: z.string(),
      })
      .parse(
        await boundedJson(
          `${config.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`,
        ),
      );
    if (discovery.issuer !== config.issuer) throw fail();
    oidcUrl(discovery.authorization_endpoint);
    oidcUrl(discovery.token_endpoint);
    oidcUrl(discovery.jwks_uri);
    return { ...config, ...discovery };
  }
  async start(slug: string) {
    const config = await this.discover();
    const org = await this.db.organization.findFirst({
      where: { slug, status: 'active' },
    });
    if (!org) throw fail();
    const state = randomBytes(32).toString('base64url'),
      browser = randomBytes(32).toString('base64url'),
      verifier = randomBytes(32).toString('base64url'),
      nonce = randomBytes(32).toString('base64url');
    await this.db.oidcAttempt.create({
      data: {
        state_hash: tokenHash(state),
        organization_id: org.id,
        browser_hash: tokenHash(browser),
        verifier,
        nonce_hash: tokenHash(nonce),
        expires_at: new Date(Date.now() + 600000),
      },
    });
    const url = new URL(config.authorization_endpoint);
    url.search = new URLSearchParams({
      client_id: config.client,
      redirect_uri: config.callback,
      response_type: 'code',
      scope: 'openid',
      state,
      nonce,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    }).toString();
    return { authorization_url: url.toString(), browser };
  }
  async complete(code: string, state: string, browser: string) {
    const attempt = await this.db.oidcAttempt.findUnique({
      where: { state_hash: tokenHash(state) },
    });
    if (
      !attempt ||
      attempt.browser_hash !== tokenHash(browser) ||
      attempt.consumed_at ||
      attempt.expires_at <= new Date()
    )
      throw fail();
    const claimed = await this.db.oidcAttempt.updateMany({
      where: {
        state_hash: attempt.state_hash,
        consumed_at: null,
        expires_at: { gt: new Date() },
      },
      data: { consumed_at: new Date(), verifier: '' },
    });
    if (!claimed.count) throw fail();
    const config = await this.discover();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.callback,
      client_id: config.client,
      code_verifier: attempt.verifier,
    });
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (process.env.OIDC_CLIENT_SECRET)
      headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(config.client)}:${encodeURIComponent(process.env.OIDC_CLIENT_SECRET)}`).toString('base64')}`;
    const token = z.object({ id_token: z.string().max(64000) }).parse(
      await boundedJson(config.token_endpoint, {
        method: 'POST',
        headers,
        body: body.toString(),
      }),
    );
    const parts = token.id_token.split('.');
    if (parts.length !== 3) throw fail();
    let header: { alg: string; kid: string },
      claims: {
        iss: string;
        sub: string;
        aud: string | string[];
        azp?: string;
        exp: number;
        iat: number;
        nonce: string;
        nbf?: number;
      };
    try {
      header = z
        .object({ alg: z.literal('RS256'), kid: z.string().min(1) })
        .parse(JSON.parse(Buffer.from(parts[0], 'base64url').toString()));
      claims = z
        .object({
          iss: z.string(),
          sub: z.string().min(1).max(1000),
          aud: z.union([z.string(), z.array(z.string()).min(1)]),
          azp: z.string().optional(),
          exp: z.number(),
          iat: z.number(),
          nonce: z.string(),
          nbf: z.number().optional(),
        })
        .parse(JSON.parse(Buffer.from(parts[1], 'base64url').toString()));
    } catch {
      throw fail();
    }
    const jwks = z
      .object({ keys: z.array(z.record(z.unknown())).max(100) })
      .parse(await boundedJson(config.jwks_uri));
    const keys = jwks.keys.filter(
      (k) =>
        k.kid === header.kid &&
        k.kty === 'RSA' &&
        (!k.use || k.use === 'sig') &&
        (!k.alg || k.alg === 'RS256') &&
        (!k.key_ops ||
          (Array.isArray(k.key_ops) && k.key_ops.includes('verify'))),
    );
    if (keys.length !== 1) throw fail();
    try {
      if (
        !verify(
          'RSA-SHA256',
          Buffer.from(`${parts[0]}.${parts[1]}`),
          createPublicKey({ key: keys[0], format: 'jwk' }),
          Buffer.from(parts[2], 'base64url'),
        )
      )
        throw fail();
    } catch {
      throw fail();
    }
    const now = Date.now() / 1000,
      aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (
      claims.iss !== config.issuer ||
      !aud.includes(config.client) ||
      (aud.length > 1 && claims.azp !== config.client) ||
      (claims.azp && claims.azp !== config.client) ||
      claims.exp <= now ||
      claims.iat > now + 60 ||
      claims.iat < now - 900 ||
      (claims.nbf && claims.nbf > now + 60) ||
      tokenHash(claims.nonce) !== attempt.nonce_hash
    )
      throw fail();
    const link = await this.db.ssoIdentity.findUnique({
      where: {
        organization_id_issuer_subject: {
          organization_id: attempt.organization_id,
          issuer: config.issuer,
          subject: claims.sub,
        },
      },
    });
    if (!link) throw fail();
    // Explicit issuer/subject mapping only. An unverified email claim never enrolls or links accounts.
    return this.identity.session(link.organization_id, link.user_id);
  }
}
