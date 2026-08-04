import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mergeAssayData } from '../chem';
import type { Molecule } from '../types';

/**
 * Assay import: the matching ladder and the per-row account of what happened.
 *
 * The reviewer's objection to the previous merge was that records joined
 * silently and that failures were invisible. What the merge reports is
 * therefore part of the claim, and the accounting has to be exact in both
 * directions: a row whose values were merged must not be listed as unmatched,
 * and a row whose values went nowhere must be.
 *
 * The two rungs below the top of the ladder are where the report and the merge
 * can disagree. A match made on InChI is by construction one whose canonical
 * SMILES differ, and a match made on name is one where the row's structure is
 * not the molecule's, so neither row can be recognised afterwards by rebuilding
 * a key from it.
 */

/**
 * Canonical SMILES and standard InChI for the structures used below, read from
 * `get_smiles` and `get_inchi` of @rdkit/rdkit 2025.3.4-1.0.0 — the build
 * index.html pins and the merge itself calls.
 *
 * That build is a 7 MB WebAssembly bundle fetched from a CDN, which the browser
 * suite pins as a fixture and the unit suite deliberately does not depend on.
 * Recording RDKit's own answers here keeps the ladder exercised against real
 * chemistry rather than against invented strings — in particular the InChI
 * rung, which needs a pair whose canonical SMILES genuinely differ while their
 * standard InChI agrees.
 */
const RDKIT_VALUES: Record<string, { smiles: string; inchi: string }> = {
  'CCO': { smiles: 'CCO', inchi: 'InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3' },
  'OCC': { smiles: 'CCO', inchi: 'InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3' },
  // 4- and 5-methylimidazole: two annular tautomers of one compound. RDKit
  // canonicalises them to different SMILES; the mobile-H layer of the standard
  // InChI is identical.
  'Cc1c[nH]cn1': { smiles: 'Cc1c[nH]cn1', inchi: 'InChI=1S/C4H6N2/c1-4-2-5-3-6-4/h2-3H,1H3,(H,5,6)' },
  'Cc1cnc[nH]1': { smiles: 'Cc1cnc[nH]1', inchi: 'InChI=1S/C4H6N2/c1-4-2-5-3-6-4/h2-3H,1H3,(H,5,6)' },
  'CN(C)C(=N)N=C(N)N': { smiles: 'CN(C)C(=N)N=C(N)N', inchi: 'InChI=1S/C4H11N5/c1-9(2)4(7)8-3(5)6/h1-2H3,(H5,5,6,7,8)' },
  'CN(C)C(=N)N=C(N)N.Cl': { smiles: 'CN(C)C(=N)N=C(N)N.Cl', inchi: 'InChI=1S/C4H11N5.ClH/c1-9(2)4(7)8-3(5)6;/h1-2H3,(H5,5,6,7,8);1H' },
  'c1ccccc1': { smiles: 'c1ccccc1', inchi: 'InChI=1S/C6H6/c1-2-4-6-5-3-1/h1-6H' },
  'Cn1cnc2c1c(=O)n(C)c(=O)n2C': { smiles: 'Cn1c(=O)c2c(ncn2C)n(C)c1=O', inchi: 'InChI=1S/C8H10N4O2/c1-10-4-9-6-5(10)7(13)12(3)8(14)11(6)2/h4H,1-3H3' },
};

interface StubMol {
  is_valid: () => boolean;
  get_smiles: () => string;
  get_inchi: () => string;
  delete: () => void;
}

const host = globalThis as { RDKitModule?: { get_mol: (s: string) => StubMol | null } };

// Saved rather than assumed absent. Vitest isolates each file today, so nothing
// else has put an RDKit on the global by the time this runs -- but a suite that
// stubs it more widely later would find this file had deleted its module out
// from under it, and the resulting failure would depend on file order.
let previousRDKit: typeof host.RDKitModule;

beforeAll(() => {
  previousRDKit = host.RDKitModule;
  host.RDKitModule = {
    get_mol: (smiles: string) => {
      const entry = RDKIT_VALUES[smiles];
      if (!entry) return null;
      return {
        is_valid: () => true,
        get_smiles: () => entry.smiles,
        get_inchi: () => entry.inchi,
        delete: () => {},
      };
    },
  };
});

afterAll(() => {
  if (previousRDKit === undefined) delete host.RDKitModule;
  else host.RDKitModule = previousRDKit;
});

/** Minimal Molecule: only the fields the merge reads or writes. */
function mol(name: string, smiles: string, customProps: Record<string, number> = {}): Molecule {
  return {
    name,
    smiles,
    svg: '',
    formula: '',
    fingerprint: '',
    fpPacked: new Uint32Array(0),
    props: {} as Molecule['props'],
    customProps,
    filters: {},
    paretoRank: null,
    dominates: [],
    dominatedBy: [],
  };
}

