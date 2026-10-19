/**
 * Local auto-login is an explicitly unsafe developer convenience.
 * Never issue a passwordless admin session on production/Docker deployments,
 * or to a non-loopback TCP peer. Do not trust X-Forwarded-For or Host.
 */
export function localAutoLoginAllowed(
  env: Record<string, string | undefined>,
  remoteAddress: string | undefined,
): boolean {
  if (env.ORGO_LOCAL_AUTO_LOGIN !== 'true' || env.NODE_ENV === 'production')
    return false;
  const publicUrl = env.ORGO_PUBLIC_URL?.trim();
  if (!publicUrl) return false;
  let url: URL;
  try { url = new URL(publicUrl); } catch { return false; }
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username || url.password || url.hash
  ) return false;
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteAddress || '');
}
