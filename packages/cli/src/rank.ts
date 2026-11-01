import {
  analyzeInput, buildDecisionRecord, descriptorTier, inferObjectives,
  DEFAULT_PARETO_OBJECTIVES, getProfile, moleculeIds, splitInput,
} from '@paretomol/core';
import { loadRDKit } from '@paretomol/core/node';
import type { DecisionRecord, ParetoObjective } from '@paretomol/core';

export { loadRDKit };

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
  const preview = splitInput(input);
  const objectives = opts.objectives ?? [...DEFAULT_PARETO_OBJECTIVES, ...inferObjectives(preview.customPropNames)];
  const tier = descriptorTier([...objectives.map((o) => o.key), ...Object.keys(profile.desirability)]);
  const { molecules, errors } = analyzeInput(input, RDKit, tier);
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
