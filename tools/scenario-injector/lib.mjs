import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

export const SCHEMA_VERSION = 'orgo.scenario.v1';
const LABEL_RE = /^[1-9]\d*\.[1-9][1-5](?:\.[A-Za-z0-9]+)*$/;
const REF_RE = /^[a-z][a-z0-9._-]{1,119}$/;
const ID_RE = /^[a-z0-9][a-z0-9._-]{2,119}$/;
const CORRELATION_RE = /^[\w.-]{1,128}$/;
const SOURCE = new Set(['email', 'api', 'manual', 'sync']);
const WORKFLOW_SOURCE = new Set(['EMAIL', 'API', 'SYSTEM', 'TIMER']);
const CATEGORY = new Set(['request', 'incident', 'update', 'report', 'distribution']);
const SEVERITY = new Set(['MINOR', 'MODERATE', 'MAJOR', 'CRITICAL']);
const PRIORITY = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const VISIBILITY = new Set(['PUBLIC', 'INTERNAL', 'RESTRICTED', 'ANONYMISED']);
const TASK_STATUS = new Set(['PENDING','IN_PROGRESS','ON_HOLD','COMPLETED','FAILED','ESCALATED','CANCELLED']);
const CASE_STATUS = new Set(['open','in_progress','resolved','archived']);
const ACTION_TYPES = new Set(['CREATE_CASE','CREATE_TASK','UPDATE_TASK','ASSIGN_TASK','ROUTE','ESCALATE','ATTACH_TEMPLATE','SET_METADATA','ADD_LABEL','NOTIFY','REQUEST_INTEGRATION','START_PROCESS']);
const OPS = new Set(['publish_workflow','simulate_workflow','execute_workflow','create_case','create_task','create_signal','queue_signal','wait_signal','comment_task','transition_task','transition_case']);
const MUTATING_OPS = new Set(['publish_workflow','execute_workflow','create_case','create_task','create_signal','queue_signal','comment_task','transition_task','transition_case']);

