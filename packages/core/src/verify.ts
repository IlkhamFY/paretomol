// ─── Claim verifier ──────────────────────────────────────────────────────────
// An agent (or a person) says "molecule X has MW 312.4 and we minimise IC50".
// This recomputes what can be recomputed with RDKit.js and checks directions
// against the ones ParetoMol knows, then flags what does not hold. It never
// guesses: properties it cannot recompute and objectives with no established
// direction are reported as unchecked, not as wrong.

import { analyzeMolecule } from './analyze.js';
import type { RDKitLike } from './analyze.js';
import { inferObjectiveDirection } from './objectives.js';
import type { Direction } from './objectives.js';
import type { MolProps } from './types.js';

export interface Claim {
  id?: string;
  smiles: string;
  /** Claimed values, keyed by descriptor name (aliases accepted, e.g. cLogP, Fsp3, RotB). */
  properties?: Record<string, number>;
  /** Claimed optimisation directions. */
  objectives?: { key: string; direction: Direction }[];
}

export interface Tolerance { abs: number; rel?: number }

/** Default tolerances. Counts are exact; continuous values allow for rounding
 *  and for small differences between toolkits (Crippen LogP, average MW). */
export const DEFAULT_TOLERANCES: Record<keyof Pick<MolProps, 'MW' | 'LogP' | 'HBD' | 'HBA' | 'TPSA' | 'RotBonds' | 'FrCSP3' | 'Rings' | 'AromaticRings' | 'HeavyAtoms' | 'MR' | 'QED'>, Tolerance> = {
  MW: { abs: 0.5 },
  LogP: { abs: 0.5 },
  TPSA: { abs: 1.5 },
  MR: { abs: 1.5 },
  QED: { abs: 0.02 },
  FrCSP3: { abs: 0.02 },
  HBD: { abs: 0 },
  HBA: { abs: 0 },
  RotBonds: { abs: 0 },
  Rings: { abs: 0 },
  AromaticRings: { abs: 0 },
  HeavyAtoms: { abs: 0 },
};

type Checked = keyof typeof DEFAULT_TOLERANCES;

const ALIASES: Record<string, Checked> = {
  mw: 'MW', molwt: 'MW', molecularweight: 'MW', amw: 'MW',
  logp: 'LogP', clogp: 'LogP', alogp: 'LogP', crippenlogp: 'LogP', slogp: 'LogP',
  hbd: 'HBD', numhdonors: 'HBD', hdonors: 'HBD',
  hba: 'HBA', numhacceptors: 'HBA', hacceptors: 'HBA',
  tpsa: 'TPSA', psa: 'TPSA',
  rotbonds: 'RotBonds', rotb: 'RotBonds', numrotatablebonds: 'RotBonds', rotatablebonds: 'RotBonds',
  frcsp3: 'FrCSP3', fsp3: 'FrCSP3', fractioncsp3: 'FrCSP3',
  rings: 'Rings', numrings: 'Rings', ringcount: 'Rings',
  aromaticrings: 'AromaticRings', numaromaticrings: 'AromaticRings',
  heavyatoms: 'HeavyAtoms', heavyatomcount: 'HeavyAtoms', numheavyatoms: 'HeavyAtoms',
  mr: 'MR', molmr: 'MR',
  qed: 'QED',
};

/** Canonical descriptor name for a claimed key, or null when it is not recomputed. */
export function canonicalProperty(key: string): Checked | null {
  return ALIASES[key.toLowerCase().replace(/[^a-z0-9]/g, '')] ?? null;
}

/** Directions that hold regardless of project: higher QED is better, a higher
 *  synthetic-accessibility or complexity score is worse. Everything else falls
 *  back to inferObjectiveDirection (pIC50 max, IC50 min, hERG min ...). MW,
 *  LogP and TPSA have no universal direction and are left unchecked. */
const KNOWN_DIRECTIONS: Record<string, Direction> = {
  qed: 'max', sc: 'min', sascore: 'min', sa: 'min', scscore: 'min', rascore: 'max', vendors: 'max',
};

export function expectedDirection(key: string): Direction | null {
  return KNOWN_DIRECTIONS[key.toLowerCase().replace(/[^a-z0-9]/g, '')] ?? inferObjectiveDirection(key);
}

export type FlagKind = 'invalid_smiles' | 'value_mismatch' | 'direction_flipped';

export interface Flag {
  id: string;
  kind: FlagKind;
  key?: string;
  claimed?: number | Direction;
  actual?: number | Direction;
  tolerance?: number;
  message: string;
}

export interface VerifyReport {
  ok: boolean;
  flags: Flag[];
  /** Number of property values and directions actually checked. */
  checked: number;
  /** Claimed keys that could not be checked, per claim id. */
  unchecked: Record<string, string[]>;
}

export interface VerifyOptions { tolerances?: Partial<Record<Checked, Tolerance>> }

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

export function verifyClaims(claims: Claim[], RDKit: RDKitLike, opts: VerifyOptions = {}): VerifyReport {
  const tol = { ...DEFAULT_TOLERANCES, ...(opts.tolerances ?? {}) };
  const flags: Flag[] = [];
  const unchecked: Record<string, string[]> = {};
  let checked = 0;
  claims.forEach((c, i) => {
    const id = c.id ?? `claim_${i + 1}`;
    const skip: string[] = [];
    const m = analyzeMolecule(`${c.smiles} ${id.replace(/\s+/g, '_')}`, i, RDKit, []);
    if (!m) {
      flags.push({ id, kind: 'invalid_smiles', message: `${id}: SMILES does not parse: ${c.smiles}` });
    } else {
      for (const [key, claimed] of Object.entries(c.properties ?? {})) {
        const k = canonicalProperty(key);
        if (!k || typeof claimed !== 'number') { skip.push(key); continue; }
        const actual = m.props[k] as number;
        const t = tol[k];
        const allowed = Math.max(t.abs, (t.rel ?? 0) * Math.abs(actual)) + 1e-9;
        checked++;
        if (!(Math.abs(claimed - actual) <= allowed)) {
          flags.push({ id, kind: 'value_mismatch', key, claimed, actual: r4(actual), tolerance: t.abs, message: `${id}: ${key} claimed ${claimed}, RDKit gives ${r4(actual)} (tolerance ±${t.abs})` });
        }
      }
    }
    for (const o of c.objectives ?? []) {
      const exp = expectedDirection(o.key);
      if (!exp) { skip.push(`objective:${o.key}`); continue; }
      checked++;
      if (o.direction !== exp) {
        flags.push({ id, kind: 'direction_flipped', key: o.key, claimed: o.direction, actual: exp, message: `${id}: ${o.key} should be ${exp === 'max' ? 'maximised' : 'minimised'}, claim says ${o.direction}` });
      }
    }
    if (skip.length) unchecked[id] = skip;
  });
  return { ok: flags.length === 0, flags, checked, unchecked };
}
