// ─── Pareto "reading" — a deterministic narration of the front ────────────────
// Instead of a blank chat box, a one-line read of what the analysis shows: how many
// compounds are Pareto-optimal across which objectives, and the sharpest trade-off —
// the active objective pair whose "goodness" is most negatively correlated across the
// set, i.e. the axis where improving one tends to cost you the other. Deterministic
// and offline (no API key), so it is always available and honest.

import type { Molecule, ParetoObjective } from './types';

function molValue(mol: Molecule, key: string): number | undefined {
  const v = (mol.props as unknown as Record<string, number>)[key] ?? mol.customProps[key];
  return typeof v === 'number' && isFinite(v) ? v : undefined;
}

function pearson(xs: number[], ys: number[]): number | null {
  let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i], y = ys[i];
    if (!isFinite(x) || !isFinite(y)) continue;
    n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
  }
  if (n < 3) return null;
  const cov = sxy - (sx * sy) / n;
  const vx = sxx - (sx * sx) / n;
  const vy = syy - (sy * sy) / n;
  if (vx <= 0 || vy <= 0) return null;
  return cov / Math.sqrt(vx * vy);
}

export interface FrontReading {
  total: number;
  paretoCount: number;
  objectiveKeys: string[];
  /** The active objective pair with the most negative goodness-correlation (the sharpest trade-off). */
  tradeoff: { a: string; b: string; r: number } | null;
}

export function readFront(molecules: Molecule[], objectives: ParetoObjective[]): FrontReading | null {
  if (objectives.length === 0 || molecules.length === 0) return null;
  const paretoCount = molecules.filter(m => m.paretoRank === 1).length;

  // Orient each objective so higher = better, then look for the most anti-correlated pair.
  const goodness = objectives.map(o => molecules.map(m => {
    const v = molValue(m, o.key);
    return v === undefined ? NaN : (o.direction === 'min' ? -v : v);
  }));

  let tradeoff: FrontReading['tradeoff'] = null;
  for (let i = 0; i < objectives.length; i++) {
    for (let j = i + 1; j < objectives.length; j++) {
      const r = pearson(goodness[i], goodness[j]);
      if (r === null) continue;
      if (tradeoff === null || r < tradeoff.r) tradeoff = { a: objectives[i].key, b: objectives[j].key, r };
    }
  }
  // Only surface it if the anti-correlation is meaningful.
  if (tradeoff && tradeoff.r >= -0.25) tradeoff = null;

  return { total: molecules.length, paretoCount, objectiveKeys: objectives.map(o => o.key), tradeoff };
}