function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function requiredString(v, path, errors, max=500) {
  if (typeof v !== 'string' || !v.trim()) errors.push(`${path}: chaîne non vide requise`);
  else if (v.length > max) errors.push(`${path}: maximum ${max} caractères`);
}
function optionalString(v, path, errors, max=20000) {
  if (v !== undefined && (typeof v !== 'string' || v.length > max)) errors.push(`${path}: chaîne <= ${max} caractères`);
}
function enumValue(v, values, path, errors, required=true) {
  if (v === undefined && !required) return;
  if (!values.has(v)) errors.push(`${path}: valeur invalide (${String(v)})`);
}
function validateLabel(v, path, errors) {
  if (typeof v !== 'string' || !LABEL_RE.test(v)) errors.push(`${path}: libellé Orgo invalide (ex. 2.11)`);
}
function validateRef(v, path, errors) {
  if (typeof v !== 'string' || !REF_RE.test(v)) errors.push(`${path}: référence locale invalide`);
}
function validateWorkBase(input, path, errors) {
  if (!isObject(input)) { errors.push(`${path}: objet requis`); return; }
  requiredString(input.title, `${path}.title`, errors);
  validateLabel(input.label, `${path}.label`, errors);
  optionalString(input.description, `${path}.description`, errors);
  if (input.severity !== undefined) enumValue(input.severity, SEVERITY, `${path}.severity`, errors);
  if (input.source !== undefined) enumValue(input.source, SOURCE, `${path}.source`, errors);
  if (input.visibility !== undefined) enumValue(input.visibility, VISIBILITY, `${path}.visibility`, errors);
  if (input.metadata !== undefined && !isObject(input.metadata)) errors.push(`${path}.metadata: objet requis`);
  if ((input.access_scope_type === undefined) !== (input.access_scope_reference === undefined)) errors.push(`${path}: access_scope_type et access_scope_reference doivent être fournis ensemble`);
  if (input.access_scope_type !== undefined && !new Set(['team','location','unit','custom']).has(input.access_scope_type)) errors.push(`${path}.access_scope_type: valeur invalide`);
}
function validateCaseInput(input, path, errors) {
  validateWorkBase(input, path, errors);
  if (!isObject(input)) return;
  if (input.tags !== undefined && (!Array.isArray(input.tags) || input.tags.length > 30 || input.tags.some(x => typeof x !== 'string' || !x.trim() || x.length > 500))) errors.push(`${path}.tags: tableau de <=30 chaînes requis`);
  if (input.location !== undefined && !isObject(input.location)) errors.push(`${path}.location: objet requis`);
  if (input.origin_vertical_level !== undefined && (!Number.isInteger(input.origin_vertical_level) || input.origin_vertical_level < 0)) errors.push(`${path}.origin_vertical_level: entier >= 0 requis`);
}
function validateTaskInput(input, path, errors) {
  validateWorkBase(input, path, errors);
  if (!isObject(input)) return;
  requiredString(input.type, `${path}.type`, errors);
  enumValue(input.category, CATEGORY, `${path}.category`, errors);
  if (input.priority !== undefined) enumValue(input.priority, PRIORITY, `${path}.priority`, errors);
  if (input.case_id !== undefined || input.owner_user_id !== undefined || input.owner_role_id !== undefined || input.requester_person_id !== undefined) errors.push(`${path}: UUID runtime interdits dans un scénario; utilisez les *_ref supportés`);
  if (input.due_at !== undefined && (typeof input.due_at !== 'string' || Number.isNaN(Date.parse(input.due_at)))) errors.push(`${path}.due_at: date ISO-8601 avec fuseau requise`);
}
function validateSignalInput(input, path, errors) {
  if (!isObject(input)) { errors.push(`${path}: objet requis`); return; }
  enumValue(input.source, SOURCE, `${path}.source`, errors);
  requiredString(input.external_reference, `${path}.external_reference`, errors, 500);
  requiredString(input.type, `${path}.type`, errors);
  enumValue(input.category, CATEGORY, `${path}.category`, errors);
  validateLabel(input.label, `${path}.label`, errors);
  requiredString(input.title, `${path}.title`, errors);
  optionalString(input.description, `${path}.description`, errors);
  if (input.severity !== undefined) enumValue(input.severity, SEVERITY, `${path}.severity`, errors);
  if (input.payload !== undefined && !isObject(input.payload)) errors.push(`${path}.payload: objet requis`);
  if (input.case_id !== undefined || input.workflow_version_id !== undefined) errors.push(`${path}: UUID runtime interdits; utilisez case_ref/workflow_ref au niveau de l'opération`);
}
function validateWorkflow(content, path, errors) {
  if (!isObject(content) || !Array.isArray(content.rules)) { errors.push(`${path}.rules: tableau requis`); return; }
  if (content.rules.length > 100) errors.push(`${path}.rules: maximum 100`);
  const ids = new Set();
  content.rules.forEach((rule, i) => {
    const p = `${path}.rules[${i}]`;
    if (!isObject(rule)) { errors.push(`${p}: objet requis`); return; }
    requiredString(rule.id, `${p}.id`, errors, 100);
    if (ids.has(rule.id)) errors.push(`${p}.id: id de règle dupliqué`); else ids.add(rule.id);
    if (rule.enabled !== undefined && typeof rule.enabled !== 'boolean') errors.push(`${p}.enabled: booléen requis`);
    if (!isObject(rule.match)) errors.push(`${p}.match: objet requis`);
    else {
      if (rule.match.source !== undefined) enumValue(rule.match.source, WORKFLOW_SOURCE, `${p}.match.source`, errors);
      if (rule.match.category !== undefined) enumValue(rule.match.category, CATEGORY, `${p}.match.category`, errors);
      if (rule.match.severity !== undefined) enumValue(rule.match.severity, SEVERITY, `${p}.match.severity`, errors);
    }
    if (!Array.isArray(rule.actions) || rule.actions.length < 1 || rule.actions.length > 50) errors.push(`${p}.actions: 1..50 actions requises`);
    else rule.actions.forEach((a,j) => {
      const ap = `${p}.actions[${j}]`;
      if (!isObject(a)) { errors.push(`${ap}: objet requis`); return; }
      enumValue(a.type, ACTION_TYPES, `${ap}.type`, errors);
      if (a.input !== undefined && !isObject(a.input)) errors.push(`${ap}.input: objet requis`);
      if (a.type === 'SET_METADATA' && a.target === '$case') errors.push(`${ap}: SET_METADATA sur $case n'est pas supporté par la RC actuelle; mettez metadata directement dans CREATE_CASE`);
    });
  });
}

