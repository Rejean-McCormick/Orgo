#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root = process.cwd();
const dotenv = path.join(root, '.env');
// Parse only whitelisted fields. Values are never echoed.
const env = {...process.env};
if(fs.existsSync(dotenv)) for(const line of fs.readFileSync(dotenv,'utf8').split(/\r?\n/)) {
  const m=line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if(m && !(m[1] in env)) env[m[1]]=m[2].trim().replace(/^(["'])(.*)\1$/,'$2');
}
const mode=env.KOA_TANDEM_SSO_MODE || 'off';
const org=env.KOA_TANDEM_ORGANIZATION || '(not set)';
const same=!!env.OIDC_ISSUER && !!env.KOA_SHARED_OIDC_ISSUER && env.OIDC_ISSUER===env.KOA_SHARED_OIDC_ISSUER;
const config=!!env.ORGO_PUBLIC_URL && !!env.OIDC_CLIENT_ID && !!env.OIDC_ISSUER;
console.log('ORGO TANDEM SSO — LECTURE SEULE');
console.log('Port web Orgo:',env.ORGO_WEB_HOST_PORT || '3000','(Konnaxion utilise deja souvent 3000 : choisir 3001 pour Orgo)');
console.log('Mode:',mode,'| Universe:',env.KOA_TANDEM_UNIVERSE||'(not set)','| Organization:',org);
console.log('OIDC complete:',config,'| Issuer matches expected Konnaxion value:',same);
console.log('Break-glass configured:',!!env.KOA_SSO_BREAKGLASS_EMAIL);
const dirs = [
  ['Konnaxion_Worlds canonique',env.FAKEPLANT_FIXTURE_ROOT || path.resolve(root,'../../Konnaxion/Konnaxion_Worlds/universes/fakeplant/fixture')],
  ['Orgo_Worlds local',path.resolve(root,'../Orgo_Worlds/fakeplant/fixture')],
];
const found=[];
for (const [label,dir] of dirs) {
  const file=path.join(dir,'employes.json'), manifest=path.join(dir,'MANIFEST.json');
  if (!fs.existsSync(file)||!fs.existsSync(manifest)) {
    console.log(label+': not accessible'); continue;
  }
  const bytes=fs.readFileSync(file);
  const hash=createHash('sha256').update(bytes).digest('hex');
  const expected=JSON.parse(fs.readFileSync(manifest,'utf8')).sha256?.['employes.json'];
  const people=JSON.parse(bytes.toString('utf8')).employees;
  const safe=people?.length===900 && people.every(p => p.synthetic === true && p.login_enabled === false && p.security?.orgo_status === 'disabled');
  const integrity=expected===hash;
  console.log(label+': verified='+integrity+' | 900 disabled personas='+safe);
  if (!integrity||!safe) process.exitCode=3;
  found.push(hash);
}
if (found.length===2) {
  const matched=found[0]===found[1];
  console.log('Cross-repo fixture SHA256 match:',matched);
  if (!matched)process.exitCode=3;
}
console.log('No SQL, no network requests, no modifications.');
if(mode!=='off' && (!config || !same))process.exitCode=2;
