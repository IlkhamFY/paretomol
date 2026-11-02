import { describe, it, expect } from 'vitest';
import { computeParetoAndDominance } from '../chem';
import type { Molecule, ParetoObjective } from '../types';

/**
 * Pareto-front tests.
 *
 * Covers the cases named by the Digital Discovery data reviewer: missing
 * predictions, duplicates, constant objectives, single-molecule input, mixed
 * optimisation directions, and repeated re-Pareto analysis — plus the
 * non-dominated layering and the missing-value policy.
 */

/** Minimal Molecule stub: only the fields the Pareto pass reads or writes. */
function mol(name: string, custom: Record<string, number>): Molecule {
  return {
    name,
    smiles: name,
    svg: '',
    formula: '',
    fingerprint: '',
    fpPacked: new Uint32Array(0),
    // Built-in props are unused by these tests; objectives are custom keys.
    props: {} as Molecule['props'],
    customProps: custom,
    filters: {},
    paretoRank: null,
    dominates: [],
    dominatedBy: [],
  };
}

const MIN2: ParetoObjective[] = [
  { key: 'a', direction: 'min' },
  { key: 'b', direction: 'min' },
];

const ranks = (ms: Molecule[]) => ms.map(m => m.paretoRank);
const front1 = (ms: Molecule[]) => ms.filter(m => m.paretoRank === 1).map(m => m.name);

describe('dominance and front membership', () => {
  it('identifies the non-dominated front', () => {
    // c is dominated by both a and b; a and b are mutually non-dominated.
    const ms = [mol('a', { a: 1, b: 5 }), mol('b', { a: 5, b: 1 }), mol('c', { a: 6, b: 6 })];
    computeParetoAndDominance(ms, MIN2);
    expect(front1(ms).sort()).toEqual(['a', 'b']);
    expect(ms[2].paretoRank).toBe(2);
  });

  it('respects mixed optimisation directions', () => {
    const objs: ParetoObjective[] = [
      { key: 'a', direction: 'min' },
      { key: 'b', direction: 'max' },
    ];
    // b is best on both axes under min-a / max-b, so it alone is front 1.
    const ms = [mol('a', { a: 5, b: 1 }), mol('b', { a: 1, b: 9 }), mol('c', { a: 9, b: 0 })];
    computeParetoAndDominance(ms, objs);
    expect(front1(ms)).toEqual(['b']);
  });

  it('assigns true non-dominated layers, not a binary flag', () => {
    // A chain of strictly worsening points: each is its own front.
    const ms = [
      mol('f1', { a: 1, b: 1 }),
      mol('f2', { a: 2, b: 2 }),
      mol('f3', { a: 3, b: 3 }),
      mol('f4', { a: 4, b: 4 }),
    ];
    computeParetoAndDominance(ms, MIN2);
    expect(ranks(ms)).toEqual([1, 2, 3, 4]);
  });

  it('never emits rank 0 or a rank above the molecule count', () => {
    const ms = [
      mol('a', { a: 1, b: 3 }), mol('b', { a: 3, b: 1 }),
      mol('c', { a: 2, b: 4 }), mol('d', { a: 4, b: 2 }), mol('e', { a: 9, b: 9 }),
    ];
    computeParetoAndDominance(ms, MIN2);
    for (const m of ms) {
      expect(m.paretoRank).not.toBeNull();
      expect(m.paretoRank!).toBeGreaterThanOrEqual(1);
      expect(m.paretoRank!).toBeLessThanOrEqual(ms.length);
    }
  });

  it('keeps dominance edges consistent with the assigned fronts', () => {
    const ms = [
      mol('a', { a: 1, b: 1 }), mol('b', { a: 2, b: 2 }), mol('c', { a: 3, b: 3 }),
    ];
    computeParetoAndDominance(ms, MIN2);
    // Every dominated molecule must rank strictly worse than its dominator.
    ms.forEach((m, i) => {
      for (const j of m.dominates) {
        expect(ms[j].dominatedBy).toContain(i);
        expect(ms[j].paretoRank!).toBeGreaterThan(m.paretoRank!);
      }
    });
  });
});