const csv = (...lines: string[]) => lines.join('\n');

describe('the matching ladder', () => {
  it('matches a row whose SMILES is written differently from the input', () => {
    const r = mergeAssayData(csv('SMILES,IC50', 'OCC,120'), [mol('ethanol', 'CCO')]);
    expect(r.report.matchedBy).toEqual({ canonicalSmiles: 1, inchi: 0, name: 0 });
    expect(r.molecules[0].customProps.IC50).toBe(120);
    expect(r.report.unmatchedRows).toEqual([]);
  });

  it('matches on standard InChI when the canonical SMILES differ', () => {
    // The rung where the row key and the molecule key cannot coincide: if they
    // did, the canonical rung above would already have matched.
    const r = mergeAssayData(
      csv('SMILES,IC50', 'Cc1cnc[nH]1,45'),
      [mol('4-methylimidazole', 'Cc1c[nH]cn1')],
    );
    expect(r.report.matchedBy).toEqual({ canonicalSmiles: 0, inchi: 1, name: 0 });
    expect(r.molecules[0].customProps.IC50).toBe(45);
    expect(r.report.unmatchedRows).toEqual([]);
  });

  it('matches on name for a row that also carries a structure', () => {
    // The row gives the hydrochloride. Salts are deliberately not reduced to a
    // parent fragment, so both structural rungs miss and the name carries the
    // match — while the row's own key remains its SMILES.
    const r = mergeAssayData(
      csv('SMILES,Name,IC50', 'CN(C)C(=N)N=C(N)N.Cl,Metformin,8'),
      [mol('metformin', 'CN(C)C(=N)N=C(N)N')],
    );
    expect(r.report.matchedBy).toEqual({ canonicalSmiles: 0, inchi: 0, name: 1 });
    expect(r.molecules[0].customProps.IC50).toBe(8);
    expect(r.report.unmatchedRows).toEqual([]);
  });

  it('reports a row that matches no molecule', () => {
    const r = mergeAssayData(
      csv('SMILES,Name,IC50', 'CCO,ethanol,120', 'c1ccccc1,benzene,300'),
      [mol('ethanol', 'CCO')],
    );
    expect(r.report.rowsParsed).toBe(2);
    expect(r.matchCount).toBe(1);
    expect(r.report.unmatchedRows).toEqual(['c1ccccc1']);
  });

  it('reports a row whose values the match did not draw on', () => {
    // The compound matched on structure, so the merge read the rows carrying
    // that structure; the name-only row was not read, and its measurement did
    // not enter the analysis. Saying so is the whole point of the report.
    const r = mergeAssayData(
      csv('SMILES,Name,IC50', 'CCO,ethanol,120', ',ethanol,200'),
      [mol('ethanol', 'CCO')],
    );
    expect(r.molecules[0].customProps.IC50).toBe(120);
    expect(r.report.unmatchedRows).toEqual(['ethanol']);
  });

  it('accounts for every row exactly once across all three rungs', () => {
    const r = mergeAssayData(
      csv(
        'SMILES,Name,IC50',
        'OCC,Ethanol,120',
        'Cc1cnc[nH]1,5-methylimidazole,45',
        'CN(C)C(=N)N=C(N)N.Cl,Metformin,8',
        'c1ccccc1,Benzene,300',
      ),
      [
        mol('ethanol', 'CCO'),
        mol('4-methylimidazole', 'Cc1c[nH]cn1'),
        mol('metformin', 'CN(C)C(=N)N=C(N)N'),
      ],
    );
    expect(r.report.rowsParsed).toBe(4);
    expect(r.report.matchedBy).toEqual({ canonicalSmiles: 1, inchi: 1, name: 1 });
    expect(r.molecules.map(m => m.customProps.IC50)).toEqual([120, 45, 8]);
    expect(r.report.unmatchedRows).toEqual(['c1ccccc1']);
  });
});

