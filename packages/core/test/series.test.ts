import { describe, expect, it } from 'vitest';
import { analyzeMolecule, computeSaliCliffs, isActivityColumn, murckoScaffold, pairCuts, singleCuts } from '../src/index';
import { loadRDKit } from '../src/node';
import type { Molecule } from '../src/index';

const ORACLE: { smiles: string; scaffold: string; generic: string }[] = [
  { smiles: 'CC(=O)Oc1ccccc1C(=O)O', scaffold: 'c1ccccc1', generic: 'C1CCCCC1' },
  { smiles: 'CN1C=NC2=C1C(=O)N(C(=O)N2C)C', scaffold: 'O=c1[nH]c(=O)c2[nH]cnc2[nH]1', generic: 'CC1CC(C)C2CCCC2C1' },
  { smiles: 'Cc1ccc(NC(=O)c2ccc(CN3CCN(C)CC3)cc2)cc1Nc1nccc(-c2cccnc2)n1', scaffold: 'O=C(Nc1cccc(Nc2nccc(-c3cccnc3)n2)c1)c1ccc(CN2CCNCC2)cc1', generic: 'CC(CC1CCCC(CC2CCCC(C3CCCCC3)C2)C1)C1CCC(CC2CCCCC2)CC1' },
  { smiles: 'c1ccccc1', scaffold: 'c1ccccc1', generic: 'C1CCCCC1' },
  { smiles: 'CCCCCC', scaffold: '', generic: '' },
  { smiles: 'c1ccc(-c2ccccc2)cc1', scaffold: 'c1ccc(-c2ccccc2)cc1', generic: 'C1CCC(C2CCCCC2)CC1' },
  { smiles: 'Cc1cc(Oc2nccc(CCC)c2)ccc1', scaffold: 'c1ccc(Oc2ccccn2)cc1', generic: 'C1CCC(CC2CCCCC2)CC1' },
  { smiles: 'C=C1CCCCC1', scaffold: 'C=C1CCCCC1', generic: 'CC1CCCCC1' },
  { smiles: 'Cn1cccc1', scaffold: 'c1cc[nH]c1', generic: 'C1CCCC1' },
  { smiles: 'C[n+]1ccccc1', scaffold: 'c1cc[nH+]cc1', generic: 'C1CCCCC1' },
  { smiles: 'O=C1C=CC(=O)C=C1', scaffold: 'O=C1C=CC(=O)C=C1', generic: 'CC1CCC(C)CC1' },
  { smiles: 'c1ccc2[nH]ccc2c1', scaffold: 'c1ccc2[nH]ccc2c1', generic: 'C1CCC2CCCC2C1' },
  { smiles: 'c1ccccc1.c1ccncc1', scaffold: 'c1ccccc1.c1ccncc1', generic: 'C1CCCCC1.C1CCCCC1' },
  { smiles: 'CC(=O)Oc1ccccc1C(=O)O.[Na+]', scaffold: 'c1ccccc1', generic: 'C1CCCCC1' },
  { smiles: 'C[C@H]1CC[C@@H](C2CCCCC2)CC1', scaffold: 'C1CCC(C2CCCCC2)CC1', generic: 'C1CCC(C2CCCCC2)CC1' },
];

describe('Murcko scaffolds', () => {
  it('matches RDKit MurckoDecompose and MakeScaffoldGeneric', async () => {
    const RDKit = await loadRDKit();
    for (const row of ORACLE) {
      const got = murckoScaffold(RDKit, row.smiles);
      expect(got.scaffold, row.smiles).toBe(row.scaffold);
      expect(got.generic, row.smiles).toBe(row.generic);
    }
    expect(murckoScaffold(RDKit, 'not-a-molecule')).toEqual({ scaffold: '', generic: '' });
  });
});

