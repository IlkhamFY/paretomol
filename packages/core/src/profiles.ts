// Versioned scoring profiles. The JSON files in ../profiles are the source of
// truth; each is identified by `id@version` and by a SHA-256 content hash of
// its canonical JSON, so a decision record can cite exactly which thresholds
// were applied. Any change to a profile's content must bump its version.

import type { ParetoObjective } from './types.js';
import type { PropDesirability } from './mpo.js';
import { sha256Hex } from './sha256.js';
import oral1 from '../profiles/oral@1.json' with { type: 'json' };
import cns1 from '../profiles/cns@1.json' with { type: 'json' };
import leadlike1 from '../profiles/leadlike@1.json' with { type: 'json' };
import lipinski1 from '../profiles/lipinski@1.json' with { type: 'json' };
import custom1 from '../profiles/custom@1.json' with { type: 'json' };

export interface ProfileFilterRule { key: string; op: '<=' | '>=' | '<' | '>'; val: number; }

export interface ScoringProfile {
  schema: 'paretomol.profile/1';
  id: string;
  version: number;
  label: string;
  description: string;
  objectives: ParetoObjective[];
  desirability: Record<string, PropDesirability>;
  filter?: { rules: ProfileFilterRule[]; maxViolations: number };
}

export interface ResolvedProfile extends ScoringProfile {
  /** `id@version`, e.g. `oral@1`. */
  ref: string;
  /** `sha256:<hex>` of canonicalJSON(profile). */
  hash: string;
}

/** Deterministic JSON: object keys sorted, no whitespace. Arrays keep order. */
export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('canonicalJSON: non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJSON(obj[k])).join(',') + '}';
}

export function profileHash(profile: ScoringProfile): string {
  return 'sha256:' + sha256Hex(canonicalJSON(profile));
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o as object)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

function resolve(p: ScoringProfile): ResolvedProfile {
  const copy = JSON.parse(JSON.stringify(p)) as ScoringProfile;
  return deepFreeze({ ...copy, ref: `${copy.id}@${copy.version}`, hash: profileHash(copy) });
}

const BUILTIN: ResolvedProfile[] = [oral1, cns1, leadlike1, lipinski1, custom1].map((p) =>
  resolve(p as unknown as ScoringProfile),
);

/** All built-in profiles (every version). */
export function listProfiles(): readonly ResolvedProfile[] {
  return BUILTIN;
}

/** Look up a profile by `id@version`, or by bare `id` for the latest version.
 *  Throws on an unknown reference rather than falling back silently. */
export function getProfile(ref: string): ResolvedProfile {
  const [id, ver] = ref.split('@');
  const matches = BUILTIN.filter((p) => p.id === id && (ver === undefined || p.version === Number(ver)));
  if (matches.length === 0) throw new Error(`Unknown scoring profile: ${ref}`);
  return matches.reduce((a, b) => (b.version > a.version ? b : a));
}

/** Validate an arbitrary (e.g. user-supplied) profile object and return it resolved with its hash. */
export function loadProfile(json: unknown): ResolvedProfile {
  const p = json as ScoringProfile;
  if (!p || typeof p !== 'object') throw new Error('Profile must be an object');
  if (p.schema !== 'paretomol.profile/1') throw new Error('Unsupported profile schema');
  if (typeof p.id !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(p.id)) throw new Error('Invalid profile id');
  if (!Number.isInteger(p.version) || p.version < 1) throw new Error('Invalid profile version');
  if (!Array.isArray(p.objectives) || p.objectives.some((o) => o.direction !== 'min' && o.direction !== 'max'))
    throw new Error('Invalid objectives');
  for (const [k, d] of Object.entries(p.desirability ?? {})) {
    if (!(d.acceptMin <= d.idealMin && d.idealMin <= d.idealMax && d.idealMax <= d.acceptMax))
      throw new Error(`Desirability window for ${k} must satisfy acceptMin <= idealMin <= idealMax <= acceptMax`);
  }
  return resolve(p);
}
