// Decision record. Writers emit paretomol.decision/1. Readers still accept
// paretomol.decision/0. Schema: docs/decision-record.md.
//
// A v1 record embeds the desirability windows and curve that scored it, names
// the RDKit WASM by hash, and stores Pareto ranks and MPO that this module
// computed. It does not copy a rank the caller already had.

import type { Molecule, ParetoObjective, FormulaColumn } from './types.js';
import { canonicalJSON, getProfile } from './profiles.js';
import type { ResolvedProfile } from './profiles.js';
import { mpoScore } from './mpo.js';
import type { CurveType, PropDesirability } from './mpo.js';
import { computeParetoAndDominance } from './pareto.js';
import { sha256Hex } from './sha256.js';
import { CORE_VERSION } from './version.js';
import { RDKIT_WASM_SHA256 } from './rdkitBuild.js';

export const DECISION_RECORD_SCHEMA_V0 = 'paretomol.decision/0' as const;
/** Schema written by buildDecisionRecord. */
export const DECISION_RECORD_SCHEMA = 'paretomol.decision/1' as const;
export { CORE_VERSION };
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
  /** MPO under the embedded windows and curve, rounded to 6 decimals. */
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

export type ReviewVerdict = 'accept' | 'reject';

export interface DecisionReview {
  /** Who produced the review link, e.g. the agent name. */
  source?: string;
  /** Per molecule id; molecules without a verdict were left undecided. */
  decisions: Record<string, ReviewVerdict>;
  /** Molecule ids the agent suggested. */
  suggested?: string[];
}

/** RDKit.js build recorded on a v1 record. v0 stored only the version string. */
export interface DecisionRdkit {
  /** `RDKit.version()`. */
  version: string;
  /** `sha256:<hex>` of the pinned RDKit_minimal.wasm. */
  sha256: string;
}

export interface DecisionProfile {
  ref: string;
  hash: string;
  /** MPO curve used for `results.mpo`. Absent on older v0 records; readers treat that as linear. */
  curve?: CurveType;
  /** Desirability windows that were applied. Required on v1 so a custom profile can be scored again. */
  windows?: Record<string, PropDesirability>;
}

export interface DecisionRecord {
  schema: typeof DECISION_RECORD_SCHEMA | typeof DECISION_RECORD_SCHEMA_V0;
  input: { sha256: string; count: number; molecules: DecisionMolecule[] };
  profile: DecisionProfile;
  models: {
    core: string;
    rdkitjs: string | DecisionRdkit;
    admet: { endpoint: string; model: string } | null;
  };
  objectives: ParetoObjective[];
  results: DecisionResult[];
  selected: string[];
  rationale: string;
  view?: DecisionView;
  /** Present when the decision came from an open review link (docs/review-url.md). */
  review?: DecisionReview;
  /** ISO 8601, UTC. */
  timestamp: string;
  /** `sha256:<hex>` of canonicalJSON(record without recordHash). */
  recordHash: string;
}

/**
 * Stable molecule ids. The first use of a name keeps that name. A repeat gets
 * `~2`, `~3`, ... skipping any id already taken, including a later molecule
 * whose name is itself `name~2`. Blank names become `mol`.
 */