export function validateScenario(doc) {
  const errors=[];
  if (!isObject(doc)) return { ok:false, errors:['racine: objet JSON requis'] };
  if (doc.schema_version !== SCHEMA_VERSION) errors.push(`schema_version doit être ${SCHEMA_VERSION}`);
  if (!isObject(doc.scenario)) errors.push('scenario: objet requis');
  else {
    if (typeof doc.scenario.id !== 'string' || !ID_RE.test(doc.scenario.id)) errors.push('scenario.id: 3..120 caractères [a-z0-9._-]');
    requiredString(doc.scenario.title, 'scenario.title', errors);
    optionalString(doc.scenario.description, 'scenario.description', errors);
    if (doc.scenario.synthetic !== true) errors.push('scenario.synthetic doit être true pour cet injecteur de simulation');
    if (doc.scenario.epistemic_status !== 'synthetic_demo_fixture') errors.push('scenario.epistemic_status doit être synthetic_demo_fixture');
    if (doc.scenario.correlation_id !== undefined && (typeof doc.scenario.correlation_id !== 'string' || !CORRELATION_RE.test(doc.scenario.correlation_id))) errors.push('scenario.correlation_id invalide');
  }
  if (!Array.isArray(doc.operations) || doc.operations.length < 1) errors.push('operations: au moins une opération requise');
  else if (doc.operations.length > 500) errors.push('operations: maximum 500');
  const refs = new Set();
  const knownRefs = new Map();
  if (Array.isArray(doc.operations)) doc.operations.forEach((op, i) => {
    const p=`operations[${i}]`;
    if (!isObject(op)) { errors.push(`${p}: objet requis`); return; }
    enumValue(op.op, OPS, `${p}.op`, errors);
    if (op.ref !== undefined) {
      validateRef(op.ref, `${p}.ref`, errors);
      if (refs.has(op.ref)) errors.push(`${p}.ref: référence dupliquée ${op.ref}`); else refs.add(op.ref);
      knownRefs.set(op.ref, op.op);
    }
    if (MUTATING_OPS.has(op.op) && !op.ref && !['transition_task','transition_case','comment_task','queue_signal'].includes(op.op)) errors.push(`${p}.ref: requis pour une opération créatrice/mutante réutilisable`);
    if (op.idempotency_key !== undefined && (typeof op.idempotency_key !== 'string' || !op.idempotency_key || op.idempotency_key.length > 200)) errors.push(`${p}.idempotency_key: 1..200 caractères`);
    if (op.correlation_id !== undefined && (typeof op.correlation_id !== 'string' || !CORRELATION_RE.test(op.correlation_id))) errors.push(`${p}.correlation_id invalide`);
    switch(op.op) {
      case 'publish_workflow':
        if (typeof op.code !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,99}$/.test(op.code)) errors.push(`${p}.code: code workflow invalide`);
        validateWorkflow(op.content, `${p}.content`, errors); break;
      case 'simulate_workflow':
      case 'execute_workflow':
        validateRef(op.workflow_ref, `${p}.workflow_ref`, errors);
        if (!isObject(op.context)) errors.push(`${p}.context: objet requis`);
        else {
          enumValue(op.context.source, WORKFLOW_SOURCE, `${p}.context.source`, errors);
          if (op.context.category !== undefined) enumValue(op.context.category, CATEGORY, `${p}.context.category`, errors);
          if (op.context.severity !== undefined) enumValue(op.context.severity, SEVERITY, `${p}.context.severity`, errors);
        }
        break;
      case 'create_case': validateCaseInput(op.input, `${p}.input`, errors); break;
      case 'create_task':
        validateTaskInput(op.input, `${p}.input`, errors);
        if (op.case_ref !== undefined) validateRef(op.case_ref, `${p}.case_ref`, errors);
        break;
      case 'create_signal':
        validateSignalInput(op.input, `${p}.input`, errors);
        if (op.case_ref !== undefined) validateRef(op.case_ref, `${p}.case_ref`, errors);
        if (op.workflow_ref !== undefined) validateRef(op.workflow_ref, `${p}.workflow_ref`, errors);
        break;
      case 'queue_signal':
      case 'wait_signal': validateRef(op.signal_ref, `${p}.signal_ref`, errors); if (op.op==='queue_signal') validateRef(op.workflow_ref, `${p}.workflow_ref`, errors); break;
      case 'comment_task': validateRef(op.task_ref, `${p}.task_ref`, errors); requiredString(op.body, `${p}.body`, errors, 20000); if (op.visibility !== undefined && !new Set(['internal_only','requester_visible','org_wide']).has(op.visibility)) errors.push(`${p}.visibility invalide`); break;
      case 'transition_task': validateRef(op.task_ref, `${p}.task_ref`, errors); enumValue(op.status, TASK_STATUS, `${p}.status`, errors); optionalString(op.reason, `${p}.reason`, errors, 2000); break;
      case 'transition_case': validateRef(op.case_ref, `${p}.case_ref`, errors); enumValue(op.status, CASE_STATUS, `${p}.status`, errors); break;
    }
  });
  // Referential ordering: references must be created earlier.
  const created = new Set();
  if (Array.isArray(doc.operations)) doc.operations.forEach((op,i) => {
    if (!isObject(op)) return;
    const needs=[];
    for (const k of ['case_ref','workflow_ref','signal_ref','task_ref']) if (op[k]) needs.push([k,op[k]]);
    for (const [k,r] of needs) if (!created.has(r)) errors.push(`operations[${i}].${k}: référence ${r} doit être créée par une opération précédente`);
    if (op.ref) created.add(op.ref);
  });
  return { ok: errors.length===0, errors };
}

