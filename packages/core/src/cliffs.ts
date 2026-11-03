import type { Molecule } from './types.js';
import { tanimotoPacked } from './similarity.js';
import { isActivityColumn } from './assayValue.js';

/** Default cliff-score property set (physicochemical profile). */
export const DEFAULT_CLIFF_KEYS: string[] = ['MW', 'LogP', 'HBD', 'HBA', 'TPSA', 'RotBonds'];

/** Read a numeric property (built-in descriptor or custom/ADMET/activity column) for a molecule. */
export function readMolProp(m: Molecule, key: string): number | undefined {
  const v = (m.props as unknown as Record<string, number | undefined>)[key];
  if (typeof v === 'number' && isFinite(v)) return v;
  const cv = m.customProps?.[key];
  return typeof cv === 'number' && isFinite(cv) ? cv : undefined;
}

export interface ActivityCliff {
  i: number;
  j: number;
  tanimoto: number;
  propDistance: number;
  cliffScore: number;
  topDifferingProps: string[];
}

/**
 * Activity cliffs: structurally similar pairs with divergent properties.
 *
 * Cliff score (Structure–Activity Similarity, SAS):
 *   SAS_ij = T_ij · ||x̂_i − x̂_j||₂
 * where T_ij is the pairwise structural (or semantic) similarity supplied in
 * `tanimotoMatrix`, and x̂ is the per-property vector min–max normalized to [0,1]
 * across the loaded set. Min–max (rather than fixed) normalization lets any
 * property — including imported activity (pChEMBL/IC50) or predicted ADMET
 * endpoints — contribute on a comparable scale, enabling classic SAR activity
 * cliffs when a single activity property is selected (`propKeys = ['pChEMBL']`).
 */
export function computeActivityCliffs(
  molecules: Molecule[],
  tanimotoMatrix: number[][],
  threshold = 0.5,
  topN = 10,
  propKeys: string[] = DEFAULT_CLIFF_KEYS,
): ActivityCliff[] {
  const n = molecules.length;
  const cliffs: ActivityCliff[] = [];
  const keys = propKeys.length ? propKeys : DEFAULT_CLIFF_KEYS;

  // Per-property min/max over the loaded set for data-range normalization.
  const ranges: Record<string, { min: number; max: number }> = {};
  for (const k of keys) {
    let mn = Infinity, mx = -Infinity;
    for (const m of molecules) {
      const v = readMolProp(m, k);
      if (v === undefined) continue;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    ranges[k] = { min: mn, max: mx };
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const t = tanimotoMatrix[i][j];
      if (t <= threshold) continue;

      let sumSq = 0;
      const diffs: { key: string; diff: number }[] = [];
      for (const k of keys) {
        const v1 = readMolProp(molecules[i], k);
        const v2 = readMolProp(molecules[j], k);
        if (v1 === undefined || v2 === undefined) continue;
        const r = ranges[k];
        const span = r.max - r.min;
        const d = span > 1e-9 ? (v1 - v2) / span : 0;
        sumSq += d * d;
        diffs.push({ key: k, diff: Math.abs(d) });
      }
      if (diffs.length === 0) continue; // no comparable properties for this pair
      const propDist = Math.sqrt(sumSq);
      diffs.sort((a, b) => b.diff - a.diff);
      cliffs.push({
        i,
        j,
        tanimoto: t,
        propDistance: propDist,
        cliffScore: t * propDist,
        topDifferingProps: diffs.slice(0, 3).map((x) => x.key),
      });
    }
  }

  cliffs.sort((a, b) => b.cliffScore - a.cliffScore);
  return cliffs.slice(0, topN);
}

/** Pairs at or above this Morgan Tanimoto are eligible for a SALI cliff.
 *  0.30 matches radius-2 fingerprints on small analogs. Raise it for a tighter series. */
export const DEFAULT_SALI_SIMILARITY = 0.3;

export interface SaliCliff {
  i: number;
  j: number;
  similarity: number;
  /** Activity of j minus activity of i. i is the lower index. */
  activityDelta: number;
  /** |Δactivity| / (1 − similarity). Similarity of 1 is omitted. */
  sali: number;
}

/**
 * Activity cliffs on one activity column.
 *
 * SALI (Guha, Van Drie) is the activity change divided by how far the
 * structures are from identical. `similarityThreshold` drops pairs below it.
 * A similarity of 1 is omitted because the denominator would be zero.
 * Keys that are not activity columns (MW, LogP, predicted ADMET) return nothing.
 */
type CliffMol = { fpPacked: Uint32Array; customProps?: Record<string, number>; props?: Molecule['props'] };

function activityValue(m: CliffMol, activityKey: string): number | undefined {
  const builtIn = m.props ? (m.props as unknown as Record<string, number | undefined>)[activityKey] : undefined;
  if (typeof builtIn === 'number' && isFinite(builtIn)) return builtIn;
  const custom = m.customProps?.[activityKey];
  return typeof custom === 'number' && isFinite(custom) ? custom : undefined;
}

/** SALI pairs for rows i in [iStart, iEnd). Unsorted. Used to score a large set in chunks. */
export function saliPairsInRange(
  molecules: readonly CliffMol[],
  activityKey: string,
  similarityThreshold: number,
  iStart: number,
  iEnd: number,
): SaliCliff[] {
  if (!isActivityColumn(activityKey)) return [];
  const cliffs: SaliCliff[] = [];
  const end = Math.min(iEnd, molecules.length);
  for (let i = Math.max(0, iStart); i < end; i++) {
    const ai = activityValue(molecules[i], activityKey);
    if (ai === undefined) continue;
    for (let j = i + 1; j < molecules.length; j++) {
      const aj = activityValue(molecules[j], activityKey);
      if (aj === undefined) continue;
      const similarity = tanimotoPacked(molecules[i].fpPacked, molecules[j].fpPacked);
      if (similarity < similarityThreshold || similarity >= 0.999) continue;
      const activityDelta = aj - ai;
      if (activityDelta === 0) continue;
      cliffs.push({
        i,
        j,
        similarity,
        activityDelta,
        sali: Math.abs(activityDelta) / (1 - similarity),
      });
    }
  }
  return cliffs;
}

export function computeSaliCliffs(
  molecules: readonly CliffMol[],
  activityKey: string,
  similarityThreshold = DEFAULT_SALI_SIMILARITY,
  limit = 50,
): SaliCliff[] {
  const cliffs = saliPairsInRange(molecules, activityKey, similarityThreshold, 0, molecules.length);
  cliffs.sort((a, b) => b.sali - a.sali);
  return cliffs.slice(0, limit);
}
