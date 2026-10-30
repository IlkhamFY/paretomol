// Decision record v0: a self-contained, hash-stable JSON account of one
// multi-objective decision: which molecules went in, which profile and models
// scored them, which objectives ranked them, what was picked and why.
// Schema: docs/decision-record.md.

import type { Molecule, ParetoObjective, FormulaColumn } from './types.js';
import { canonicalJSON, getProfile } from './profiles.js';
import type { ResolvedProfile } from './profiles.js';
import { mpoScore } from './mpo.js';
import { sha256Hex } from './sha256.js';

export const DECISION_RECORD_SCHEMA = 'paretomol.decision/0' as const;
/** Version of @paretomol/core that wrote the record. Keep in sync with package.json. */
export const CORE_VERSION = '0.1.0';
export const DEFAULT_ADMET_ENDPOINT = 'https://ilkhamfy-admet-ai-api.hf.space';
export const ADMET_MODEL = 'ADMET-AI v2.0.1 (Chemprop D-MPNN, TDC)';

export interface DecisionMolecule {
  id: string;
  name: string;
  smiles: string;
  /** Imported, predicted or measured columns (not RDKit descriptors, which are recomputed). */
  customProps?: Record<string, number>;
}

export interface DecisionResult {
  id: string;
  paretoRank: number | null;
  /** Linear MPO score under `profile`, rounded to 6 decimals. */
  mpo: number;
}

export interface DecisionView {
  activeTab?: string;
  formulaColumns?: FormulaColumn[];
  customPropNames?: string[];
  admetPropNames?: string[];
  propertyFilters?: Record<string, { min: number; max: number }>;
  substructureFilter?: string;
}

export interface DecisionRecord {
  schema: typeof DECISION_RECORD_SCHEMA;
  input: { sha256: string; count: number; molecules: DecisionMolecule[] };
  profile: { ref: string; hash: string };
  models: { core: string; rdkitjs: string; admet: { endpoint: string; model: string } | null };
  objectives: ParetoObjective[];
  results: DecisionResult[];
  selected: string[];
  rationale: string;
  view?: DecisionView;
  /** ISO 8601, UTC. */
  timestamp: string;
  /** `sha256:<hex>` of canonicalJSON(record without recordHash). */
  recordHash: string;
}

/** Stable molecule ids: the name, with `~2`, `~3` ... appended to repeats. */
export function moleculeIds(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((raw) => {
    const n = raw.trim() || 'mol';
    const k = (seen.get(n) ?? 0) + 1;
    seen.set(n, k);
    return k === 1 ? n : `${n}~${k}`;
  });
}

function cleanCustom(cp: Record<string, number> | undefined): Record<string, number> | undefined {
  if (!cp) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(cp)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  return Object.keys(out).length ? out : undefined;
}

/** `sha256:<hex>` over the ordered input molecules (id, name, SMILES, custom columns). */
export function inputHash(molecules: DecisionMolecule[]): string {
  return 'sha256:' + sha256Hex(canonicalJSON(molecules.map((m) => ({ id: m.id, name: m.name, smiles: m.smiles, customProps: cleanCustom(m.customProps) }))));
}

