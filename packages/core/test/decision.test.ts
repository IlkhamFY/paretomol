import { describe, it, expect } from 'vitest';
import type { Molecule } from '../src/index';
import {
  buildDecisionRecord, parseDecisionRecord, stringifyDecisionRecord, selectedIndices,
  moleculeIds, inputHash, DECISION_RECORD_SCHEMA,
} from '../src/index';

function mol(name: string, smiles: string, MW: number, LogP: number, extra: Record<string, number> = {}): Molecule {
  return {
    name, smiles,
    props: { MW, LogP, HBD: 1, HBA: 3, TPSA: 60, RotBonds: 3, FSP3: 0.3, QED: 0.7 },
    customProps: extra,
    paretoRank: null,
  } as unknown as Molecule;
}

const MOLS = [mol('a', 'CCO', 46, -0.1), mol('b', 'c1ccccc1', 78, 1.7, { pIC50: 6.2 }), mol('a', 'CCN', 45, -0.2)];
const OBJ = [{ key: 'MW', direction: 'min' as const }, { key: 'LogP', direction: 'max' as const }];
const base = { molecules: MOLS, objectives: OBJ, rdkitVersion: '2025.03.4', selected: [2, 0], rationale: 'small', timestamp: '2026-10-30T00:00:00.000Z' };

describe('decision record v0', () => {
  it('dedups ids', () => {
    expect(moleculeIds(['a', 'b', 'a', 'a'])).toEqual(['a', 'b', 'a~2', 'a~3']);
  });

  it('builds a valid record with sorted selected ids', () => {
    const r = buildDecisionRecord(base);
    expect(r.schema).toBe(DECISION_RECORD_SCHEMA);
    expect(r.profile.ref).toBe('oral@1');
    expect(r.profile.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(r.input.sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(r.selected).toEqual(['a', 'a~2']);
    expect(r.models.admet).toBeNull();
    expect(r.results).toHaveLength(3);
  });

  it('hashing is stable across builds and key order', () => {
    const a = buildDecisionRecord(base), b = buildDecisionRecord({ ...base, selected: [0, 2, 2] });
    expect(stringifyDecisionRecord(a)).toBe(stringifyDecisionRecord(b));
    const reordered = MOLS.map((m) => ({ ...m, customProps: Object.fromEntries(Object.entries(m.customProps).reverse()) }));
    expect(inputHash(buildDecisionRecord({ ...base, molecules: reordered }).input.molecules)).toBe(a.input.sha256);
  });

  it('input hash depends on molecules only, not on timestamp or rationale', () => {
    const a = buildDecisionRecord(base), b = buildDecisionRecord({ ...base, rationale: 'x', timestamp: '2027-01-01T00:00:00Z' });
    expect(a.input.sha256).toBe(b.input.sha256);
    expect(a.recordHash).not.toBe(b.recordHash);
  });

  it('round-trips through JSON', () => {
    const r = buildDecisionRecord({ ...base, admetEndpoint: 'https://x.example', view: { activeTab: 'pareto', propertyFilters: { MW: { min: 10 } } as never } });
    const back = parseDecisionRecord(stringifyDecisionRecord(r));
    expect(back).toEqual(r);
    expect(selectedIndices(back)).toEqual([0, 2]);
    expect(stringifyDecisionRecord(back)).toBe(stringifyDecisionRecord(r));
  });

  it('rejects tampering', () => {
    const r = buildDecisionRecord(base);
    const t1 = JSON.parse(stringifyDecisionRecord(r)); t1.input.molecules[0].smiles = 'CCCO';
    expect(() => parseDecisionRecord(t1)).toThrow(/input/i);
    const t2 = JSON.parse(stringifyDecisionRecord(r)); t2.rationale = 'edited';
    expect(() => parseDecisionRecord(t2)).toThrow(/hash/i);
    const t3 = JSON.parse(stringifyDecisionRecord(r)); t3.schema = 'paretomol.decision/9';
    expect(() => parseDecisionRecord(t3)).toThrow(/schema/i);
  });
});
