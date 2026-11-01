// ─── Best-compromise ("knee") of the Pareto front ────────────────────────────
// The front shows the trade-offs; the knee is the one a chemist usually picks —
// the Pareto-optimal molecule closest to the ideal corner, where you stop gaining
// on one objective without paying on another. We compute the compromise solution:
// among rank-1 molecules, the one with the smallest Euclidean distance to the ideal
// point in min–max-normalized objective space (each objective oriented so 0 = best).

import type { Molecule, ParetoObjective } from './types.js';
import { getMolValue, objectiveMinimises, objectiveScalar } from './pareto.js';

function molScalar(mol: Molecule, obj: ParetoObjective): number | undefined {
  const raw = getMolValue(mol, obj.key);
  if (raw === null) return undefined;
  const s = objectiveScalar(raw, obj);
  return Number.isFinite(s) ? s : undefined;
}

export interface KneeResult {
  index: number;     // molecule index of the best compromise
  distance: number;  // normalized Euclidean distance to the ideal point (0 = ideal)
  nObjectives: number;
}

/** Find the best-compromise (knee) molecule across the active Pareto objectives. */
export function findBestCompromise(molecules: Molecule[], objectives: ParetoObjective[]): KneeResult | null {
  if (objectives.length === 0 || molecules.length === 0) return null;

  const front = molecules.map((m, i) => ({ m, i })).filter(({ m }) => m.paretoRank === 1);
  if (front.length === 0) return null;

  // Per-objective data range across the full set, in the same space as dominance.
  const ranges = objectives.map((obj) => {
    let lo = Infinity, hi = -Infinity;
    for (const m of molecules) {
      const v = molScalar(m, obj);
      if (v === undefined) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return { lo, hi };
  });

  // Count objectives that actually vary (degenerate ones can't discriminate).
  const usable = ranges.filter(r => r.hi > r.lo).length;
  if (usable === 0) return null;

  let best: KneeResult | null = null;
  for (const { m, i } of front) {
    let sumSq = 0;
    for (let o = 0; o < objectives.length; o++) {
      const { hi, lo } = ranges[o];
      if (hi === lo) continue;
      const v = molScalar(m, objectives[o]);
      if (v === undefined) continue;
      const norm = (v - lo) / (hi - lo);                                   // 0..1
      const cost = objectiveMinimises(objectives[o]) ? norm : 1 - norm;    // 0 = ideal
      sumSq += cost * cost;
    }
    const distance = Math.sqrt(sumSq);
    if (best === null || distance < best.distance) best = { index: i, distance, nObjectives: usable };
  }
  return best;
}
