/** P5: verify server-owned Ed25519 Worlds attestation; NO admission, HTTP or DB.
 * Public key registry is pinned inside Orgo server configuration, never Akor JSON.
 */
import {verify} from 'node:crypto';
import {parseStrictJson} from './review-plan.mjs';
const KID=/^[a-z0-9][a-z0-9-]{0,63}$/;
const B64=/^[A-Za-z0-9_-]+$/;
const SHA=/^[0-9a-f]{64}$/;
const NONCE=/^[A-Za-z0-9_-]{43}$/;
function deny(reason){throw Error('ORGO_P5_WORLD_WITNESS_DENIED: '+reason);}
function strict(v,k){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==[...k].sort().join(','))deny('unexpected or missing fields');}
function decode(encoded,max){if(typeof encoded!=='string'||encoded.length<1||encoded.length>max||!B64.test(encoded))deny('encoding');let b;
 try{b=Buffer.from(encoded,'base64url');}catch{deny('base64 decoding');}
 if(b.toString('base64url')!==encoded)deny('noncanonical encoding');return b;}
/** `expected` comes from Orgo's verified P3 lookup, not the transported proof.
 * `challenge` generated fresh server-side for EACH attempt. No durable replay
 * guarantee is provided without the future persistent admission store.
 */
export function verifyP5WorldWitness(envelope,{trustedPublicKeys,expected,challenge,nowMs=Date.now()}={}){
 strict(envelope,['format','algorithm','key_id','payload_b64u','signature_b64u']);
 if(envelope.format!=='orgo-worlds.tandem-signed-witness/1.0'||envelope.algorithm!=='Ed25519')deny('format/algorithm');
 if(typeof envelope.key_id!=='string'||!KID.test(envelope.key_id)||!(trustedPublicKeys instanceof Map))deny('key config');
 const key=trustedPublicKeys.get(envelope.key_id);
 if(!key || key.type!=='public'||key.asymmetricKeyType!=='ed25519')deny('untrusted signer');
 const bytes=decode(envelope.payload_b64u,4096),signature=decode(envelope.signature_b64u,128);
 if(signature.length!==64)deny('signature size');
 if(!verify(null,bytes,key,signature))deny('invalid signature');
 let p;
 try{p=parseStrictJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{deny('signed JSON invalid');}
 strict(p,['format','issuer','audience','challenge','organizationId','worldId','releaseId','currentReleaseId','actorUserId','intentSha256','worldStatus','releaseStatus','membership','issuedAtMs','expiresAtMs']);
 strict(p.membership,['userId','worldId','active','role']);
 if(JSON.stringify(p)!==bytes.toString('utf8'))deny('noncanonical signed JSON');
 if(p.format!=='orgo-worlds.tandem-scope-witness/1.0'||p.issuer!=='orgo-worlds'||p.audience!=='orgo-education-preflight')deny('wrong proof domain');
 if(typeof challenge!=='string'||!NONCE.test(challenge)||p.challenge!==challenge)deny('challenge mismatch or replay');
 if(!expected||typeof expected!=='object'||!SHA.test(expected.intentSha256))deny('missing trusted Orgo scope');
 for(const [a,b] of [['organizationId','organizationId'],['worldId','worldId'],['releaseId','worldReleaseId'],['actorUserId','actorUserId'],['intentSha256','intentSha256']])
   if(p[a]!==expected[b])deny('scope/hash/actor mismatch');
 if(!Number.isSafeInteger(nowMs)||nowMs<=0||!Number.isSafeInteger(p.issuedAtMs)||!Number.isSafeInteger(p.expiresAtMs)||p.issuedAtMs>nowMs||p.expiresAtMs<=nowMs||p.expiresAtMs>p.issuedAtMs+10000)deny('expired or future proof');
 if(p.currentReleaseId!==p.releaseId||p.worldStatus!=='active'||p.releaseStatus!=='current'||p.membership.userId!==p.actorUserId||p.membership.worldId!==p.worldId||p.membership.active!==true||!['owner','maintainer','member'].includes(p.membership.role))deny('World inactive/release/member revoked in witness');
 return {organizationId:p.organizationId,worldId:p.worldId,releaseId:p.releaseId,currentReleaseId:p.currentReleaseId,
   worldStatus:p.worldStatus,releaseStatus:p.releaseStatus,membership:{...p.membership}};
}