describe('single-cut matched pairs', () => {
  it('pairs molecules that differ by one R group and reports property deltas', async () => {
    const RDKit = await loadRDKit();
    const rows = [
      { smiles: 'Cc1ccccc1', name: 'toluene', pIC50: 5 },
      { smiles: 'CCc1ccccc1', name: 'ethylbenzene', pIC50: 6.5 },
      { smiles: 'Oc1ccccc1', name: 'phenol', pIC50: 8 },
      { smiles: 'c1ccccc1', name: 'benzene', pIC50: 4 },
    ];
    const molecules: Molecule[] = rows.map((row) => {
      const mol = analyzeMolecule(row.smiles, 0, RDKit, [{ pIC50: row.pIC50 }]);
      if (!mol) throw new Error(row.name);
      mol.name = row.name;
      mol.customProps = { pIC50: row.pIC50 };
      return mol;
    });
    expect(singleCuts(RDKit, 'c1ccccc1', 3)).toEqual([]);

    const cuts = molecules.flatMap((mol, i) => singleCuts(RDKit, mol.smiles, i));
    const table = pairCuts(cuts, molecules, ['MW', 'LogP', 'pIC50']);
    const ethyl = table.rows.find((r) => r.i === 0 && r.j === 1);
    const phenol = table.rows.find((r) => r.i === 0 && r.j === 2);
    expect(ethyl, 'toluene/ethylbenzene').toBeTruthy();
    expect(phenol, 'toluene/phenol').toBeTruthy();
    expect(ethyl!.context).toBe(phenol!.context);
    expect(new Set([ethyl!.fromGroup, ethyl!.toGroup])).not.toEqual(new Set([phenol!.fromGroup, phenol!.toGroup]));
    const dMw = ethyl!.deltas.find((d) => d.key === 'MW');
    const dAct = ethyl!.deltas.find((d) => d.key === 'pIC50');
    expect(dMw && dMw.delta).toBeGreaterThan(10);
    expect(dAct?.delta).toBeCloseTo(1.5);
    expect(table.rows.some((r) => r.i === 3 || r.j === 3)).toBe(false);
  });
});

describe('SALI cliffs', () => {
  function fp(bits: number[]): Uint32Array {
    const packed = new Uint32Array(64);
    for (const b of bits) packed[b >>> 5] |= 1 << (b & 31);
    return packed;
  }

  const shared = [1, 2, 3, 4, 5, 6, 7, 8];
  const molecules = [
    { fpPacked: fp(shared), customProps: { pIC50: 5, LogP: 1 } },
    { fpPacked: fp([...shared.slice(0, 7), 9]), customProps: { pIC50: 9, LogP: 4 } },
    { fpPacked: fp([40, 41, 42, 43]), customProps: { pIC50: 1, LogP: 9 } },
    { fpPacked: fp(shared), customProps: { pIC50: 7, LogP: 2 } },
  ];

  it('scores activity change over similarity and skips other columns', () => {
    expect(isActivityColumn('pIC50')).toBe(true);
    expect(isActivityColumn('LogP')).toBe(false);
    expect(isActivityColumn('IC50_nM')).toBe(true);
    const cliffs = computeSaliCliffs(molecules, 'pIC50', 0.5);
    expect(cliffs.map((c) => [c.i, c.j])).toEqual([[0, 1], [1, 3]]);
    expect(cliffs.some((c) => c.i === 0 && c.j === 3)).toBe(false);
    expect(cliffs.some((c) => c.i === 2 || c.j === 2)).toBe(false);
    expect(cliffs[0].activityDelta).toBeCloseTo(4);
    expect(cliffs[0].sali).toBeCloseTo(Math.abs(4) / (1 - cliffs[0].similarity));
    expect(cliffs[0].similarity).toBeGreaterThanOrEqual(0.5);
    expect(computeSaliCliffs(molecules, 'LogP', 0.1)).toEqual([]);
    expect(computeSaliCliffs(molecules, 'pIC50', 0.99)).toEqual([]);
  });
});
