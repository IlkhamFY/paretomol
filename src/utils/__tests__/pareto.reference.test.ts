import { describe, it, expect } from 'vitest';
import { computeParetoAndDominance } from '../chem';
import type { Molecule, ParetoObjective } from '../types';

/**
 * Randomised validation of the non-dominated sorting against an independent
 * brute-force reference, over many random populations.
 *
 * The reference computes fronts by repeated peeling using the textbook
 * dominance definition (weakly better on all objectives, strictly better on at
 * least one) and shares no code with the implementation under test.
 */

function mol(name: string, custom: Record<string, number>): Molecule {
  return {
    name, smiles: name, svg: '', formula: '', fingerprint: '',
    fpPacked: new Uint32Array(0),
    props: {} as Molecule['props'],
    customProps: custom,
    filters: {},
    paretoRank: null, dominates: [], dominatedBy: [],
  };
}

/** Deterministic PRNG so failures are reproducible (mulberry32). */
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Independent reference: peel fronts using the textbook dominance definition. */
function referenceFronts(points: number[][], objs: ParetoObjective[]): number[] {
  const n = points.length;
  const rank = new Array<number>(n).fill(0);
  const dominates = (p: number[], q: number[]) => {
    let strictlyBetter = false;
    for (let o = 0; o < objs.length; o++) {
      const better = objs[o].direction === 'min' ? p[o] < q[o] : p[o] > q[o];
      const worse = objs[o].direction === 'min' ? p[o] > q[o] : p[o] < q[o];
      if (worse) return false;
      if (better) strictlyBetter = true;
    }
    return strictlyBetter;
  };
  let remaining = points.map((_, i) => i);
  let current = 1;
  while (remaining.length > 0) {
    const front = remaining.filter(i => !remaining.some(j => j !== i && dominates(points[j], points[i])));
    for (const i of front) rank[i] = current;
    remaining = remaining.filter(i => !front.includes(i));
    current++;
  }
  return rank;
}

describe('non-dominated sorting matches an independent reference', () => {
  it('agrees on 200 random populations with mixed directions', () => {
    const rand = rng(12345);
    for (let trial = 0; trial < 200; trial++) {
      const n = 2 + Math.floor(rand() * 24);
      const k = 1 + Math.floor(rand() * 4);
      const objs: ParetoObjective[] = Array.from({ length: k }, (_, o) => ({
        key: `o${o}`,
        direction: rand() < 0.5 ? 'min' : 'max',
      }));
      // Small integer range, so ties and duplicates occur often.
      const points = Array.from({ length: n }, () =>
        Array.from({ length: k }, () => Math.floor(rand() * 5)),
      );
      const ms = points.map((p, i) =>
        mol(`m${i}`, Object.fromEntries(p.map((v, o) => [`o${o}`, v]))),
      );

      computeParetoAndDominance(ms, objs);
      const expected = referenceFronts(points, objs);
      expect(ms.map(m => m.paretoRank), `trial ${trial} (n=${n}, k=${k})`).toEqual(expected);
    }
  });

  it('agrees on populations containing missing values (complete-case)', () => {
    const rand = rng(999);
    for (let trial = 0; trial < 100; trial++) {
      const n = 3 + Math.floor(rand() * 15);
      const objs: ParetoObjective[] = [
        { key: 'o0', direction: 'min' },
        { key: 'o1', direction: 'min' },
      ];
      const complete: boolean[] = [];
      const ms = Array.from({ length: n }, (_, i) => {
        const props: Record<string, number> = { o0: Math.floor(rand() * 5) };
        const hasSecond = rand() > 0.3;
        if (hasSecond) props.o1 = Math.floor(rand() * 5);
        complete.push(hasSecond);
        return mol(`m${i}`, props);
      });

      computeParetoAndDominance(ms, objs);

      // Incomplete molecules are unranked and outside the relation entirely.
      ms.forEach((m, i) => {
        if (!complete[i]) {
          expect(m.paretoRank).toBeNull();
          expect(m.dominates).toEqual([]);
          expect(m.dominatedBy).toEqual([]);
        }
      });

      // The ranked subset must match the reference computed on that subset alone.
      const keep = ms.map((_, i) => i).filter(i => complete[i]);
      const pts = keep.map(i => [ms[i].customProps.o0, ms[i].customProps.o1]);
      const expected = referenceFronts(pts, objs);
      expect(keep.map(i => ms[i].paretoRank), `trial ${trial}`).toEqual(expected);
    }
  });
});
