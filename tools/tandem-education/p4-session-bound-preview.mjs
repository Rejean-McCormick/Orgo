/** Tandem Education P4: authenticated read-only preflight integration boundary.
 * The IdentityService object MUST come from Orgo's Nest dependency injection,
 * not from client payloads. This file installs NO route and NO provider.
 * Never returns a runtime admission or an authorization receipt.
 */
import { inspectAdmissionPrerequisites } from './admission-prerequisites.mjs';

function deny(reason) { throw Error(`TANDEM_P4_DENIED: ${reason}`); }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** `sessionToken` must be obtained by the authenticated server boundary,
 * never from the Akor JSON or a forwarded x-user-id/x-permissions header.
 * authorityPorts are server-owned readers. No fallback is permitted.
 * `enabled` defaults to false and is NOT tied to a deploy environment variable.
 */
export async function inspectP4AuthenticatedPreview({
  enabled = false, identityService, sessionToken, tenantId, intentBytes,
  scopeReport, authorityRequest, authorityPorts, nowMs = Date.now(),
} = {}) {
  if (enabled !== true) deny('disabled by default');
  if (typeof tenantId !== 'string' || !uuid.test(tenantId)) deny('tenant scope');
  if (typeof sessionToken !== 'string' || sessionToken.length < 16 || sessionToken.length > 500)
    deny('authenticated session required');
  if (!identityService || typeof identityService.authenticate !== 'function')
    deny('Orgo IdentityService unavailable');
  if (!authorityPorts || Object.keys(authorityPorts).sort().join(',') !==
      'readParticipantGrants,readTeacherApproval,readWorld' ||
      Object.values(authorityPorts).some(reader => typeof reader !== 'function'))
    deny('all server-owned authority readers required');

  let actor;
  try {
    // Calls the existing Orgo IdentityService.authenticate() implementation,
    // which reads LoginSession + active UserAccount and role permissions.
    // API tokens resolve to actorType=system and are refused below.
    actor = await identityService.authenticate(sessionToken, { organization: tenantId });
  } catch {
    deny('Orgo session authentication failed');
  }
  if (actor?.actorType !== 'user' || typeof actor.actorUserId !== 'string' ||
      !uuid.test(actor.actorUserId) || actor.organizationId !== tenantId ||
      actor.source !== 'api' || !Array.isArray(actor.permissions) ||
      !actor.permissions.includes('education:admit'))
    deny('authenticated user lacks explicit education admission permission');

  // P3 validates the exact intent SHA, current World, short-lived teacher
  // approval and per-task grants. Even all-green readers yield DRY_RUN_ONLY.
  return inspectAdmissionPrerequisites({
    intentBytes, scopeReport, authorityRequest,
    actor: {
      actorType: actor.actorType, actorUserId: actor.actorUserId,
      organizationId: actor.organizationId, permissions: actor.permissions,
    },
    readWorld: authorityPorts.readWorld,
    readTeacherApproval: authorityPorts.readTeacherApproval,
    readParticipantGrants: authorityPorts.readParticipantGrants,
    nowMs,
  });
}