export function buildPrompt(brief='') {
  return `# Orgo Scenario Injector — contrat IA v1\n\nTu simules un scénario destiné à être injecté dans Orgo RC via un outil contrôlé.\n\n## Règles absolues\n\n1. Réponds avec **un seul objet JSON**, sans bloc Markdown et sans texte avant/après.\n2. Utilise exactement \"schema_version\": \"${SCHEMA_VERSION}\".\n3. Le scénario est fictif : \"synthetic\": true et \"epistemic_status\": \"synthetic_demo_fixture\".\n4. N'invente jamais d'UUID Orgo. Utilise des références locales stables comme \"case.main\", \"task.review30\", \"workflow.main\".\n5. N'écris jamais de SQL, d'URL arbitraire, de token, de mot de passe ou de secret.\n6. Ne produis pas de PII réelle. Les noms éventuels doivent être explicitement fictifs et placés dans metadata/payload.\n7. Les Signals Orgo utilisent source en minuscules: email | api | manual | sync.\n8. Dans les règles workflow, match.source utilise les valeurs majuscules: EMAIL | API | SYSTEM | TIMER.\n9. Un label Orgo est obligatoire pour Case/Task/Signal et suit le format ex. \"2.11\".\n10. SET_METADATA cible actuellement une Task, pas un Case. Pour un Case, mets metadata directement dans CREATE_CASE.\n11. Chaque Signal doit avoir external_reference stable.\n12. Ordonne les opérations afin qu'une référence soit créée avant son utilisation.\n\n## Opérations autorisées\n\npublish_workflow, simulate_workflow, execute_workflow, create_case, create_task, create_signal, queue_signal, wait_signal, comment_task, transition_task, transition_case.\n\n## Enveloppe obligatoire\n\n{\n  \"schema_version\": \"${SCHEMA_VERSION}\",\n  \"scenario\": {\n    \"id\": \"scenario-id-stable\",\n    \"title\": \"Titre\",\n    \"description\": \"But de la simulation\",\n    \"synthetic\": true,\n    \"epistemic_status\": \"synthetic_demo_fixture\",\n    \"correlation_id\": \"scenario.scenario-id-stable\"\n  },\n  \"operations\": []\n}\n\n## Formes utiles\n\n### Créer un Case\n{\n  \"op\": \"create_case\",\n  \"ref\": \"case.main\",\n  \"input\": {\n    \"title\": \"...\",\n    \"description\": \"...\",\n    \"label\": \"2.11\",\n    \"severity\": \"MODERATE\",\n    \"visibility\": \"INTERNAL\",\n    \"metadata\": { \"synthetic\": true }\n  }\n}\n\n### Créer une Task liée\n{\n  \"op\": \"create_task\",\n  \"ref\": \"task.one\",\n  \"case_ref\": \"case.main\",\n  \"input\": {\n    \"title\": \"...\",\n    \"description\": \"...\",\n    \"type\": \"scenario\",\n    \"category\": \"request\",\n    \"label\": \"2.11\",\n    \"priority\": \"MEDIUM\",\n    \"metadata\": { \"synthetic\": true }\n  }\n}\n\n### Créer un Signal\n{\n  \"op\": \"create_signal\",\n  \"ref\": \"signal.event1\",\n  \"input\": {\n    \"source\": \"api\",\n    \"external_reference\": \"scenario:scenario-id-stable:event1:v1\",\n    \"type\": \"scenario_event\",\n    \"category\": \"update\",\n    \"severity\": \"MODERATE\",\n    \"label\": \"2.11\",\n    \"title\": \"...\",\n    \"description\": \"...\",\n    \"payload\": { \"synthetic\": true }\n  }\n}\n\n### Workflow\n{\n  \"op\": \"publish_workflow\",\n  \"ref\": \"workflow.main\",\n  \"code\": \"scenario_workflow\",\n  \"content\": {\n    \"rules\": [{\n      \"id\": \"event_v1\",\n      \"enabled\": true,\n      \"match\": { \"source\": \"API\", \"type\": \"scenario_event\" },\n      \"actions\": [{\n        \"type\": \"CREATE_CASE\",\n        \"input\": {\n          \"title\": \"$signal.title\",\n          \"description\": \"$signal.description\",\n          \"label\": \"$signal.label\",\n          \"severity\": \"$signal.severity\",\n          \"metadata\": { \"synthetic\": true }\n        }\n      }]\n    }]\n  }\n}\n\nUn create_signal peut contenir \"workflow_ref\": \"workflow.main\" pour que le Signal soit accepté et mis en file pour traitement par le worker Orgo. Ajoute ensuite {\"op\":\"wait_signal\",\"signal_ref\":\"signal.event1\",\"timeout_seconds\":30} si le scénario exige que les effets du workflow soient visibles avant de poursuivre.\n\n## Qualité attendue\n\n- scénario cohérent et déterministe;\n- titres lisibles par un humain;\n- metadata/payload contenant scenario_id et synthetic:true;\n- pas de succès scientifique ou institutionnel inventé;\n- distinguer observation, décision, tâche et résultat;\n- préférer peu d'opérations significatives à un grand volume artificiel.\n\n${brief ? `## Brief à simuler\n\n${brief}\n` : '## Brief à simuler\n\n[COLLER ICI LE BRIEF DU SCÉNARIO]\n'}\n`;
}

