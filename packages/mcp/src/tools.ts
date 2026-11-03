// ParetoMol MCP tools. Each tool is a plain function over @paretomol/core so the
// same logic serves the SDK server, tests and the agent benchmark.
import {
  analyzeInput, analyzeMolecule, checkInputLimits, computeParetoAndDominance, contractObjectives, descriptorTier, getMolValue, getProfile, isStrictlyBetter, splitInput,
  listProfiles, moleculeIds, mpoScore, objectivesForPreset, readFront, reviewUrl, verifyClaims, verifyDecision,
  REVIEW_URL_SOFT_LIMIT,
} from '@paretomol/core';
import type { AnalyzeOptions, Claim, Molecule, ParetoObjective, ResolvedProfile, ReviewInput } from '@paretomol/core';
import { loadRDKit } from '@paretomol/core/node';
import { ToolError } from './errors.js';

export interface MolIn { smiles: string; name?: string; props?: Record<string, number> }

const DESCRIPTORS = ['MW', 'LogP', 'HBD', 'HBA', 'TPSA', 'RotBonds', 'FrCSP3', 'Rings', 'AromaticRings', 'HeavyAtoms', 'QED', 'SC'] as const;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

function optionalNumber(v: unknown, name: string): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new ToolError('invalid_input', `${name} must be a positive integer`);
  return v;
}

export function assertLimits(mols: { smiles: string }[], args: Record<string, unknown>): void {
  const issue = checkInputLimits(mols, {
    maxMolecules: optionalNumber(args.maxMolecules, 'maxMolecules'),
    maxSmilesLength: optionalNumber(args.maxSmilesLength, 'maxSmilesLength'),
  });
  if (issue) throw new ToolError(issue.code, issue.message);
}

export function asMols(x: unknown): MolIn[] {
  if (!Array.isArray(x) || x.length === 0) throw new ToolError('invalid_input', 'molecules must be a non-empty array of {smiles, name?, props?}');
  return x.map((m, i) => {
    if (typeof m === 'string') return { smiles: m.trim() };
    if (!m || typeof m !== 'object' || typeof (m as MolIn).smiles !== 'string') throw new ToolError('invalid_input', `molecules[${i}].smiles must be a string`);
    const row = m as MolIn;
    return { smiles: row.smiles.trim(), name: row.name, props: row.props };
  });
}

export function asObjectives(x: unknown, fallback: ParetoObjective[]): ParetoObjective[] {
  if (x === undefined || x === null) return fallback;
  if (!Array.isArray(x) || x.length === 0) throw new ToolError('invalid_input', 'objectives must be a non-empty array of {key, direction}');
  return x.map((o, i) => {
    const ob = o as ParetoObjective;
    if (!ob || typeof ob.key !== 'string' || (ob.direction !== 'min' && ob.direction !== 'max')) throw new ToolError('invalid_input', `objectives[${i}] must be {key, direction: "min"|"max"}`);
    return { key: ob.key, direction: ob.direction };
  });
}

export function profileOrThrow(ref: string): ResolvedProfile {
  try { return getProfile(ref); }
  catch (e) { throw new ToolError('unknown_profile', e instanceof Error ? e.message : String(e)); }
}

/** Analyse molecules with RDKit.js. Returns parsed molecules and the indices that failed.
 *  Pass a descriptor tier to skip fingerprints and QED alerts. */
export async function analyze(mols: MolIn[], opts?: AnalyzeOptions): Promise<{ molecules: Molecule[]; invalid: { index: number; smiles: string }[] }> {
  const RDKit = await loadRDKit();
  const molecules: Molecule[] = [];
  const invalid: { index: number; smiles: string }[] = [];
  mols.forEach((m, i) => {
    const mol = analyzeMolecule(m.smiles, i, RDKit, [m.props ?? {}], opts);
    if (!mol) { invalid.push({ index: i, smiles: m.smiles }); return; }
    mol.name = m.name?.trim() || `mol_${i + 1}`;
    mol.customProps = { ...(m.props ?? {}) };
    molecules.push(mol);
  });
  return { molecules, invalid };
}

function row(m: Molecule) {
  const d: Record<string, number> = {};
  for (const k of DESCRIPTORS) d[k] = r3(m.props[k]);
  return { name: m.name, smiles: m.smiles, descriptors: d, props: m.customProps };
}

function take(args: Record<string, unknown>): MolIn[] {
  const mols = asMols(args.molecules);
  assertLimits(mols, args);
  return mols;
}

export async function scoreMolecules(args: Record<string, unknown>) {
  const { molecules, invalid } = await analyze(take(args), { fingerprint: false, qed: true });
  return { molecules: molecules.map(row), invalid };
}

