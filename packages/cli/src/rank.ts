import { createRequire } from 'node:module';
import {
  analyzeInput, buildDecisionRecord, computeParetoAndDominance, inferObjectives,
  DEFAULT_PARETO_OBJECTIVES, getProfile, moleculeIds,
} from '@paretomol/core';
import type { DecisionRecord, ParetoObjective, RDKitLike } from '@paretomol/core';

export interface RDKitNode extends RDKitLike { version(): string }

let rdkit: Promise<RDKitNode> | null = null;

/** Load the RDKit.js WebAssembly build from npm (same version the app loads from the CDN). */
export function loadRDKit(): Promise<RDKitNode> {
  if (!rdkit) {
    const require = createRequire(import.meta.url);
    const init = require('@rdkit/rdkit') as () => Promise<RDKitNode>;
    rdkit = init();
  }
  return rdkit;
}

export interface RankOptions {
  profile?: string;
  /** Explicit objectives; default is the app's: MW/LogP/TPSA plus inferable custom columns. */
  objectives?: ParetoObjective[];
  /** Molecule ids or names to mark as selected. */
  select?: string[];
  rationale?: string;
  timestamp?: string;
  admetEndpoint?: string | null;
}

export interface RankResult { record: DecisionRecord; errors: number }

/** Parse SMILES text or CSV/TSV, rank it, and build a decision record.
 *  Offline: unparseable lines are skipped (the app would try a PubChem name lookup). */
export async function rank(input: string, opts: RankOptions = {}): Promise<RankResult> {
  const RDKit = await loadRDKit();
  const profile = getProfile(opts.profile ?? 'oral@1');
  const { molecules, errors, customPropNames } = analyzeInput(input, RDKit);
  const objectives = opts.objectives ?? [...DEFAULT_PARETO_OBJECTIVES, ...inferObjectives(customPropNames)];
  computeParetoAndDominance(molecules, objectives);
  const want = new Set(opts.select ?? []);
  const ids = moleculeIds(molecules.map((m) => m.name));
  const selected = ids.flatMap((id, i) => (want.has(id) || want.has(molecules[i].name) ? [i] : []));
  const record = buildDecisionRecord({
    molecules, objectives, profile, selected,
    rationale: opts.rationale ?? '',
    rdkitVersion: RDKit.version(),
    admetEndpoint: opts.admetEndpoint ?? null,
    timestamp: opts.timestamp,
  });
  return { record, errors };
}

/** "MW:min,LogP:max" -> objectives. */
export function parseObjectives(spec: string): ParetoObjective[] {
  return spec.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const [key, dir] = s.split(':');
    if (!key || (dir !== 'min' && dir !== 'max')) throw new Error(`Bad objective "${s}", expected KEY:min or KEY:max`);
    return { key, direction: dir };
  });
}
