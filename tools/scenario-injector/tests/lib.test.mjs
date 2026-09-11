import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildPrompt, planScenario, validateScenario } from '../lib.mjs';
const here=dirname(fileURLToPath(import.meta.url));
const example=JSON.parse(await readFile(resolve(here,'../examples/uckk-a014.scenario.json'),'utf8'));

test('UCKK example validates',()=>{ const r=validateScenario(example); assert.equal(r.ok,true,JSON.stringify(r.errors)); });
test('plan is dry and ordered',()=>{ const r=planScenario(example); assert.equal(r.ok,true); assert.equal(r.operations.length,3); assert.equal(r.operations[0].op,'publish_workflow'); });
test('rejects runtime UUID in task input',()=>{ const bad=structuredClone(example); bad.operations=[{op:'create_task',ref:'task.x',input:{title:'x',type:'x',category:'request',label:'2.11',case_id:'00000000-0000-0000-0000-000000000000'}}]; const r=validateScenario(bad); assert.equal(r.ok,false); assert.match(r.errors.join('\n'),/UUID runtime interdits/); });
test('rejects forward references',()=>{ const bad=structuredClone(example); bad.operations=[{op:'create_task',ref:'task.x',case_ref:'case.later',input:{title:'x',type:'x',category:'request',label:'2.11'}},{op:'create_case',ref:'case.later',input:{title:'c',label:'2.11'}}]; const r=validateScenario(bad); assert.equal(r.ok,false); assert.match(r.errors.join('\n'),/doit être créée/); });
test('prompt contains hard safety contract',()=>{ const p=buildPrompt('Brief test'); assert.match(p,/sans bloc Markdown/); assert.match(p,/N'invente jamais d'UUID/); assert.match(p,/Brief test/); });
