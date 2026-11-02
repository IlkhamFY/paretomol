import { describe, it, expect } from 'vitest';
import { buildExportCSV, buildScoredCSV, buildExportJSON, buildExportSDF } from '../export';
import type { Molecule } from '../types';

/**
 * Export formats.
 *
 * These matter beyond formatting: the exported Pareto columns are what a reader
 * takes away from the tool, and the reviewer's objection was that the label
 * implied an ordinal stratification that was not computed. The tests below pin
 * what those columns now mean, including for a molecule that is unranked
 * because it lacks a value for an active objective.
 */

function mol(over: Partial<Molecule> = {}): Molecule {
  return {
    name: 'test', smiles: 'CCO', svg: '', formula: 'C2H6O',
    fingerprint: '', fpPacked: new Uint32Array(0),
    props: {
      MW: 46.07, LogP: -0.0014, HBD: 1, HBA: 1, TPSA: 20.23, RotBonds: 0,
      FrCSP3: 1, Rings: 0, AromaticRings: 0, HeavyAtoms: 3, MR: 12.8,
      NumAtoms: 9, QED: 0.41, SC: 1.0,
    },
    customProps: {},
    filters: { lipinski: { pass: true, violations: 0 } },
    paretoRank: 1, dominates: [], dominatedBy: [],
    ...over,
  };
}

describe('CSV export', () => {
  it('emits a header and one row per molecule', () => {
    const csv = buildExportCSV([mol({ name: 'a' }), mol({ name: 'b' })]);
    const lines = csv.trim().split('\n');
    // Leading comment line, header, then one row each.
    expect(lines[0].startsWith('#')).toBe(true);
    expect(lines).toHaveLength(4);
  });

  it('carries both the front index and the boolean membership flag', () => {
    const csv = buildExportCSV([mol()]);
    expect(csv).toContain('Pareto_Rank');
    expect(csv).toContain('Pareto_Optimal');
  });

  it('reports an unranked molecule as blank rather than as dominated', () => {
    // A molecule excluded from the comparison for want of an objective value is
    // not "not optimal"; emitting 0 or 2 would assert a comparison never made.
    const csv = buildExportCSV([mol({ paretoRank: null, missingObjectives: ['hERG'] })]);
    const cells = csv.trim().split('\n').at(-1)!.split(',');
    const [rank, optimal] = cells.slice(-2);
    expect(rank.replace(/"/g, '')).toBe('');   // blank, not 0 and not 2
    expect(optimal.replace(/"/g, '')).toBe('false');
  });

  it('quotes fields containing separators so columns cannot shift', () => {
    const csv = buildExportCSV([mol({ name: 'drug, sodium salt' })]);
    expect(csv).toContain('"drug, sodium salt"');
  });

  it('escapes embedded quotes by doubling them', () => {
    const csv = buildExportCSV([mol({ name: 'the "good" one' })]);
    expect(csv).toContain('"the ""good"" one"');
  });
});

describe('scored CSV export', () => {
  it('emits only the requested columns, in order', () => {
    const m = mol({ customProps: { hERG: 0.1, DILI: 0.2, extra: 9 } });
    const csv = buildScoredCSV([m], ['hERG', 'DILI']);
    expect(csv.split('\n')[0]).toBe('smiles,name,hERG,DILI');
    expect(csv).not.toContain('extra');
  });

  it('leaves a missing value empty rather than writing zero', () => {
    // Writing 0 for an absent measurement is the defect this revision removes;
    // it must not reappear at the export boundary.
    const csv = buildScoredCSV([mol({ customProps: {} })], ['hERG']);
    expect(csv.trim().split('\n')[1]).toBe('CCO,test,');
  });

  it('leaves a non-finite value empty', () => {
    const csv = buildScoredCSV([mol({ customProps: { hERG: NaN } })], ['hERG']);
    expect(csv.trim().split('\n')[1]).toBe('CCO,test,');
  });
});

describe('JSON export', () => {
  it('produces parseable JSON carrying the front index', () => {
    const parsed = JSON.parse(buildExportJSON([mol({ paretoRank: 3 })]));
    const records = Array.isArray(parsed) ? parsed : parsed.molecules;
    expect(records[0].paretoRank).toBe(3);
    expect(records[0].paretoOptimal).toBe(false);
  });

  it('preserves null for an unranked molecule', () => {
    const parsed = JSON.parse(buildExportJSON([mol({ paretoRank: null })]));
    const records = Array.isArray(parsed) ? parsed : parsed.molecules;
    expect(records[0].paretoRank).toBeNull();
  });
});

describe('SDF export', () => {
  it('terminates every record with the SDF delimiter', () => {
    const sdf = buildExportSDF([mol(), mol({ name: 'second' })]);
    expect(sdf.split('$$$$').length - 1).toBe(2);
  });

  it('writes the rank as N/A when the molecule is unranked', () => {
    const sdf = buildExportSDF([mol({ paretoRank: null })]);
    expect(sdf).toContain('N/A');
  });

  it('handles an empty input without throwing', () => {
    expect(buildExportSDF([])).toBe('');
    expect(() => buildExportCSV([])).not.toThrow();
    expect(() => JSON.parse(buildExportJSON([]))).not.toThrow();
  });
});
