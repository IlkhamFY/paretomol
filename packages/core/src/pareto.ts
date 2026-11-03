import { linearDesirability } from './mpo.js';
import { contractObjectives } from './scoring.js';
import { getProfile } from './profiles.js';
import type { Molecule, MolProps, ParetoObjective } from './types.js';

/** Get a molecule's value for a Pareto objective key (built-in or custom).
 *  Returns null when the value is absent or non-finite. A missing value must
 *  never be substituted with a number: for a minimised objective such as a
 *  predicted hERG risk on [0,1], an imputed 0 is the infimum, so a *failed*
 *  prediction would weakly dominate every real measurement. */
export function getMolValue(m: Molecule, key: string): number | null {
  const v = key in m.props
    ? (m.props[key as keyof MolProps] as number)
    : m.customProps[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Value used for dominance. A window objective contributes its desirability. */
export function objectiveScalar(raw: number, obj: ParetoObjective): number {
  if (obj.window) return linearDesirability(raw, obj.window);
  return raw;
}

/** True when a smaller scalar is better. Windows are never minimized. */
export function objectiveMinimises(obj: ParetoObjective): boolean {
  return !obj.window && obj.direction === 'min';
}

/** True when `a` is strictly better than `b` on this objective. */
export function isStrictlyBetter(a: number, b: number, obj: ParetoObjective): boolean {
  const av = objectiveScalar(a, obj);
  const bv = objectiveScalar(b, obj);
  if (!Number.isFinite(av) || !Number.isFinite(bv) || av === bv) return false;
  return objectiveMinimises(obj) ? av < bv : av > bv;
}

let oralWindows: ParetoObjective[] | null = null;
function defaultObjectives(): ParetoObjective[] {
  if (!oralWindows) oralWindows = contractObjectives(getProfile('oral@1'));
  return oralWindows;
}

/** Non-dominated fronts + dominance edges in a single O(n²) pass.
 *
 *  Missing values follow a complete-case policy: a molecule lacking a usable
 *  value for any active objective is excluded from the dominance relation
 *  entirely — it can neither dominate nor be dominated — and is left unranked
 *  (`paretoRank === null`) with the offending keys recorded in
 *  `missingObjectives` so the interface can report it. Excluding pairwise
 *  instead (comparing each pair on whichever objectives they happen to share)
 *  would break transitivity of the dominance relation and yield incoherent
 *  fronts, so it is deliberately not done.
 *
 *  Ranks are true non-dominated fronts (NSGA-II fast non-dominated sorting):
 *  rank 1 is the Pareto front, rank 2 the front remaining once rank 1 is
 *  removed, and so on. Rank 1 is identical to the previous front-membership
 *  flag, so every `paretoRank === 1` consumer is unaffected. Layering reuses
 *  the dominance edges materialised by the pairwise pass and costs O(n + |E|).
 */
export function computeParetoAndDominance(molecules: Molecule[], objectives?: ParetoObjective[], eligible?: readonly boolean[]) {
  const objs = objectives ?? defaultObjectives();
  const n = molecules.length;
  const k = objs.length;
  const minimise = objs.map(objectiveMinimises);

  // Resolve all objectives up front; `null` marks an incomplete molecule.
  const vals: (number[] | null)[] = new Array(n);
  const ranked: number[] = [];

  for (let i = 0; i < n; i++) {
    const m = molecules[i];
    m.dominates = [];
    m.dominatedBy = [];
    if (eligible && eligible[i] === false) {
      vals[i] = null;
      m.paretoRank = null;
      delete m.missingObjectives;
      continue;
    }
    const row: number[] = [];
    const missing: string[] = [];
    for (const obj of objs) {
      const v = getMolValue(m, obj.key);
      if (v === null) missing.push(obj.key);
      else {
        const s = objectiveScalar(v, obj);
        if (!Number.isFinite(s)) missing.push(obj.key);
        else row.push(s);
      }
    }
    if (missing.length > 0) {
      vals[i] = null;
      m.missingObjectives = missing;
      m.paretoRank = null;
    } else {
      vals[i] = row;
      delete m.missingObjectives;
      ranked.push(i);
    }
  }

  for (let a = 0; a < ranked.length; a++) {
    const i = ranked[a];
    const vi = vals[i]!;
    for (let b = a + 1; b < ranked.length; b++) {
      const j = ranked[b];
      const vj = vals[j]!;
      let iBetter = 0, jBetter = 0;
      for (let o = 0; o < k; o++) {
        const x = vi[o], y = vj[o];
        if (x === y || Math.abs(x - y) <= (objs[o].epsilon ?? 0)) continue;
        if (minimise[o] ? x < y : x > y) iBetter++;
        else jBetter++;
      }
      if (iBetter > 0 && jBetter === 0) {
        molecules[i].dominates.push(j);
        molecules[j].dominatedBy.push(i);
      } else if (jBetter > 0 && iBetter === 0) {
        molecules[j].dominates.push(i);
        molecules[i].dominatedBy.push(j);
      }
    }
  }

  // Peel fronts: a molecule enters front r once every molecule dominating it
  // has been assigned to an earlier front.
  const dominatingCount = new Array<number>(n).fill(0);
  for (const i of ranked) dominatingCount[i] = molecules[i].dominatedBy.length;

  let front = ranked.filter(i => dominatingCount[i] === 0);
  let rank = 1;
  while (front.length > 0) {
    const next: number[] = [];
    for (const i of front) {
      molecules[i].paretoRank = rank;
      for (const j of molecules[i].dominates) {
        if (--dominatingCount[j] === 0) next.push(j);
      }
    }
    front = next;
    rank++;
  }
}