describe('missing values are never treated as favourable', () => {
  it('does not promote a molecule whose minimised objective is missing', () => {
    // This is the defect the reviewer identified: with `?? 0`, `gap` had an
    // implicit hERG of 0 — the best attainable value — and joined the front.
    const objs: ParetoObjective[] = [
      { key: 'mw', direction: 'min' },
      { key: 'herg', direction: 'min' },
    ];
    const ms = [
      mol('safe', { mw: 300, herg: 0.05 }),
      mol('gap', { mw: 300 }), // hERG prediction failed
    ];
    computeParetoAndDominance(ms, objs);
    expect(front1(ms)).toEqual(['safe']);
    expect(ms[1].paretoRank).toBeNull();
    expect(ms[1].missingObjectives).toEqual(['herg']);
  });

  it('excludes incomplete molecules from the relation entirely', () => {
    const ms = [mol('full', { a: 5, b: 5 }), mol('partial', { a: 1 })];
    computeParetoAndDominance(ms, MIN2);
    // The incomplete molecule neither dominates nor is dominated, despite
    // having a better value on the one axis it does have.
    expect(ms[1].dominates).toEqual([]);
    expect(ms[1].dominatedBy).toEqual([]);
    expect(ms[0].dominatedBy).toEqual([]);
    expect(ms[0].paretoRank).toBe(1);
  });

  it('treats NaN and Infinity as missing, not as extreme values', () => {
    const ms = [
      mol('ok', { a: 5, b: 5 }),
      mol('nan', { a: NaN, b: 1 }),
      mol('inf', { a: -Infinity, b: 1 }),
    ];
    computeParetoAndDominance(ms, MIN2);
    expect(ms[1].paretoRank).toBeNull();
    expect(ms[2].paretoRank).toBeNull();
    expect(front1(ms)).toEqual(['ok']);
  });

  it('ranks every molecule when no values are missing', () => {
    const ms = [mol('a', { a: 1, b: 2 }), mol('b', { a: 2, b: 1 })];
    computeParetoAndDominance(ms, MIN2);
    expect(ms.every(m => m.paretoRank !== null)).toBe(true);
    expect(ms.every(m => m.missingObjectives === undefined)).toBe(true);
  });
});

describe('degenerate inputs', () => {
  it('handles a single molecule', () => {
    const ms = [mol('only', { a: 1, b: 1 })];
    computeParetoAndDominance(ms, MIN2);
    expect(ms[0].paretoRank).toBe(1);
    expect(ms[0].dominates).toEqual([]);
  });

  it('handles an empty input', () => {
    const ms: Molecule[] = [];
    expect(() => computeParetoAndDominance(ms, MIN2)).not.toThrow();
  });

  it('places exact duplicates on the same front', () => {
    const ms = [mol('a', { a: 2, b: 2 }), mol('b', { a: 2, b: 2 }), mol('c', { a: 2, b: 2 })];
    computeParetoAndDominance(ms, MIN2);
    // Identical points cannot dominate one another (no strict improvement).
    expect(ranks(ms)).toEqual([1, 1, 1]);
  });

  it('places all molecules on front 1 when every objective is constant', () => {
    const ms = [mol('a', { a: 7, b: 7 }), mol('b', { a: 7, b: 7 }), mol('c', { a: 7, b: 7 })];
    computeParetoAndDominance(ms, MIN2);
    expect(ranks(ms)).toEqual([1, 1, 1]);
  });

  it('places all molecules on front 1 when there are no objectives', () => {
    const ms = [mol('a', { a: 1 }), mol('b', { a: 2 })];
    computeParetoAndDominance(ms, []);
    expect(ranks(ms)).toEqual([1, 1]);
  });
});

describe('repeated and re-parameterised analysis', () => {
  it('is idempotent when re-run with the same objectives', () => {
    const ms = [mol('a', { a: 1, b: 3 }), mol('b', { a: 3, b: 1 }), mol('c', { a: 4, b: 4 })];
    computeParetoAndDominance(ms, MIN2);
    const first = ranks(ms);
    const edges = ms.map(m => [...m.dominates]);
    computeParetoAndDominance(ms, MIN2);
    expect(ranks(ms)).toEqual(first);
    // Edge lists must not accumulate across runs.
    expect(ms.map(m => [...m.dominates])).toEqual(edges);
  });

  it('recomputes when the objective set changes', () => {
    const ms = [mol('a', { a: 1, b: 9 }), mol('b', { a: 9, b: 1 })];
    computeParetoAndDominance(ms, [{ key: 'a', direction: 'min' }]);
    expect(front1(ms)).toEqual(['a']);
    // The previous guard short-circuited here and silently kept stale ranks.
    computeParetoAndDominance(ms, [{ key: 'b', direction: 'min' }]);
    expect(front1(ms)).toEqual(['b']);
  });

  it('clears a stale unranked state once the missing value arrives', () => {
    const ms = [mol('a', { a: 1, b: 1 }), mol('b', { a: 2 })];
    computeParetoAndDominance(ms, MIN2);
    expect(ms[1].paretoRank).toBeNull();
    ms[1].customProps.b = 2;
    computeParetoAndDominance(ms, MIN2);
    expect(ms[1].paretoRank).toBe(2);
    expect(ms[1].missingObjectives).toBeUndefined();
  });
});