export function planScenario(doc) {
  const v=validateScenario(doc); if (!v.ok) return v;
  return { ok:true, scenario:doc.scenario.id, operations:doc.operations.map((op,i)=>({index:i+1, op:op.op, ref:op.ref ?? null, target:op.case_ref ?? op.task_ref ?? op.signal_ref ?? op.workflow_ref ?? null, mutates:MUTATING_OPS.has(op.op)})) };
}

export class OrgoClient {
  constructor({baseUrl, token, organization, email, password, fetchImpl=fetch}) {
    this.baseUrl=baseUrl.replace(/\/$/,''); this.token=token || ''; this.organization=organization; this.email=email; this.password=password; this.fetchImpl=fetchImpl;
  }
  async login() {
    if (this.token) return;
    if (!this.organization || !this.email || !this.password) throw new Error('Authentification requise: ORGO_SCENARIO_TOKEN ou ORGO_SCENARIO_ORGANIZATION + ORGO_SCENARIO_EMAIL + ORGO_SCENARIO_PASSWORD');
    const r=await this.request('auth/login','POST',{organization:this.organization,email:this.email,password:this.password},{auth:false,idempotency:false});
    this.token=r.token;
  }
  async request(path, method='GET', body, opts={}) {
    const headers={'Content-Type':'application/json'};
    if (opts.auth !== false && this.token) headers.Authorization=`Bearer ${this.token}`;
    if (opts.idempotencyKey) headers['Idempotency-Key']=opts.idempotencyKey;
    if (opts.correlationId) headers['X-Correlation-ID']=opts.correlationId;
    const response=await this.fetchImpl(`${this.baseUrl}/${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
    let payload; try { payload=await response.json(); } catch { payload={}; }
    if (!response.ok || payload?.ok===false) {
      const detail=payload?.error ? `${payload.error.code}: ${payload.error.message}` : `HTTP ${response.status}`;
      const e=new Error(`${method} ${path} -> ${detail}`); e.status=response.status; e.payload=payload; throw e;
    }
    return payload?.ok===true ? payload.data : payload;
  }
}

function opKey(doc, op, index) { return op.idempotency_key || `scenario:${doc.scenario.id}:${op.ref || op.op}:${index+1}`.slice(0,200); }
function corr(doc, op) { return op.correlation_id || doc.scenario.correlation_id || `scenario.${doc.scenario.id}`.slice(0,128); }
function refId(refs, name, expected) {
  const row=refs.get(name); if (!row) throw new Error(`Référence non résolue: ${name}`);
  if (expected && row.kind!==expected) throw new Error(`Référence ${name}: attendu ${expected}, reçu ${row.kind}`);
  return row.id;
}
function enrichMetadata(input, doc) {
  return {...input, metadata:{...(isObject(input.metadata)?input.metadata:{}), scenario_id:doc.scenario.id, synthetic:true, epistemic_status:'synthetic_demo_fixture'}};
}

export async function applyScenario(doc, config, {apply=false, fetchImpl=fetch, onEvent=()=>{}}={}) {
  const validation=validateScenario(doc); if (!validation.ok) throw new Error(`Scénario invalide:\n- ${validation.errors.join('\n- ')}`);
  if (!apply) return {mode:'dry-run', ...planScenario(doc)};
  const client=new OrgoClient({...config,fetchImpl}); await client.login();
  const refs=new Map(); const results=[];
  for (let index=0; index<doc.operations.length; index++) {
    const op=doc.operations[index]; const key=opKey(doc,op,index); const correlationId=corr(doc,op); let data=null; let status='applied';
    onEvent({phase:'start',index:index+1,op:op.op,ref:op.ref});
    switch(op.op) {
      case 'publish_workflow':
        data=await client.request(`workflows/${encodeURIComponent(op.code)}/versions`,'POST',op.content,{idempotencyKey:key,correlationId});
        refs.set(op.ref,{kind:'workflow',id:data.id,data}); break;
      case 'simulate_workflow': {
        const id=refId(refs,op.workflow_ref,'workflow'); data=await client.request(`workflow-versions/${id}/simulate`,'POST',op.context,{correlationId}); break; }
      case 'execute_workflow': {
        const id=refId(refs,op.workflow_ref,'workflow'); data=await client.request(`workflow-versions/${id}/execute`,'POST',op.context,{idempotencyKey:key,correlationId}); if (op.ref) refs.set(op.ref,{kind:'workflow_instance',id:data.instance_id,data}); break; }
      case 'create_case':
        data=await client.request('cases','POST',enrichMetadata(op.input,doc),{idempotencyKey:key,correlationId}); refs.set(op.ref,{kind:'case',id:data.id,data}); break;
      case 'create_task': {
        const input=enrichMetadata(op.input,doc); if (op.case_ref) input.case_id=refId(refs,op.case_ref,'case'); data=await client.request('tasks','POST',input,{idempotencyKey:key,correlationId}); refs.set(op.ref,{kind:'task',id:data.id,data}); break; }
      case 'create_signal': {
        const input={...op.input,payload:{...(isObject(op.input.payload)?op.input.payload:{}),scenario_id:doc.scenario.id,synthetic:true,epistemic_status:'synthetic_demo_fixture'}};
        if (op.case_ref) input.case_id=refId(refs,op.case_ref,'case'); if (op.workflow_ref) input.workflow_version_id=refId(refs,op.workflow_ref,'workflow');
        data=await client.request('signals','POST',input,{idempotencyKey:key,correlationId}); refs.set(op.ref,{kind:'signal',id:data.signal_id,data}); break; }
      case 'queue_signal': {
        const signalId=refId(refs,op.signal_ref,'signal'); const workflowId=refId(refs,op.workflow_ref,'workflow'); const current=await client.request(`signals/${signalId}`); if (current.status==='PROCESSED') { data=current; status='skipped_already_processed'; } else data=await client.request(`signals/${signalId}/process`,'POST',{workflow_version_id:workflowId},{idempotencyKey:key,correlationId}); break; }
      case 'wait_signal': {
        const signalId=refId(refs,op.signal_ref,'signal'); const timeout=Math.max(1,Math.min(Number(op.timeout_seconds ?? 30),300))*1000; const started=Date.now();
        while (true) { data=await client.request(`signals/${signalId}`); if (data.status==='PROCESSED') break; if (data.status==='REJECTED') throw new Error(`Signal ${op.signal_ref} rejeté`); if (Date.now()-started>=timeout) { status='pending_worker'; break; } await new Promise(r=>setTimeout(r,750)); }
        break; }
      case 'comment_task': {
        const taskId=refId(refs,op.task_ref,'task'); data=await client.request(`tasks/${taskId}/comments`,'POST',{body:op.body,visibility:op.visibility ?? 'internal_only'},{idempotencyKey:key,correlationId}); break; }
      case 'transition_task': {
        const taskId=refId(refs,op.task_ref,'task'); const current=await client.request(`tasks/${taskId}`); if (current.status===op.status) { data=current; status='skipped_already_at_status'; } else data=await client.request(`tasks/${taskId}/status`,'PATCH',{status:op.status,revision:current.revision,...(op.reason?{reason:op.reason}:{})},{idempotencyKey:key,correlationId}); refs.set(op.task_ref,{kind:'task',id:taskId,data}); break; }
      case 'transition_case': {
        const caseId=refId(refs,op.case_ref,'case'); const current=await client.request(`cases/${caseId}`); if (current.status===op.status) { data=current; status='skipped_already_at_status'; } else data=await client.request(`cases/${caseId}/status`,'PATCH',{status:op.status,revision:current.revision},{idempotencyKey:key,correlationId}); refs.set(op.case_ref,{kind:'case',id:caseId,data}); break; }
    }
    const record={index:index+1,op:op.op,ref:op.ref ?? null,status,id:op.ref ? refs.get(op.ref)?.id ?? null : null,data}; results.push(record); onEvent({phase:'done',...record});
  }
  return {schema_version:'orgo.scenario.import-report.v1',scenario_id:doc.scenario.id,applied_at:new Date().toISOString(),results,refs:Object.fromEntries([...refs.entries()].map(([k,v])=>[k,{kind:v.kind,id:v.id}]))};
}

export async function loadJson(path) { return JSON.parse(await readFile(path,'utf8')); }
export async function saveJson(path, value) { await writeFile(path,JSON.stringify(value,null,2)+'\n','utf8'); return path; }
export function defaultReportPath(input) { return `${input.replace(/\.json$/i,'')}.import-report.json`; }