export async function paretoFront(args: Record<string, unknown>) {
  const objectives = asObjectives(args.objectives, contractObjectives(getProfile('oral@1')));
  const { molecules, invalid } = await analyze(take(args), descriptorTier(objectives.map((o) => o.key)));
  const edges = args.edges === true;
  if (args.edges !== undefined && typeof args.edges !== 'boolean') throw new ToolError('invalid_input', 'edges must be a boolean');
  computeParetoAndDominance(molecules, objectives);
  const ranked = molecules.map((m) => ({
    name: m.name,
    paretoRank: m.paretoRank,
    values: Object.fromEntries(objectives.map((o) => [o.key, getMolValue(m, o.key)])),
    ...(m.missingObjectives?.length ? { missingObjectives: m.missingObjectives } : {}),
    ...(edges ? {
      dominatedBy: m.dominatedBy.map((j) => molecules[j].name),
      dominates: m.dominates.map((j) => molecules[j].name),
    } : {}),
  }));
  const byRank: Record<string, number> = {};
  const groups = new Map<number, string[]>();
  let unranked = 0;
  for (const r of ranked) {
    if (r.paretoRank == null) { unranked++; continue; }
    byRank[String(r.paretoRank)] = (byRank[String(r.paretoRank)] ?? 0) + 1;
    const names = groups.get(r.paretoRank) ?? [];
    names.push(r.name);
    groups.set(r.paretoRank, names);
  }
  const fronts = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([rank, names]) => ({ rank, names }));
  return {
    objectives,
    front: fronts.find((f) => f.rank === 1)?.names ?? [],
    fronts,
    counts: {
      molecules: ranked.length,
      invalid: invalid.length,
      ranked: ranked.length - unranked,
      unranked,
      onFront: byRank['1'] ?? 0,
      byRank,
    },
    edges,
    molecules: ranked,
    invalid,
  };
}

export function profileSummary(p: ResolvedProfile) {
  return { ref: p.ref, hash: p.hash, label: p.label, description: p.description, objectives: p.objectives };
}

export function listProfilesTool() {
  return { profiles: listProfiles().map(profileSummary) };
}

export async function applyProfile(args: Record<string, unknown>) {
  const ref = typeof args.profile === 'string' ? args.profile : 'oral@1';
  const profile = profileOrThrow(ref);
  const front = contractObjectives(profile);
  const { molecules, invalid } = await analyze(take(args), descriptorTier([
    ...front.map((o) => o.key),
    ...Object.keys(profile.desirability),
  ]));
  computeParetoAndDominance(molecules, front);
  const rows = molecules.map((m) => {
    const all: Record<string, number> = { ...(m.props as unknown as Record<string, number>), ...m.customProps };
    const { score, perProp } = mpoScore(all, profile.desirability);
    const violations = (profile.filter?.rules ?? []).filter((r) => {
      const v = all[r.key];
      if (typeof v !== 'number') return false;
      return !(r.op === '<=' ? v <= r.val : r.op === '>=' ? v >= r.val : r.op === '<' ? v < r.val : v > r.val);
    }).map((r) => `${r.key} ${r.op} ${r.val}`);
    const pass = profile.filter ? violations.length <= profile.filter.maxViolations : true;
    return { name: m.name, mpo: r3(score), perProp: Object.fromEntries(Object.entries(perProp).map(([k, v]) => [k, r3(v)])), paretoRank: m.paretoRank, filterPass: pass, violations };
  });
  rows.sort((a, b) => (a.paretoRank ?? 99) - (b.paretoRank ?? 99) || b.mpo - a.mpo);
  return { profile: profileSummary(profile), molecules: rows, invalid };
}

export async function explainTradeoff(args: Record<string, unknown>) {
  const objectives = asObjectives(args.objectives, contractObjectives(getProfile('oral@1')));
  const { molecules } = await analyze(take(args), descriptorTier(objectives.map((o) => o.key)));
  computeParetoAndDominance(molecules, objectives);
  const reading = readFront(molecules, objectives);
  const names = Array.isArray(args.compare) ? (args.compare as string[]) : [];
  let comparison: Record<string, unknown> | undefined;
  if (names.length === 2) {
    const [a, b] = names.map((n) => molecules.find((m) => m.name === n));
    if (!a || !b) throw new ToolError('not_found', `compare: names not found among molecules: ${names.join(', ')}`);
    const better: string[] = [], worse: string[] = [], tied: string[] = [];
    for (const o of objectives) {
      const va = getMolValue(a, o.key), vb = getMolValue(b, o.key);
      if (va === null || vb === null || !isStrictlyBetter(va, vb, o) && !isStrictlyBetter(vb, va, o)) { tied.push(o.key); continue; }
      (isStrictlyBetter(va, vb, o) ? better : worse).push(o.key);
    }
    const ia = molecules.indexOf(a), ib = molecules.indexOf(b);
    const relation = a.dominates.includes(ib) ? `${a.name} dominates ${b.name}` : b.dominates.includes(ia) ? `${b.name} dominates ${a.name}` : 'neither dominates: a real trade-off';
    comparison = { a: a.name, b: b.name, aBetterOn: better, aWorseOn: worse, tied, relation };
  }
  const t = reading?.tradeoff;
  const summary = reading
    ? `${reading.paretoCount} of ${reading.total} molecules are on the Pareto front over ${reading.objectiveKeys.join(', ')}.` +
      (t ? ` Sharpest trade-off: ${t.a} vs ${t.b} (goodness correlation r = ${r3(t.r)}); improving one tends to cost the other.` : ' No strong pairwise trade-off (no pair with r < -0.25).')
    : 'Nothing to rank.';
  return { summary, reading: reading && { ...reading, tradeoff: t ? { ...t, r: r3(t.r) } : null }, ...(comparison ? { comparison } : {}) };
}

