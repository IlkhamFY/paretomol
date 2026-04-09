/**
 * FDA Reference Drug types and utilities.
 * The dataset is ~157 curated FDA-approved oral drugs generated with RDKit.
 */

export interface FDADrug {
  n: string;   // name
  s: string;   // canonical SMILES
  mw: number;  // molecular weight
  logp: number;
  hbd: number; // H-bond donors
  hba: number; // H-bond acceptors
  tpsa: number;
  rb: number;  // rotatable bonds
}

/** Load the reference dataset (lazy, cached). */
let _cache: FDADrug[] | null = null;

export async function loadFDAReference(): Promise<FDADrug[]> {
  if (_cache) return _cache;
  const mod = await import('../data/fda_oral_drugs.json');
  _cache = mod.default as FDADrug[];
  return _cache;
}

/** Get the percentile rank of a value within the FDA reference distribution for a property. */
export function getFDAPercentile(
  drugs: FDADrug[],
  prop: keyof Pick<FDADrug, 'mw' | 'logp' | 'hbd' | 'hba' | 'tpsa' | 'rb'>,
  value: number
): number {
  const vals = drugs.map(d => d[prop] as number).sort((a, b) => a - b);
  const below = vals.filter(v => v < value).length;
  return Math.round((below / vals.length) * 100);
}

/** Map molecule prop key to FDA drug key */
export const PROP_TO_FDA: Record<string, keyof FDADrug | null> = {
  MW: 'mw',
  LogP: 'logp',
  HBD: 'hbd',
  HBA: 'hba',
  TPSA: 'tpsa',
  RotBonds: 'rb',
};
