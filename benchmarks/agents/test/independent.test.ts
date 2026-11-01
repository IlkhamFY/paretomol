import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDecisionRecord, parseDelimited } from '@paretomol/core';
import { paretoFront } from '@paretomol/mcp/tools';
import { TASKS } from '../tasks';

const data = (...p: string[]) => join(__dirname, '..', 'data', ...p);
const read = (name: string) => JSON.parse(readFileSync(data(name), 'utf8'));

interface Obj { key: string; direction: 'min' | 'max' }
interface Row { name: string; [key: string]: string | number }

/** Dominance from the definition, not from @paretomol/core. */
function dominates(a: Row, b: Row, objs: Obj[]): boolean {
  let better = false;
  for (const o of objs) {
    const av = a[o.key] as number, bv = b[o.key] as number;
    const aBetter = o.direction === 'min' ? av < bv : av > bv;
    const bBetter = o.direction === 'min' ? av > bv : av < bv;
    if (bBetter) return false;
    if (aBetter) better = true;
  }
  return better;
}

function relation(a: Row, b: Row, objs: Obj[]): string {
  if (dominates(a, b, objs)) return `${a.name} dominates ${b.name}`;
  if (dominates(b, a, objs)) return `${b.name} dominates ${a.name}`;
  return 'neither';
}

describe('independent ground truth', () => {
  it('pins ChEMBL_37, the license, and the cited activity rows', () => {
    const manifest = read('manifest.json');
    const activities = read('activities.json').activities as { activity_id: number; molecule_chembl_id: string; target_chembl_id: string; assay_chembl_id: string; pchembl_value: string; canonical_smiles: string; sets: string[] }[];
    const molecules = read('molecules.json').molecules as { molecule_chembl_id: string; smiles: string; pchembl: Record<string, { value: number; pchembl_value: string; activity_id: number; target_chembl_id: string }> }[];
    expect(manifest.chembl_db_version).toBe('ChEMBL_37');
    expect(manifest.license).toBe('CC BY-SA 3.0');
    expect(manifest.activity_ids).toEqual(activities.map((a) => a.activity_id));
    expect(manifest.assay_chembl_ids).toEqual([...new Set(activities.map((a) => a.assay_chembl_id))].sort());
    expect(activities.length).toBeLessThan(40);
    const csv = parseDelimited(readFileSync(data('molecules.csv'), 'utf8'), ',');
    const header = csv[0];
    const idCol = header.indexOf('activity_id');
    const pCol = header.indexOf('pchembl_value');
    expect(csv.slice(1).map((r) => Number(r[idCol]))).toEqual(activities.map((a) => a.activity_id));
    expect(csv.slice(1).map((r) => r[pCol])).toEqual(activities.map((a) => a.pchembl_value));
    for (const m of molecules) {
      for (const cell of Object.values(m.pchembl)) {
        const row = activities.find((a) => a.activity_id === cell.activity_id);
        expect(row?.pchembl_value).toBe(cell.pchembl_value);
        expect(row?.canonical_smiles).toBe(m.smiles);
        expect(Number(cell.pchembl_value)).toBe(cell.value);
      }
    }
  });

  it('recomputes the hand-checked front without core, and core agrees', async () => {
    const hand = read('hand_front.json');
    const molecules = read('molecules.json').molecules as { molecule_chembl_id: string; pchembl: Record<string, { value: number }> }[];
    const objs = hand.objectives as Obj[];
    const rows = hand.molecules as Row[];
    for (const m of rows) {
      const src = molecules.find((x) => x.molecule_chembl_id === m.molecule_chembl_id);
      expect(src?.pchembl.EGFR.value).toBe(m.pchembl_egfr);
      expect(src?.pchembl.ERBB2.value).toBe(m.pchembl_erbb2);
    }
    for (const pair of hand.pairs as { a: string; b: string; relation: string }[]) {
      const a = rows.find((r) => r.name === pair.a)!;
      const b = rows.find((r) => r.name === pair.b)!;
      expect(relation(a, b, objs)).toBe(pair.relation);
    }
    const front = rows.filter((m) => rows.every((o) => o === m || !dominates(o, m, objs))).map((m) => m.name).sort();
    expect(front).toEqual([...hand.front].sort());
    const task = TASKS.find((t) => t.id === 't24')!;
    expect(task.answer).toEqual(front);
    const viaCore = await paretoFront({ molecules: task.molecules, objectives: task.objectives });
    expect(viaCore.front.slice().sort()).toEqual(front);
  });

  it('checks the quoted CSV front from the cells, not from core', () => {
    const table = parseDelimited(readFileSync(data('quoted.csv'), 'utf8'), ',');
    const [header, ...body] = table;
    const nameAt = header.indexOf('name');
    const potAt = header.indexOf('potency');
    const bulkAt = header.indexOf('bulk');
    const rows = body.map((r) => ({ name: r[nameAt], potency: Number(r[potAt]), bulk: Number(r[bulkAt]) }));
    expect(rows).toEqual([
      { name: 'erlotinib', potency: 9, bulk: 5 },
      { name: 'gefitinib, free base', potency: 7, bulk: 2 },
      { name: 'lapatinib, ditosylate', potency: 8, bulk: 6 },
      { name: 'afatinib', potency: 6, bulk: 4 },
    ]);
    const objs: Obj[] = [{ key: 'potency', direction: 'max' }, { key: 'bulk', direction: 'min' }];
    const front = rows.filter((m) => rows.every((o) => o === m || !dominates(o, m, objs))).map((m) => m.name).sort();
    expect(TASKS.find((t) => t.id === 't25')!.answer).toEqual(front);
  });

  it('keeps the duplicate-id answer as the documented name / name~2 rule', () => {
    const table = parseDelimited(readFileSync(data('duplicate.csv'), 'utf8'), ',');
    const nameAt = table[0].indexOf('name');
    expect(table.slice(1).map((r) => r[nameAt])).toEqual(['gefitinib', 'gefitinib']);
    expect(TASKS.find((t) => t.id === 't26')!.answer).toEqual(['gefitinib', 'gefitinib~2']);
  });

  it('rejects the tampered decision record and accepts its sibling', () => {
    const ok = read('decision_ok.json');
    const bad = read('decision_tampered.json');
    expect(parseDecisionRecord(ok).input.count).toBe(2);
    expect(bad.recordHash).toBe(ok.recordHash);
    expect(bad.results[0].mpo).toBe(Math.round((ok.results[0].mpo + 1) * 1e6) / 1e6);
    expect(() => parseDecisionRecord(bad)).toThrow(/record hash/);
    expect(TASKS.find((t) => t.id === 't27')!.answer).toBe('fail');
  });

  it('regenerates RDKit Python descriptors onto the committed file', () => {
    execFileSync('python3', [join(__dirname, '..', 'build', 'rdkit_descriptors.py'), '--check'], { stdio: 'inherit' });
    const py = read('rdkit_python.json');
    expect(py.rdkit).toBe('2026.03.4');
    for (const id of ['t21', 't22', 't23']) {
      const t = TASKS.find((x) => x.id === id)!;
      const row = py.molecules.find((m: { name: string }) => m.name === t.descriptor!.name);
      expect(t.answer).toBe(row[t.descriptor!.key]);
      expect(t.source).toBe('rdkit-python');
    }
  });
});