export function moleculeIds(names: string[]): string[] {
  const bases = names.map((raw) => raw.trim() || 'mol');
  const first = new Map<string, number>();
  bases.forEach((b, i) => { if (!first.has(b)) first.set(b, i); });
  const used = new Set<string>();
  const out = new Array<string>(bases.length);
  for (const [base, i] of first) {
    out[i] = base;
    used.add(base);
  }
  const next = new Map<string, number>();
  for (let i = 0; i < bases.length; i++) {
    if (out[i] !== undefined) continue;
    const base = bases[i];
    let k = next.get(base) ?? 2;
    let id = `${base}~${k}`;
    while (used.has(id)) {
      k += 1;
      id = `${base}~${k}`;
    }
    next.set(base, k + 1);
    used.add(id);
    out[i] = id;
  }
  return out;
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

function buildReview(r: NonNullable<BuildDecisionOptions['review']>, ids: string[]): DecisionReview {
  const decisions: Record<string, ReviewVerdict> = {};
  for (const [k, v] of Object.entries(r.decisions)) {
    const i = Number(k);
    if (Number.isInteger(i) && i >= 0 && i < ids.length && (v === 'accept' || v === 'reject')) decisions[ids[i]] = v;
  }
  const out: DecisionReview = { decisions };
  if (r.source) out.source = r.source;
  if (r.suggested?.length) out.suggested = [...new Set(r.suggested)].filter((i) => i >= 0 && i < ids.length).sort((a, b) => a - b).map((i) => ids[i]);
  return out;
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

export function acceptedIds(decisions: Record<string, ReviewVerdict> | undefined): string[] {
  return Object.entries(decisions ?? {}).filter(([, v]) => v === 'accept').map(([id]) => id).sort();
}

function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const as = [...a].sort();
  const bs = [...b].sort();
  return as.every((id, i) => id === bs[i]);
}

export function validWindows(w: unknown): w is Record<string, PropDesirability> {
  if (!w || typeof w !== 'object' || Array.isArray(w)) return false;
  for (const d of Object.values(w as Record<string, unknown>)) {
    if (!d || typeof d !== 'object') return false;
    const win = d as PropDesirability;
    for (const k of ['idealMin', 'idealMax', 'acceptMin', 'acceptMax'] as const) {
      if (typeof win[k] !== 'number' || !Number.isFinite(win[k])) return false;
    }
  }
  return true;
}

function windowsMatch(a: Record<string, PropDesirability>, b: Record<string, PropDesirability>): boolean {
  return canonicalJSON(a) === canonicalJSON(b);
}

/** Ranks and MPO from the molecules' descriptors and the stated objectives. Does not read `paretoRank`. */
function scoreResults(
  molecules: Molecule[],
  objectives: ParetoObjective[],
  windows: Record<string, PropDesirability>,
  curve: CurveType,
  ids: string[],
): DecisionResult[] {
  const working = molecules.map((m) => ({
    ...m,
    customProps: { ...(m.customProps ?? {}) },
    dominates: [] as number[],
    dominatedBy: [] as number[],
    paretoRank: null as number | null,
  }));
  computeParetoAndDominance(working, objectives);
  return working.map((m, i) => ({
    id: ids[i],
    paretoRank: m.paretoRank ?? null,
    mpo: round6(mpoScore({ ...(m.props as unknown as Record<string, number>), ...m.customProps }, windows, curve).score),
  }));
}

export interface BuildDecisionOptions {
  molecules: Molecule[];
  objectives: ParetoObjective[];
  profile?: string | ResolvedProfile;
  /** MPO curve the user applied. Default linear (CLI, and review export). */
  curve?: CurveType;
  /** Indices into `molecules`. When `review` is set, these must be the accepted molecules. */
  selected?: number[];
  rationale?: string;
  rdkitVersion: string;
  /** Set when any column came from ADMET-AI; null/undefined when ADMET was not used. */
  admetEndpoint?: string | null;
  view?: DecisionView;
  /** Review verdicts keyed by molecule index. */
  review?: { source?: string; decisions: Record<number, ReviewVerdict>; suggested?: number[] };
  timestamp?: string;
}

export function buildDecisionRecord(o: BuildDecisionOptions): DecisionRecord {
  const profile = typeof o.profile === 'string' || o.profile === undefined ? getProfile(o.profile ?? 'oral@1') : o.profile;
  if (o.curve !== undefined && o.curve !== 'linear' && o.curve !== 'sigmoid') throw new Error('Decision record: curve must be linear or sigmoid');
  const curve: CurveType = o.curve ?? 'linear';
  const ids = moleculeIds(o.molecules.map((m) => m.name));
  const inMols: DecisionMolecule[] = o.molecules.map((m, i) => {
    const cp = cleanCustom(m.customProps);
    return cp ? { id: ids[i], name: m.name, smiles: m.smiles, customProps: cp } : { id: ids[i], name: m.name, smiles: m.smiles };
  });
  const windows = JSON.parse(JSON.stringify(profile.desirability)) as Record<string, PropDesirability>;
  const results = scoreResults(o.molecules, o.objectives, windows, curve, ids);
  const selected = [...new Set(o.selected ?? [])].filter((i) => i >= 0 && i < ids.length).sort((a, b) => a - b).map((i) => ids[i]);
  const review = o.review ? buildReview(o.review, ids) : undefined;
  if (review && !sameIdSet(selected, acceptedIds(review.decisions))) {
    throw new Error('Decision record: selected ids do not match accepted review decisions');
  }
  const rec: Omit<DecisionRecord, 'recordHash'> = {
    schema: DECISION_RECORD_SCHEMA,
    input: { sha256: inputHash(inMols), count: inMols.length, molecules: inMols },
    profile: { ref: profile.ref, hash: profile.hash, curve, windows },
    models: {
      core: CORE_VERSION,
      rdkitjs: { version: o.rdkitVersion, sha256: RDKIT_WASM_SHA256 },
      admet: o.admetEndpoint ? { endpoint: o.admetEndpoint, model: ADMET_MODEL } : null,
    },
    objectives: o.objectives.map((x) => ({ key: x.key, direction: x.direction })),
    results,
    selected,
    rationale: o.rationale ?? '',
    ...(o.view ? { view: o.view } : {}),
    ...(review ? { review } : {}),
    timestamp: o.timestamp ?? new Date().toISOString(),
  };
  return { ...rec, recordHash: recordHash(rec) };
}

/** Serialize with sorted keys and 2-space indent, so the file itself is stable. */
export function stringifyDecisionRecord(rec: DecisionRecord): string {
  return JSON.stringify(JSON.parse(canonicalJSON(rec)), null, 2) + '\n';
}

function isSchema(s: unknown): s is DecisionRecord['schema'] {
  return s === DECISION_RECORD_SCHEMA || s === DECISION_RECORD_SCHEMA_V0;
}

/** Parse and verify a record. Throws on a wrong schema, a bad input hash,
 *  a tampered record hash, a profile hash that no longer matches the built-in
 *  profile, or selected ids that are not in the input.
 *  v1 also requires unique ids, embedded windows, the WASM hash of this build,
 *  and `selected` equal to the accepted review ids. v0 records still open. */
export function parseDecisionRecord(json: string | unknown): DecisionRecord {
  const rec = (typeof json === 'string' ? JSON.parse(json) : json) as DecisionRecord;
  if (!rec || typeof rec !== 'object' || !isSchema(rec.schema)) {
    throw new Error('Not a ParetoMol decision record (schema paretomol.decision/0 or paretomol.decision/1)');
  }
  if (!rec.input || !Array.isArray(rec.input.molecules)) throw new Error('Decision record: missing input.molecules');
  if (inputHash(rec.input.molecules) !== rec.input.sha256) throw new Error('Decision record: input hash mismatch');
  if (rec.input.count !== rec.input.molecules.length) throw new Error('Decision record: input count mismatch');
  if (recordHash(rec) !== rec.recordHash) throw new Error('Decision record: record hash mismatch (edited after export?)');
  let p: ResolvedProfile | null = null;
  try { p = getProfile(rec.profile.ref); } catch { /* unknown profile: allowed, cannot be checked */ }
  if (p && p.hash !== rec.profile.hash) throw new Error(`Decision record: profile ${rec.profile.ref} hash differs from this version of ParetoMol`);
  if (rec.profile.curve !== undefined && rec.profile.curve !== 'linear' && rec.profile.curve !== 'sigmoid') throw new Error('Decision record: profile.curve must be linear or sigmoid');
  const ids = rec.input.molecules.map((m) => m.id);
  const idSet = new Set(ids);
  if (rec.schema === DECISION_RECORD_SCHEMA) {
    if (idSet.size !== ids.length) {
      const seen = new Set<string>();
      for (const id of ids) {
        if (seen.has(id)) throw new Error(`Decision record: duplicate input id: ${id}`);
        seen.add(id);
      }
    }
    if (!validWindows(rec.profile.windows)) throw new Error('Decision record: profile.windows must be desirability windows');
    if (rec.profile.curve !== 'linear' && rec.profile.curve !== 'sigmoid') throw new Error('Decision record: profile.curve must be linear or sigmoid');
    const rj = rec.models?.rdkitjs;
    if (!rj || typeof rj === 'string' || typeof rj.version !== 'string' || typeof rj.sha256 !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(rj.sha256)) {
      throw new Error('Decision record: models.rdkitjs must include a version and a sha256 hash');
    }
    if (rj.sha256 !== RDKIT_WASM_SHA256) throw new Error('Decision record: rdkitjs hash does not match this build');
    if (p && !windowsMatch(rec.profile.windows, p.desirability)) {
      throw new Error(`Decision record: profile ${rec.profile.ref} windows differ from this version of ParetoMol`);
    }
    if (rec.review && !sameIdSet(rec.selected ?? [], acceptedIds(rec.review.decisions))) {
      throw new Error('Decision record: selected ids do not match accepted review decisions');
    }
  }
  for (const s of rec.selected ?? []) if (!idSet.has(s)) throw new Error(`Decision record: selected id not in input: ${s}`);
  if (rec.review) {
    for (const [id, v] of Object.entries(rec.review.decisions ?? {})) {
      if (!idSet.has(id)) throw new Error(`Decision record: review decision for unknown id: ${id}`);
      if (v !== 'accept' && v !== 'reject') throw new Error(`Decision record: review decision must be accept or reject: ${id}`);
    }
  }
  return rec;
}

/** Indices of the selected molecules in input order. */
export function selectedIndices(rec: DecisionRecord): number[] {
  const sel = new Set(rec.selected);
  return rec.input.molecules.flatMap((m, i) => (sel.has(m.id) ? [i] : []));
}
