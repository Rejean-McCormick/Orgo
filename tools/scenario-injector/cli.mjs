#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { applyScenario, buildPrompt, defaultReportPath, loadJson, planScenario, saveJson, validateScenario } from './lib.mjs';

function usage() {
  console.log(`Orgo Scenario Injector\n\nCommandes:\n  template [--brief fichier.md] [--out prompt.md]\n  validate scenario.json\n  plan scenario.json\n  inject scenario.json [--apply] [--report rapport.json]\n\nPar sécurité, inject sans --apply fait uniquement un dry-run.\n\nVariables d'environnement pour --apply:\n  ORGO_SCENARIO_API_URL          défaut http://127.0.0.1:4000/api/v3\n  ORGO_SCENARIO_TOKEN            optionnel\n  OU\n  ORGO_SCENARIO_ORGANIZATION\n  ORGO_SCENARIO_EMAIL\n  ORGO_SCENARIO_PASSWORD\n`);
}
function flag(args,name) { return args.includes(name); }
function value(args,name) { const i=args.indexOf(name); return i>=0 ? args[i+1] : undefined; }

const [, , command, ...args]=process.argv;
try {
  if (!command || ['-h','--help','help'].includes(command)) { usage(); process.exitCode=0; }
  else if (command==='template') {
    const briefPath=value(args,'--brief'); const out=value(args,'--out'); const brief=briefPath ? await readFile(resolve(briefPath),'utf8') : '';
    const prompt=buildPrompt(brief); if (out) { await writeFile(resolve(out),prompt,'utf8'); console.log(`Template IA écrit: ${resolve(out)}`); } else console.log(prompt);
  } else if (command==='validate' || command==='plan') {
    const input=args.find(a=>!a.startsWith('--')); if (!input) throw new Error('Fichier scenario.json requis'); const doc=await loadJson(resolve(input)); const result=command==='validate'?validateScenario(doc):planScenario(doc);
    if (!result.ok) { console.error(JSON.stringify(result,null,2)); process.exitCode=2; } else console.log(JSON.stringify(result,null,2));
  } else if (command==='inject') {
    const input=args.find(a=>!a.startsWith('--')); if (!input) throw new Error('Fichier scenario.json requis'); const path=resolve(input); const doc=await loadJson(path); const apply=flag(args,'--apply');
    const config={baseUrl:process.env.ORGO_SCENARIO_API_URL || 'http://127.0.0.1:4000/api/v3',token:process.env.ORGO_SCENARIO_TOKEN,organization:process.env.ORGO_SCENARIO_ORGANIZATION,email:process.env.ORGO_SCENARIO_EMAIL,password:process.env.ORGO_SCENARIO_PASSWORD};
    const report=await applyScenario(doc,config,{apply,onEvent:e=>{ if (apply) console.error(`[${e.phase}] ${e.index ?? ''} ${e.op ?? ''} ${e.ref ?? ''}`.trim()); }});
    if (!apply) console.log(JSON.stringify(report,null,2));
    else { const reportPath=resolve(value(args,'--report') || defaultReportPath(path)); await saveJson(reportPath,report); console.log(JSON.stringify({ok:true,scenario_id:doc.scenario.id,report:reportPath,refs:report.refs},null,2)); }
  } else throw new Error(`Commande inconnue: ${command}`);
} catch (error) { console.error(`ERREUR: ${error.message}`); if (error.payload) console.error(JSON.stringify(error.payload,null,2)); process.exitCode=1; }