/** Review payload shared by the link tool and the experimental review UI. */
export function reviewInput(args: Record<string, unknown>, mols: MolIn[]): ReviewInput {
  const molecules = mols.map((m, i) => ({ name: m.name?.trim() || `mol${i + 1}`, smiles: m.smiles, ...(m.props ? { customProps: m.props } : {}) }));
  const input: ReviewInput = { molecules };
  if (args.objectives !== undefined) input.objectives = asObjectives(args.objectives, []);
  for (const k of ['profile', 'title', 'source', 'note'] as const) if (typeof args[k] === 'string') input[k] = args[k];
  if (Array.isArray(args.suggested)) input.suggested = args.suggested as string[];
  if (!input.source) input.source = 'paretomol-mcp';
  return input;
}

export function openReviewUrl(args: Record<string, unknown>) {
  const mols = take(args);
  const input = reviewInput(args, mols);
  let url: string;
  try { url = reviewUrl(input); }
  catch (e) { throw new ToolError('invalid_input', e instanceof Error ? e.message : String(e)); }
  if (url.length > REVIEW_URL_SOFT_LIMIT) {
    throw new ToolError(
      'review_url_too_long',
      `Review URL is ${url.length} characters, above ${REVIEW_URL_SOFT_LIMIT}. Write a decision record file instead of a link. Browsers and chat apps cut links of this size.`,
    );
  }
  return { url, length: url.length };
}

export async function verifyClaimsTool(args: Record<string, unknown>) {
  if (!Array.isArray(args.claims)) throw new ToolError('invalid_input', 'claims must be an array of {smiles, properties?, objectives?}');
  const mols = args.claims.map((c, i) => {
    if (!c || typeof c !== 'object' || typeof (c as Claim).smiles !== 'string') throw new ToolError('invalid_input', `claims[${i}].smiles must be a string`);
    return { smiles: (c as Claim).smiles.trim() };
  });
  assertLimits(mols, args);
  return verifyClaims(args.claims as Claim[], await loadRDKit());
}

export async function verifyDecisionTool(args: Record<string, unknown>) {
  const record = asDecisionRecord(args);
  const molecules = (record as { input?: { molecules?: { smiles?: unknown }[] } }).input?.molecules;
  if (Array.isArray(molecules)) {
    assertLimits(molecules.map((m) => ({ smiles: typeof m?.smiles === 'string' ? m.smiles.trim() : '' })), args);
  }
  return verifyDecision(record, await loadRDKit());
}

function asDecisionRecord(args: Record<string, unknown>): unknown {
  if (args.record && typeof args.record === 'object') return args.record;
  if (args.schema === 'paretomol.decision/0' || args.schema === 'paretomol.decision/1') return args;
  throw new ToolError('invalid_input', 'Pass a paretomol.decision/0 or paretomol.decision/1 record as { record } or as the record itself.');
}

/** Rank a CSV, TSV or SMILES-lines string the way the CLI does, and return decision-record ids.
 *  Quoted fields are kept intact, including commas inside a name. Repeated names become `name~2`, `name~3`, ... */
export async function rankInput(args: Record<string, unknown>) {
  if (typeof args.text !== 'string' || !args.text.trim()) throw new ToolError('invalid_input', 'text must be a non-empty CSV, TSV or SMILES string');
  const RDKit = await loadRDKit();
  const preview = splitInput(args.text);
  const objectives = asObjectives(args.objectives, objectivesForPreset('oral@1', preview.customPropNames));
  const { molecules, errors } = analyzeInput(args.text, RDKit, descriptorTier([...objectives.map((o) => o.key), ...Object.keys(getProfile('oral@1').desirability)]));
  if (molecules.length === 0) throw new ToolError('invalid_input', 'no molecules parsed');
  assertLimits(molecules.map((m) => ({ smiles: m.smiles })), args);
  computeParetoAndDominance(molecules, objectives);
  const ids = moleculeIds(molecules.map((m) => m.name));
  const rows = molecules.map((m, i) => ({
    id: ids[i],
    name: m.name,
    smiles: m.smiles,
    paretoRank: m.paretoRank,
    props: m.customProps,
    ...(m.missingObjectives?.length ? { missingObjectives: m.missingObjectives } : {}),
  }));
  return {
    objectives,
    errors,
    ids,
    front: rows.filter((r) => r.paretoRank === 1).map((r) => r.id),
    molecules: rows,
  };
}
