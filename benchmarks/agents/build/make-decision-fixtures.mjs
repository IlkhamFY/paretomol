#!/usr/bin/env node
// Build the decision-record pair used by the benchmark.
// The tampered file is the valid record with results[0].mpo increased by 1
// and recordHash left stale, so verification must fail.
//
//   node benchmarks/agents/build/make-decision-fixtures.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyzeInput, buildDecisionRecord, computeParetoAndDominance, stringifyDecisionRecord,
  DEFAULT_PARETO_OBJECTIVES,
} from '@paretomol/core';
import { loadRDKit } from '@paretomol/cli';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
mkdirSync(DATA, { recursive: true });
const INPUT = 'CCO ethanol\nc1ccccc1 benzene\n';

const RDKit = await loadRDKit();
const { molecules, errors } = analyzeInput(INPUT, RDKit);
if (errors !== 0 || molecules.length !== 2) throw new Error(`expected 2 molecules, got ${molecules.length} (${errors} errors)`);
computeParetoAndDominance(molecules, DEFAULT_PARETO_OBJECTIVES);
const rec = buildDecisionRecord({
  molecules,
  objectives: DEFAULT_PARETO_OBJECTIVES,
  profile: 'oral@1',
  selected: [0],
  rationale: 'smallest molecule',
  rdkitVersion: RDKit.version(),
  admetEndpoint: null,
  timestamp: '2026-11-01T00:00:00.000Z',
});
const ok = JSON.parse(stringifyDecisionRecord(rec));
const tampered = JSON.parse(JSON.stringify(ok));
tampered.results[0].mpo = Math.round((tampered.results[0].mpo + 1) * 1e6) / 1e6;
writeFileSync(join(DATA, 'decision_ok.json'), JSON.stringify(ok, null, 2) + '\n');
writeFileSync(join(DATA, 'decision_tampered.json'), JSON.stringify(tampered, null, 2) + '\n');
console.error(`wrote decision fixtures (tampered mpo ${ok.results[0].mpo} -> ${tampered.results[0].mpo}, hash unchanged)`);