export function recordHash(rec: Omit<DecisionRecord, 'recordHash'> | DecisionRecord): string {
  const { recordHash: _omit, ...rest } = rec as DecisionRecord;
  void _omit;
  return 'sha256:' + sha256Hex(canonicalJSON(rest));
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

export interface BuildDecisionOptions {
  molecules: Molecule[];
  objectives: ParetoObjective[];
  profile?: string | ResolvedProfile;
  /** Indices into `molecules`. */
  selected?: number[];
  rationale?: string;
  rdkitVersion: string;
  /** Set when any column came from ADMET-AI; null/undefined when ADMET was not used. */
  admetEndpoint?: string | null;
  view?: DecisionView;
  timestamp?: string;
}

export function buildDecisionRecord(o: BuildDecisionOptions): DecisionRecord {
  const profile = typeof o.profile === 'string' || o.profile === undefined ? getProfile(o.profile ?? 'oral@1') : o.profile;
  const ids = moleculeIds(o.molecules.map((m) => m.name));
  const inMols: DecisionMolecule[] = o.molecules.map((m, i) => {
    const cp = cleanCustom(m.customProps);
    return cp ? { id: ids[i], name: m.name, smiles: m.smiles, customProps: cp } : { id: ids[i], name: m.name, smiles: m.smiles };
  });
  const results: DecisionResult[] = o.molecules.map((m, i) => ({
    id: ids[i],
    paretoRank: m.paretoRank ?? null,
    mpo: round6(mpoScore({ ...(m.props as unknown as Record<string, number>), ...m.customProps }, profile.desirability, 'linear').score),
  }));
  const selected = [...new Set(o.selected ?? [])].filter((i) => i >= 0 && i < ids.length).sort((a, b) => a - b).map((i) => ids[i]);
  const rec: Omit<DecisionRecord, 'recordHash'> = {
    schema: DECISION_RECORD_SCHEMA,
    input: { sha256: inputHash(inMols), count: inMols.length, molecules: inMols },
    profile: { ref: profile.ref, hash: profile.hash },
    models: {
      core: CORE_VERSION,
      rdkitjs: o.rdkitVersion,
      admet: o.admetEndpoint ? { endpoint: o.admetEndpoint, model: ADMET_MODEL } : null,
    },
    objectives: o.objectives.map((x) => ({ key: x.key, direction: x.direction })),
    results,
    selected,
    rationale: o.rationale ?? '',
    ...(o.view ? { view: o.view } : {}),
    timestamp: o.timestamp ?? new Date().toISOString(),
  };
  return { ...rec, recordHash: recordHash(rec) };
}

/** Serialize with sorted keys and 2-space indent, so the file itself is stable. */
export function stringifyDecisionRecord(rec: DecisionRecord): string {
  return JSON.stringify(JSON.parse(canonicalJSON(rec)), null, 2) + '\n';
}

/** Parse and verify a record. Throws on a wrong schema, a bad input hash,
 *  a tampered record hash, a profile hash that no longer matches the built-in
 *  profile, or selected ids that are not in the input. */
export function parseDecisionRecord(json: string | unknown): DecisionRecord {
  const rec = (typeof json === 'string' ? JSON.parse(json) : json) as DecisionRecord;
  if (!rec || typeof rec !== 'object' || rec.schema !== DECISION_RECORD_SCHEMA) throw new Error('Not a ParetoMol decision record (schema paretomol.decision/0)');
  if (!rec.input || !Array.isArray(rec.input.molecules)) throw new Error('Decision record: missing input.molecules');
  if (inputHash(rec.input.molecules) !== rec.input.sha256) throw new Error('Decision record: input hash mismatch');
  if (rec.input.count !== rec.input.molecules.length) throw new Error('Decision record: input count mismatch');
  if (recordHash(rec) !== rec.recordHash) throw new Error('Decision record: record hash mismatch (edited after export?)');
  let p: ResolvedProfile | null = null;
  try { p = getProfile(rec.profile.ref); } catch { /* unknown profile: allowed, cannot be checked */ }
  if (p && p.hash !== rec.profile.hash) throw new Error(`Decision record: profile ${rec.profile.ref} hash differs from this version of ParetoMol`);
  const ids = new Set(rec.input.molecules.map((m) => m.id));
  for (const s of rec.selected) if (!ids.has(s)) throw new Error(`Decision record: selected id not in input: ${s}`);
  return rec;
}

/** Indices of the selected molecules in input order. */
export function selectedIndices(rec: DecisionRecord): number[] {
  const sel = new Set(rec.selected);
  return rec.input.molecules.flatMap((m, i) => (sel.has(m.id) ? [i] : []));
}