describe('repeated rows for one compound', () => {
  it('aggregates to the median, and reports neither an unmatched row nor a second match', () => {
    const r = mergeAssayData(
      csv('SMILES,IC50', 'CCO,10', 'CCO,12', 'CCO,14'),
      [mol('ethanol', 'CCO')],
    );
    expect(r.report.rowsParsed).toBe(3);
    expect(r.matchCount).toBe(1);
    expect(r.molecules[0].customProps.IC50).toBe(12);
    expect(r.report.aggregated).toBe(1);
    expect(r.report.unmatchedRows).toEqual([]);
  });

  it('counts the compound once however many of its columns were aggregated', () => {
    // `aggregated` counts compounds, as the field it is reported in states.
    const r = mergeAssayData(
      csv('SMILES,IC50,Ki', 'CCO,10,1', 'CCO,12,3'),
      [mol('ethanol', 'CCO')],
    );
    expect(r.molecules[0].customProps).toMatchObject({ IC50: 11, Ki: 2 });
    expect(r.report.aggregated).toBe(1);
  });

  it('reports replicates that disagree by an order of magnitude', () => {
    const r = mergeAssayData(
      csv('SMILES,IC50', 'CCO,10', 'CCO,12', 'CCO,1000'),
      [mol('ethanol', 'CCO')],
    );
    expect(r.report.conflicts).toHaveLength(1);
    expect(r.report.conflicts[0]).toMatchObject({ molecule: 'ethanol', column: 'IC50', resolved: 12 });
    expect(r.molecules[0].customProps.IC50).toBe(12);
  });
});

describe('values that cannot be ordered or read', () => {
  it('reports a censored value and leaves the column unset when nothing else remains', () => {
    const r = mergeAssayData(
      csv('SMILES,IC50', 'CCO,120', 'Cn1cnc2c1c(=O)n(C)c(=O)n2C,>10000'),
      [mol('ethanol', 'CCO'), mol('caffeine', 'Cn1cnc2c1c(=O)n(C)c(=O)n2C')],
    );
    expect(r.report.censored).toEqual([{ molecule: 'caffeine', column: 'IC50', raw: '>10000' }]);
    expect(r.molecules[1].customProps.IC50).toBeUndefined();
    expect(r.report.unmatchedRows).toEqual([]);
  });

  it('keeps a censored replicate out of the median', () => {
    const r = mergeAssayData(
      csv('SMILES,IC50', 'CCO,10', 'CCO,12', 'CCO,>10000'),
      [mol('ethanol', 'CCO')],
    );
    expect(r.molecules[0].customProps.IC50).toBe(11);
    expect(r.report.censored).toHaveLength(1);
  });

  it('never turns a blank or non-numeric cell into a value', () => {
    // Number('') is 0, which for a minimised objective is the best attainable
    // value; a compound with no measurement must simply carry none. Its row
    // contributed nothing, so it is reported rather than passed over.
    const r = mergeAssayData(
      csv(
        'SMILES,Name,IC50',
        'CCO,ethanol,120',
        'Cn1cnc2c1c(=O)n(C)c(=O)n2C,caffeine,',
        'c1ccccc1,benzene,ND',
      ),
      [
        mol('ethanol', 'CCO'),
        mol('caffeine', 'Cn1cnc2c1c(=O)n(C)c(=O)n2C'),
        mol('benzene', 'c1ccccc1'),
      ],
    );
    expect(r.matchCount).toBe(1);
    expect(r.molecules[1].customProps.IC50).toBeUndefined();
    expect(r.molecules[2].customProps.IC50).toBeUndefined();
    expect(r.report.unmatchedRows).toEqual(['Cn1cnc2c1c(=O)n(C)c(=O)n2C', 'c1ccccc1']);
  });

  it('does not report a blank row for a compound whose other row carried a value', () => {
    const r = mergeAssayData(
      csv('SMILES,IC50', 'CCO,120', 'OCC,'),
      [mol('ethanol', 'CCO')],
    );
    expect(r.molecules[0].customProps.IC50).toBe(120);
    expect(r.report.unmatchedRows).toEqual([]);
  });
});

describe('column selection', () => {
  it('ignores a column whose header collides with a built-in descriptor', () => {
    const r = mergeAssayData(csv('SMILES,MW,IC50', 'CCO,46.07,120'), [mol('ethanol', 'CCO')]);
    expect(r.newPropNames).toEqual(['IC50']);
    expect(r.molecules[0].customProps.MW).toBeUndefined();
  });

  it('ignores a column already loaded as a custom property', () => {
    const r = mergeAssayData(
      csv('SMILES,Solubility,IC50', 'CCO,1.2,120'),
      [mol('ethanol', 'CCO', { Solubility: 9 })],
      ['Solubility'],
    );
    expect(r.newPropNames).toEqual(['IC50']);
    expect(r.molecules[0].customProps.Solubility).toBe(9);
  });

  it('records the units a column mixes', () => {
    const r = mergeAssayData(
      csv('SMILES,Name,IC50', 'CCO,ethanol,120 nM', 'c1ccccc1,benzene,3 uM'),
      [mol('ethanol', 'CCO'), mol('benzene', 'c1ccccc1')],
    );
    expect(r.report.unitsByColumn.IC50).toEqual(['nM', 'uM']);
  });
});
