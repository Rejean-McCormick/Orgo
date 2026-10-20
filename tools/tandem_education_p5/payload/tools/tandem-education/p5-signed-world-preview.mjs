/** Orgo P5 opt-in *read-only* adapter. Not wired to Nest or HTTP.
 * World proof signature does NOT replace the teacher approval or participant
 * grants. Those two ports remain required and must come from Orgo server state.
 * A trusted service transport, persistent revocation and transactions remain P6.
 */
import {randomBytes} from 'node:crypto';
import {inspectP4AuthenticatedPreview} from './p4-session-bound-preview.mjs';
import {verifyP5WorldWitness} from './p5-verified-world.mjs';
function deny(reason){throw Error('ORGO_P5_PREVIEW_DENIED: '+reason);}
export async function inspectP5SignedWorldPreview({enabled=false,identityService,sessionToken,tenantId,
  intentBytes,scopeReport,authorityRequest,readSignedWorld,readTeacherApproval,readParticipantGrants,
  trustedWorldPublicKeys,nowMs=Date.now()}={}){
 if(enabled!==true)deny('disabled by default');
 if(typeof readSignedWorld!=='function'||typeof readTeacherApproval!=='function'||typeof readParticipantGrants!=='function')deny('server-owned readers required');
 if(!(trustedWorldPublicKeys instanceof Map)||trustedWorldPublicKeys.size<1)deny('pinned trust registry required');
 const challenge=randomBytes(32).toString('base64url');
 const worldReader=async lookup=>{
   const envelope=await readSignedWorld(lookup,challenge);
   return verifyP5WorldWitness(envelope,{trustedPublicKeys:trustedWorldPublicKeys,expected:lookup,challenge,nowMs});
 };
 return inspectP4AuthenticatedPreview({enabled:true,identityService,sessionToken,tenantId,
   intentBytes,scopeReport,authorityRequest,
   authorityPorts:{readWorld:worldReader,readTeacherApproval,readParticipantGrants},nowMs});
}
