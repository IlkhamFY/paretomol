import { describe, expect, it } from 'vitest';
import {
  LIPINSKI_CONSTRAINTS,
  buildDecisionRecord,
  parseDecisionRecord,
  pruneSummary,
  rankUnder,
} from '@paretomol/core';
import type { Molecule } from '@paretomol/core';

function mol(name: string, props: Record<string, number>, custom: Record<string, number> = {}): Molecule {
  return {
    name, smiles: 'C', svg: '', formula: '', fingerprint: '', fpPacked: new Uint32Array(),
    props: props as Molecule['props'], customProps: custom, filters: {},
    paretoRank: null, dominates: [], dominatedBy: [],
  };
}

describe('constraints', () => {
  it('drops a molecule that fails or lacks a value, then reranks the rest', () => {
    const big = mol('big', { MW: 600, LogP: 2, HBD: 1, HBA: 2, TPSA: 60, RotBonds: 2 });
    const small = mol('small', { MW: 200, LogP: 2, HBD: 1, HBA: 2, TPSA: 60, RotBonds: 2 });
    const gap = mol('gap', { MW: 180, LogP: 2, HBD: 1, HBA: 2, TPSA: 60, RotBonds: 2 });
    delete (gap.props as { HBA?: number }).HBA;
    const objectives = [{ key: 'MW', direction: 'min' as const }, { key: 'LogP', direction: 'min' as const }];
    const gates = [{ key: 'HBA', op: '<=' as const, value: 5 }];
    rankUnder([big, small, gap], objectives, gates);
    expect(big.paretoRank).toBe(2);
    expect(small.paretoRank).toBe(1);
    expect(gap.paretoRank).toBeNull();
    expect(gap.excluded?.[0]).toMatch(/missing HBA/);
    expect(pruneSummary([big, small, gap])).toMatch(/^Pruned 1\./);
  });

  it('writes constraints on a v1 record and verify can read them back', () => {
    const molecules = [
      mol('a', { MW: 100, LogP: 1, HBD: 0, HBA: 1, TPSA: 20, RotBonds: 0, QED: 0.5, SC: 1, FrCSP3: 1, Rings: 0, AromaticRings: 0, HeavyAtoms: 1, MR: 1, NumAtoms: 1 }),
      mol('b', { MW: 300, LogP: 4, HBD: 1, HBA: 3, TPSA: 40, RotBonds: 1, QED: 0.4, SC: 2, FrCSP3: 0, Rings: 0, AromaticRings: 0, HeavyAtoms: 2, MR: 2, NumAtoms: 2 }),
    ];
    molecules.forEach((m) => { m.smiles = m.name === 'a' ? 'C' : 'CC'; });
    const constraints = [{ key: 'LogP', op: '<=' as const, value: 3, predicted: true as const }];
    rankUnder(molecules, [{ key: 'MW', direction: 'min' }], constraints);
    const rec = buildDecisionRecord({
      molecules,
      objectives: [{ key: 'MW', direction: 'min' }],
      constraints,
      rdkitVersion: '2025.03.4',
      timestamp: '2026-11-01T00:00:00.000Z',
    });
    expect(rec.constraints).toEqual(constraints);
    expect(rec.results.map((r) => r.paretoRank)).toEqual([1, null]);
    const parsed = parseDecisionRecord(JSON.parse(JSON.stringify(rec)));
    expect(parsed.constraints).toEqual(constraints);
    expect(LIPINSKI_CONSTRAINTS.map((c) => c.key)).toEqual(['MW', 'LogP', 'HBD', 'HBA']);
  });
});
