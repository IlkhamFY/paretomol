import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PAPER_REPRODUCTION_OBJECTIVES,
  computeParetoAndDominance,
  contractObjectives,
  getProfile,
  objectivesForPreset,
  potencyObjectives,
} from '@paretomol/core';
import type { Molecule, ParetoObjective } from '@paretomol/core';

function mol(name: string, props: Record<string, number>, custom: Record<string, number> = {}): Molecule {
  return {
    name,
    smiles: name,
    svg: '',
    formula: '',
    fingerprint: '',
    fpPacked: new Uint32Array(),
    props: props as Molecule['props'],
    customProps: custom,
    filters: {},
    paretoRank: null,
    dominates: [],
    dominatedBy: [],
  };
}

function ranks(mols: Molecule[], objectives: ParetoObjective[]): (number | null)[] {
  computeParetoAndDominance(mols, objectives);
  return mols.map((m) => m.paretoRank);
}

describe('scoring contract', () => {
  it('ranks oral windows, not minimized logP and TPSA', () => {
    const windows = contractObjectives(getProfile('oral@1'));
    expect(windows.map((o) => o.key)).toEqual(['MW', 'LogP', 'HBD', 'HBA', 'TPSA', 'RotBonds']);
    expect(windows.every((o) => o.direction === 'max' && o.window)).toBe(true);

    const polar = mol('polar', { MW: 180, LogP: -2, HBD: 0, HBA: 2, TPSA: 20, RotBonds: 1 });
    const druglike = mol('druglike', { MW: 300, LogP: 2.5, HBD: 1, HBA: 4, TPSA: 70, RotBonds: 3 });
    const raw = [
      { key: 'MW', direction: 'min' as const },
      { key: 'LogP', direction: 'min' as const },
      { key: 'TPSA', direction: 'min' as const },
    ];
    expect(ranks([polar, druglike], raw)).toEqual([1, 2]);
    expect(ranks([
      mol('polar', { MW: 180, LogP: -2, HBD: 0, HBA: 2, TPSA: 20, RotBonds: 1 }),
      mol('druglike', { MW: 300, LogP: 2.5, HBD: 1, HBA: 4, TPSA: 70, RotBonds: 3 }),
    ], windows)).toEqual([2, 1]);
  });

  it('adds a p-scaled potency column and skips the raw concentration beside it', () => {
    const objs = objectivesForPreset('oral@1', ['pIC50', 'IC50_nM', 'notes_id']);
    expect(objs.map((o) => o.key)).toContain('pIC50');
    expect(objs.map((o) => o.key)).not.toContain('IC50_nM');
    expect(objs.find((o) => o.key === 'pIC50')?.direction).toBe('max');
    expect(potencyObjectives(['IC50'])).toEqual([{ key: 'IC50', direction: 'min' }]);
  });

  it('reproduces the published FDA front: 50 compounds, mean LogP -2.57', () => {
    expect(PAPER_REPRODUCTION_OBJECTIVES.map((o) => o.key)).toEqual(['MW', 'LogP', 'HBD', 'HBA', 'TPSA', 'RotBonds']);
    expect(PAPER_REPRODUCTION_OBJECTIVES.every((o) => o.direction === 'min' && !o.window)).toBe(true);

    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const text = readFileSync(join(root, 'paper', 'fda_approved_1949.csv'), 'utf8');
    const lines = text.split('\n').filter((l) => l.length > 0);
    const header = splitCsv(lines[0]);
    const col = (name: string) => header.indexOf(name);
    const mols = lines.slice(1).map((line) => {
      const cells = splitCsv(line);
      const num = (name: string) => Number(cells[col(name)]);
      return mol(cells[col('name')], {
        MW: num('MW'),
        LogP: num('LogP'),
        HBD: num('HBD'),
        HBA: num('HBA'),
        TPSA: num('TPSA'),
        RotBonds: num('RotBonds'),
      });
    });
    expect(mols).toHaveLength(1949);
    computeParetoAndDominance(mols, PAPER_REPRODUCTION_OBJECTIVES.map((o) => ({ ...o })));
    const front = mols.filter((m) => m.paretoRank === 1);
    expect(front).toHaveLength(50);
    const mean = front.reduce((s, m) => s + m.props.LogP, 0) / front.length;
    expect(Math.round(mean * 100) / 100).toBe(-2.57);
  });
});

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
