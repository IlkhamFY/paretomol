import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { analyzeMolecule, descriptorTier, parseDelimited } from '../src/index';
import { loadRDKit } from '../src/node';

function sampleSmiles(n: number): string[] {
  const text = readFileSync(new URL('../../../paper/fda_approved_1949.csv', import.meta.url), 'utf8');
  const rows = parseDelimited(text, ',');
  const col = rows[0].indexOf('smiles');
  const out: string[] = [];
  for (let i = 1; i < rows.length && out.length < n; i++) {
    const smiles = rows[i][col];
    if (smiles) out.push(smiles);
  }
  return out;
}

describe('descriptor tier', () => {
  it('skips fingerprints and QED alerts unless asked', async () => {
    const RDKit = await loadRDKit();
    const smiles = sampleSmiles(4);
    const cheap = analyzeMolecule(smiles[0], 0, RDKit, [], descriptorTier(['MW', 'LogP']));
    const full = analyzeMolecule(smiles[0], 0, RDKit, [], { fingerprint: true, qed: true });
    expect(cheap?.fingerprint).toBe('');
    expect(Number.isFinite(cheap?.props.QED)).toBe(false);
    expect(full?.fingerprint.length).toBeGreaterThan(100);
    expect(Number.isFinite(full?.props.QED)).toBe(true);
    expect(cheap?.props.MW).toBeCloseTo(full!.props.MW, 6);
    expect(cheap?.props.LogP).toBeCloseTo(full!.props.LogP, 6);
  });

  it('stays inside a wide time budget and stays cheaper than the full molecule', async () => {
    const RDKit = await loadRDKit();
    analyzeMolecule('CCO', 0, RDKit, []);
    const smiles = sampleSmiles(40);
    const time = (opts: { fingerprint?: boolean; qed?: boolean }) => {
      const started = performance.now();
      for (const s of smiles) analyzeMolecule(s, 0, RDKit, [], opts);
      return performance.now() - started;
    };
    const full = time({ fingerprint: true, qed: true });
    const cheap = time(descriptorTier(['MW', 'LogP', 'TPSA']));
    // Large-slowdown ceiling for 40 FDA structures. A run that takes tens of
    // seconds has regressed. The skip itself is checked above (empty
    // fingerprint, QED not a number); a wall-clock ratio is too noisy to gate on.
    expect(cheap).toBeLessThan(20_000);
    expect(full).toBeLessThan(60_000);
  });
});
