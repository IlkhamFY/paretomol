// ─── Analysis → design bridge: nearest better analog ─────────────────────────
// Every other view tells you how a molecule scores; none tells you what to change.
// For a dominated (improvable) molecule, the most useful next step is its closest
// structural analog that Pareto-dominates it — same chemotype, strictly better on the
// objectives. Seeing the two side by side shows which R-group change buys the gain.
//
// We reuse the domination data already computed for the Pareto front (Molecule.
// dominatedBy holds the indices that dominate this one), so this is just: among the
// dominators, pick the highest-Tanimoto one.

import type { Molecule, ParetoObjective } from './types';
import { tanimotoPacked } from './chem';

function molValue(mol: Molecule, key: string): number | undefined {
  const v = (mol.props as unknown as Record<string, number>)[key] ?? mol.customProps[key];
  return typeof v === 'number' && isFinite(v) ? v : undefined;
}

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
      const va = molValue(d, o.key);
      const vb = molValue(m, o.key);
      if (va === undefined || vb === undefined) continue;
      if ((o.direction === 'min' && va < vb) || (o.direction === 'max' && va > vb)) betterOn.push(o.key);
    }
    best = { index: di, tanimoto: t, betterOn };
  }
  return best;
}
