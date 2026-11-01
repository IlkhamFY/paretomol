// Recompute a decision record: hashes first (the same checks as
// parseDecisionRecord), then Pareto rank and MPO with RDKit.
// A hash failure still produces a rank/MPO diff when the molecules parse.
// v1 scores from the embedded windows and curve. v0 uses the built-in profile
// and treats a missing curve as linear.

import { analyzeMolecule, descriptorTier, type RDKitLike } from './analyze.js';
import {
  DECISION_RECORD_SCHEMA, DECISION_RECORD_SCHEMA_V0, parseDecisionRecord, validWindows,
  type DecisionRecord, type DecisionResult,
} from './decision.js';
import { mpoScore, type CurveType, type PropDesirability } from './mpo.js';
import { computeParetoAndDominance } from './pareto.js';
import { getProfile } from './profiles.js';
import type { Molecule, ParetoObjective } from './types.js';

export type DecisionIssueCode =
  | 'schema'
  | 'hash'
  | 'count'
  | 'selection'
  | 'profile'
  | 'invalid_smiles'
  | 'rank'
  | 'mpo';

export interface DecisionIssue {
  code: DecisionIssueCode;
  message: string;
  id?: string;
  field?: 'paretoRank' | 'mpo';
  claimed?: number | null;
  actual?: number | null;
}

export interface RecomputedRow {
  id: string;
  paretoRank: number | null;
  /** Null when the profile is unknown and MPO could not be recomputed. */
  mpo: number | null;
}

export interface DecisionCheck {
  ok: boolean;
  issues: DecisionIssue[];
  recomputed: RecomputedRow[];
  /** RDKit.js version that recomputed the record, when one was loaded. */
  rdkitVersion: string;
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

function classify(message: string): DecisionIssue {
  if (message.includes('hash')) return { code: 'hash', message };
  if (message.includes('duplicate') || message.includes('count')) return { code: 'count', message };
  if (message.includes('selected') || message.includes('review decision')) return { code: 'selection', message };
  if (message.includes('profile') && !message.includes('hash')) return { code: 'profile', message };
  return { code: 'schema', message };
}

function usable(rec: DecisionRecord): boolean {
  return !!rec
    && (rec.schema === DECISION_RECORD_SCHEMA || rec.schema === DECISION_RECORD_SCHEMA_V0)
    && !!rec.input && Array.isArray(rec.input.molecules)
    && Array.isArray(rec.results)
    && Array.isArray(rec.objectives)
    && rec.objectives.every((o) => o && typeof o.key === 'string' && (o.direction === 'min' || o.direction === 'max'));
}

function curveOf(rec: DecisionRecord): CurveType {
  return rec.profile?.curve === 'sigmoid' ? 'sigmoid' : 'linear';
}

/** Check a decision record and recompute its front and MPO. Does not throw. */
export function verifyDecision(json: string | unknown, RDKit: RDKitLike): DecisionCheck {
  const rdkitVersion = typeof RDKit.version === 'function' ? String(RDKit.version()) : '';
  let raw: unknown;
  try { raw = typeof json === 'string' ? JSON.parse(json) : json; }
  catch {
    return { ok: false, issues: [{ code: 'schema', message: 'Decision record is not JSON' }], recomputed: [], rdkitVersion };
  }

  const issues: DecisionIssue[] = [];
  try { parseDecisionRecord(raw); }
  catch (e) { issues.push(classify(e instanceof Error ? e.message : String(e))); }

  const rec = raw as DecisionRecord;
  if (!usable(rec)) {
    if (!issues.some((i) => i.code === 'schema')) issues.push({ code: 'schema', message: 'Not a ParetoMol decision record (schema paretomol.decision/0 or paretomol.decision/1)' });
    return { ok: false, issues, recomputed: [], rdkitVersion };
  }
  if (issues.some((i) => i.code === 'schema')) return { ok: false, issues, recomputed: [], rdkitVersion };

  let windows: Record<string, PropDesirability> | null = validWindows(rec.profile?.windows) ? rec.profile.windows : null;
  if (!windows) {
    try { windows = getProfile(rec.profile.ref).desirability; }
    catch (e) {
      issues.push({ code: 'profile', message: e instanceof Error ? e.message : String(e) });
    }
  }
  const curve = curveOf(rec);
  const tier = descriptorTier([
    ...rec.objectives.map((o) => o.key),
    ...Object.keys(windows ?? {}),
  ]);

  const molecules: Molecule[] = [];
  rec.input.molecules.forEach((row, i) => {
    const mol = analyzeMolecule(row.smiles, 0, RDKit, [row.customProps ?? {}], tier);
    if (!mol) {
      issues.push({ code: 'invalid_smiles', id: row.id, message: `${row.id || i}: SMILES does not parse` });
      return;
    }
    mol.name = row.name;
    mol.customProps = { ...(row.customProps ?? {}) };
    molecules.push(mol);
  });
  if (molecules.length !== rec.input.molecules.length) {
    return { ok: false, issues, recomputed: [], rdkitVersion };
  }

  computeParetoAndDominance(molecules, rec.objectives as ParetoObjective[]);
  const recomputed: RecomputedRow[] = molecules.map((m, i) => ({
    id: rec.input.molecules[i].id,
    paretoRank: m.paretoRank ?? null,
    mpo: windows
      ? round6(mpoScore({ ...(m.props as unknown as Record<string, number>), ...m.customProps }, windows, curve).score)
      : null,
  }));

  const claimed = new Map<string, DecisionResult>();
  for (const row of rec.results) {
    if (claimed.has(row.id)) issues.push({ code: 'count', id: row.id, message: `Duplicate result id: ${row.id}` });
    claimed.set(row.id, row);
  }
  if (rec.results.length !== recomputed.length) {
    issues.push({ code: 'count', message: `results length ${rec.results.length} but recomputed ${recomputed.length}` });
  }
  for (const row of recomputed) {
    const was = claimed.get(row.id);
    if (!was) { issues.push({ code: 'count', id: row.id, message: `No result row for ${row.id}` }); continue; }
    if (was.paretoRank !== row.paretoRank) {
      issues.push({ code: 'rank', id: row.id, field: 'paretoRank', claimed: was.paretoRank, actual: row.paretoRank, message: `${row.id}: paretoRank ${String(was.paretoRank)} but recomputed ${String(row.paretoRank)}` });
    }
    if (row.mpo !== null && was.mpo !== row.mpo) {
      issues.push({ code: 'mpo', id: row.id, field: 'mpo', claimed: was.mpo, actual: row.mpo, message: `${row.id}: mpo ${was.mpo} but recomputed ${row.mpo}` });
    }
  }
  return { ok: issues.length === 0, issues, recomputed, rdkitVersion };
}
