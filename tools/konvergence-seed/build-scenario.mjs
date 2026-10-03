#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_LABEL = '1.11';
const PACK_ID = 'konvergence-koali';

function slug(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || 'item';
}

export function buildScenario(casesDocument, { label = DEFAULT_LABEL, sourcePath = 'orgo/examples/cases.json' } = {}) {
  if (!casesDocument || casesDocument.contract !== 'koa-orgo-sim/v1' || !Array.isArray(casesDocument.cases)) {
    throw new Error('Expected Konvergence orgo/examples/cases.json using koa-orgo-sim/v1');
  }

  const operations = [];
  casesDocument.cases.forEach((sourceCase, caseIndex) => {
    const caseRef = `case.${slug(sourceCase.case_id)}`;
    const caseMetadata = {
      seed_pack: PACK_ID,
      seed_version: '1.0.0',
      seed_source: sourcePath,
      seed_contract: casesDocument.contract,
      source_case_id: sourceCase.case_id,
      origin_world: sourceCase.origin_world,
      origin_topic: sourceCase.origin_topic,
      source_status: sourceCase.status,
      ...(sourceCase.media_ref ? { media_ref: sourceCase.media_ref } : {}),
    };
    operations.push({
      op: 'create_case',
      ref: caseRef,
      input: {
        title: sourceCase.title,
        description: sourceCase.mandate ?? '',
        label,
        severity: 'MODERATE',
        visibility: 'INTERNAL',
        metadata: caseMetadata,
      },
    });

    const tasks = Array.isArray(sourceCase.tasks) ? sourceCase.tasks : [];
    tasks.forEach((sourceTask, taskIndex) => {
      operations.push({
        op: 'create_task',
        ref: `task.${slug(sourceCase.case_id)}.${String(taskIndex + 1).padStart(2, '0')}`,
        case_ref: caseRef,
        input: {
          title: sourceTask.task,
          description: `Tâche importée du seed Konvergence ${sourceCase.case_id}.`,
          type: 'konvergence_seed',
          category: 'request',
          label,
          priority: 'MEDIUM',
          visibility: 'INTERNAL',
          metadata: {
            seed_pack: PACK_ID,
            seed_version: '1.0.0',
            source_case_id: sourceCase.case_id,
            origin_world: sourceCase.origin_world,
            origin_topic: sourceCase.origin_topic,
            source_task_index: taskIndex,
            ...(sourceTask.owner ? { konvergence_owner_ref: sourceTask.owner } : {}),
          },
        },
      });
    });
  });

  return {
    schema_version: 'orgo.scenario.v1',
    scenario: {
      id: 'konvergence-koali-universe-1.0.0',
      title: 'Konvergence Koali Universe 1.0.0 — Orgo operational seed',
      description: 'Import contrôlé des cas et tâches opérationnels du paquet Konvergence vers Orgo, en conservant la provenance sans prétendre à une compatibilité runtime native du contrat éditorial source.',
      synthetic: true,
      epistemic_status: 'synthetic_demo_fixture',
      correlation_id: 'scenario.konvergence-koali-universe-1.0.0',
    },
    operations,
  };
}

async function main(argv) {
  const [input, output, label = DEFAULT_LABEL] = argv;
  if (!input || !output) {
    throw new Error('Usage: node tools/konvergence-seed/build-scenario.mjs <cases.json> <scenario.json> [label]');
  }
  const source = JSON.parse(await readFile(resolve(input), 'utf8'));
  const scenario = buildScenario(source, { label, sourcePath: 'orgo/examples/cases.json' });
  await writeFile(resolve(output), JSON.stringify(scenario, null, 2) + '\n', 'utf8');
  process.stdout.write(`Wrote ${scenario.operations.length} Orgo operations to ${output}\n`);
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === resolve(self)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
