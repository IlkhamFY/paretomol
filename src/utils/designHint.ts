// ─── Analysis → design bridge: nearest better analog ─────────────────────────
// Every other view tells you how a molecule scores; none tells you what to change.
// For a dominated (improvable) molecule, the most useful next step is its closest
// structural analog that Pareto-dominates it — same chemotype, strictly better on the
// objectives. Seeing the two side by side shows which R-group change buys the gain.
//
// We reuse the domination data already computed for the Pareto front (Molecule.
// dominatedBy holds the indices that dominate this one), so this is just: among the
// dominators, pick the highest-Tanimoto one.

import type { Molecule, ParetoObjective } from '@paretomol/core';
import { getMolValue, isStrictlyBetter } from '@paretomol/core';
import { tanimotoPacked } from './chem';

export interface DesignHint {
  index: number;       // molecule index of the nearest dominating analog
  tanimoto: number;    // ECFP4 similarity to the query
  betterOn: string[];  // objectives on which the analog is strictly better
}

/** The most structurally similar molecule that Pareto-dominates `idx`, or null if `idx`
 *  is already non-dominated (Pareto-optimal) or has no usable analog. */
export function nearestBetterAnalog(
  molecules: Molecule[],
  idx: number,
  objectives: ParetoObjective[],
): DesignHint | null {
  const m = molecules[idx];
  if (!m || !m.dominatedBy || m.dominatedBy.length === 0) return null;

  let best: DesignHint | null = null;
  for (const di of m.dominatedBy) {
    const d = molecules[di];
    if (!d) continue;
    const t = tanimotoPacked(m.fpPacked, d.fpPacked);
    if (best !== null && t <= best.tanimoto) continue;

    const betterOn: string[] = [];
    for (const o of objectives) {
      const va = getMolValue(d, o.key);
      const vb = getMolValue(m, o.key);
      if (va === null || vb === null) continue;
      if (isStrictlyBetter(va, vb, o)) betterOn.push(o.key);
    }
    best = { index: di, tanimoto: t, betterOn };
  }
  return best;
}
