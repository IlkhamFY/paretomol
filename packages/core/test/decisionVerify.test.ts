import { describe, it, expect } from 'vitest';
import { analyzeMolecule, buildDecisionRecord, computeParetoAndDominance, recordHash, verifyDecision } from '../src/index';
import { loadRDKit } from '../src/node';
import type { Molecule } from '../src/index';

describe('verifyDecision', () => {
  it('accepts a record it just built and flags a recomputed mismatch', async () => {
    const RDKit = await loadRDKit();
    const lines = [
      { smiles: 'CC(=O)Oc1ccccc1C(=O)O', name: 'aspirin', props: { pIC50: 6.2 } },
      { smiles: 'CN1C=NC2=C1C(=O)N(C(=O)N2C)C', name: 'caffeine', props: { pIC50: 5 } },
    ];
    const molecules: Molecule[] = [];
    lines.forEach((m, i) => {
      const mol = analyzeMolecule(m.smiles, 0, RDKit, [m.props]);
      if (!mol) throw new Error('parse');
      mol.name = m.name;
      mol.customProps = { ...m.props };
      molecules.push(mol);
      void i;
    });
    const objectives = [{ key: 'MW', direction: 'min' as const }, { key: 'pIC50', direction: 'max' as const }];
    computeParetoAndDominance(molecules, objectives);
    const rec = buildDecisionRecord({
      molecules, objectives, profile: 'oral@1', selected: [0], rationale: 'aspirin',
      rdkitVersion: RDKit.version(), timestamp: '2026-01-01T00:00:00.000Z',
      review: { source: 'test', decisions: { 0: 'accept', 1: 'reject' }, suggested: [0] },
    });
    const ok = verifyDecision(rec, RDKit);
    expect(ok.ok).toBe(true);
    expect(ok.issues).toEqual([]);
    expect(ok.recomputed.map((r) => r.id)).toEqual(['aspirin', 'caffeine']);
    expect(ok.rdkitVersion).toMatch(/^2025\.03\.4/);

    const edited = structuredClone(rec);
    edited.results[0].mpo = 0;
    edited.recordHash = recordHash(edited);
    const diff = verifyDecision(edited, RDKit);
    expect(diff.ok).toBe(false);
    expect(diff.issues.map((i) => i.code)).toEqual(['mpo']);
    expect(diff.issues[0].id).toBe('aspirin');
    expect(diff.recomputed[0].mpo).toBe(rec.results[0].mpo);

    const hashed = { ...rec, rationale: 'edited after export' };
    const bad = verifyDecision(hashed, RDKit);
    expect(bad.ok).toBe(false);
    expect(bad.issues.some((i) => i.code === 'hash')).toBe(true);
    expect(bad.recomputed).toHaveLength(2);

    expect(verifyDecision({ schema: 'nope' }, RDKit).issues[0].code).toBe('schema');
    expect(verifyDecision('not json', RDKit).issues[0].code).toBe('schema');
  });
});
