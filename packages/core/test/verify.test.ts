import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyClaims, canonicalProperty, expectedDirection } from '../src/verify';
import type { Claim } from '../src/verify';
import type { RDKitLike } from '../src/analyze';

const FIX = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'verify-claims.json'), 'utf8')) as {
  claims: Claim[]; expected: { id: string; kind: string; key?: string }[];
};

let RDKit: RDKitLike;
beforeAll(async () => {
  RDKit = await (createRequire(import.meta.url)('@rdkit/rdkit') as () => Promise<RDKitLike>)();
});

const sig = (f: { id: string; kind: string; key?: string }) => `${f.id}|${f.kind}|${f.key ?? ''}`;

describe('claim verifier', () => {
  it('fixture has 50 rows and seeded errors', () => {
    expect(FIX.claims).toHaveLength(50);
    expect(FIX.expected.length).toBeGreaterThanOrEqual(15);
  });

  it('catches every seeded error with zero false flags', () => {
    const rep = verifyClaims(FIX.claims, RDKit);
    expect(rep.flags.map(sig).sort()).toEqual(FIX.expected.map(sig).sort());
    expect(rep.ok).toBe(false);
    // pIC50 values and the MW objective cannot be checked and must say so.
    expect(rep.unchecked[FIX.claims[0].id!]).toEqual(['pIC50', 'objective:MW']);
    expect(rep.checked).toBeGreaterThan(500);
  });

  it('passes the clean rows untouched', () => {
    const bad = new Set(FIX.expected.map((e) => e.id));
    const clean = FIX.claims.filter((c) => !bad.has(c.id!));
    expect(clean.length).toBeGreaterThanOrEqual(30);
    expect(verifyClaims(clean, RDKit).flags).toEqual([]);
  });

  it('respects custom tolerances', () => {
    const c: Claim = { id: 'aspirin', smiles: 'CC(=O)Oc1ccccc1C(=O)O', properties: { MW: 181.0 } };
    expect(verifyClaims([c], RDKit).flags).toHaveLength(1);
    expect(verifyClaims([c], RDKit, { tolerances: { MW: { abs: 1 } } }).flags).toHaveLength(0);
  });

  it('maps aliases and directions', () => {
    expect(canonicalProperty('cLogP')).toBe('LogP');
    expect(canonicalProperty('Num H Donors')).toBe('HBD');
    expect(canonicalProperty('pIC50')).toBeNull();
    expect(expectedDirection('pIC50')).toBe('max');
    expect(expectedDirection('IC50 (nM)')).toBe('min');
    expect(expectedDirection('SA_Score')).toBe('min');
    expect(expectedDirection('MW')).toBeNull();
  });
});
