import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDecisionRecord, getProfile } from '@paretomol/core';
import { rank, parseObjectives, loadRDKit } from '../src/rank';
import { main } from '../src/main';

/** First 1000 FDA-approved drugs from the deposited reference set, as SMILES lines. */
function thousandSmiles(): string {
  const rows = readFileSync(join(__dirname, '..', '..', '..', 'paper', 'fda_approved_1949.csv'), 'utf8').split('\n').slice(1)
    .filter((r) => r && !r.startsWith('"')).slice(0, 1000); // skip quoted names (commas inside)
  return rows.map((r, i) => { const [name, , smi] = r.split(','); return `${smi} ${name.replace(/\W+/g, '_')}_${i}`; }).join('\n');
}

describe('paretomol rank', () => {
  it('ranks SMILES lines and builds a valid record', async () => {
    const { record, errors } = await rank('CCO ethanol\nc1ccccc1 benzene\nnot_a_smiles x\nCN1C=NC2=C1C(=O)N(C(=O)N2C)C caffeine', { select: ['benzene'], timestamp: '2026-10-30T00:00:00.000Z' });
    expect(errors).toBe(1);
    expect(record.input.count).toBe(3);
    expect(record.selected).toEqual(['benzene']);
    expect(record.profile).toEqual({ ref: 'oral@1', hash: getProfile('oral@1').hash });
    expect(record.models.rdkitjs).toMatch(/^2025\.03\.4/);
    expect(parseDecisionRecord(JSON.parse(JSON.stringify(record)))).toEqual(record);
    expect(record.results.every((r) => r.paretoRank !== null)).toBe(true);
  });

  it('is deterministic with a fixed timestamp', async () => {
    const a = await rank('CCO a\nCCN b', { timestamp: 't' }), b = await rank('CCO a\nCCN b', { timestamp: 't' });
    expect(a.record.recordHash).toBe(b.record.recordHash);
  });

  it('infers objectives from CSV columns like the app', async () => {
    const { record } = await rank('smiles,name,pIC50,notes_id\nCCO,a,5,1\nCCCO,b,6,2\n');
    expect(record.objectives.map((o) => `${o.key}:${o.direction}`)).toContain('pIC50:max');
    expect(record.input.molecules[0].customProps).toEqual({ pIC50: 5, notes_id: 1 });
  });

  it('parses objective specs', () => {
    expect(parseObjectives('MW:min, pIC50:max')).toEqual([{ key: 'MW', direction: 'min' }, { key: 'pIC50', direction: 'max' }]);
    expect(() => parseObjectives('MW:up')).toThrow();
  });

  it('ranks 1000 SMILES in under 10 s', async () => {
    await loadRDKit();
    const t0 = performance.now();
    const { record, errors } = await rank(thousandSmiles());
    expect(errors).toBe(0);
    const s = (performance.now() - t0) / 1000;
    expect(record.input.count).toBe(1000);
    expect(s).toBeLessThan(10);
  }, 60_000);

  it('CLI writes a record file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pm-cli-'));
    const inp = join(dir, 'in.smi'), out = join(dir, 'rec.json');
    (await import('node:fs')).writeFileSync(inp, 'CCO ethanol\nCCN ethylamine\n');
    const err = process.stderr.write; process.stderr.write = () => true;
    try {
      expect(await main(['rank', inp, '--profile', 'oral@1', '--out', out])).toBe(0);
      expect(await main(['bogus'])).toBe(1);
    }
    finally { process.stderr.write = err; }
    const rec = parseDecisionRecord(readFileSync(out, 'utf8'));
    expect(rec.input.count).toBe(2);
  });
});
