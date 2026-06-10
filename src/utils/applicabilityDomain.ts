// ─── Applicability domain (structural + property-space proxy) ─────────────────
// A reliability cue for the ADMET predictions: is a query molecule close to the
// kind of chemistry the models have seen, or an extrapolation? We approximate the
// model's domain with the bundled ~150 approved oral drugs — nearest-neighbour
// ECFP4 (Morgan r2, 2048-bit) Tanimoto similarity, plus how many physicochemical
// descriptors fall outside that reference's central [5th, 95th] percentile range.
//
// This is an honest PROXY, not the exact ADMET-AI (TDC) training set: it measures
// "how approved-drug-like" a molecule is, structurally and by properties. Compounds
// flagged "novel" are outside that space and their predictions are extrapolations.

import type { Molecule } from './types';
import { loadFDAReference, type FDADrug } from './fda_reference';
import { packFingerprint, tanimotoPacked } from './chem';

const PROPS: { key: string; fda: keyof FDADrug }[] = [
  { key: 'MW', fda: 'mw' },
  { key: 'LogP', fda: 'logp' },
  { key: 'TPSA', fda: 'tpsa' },
  { key: 'HBD', fda: 'hbd' },
  { key: 'HBA', fda: 'hba' },
  { key: 'RotBonds', fda: 'rb' },
];

export type DomainVerdict = 'typical' | 'edge' | 'novel';

export interface DomainResult {
  /** Max Tanimoto (ECFP4) to the approved-drug reference, 0–1 (higher = more drug-like). */
  nn: number;
  /** Physicochemical descriptors outside the reference's [5th, 95th] percentile range. */
  outProps: string[];
  verdict: DomainVerdict;
}

interface DomainReference {
  fps: Uint32Array[];
  sorted: Record<string, number[]>; // fda key -> ascending reference values
}

let _ref: DomainReference | null = null;

type RDKitMol = { is_valid: () => boolean; delete: () => void; get_morgan_fp: (o: string) => string };
type RDKitModule = { get_mol: (s: string) => RDKitMol | null };

/** Lazily build the approved-drug reference (ECFP4 fingerprints + sorted property arrays). Cached. */
export async function loadDomainReference(): Promise<DomainReference | null> {
  if (_ref) return _ref;
  const RDKit = (globalThis as { RDKitModule?: RDKitModule }).RDKitModule;
  if (!RDKit) return null;
  const drugs = await loadFDAReference();
  const fps: Uint32Array[] = [];
  for (const d of drugs) {
    try {
      const m = RDKit.get_mol(d.s);
      if (m && m.is_valid()) {
        fps.push(packFingerprint(m.get_morgan_fp(JSON.stringify({ radius: 2, nBits: 2048 }))));
      }
      m?.delete();
    } catch { /* skip invalid reference SMILES */ }
  }
  const sorted: Record<string, number[]> = {};
  for (const { fda } of PROPS) {
    sorted[fda] = drugs.map(d => d[fda] as number).sort((a, b) => a - b);
  }
  _ref = { fps, sorted };
  return _ref;
}

/** Fraction (0–100) of reference values strictly below `value`. */
function percentile(sortedAsc: number[], value: number): number {
  let lo = 0, hi = sortedAsc.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sortedAsc[mid] < value) lo = mid + 1; else hi = mid; }
  return (lo / sortedAsc.length) * 100;
}

/** Assess whether a molecule sits inside the approved-drug structural + property space. */
export function assessDomain(mol: Molecule, ref: DomainReference): DomainResult {
  let nn = 0;
  for (const fp of ref.fps) {
    const t = tanimotoPacked(mol.fpPacked, fp);
    if (t > nn) nn = t;
  }
  const outProps: string[] = [];
  for (const { key, fda } of PROPS) {
    const v = (mol.props as unknown as Record<string, number>)[key];
    if (typeof v !== 'number' || !isFinite(v)) continue;
    const pct = percentile(ref.sorted[fda], v);
    if (pct < 5 || pct > 95) outProps.push(key);
  }
  const verdict: DomainVerdict =
    (nn < 0.25 || outProps.length >= 3) ? 'novel'
    : (nn < 0.40 || outProps.length >= 1) ? 'edge'
    : 'typical';
  return { nn, outProps, verdict };
}
