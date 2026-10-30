// ParetoMol MCP tools. Each tool is a plain function over @paretomol/core so the
// same logic serves the stdio server, tests and the agent benchmark.
import {
  analyzeMolecule, computeParetoAndDominance, getMolValue, getProfile, listProfiles, mpoScore,
  readFront, reviewUrl, verifyClaims, DEFAULT_PARETO_OBJECTIVES, REVIEW_URL_SOFT_LIMIT,
} from '@paretomol/core';
import type { Claim, Molecule, ParetoObjective, ReviewInput, ResolvedProfile } from '@paretomol/core';
import { loadRDKit } from '@paretomol/cli';

export interface MolIn { smiles: string; name?: string; props?: Record<string, number> }

const DESCRIPTORS = ['MW', 'LogP', 'HBD', 'HBA', 'TPSA', 'RotBonds', 'FrCSP3', 'Rings', 'AromaticRings', 'HeavyAtoms', 'QED', 'SC'] as const;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

function asMols(x: unknown): MolIn[] {
  if (!Array.isArray(x) || x.length === 0) throw new Error('molecules must be a non-empty array of {smiles, name?, props?}');
  return x.map((m, i) => {
    if (typeof m === 'string') return { smiles: m };
    if (!m || typeof m !== 'object' || typeof (m as MolIn).smiles !== 'string') throw new Error(`molecules[${i}].smiles must be a string`);
    return m as MolIn;
  });
}

function asObjectives(x: unknown, fallback: ParetoObjective[]): ParetoObjective[] {
  if (x === undefined || x === null) return fallback;
  if (!Array.isArray(x) || x.length === 0) throw new Error('objectives must be a non-empty array of {key, direction}');
  return x.map((o, i) => {
    const ob = o as ParetoObjective;
    if (!ob || typeof ob.key !== 'string' || (ob.direction !== 'min' && ob.direction !== 'max')) throw new Error(`objectives[${i}] must be {key, direction: "min"|"max"}`);
    return { key: ob.key, direction: ob.direction };
  });
}

/** Analyse molecules with RDKit.js. Returns parsed molecules and the indices that failed. */
export async function analyze(mols: MolIn[]): Promise<{ molecules: Molecule[]; invalid: { index: number; smiles: string }[] }> {
  const RDKit = await loadRDKit();
  const molecules: Molecule[] = [];
  const invalid: { index: number; smiles: string }[] = [];
  mols.forEach((m, i) => {
    const mol = analyzeMolecule(m.smiles.trim(), i, RDKit, [m.props ?? {}]);
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

export async function scoreMolecules(args: Record<string, unknown>) {
  const { molecules, invalid } = await analyze(asMols(args.molecules));
  return { molecules: molecules.map(row), invalid };
}

export async function paretoFront(args: Record<string, unknown>) {
  const { molecules, invalid } = await analyze(asMols(args.molecules));
  const objectives = asObjectives(args.objectives, DEFAULT_PARETO_OBJECTIVES);
  computeParetoAndDominance(molecules, objectives);
  const ranked = molecules.map((m) => ({
    name: m.name,
    paretoRank: m.paretoRank,
    values: Object.fromEntries(objectives.map((o) => [o.key, getMolValue(m, o.key)])),
    dominatedBy: m.dominatedBy.map((j) => molecules[j].name),
    ...(m.missingObjectives?.length ? { missingObjectives: m.missingObjectives } : {}),
  }));
  return { objectives, front: ranked.filter((r) => r.paretoRank === 1).map((r) => r.name), molecules: ranked, invalid };
}

export function profileSummary(p: ResolvedProfile) {
  return { ref: p.ref, hash: p.hash, label: p.label, description: p.description, objectives: p.objectives };
}

export async function applyProfile(args: Record<string, unknown>) {
  const ref = typeof args.profile === 'string' ? args.profile : 'oral@1';
  const profile = getProfile(ref);
  const { molecules, invalid } = await analyze(asMols(args.molecules));
  computeParetoAndDominance(molecules, profile.objectives);
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
  const { molecules } = await analyze(asMols(args.molecules));
  const objectives = asObjectives(args.objectives, DEFAULT_PARETO_OBJECTIVES);
  computeParetoAndDominance(molecules, objectives);
  const reading = readFront(molecules, objectives);
  const names = Array.isArray(args.compare) ? (args.compare as string[]) : [];
  let comparison: Record<string, unknown> | undefined;
  if (names.length === 2) {
    const [a, b] = names.map((n) => molecules.find((m) => m.name === n));
    if (!a || !b) throw new Error(`compare: names not found among molecules: ${names.join(', ')}`);
    const better: string[] = [], worse: string[] = [], tied: string[] = [];
    for (const o of objectives) {
      const va = getMolValue(a, o.key), vb = getMolValue(b, o.key);
      if (va === null || vb === null || va === vb) { tied.push(o.key); continue; }
      ((o.direction === 'min' ? va < vb : va > vb) ? better : worse).push(o.key);
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

export function openReviewUrl(args: Record<string, unknown>) {
  const molecules = asMols(args.molecules).map((m, i) => ({ name: m.name ?? `mol${i + 1}`, smiles: m.smiles, ...(m.props ? { customProps: m.props } : {}) }));
  const input: ReviewInput = { molecules };
  if (args.objectives !== undefined) input.objectives = asObjectives(args.objectives, []);
  for (const k of ['profile', 'title', 'source', 'note'] as const) if (typeof args[k] === 'string') input[k] = args[k] as string;
  if (Array.isArray(args.suggested)) input.suggested = args.suggested as string[];
  if (!input.source) input.source = 'paretomol-mcp';
  const url = reviewUrl(input);
  const warning = url.length > REVIEW_URL_SOFT_LIMIT ? `URL is ${url.length} chars, above the ~${REVIEW_URL_SOFT_LIMIT} that browsers and chat apps handle reliably. Send fewer molecules.` : undefined;
  return { url, length: url.length, ...(warning ? { warning } : {}) };
}

export async function verifyClaimsTool(args: Record<string, unknown>) {
  if (!Array.isArray(args.claims)) throw new Error('claims must be an array of {smiles, properties?, objectives?}');
  return verifyClaims(args.claims as Claim[], await loadRDKit());
}

const molSchema = {
  type: 'array', minItems: 1, description: 'Molecules: SMILES strings or {smiles, name?, props?} where props are numeric columns (e.g. pIC50).',
  items: { anyOf: [{ type: 'string' }, { type: 'object', properties: { smiles: { type: 'string' }, name: { type: 'string' }, props: { type: 'object', additionalProperties: { type: 'number' } } }, required: ['smiles'] }] },
};
const objSchema = {
  type: 'array', description: 'Objectives, e.g. [{"key":"MW","direction":"min"},{"key":"pIC50","direction":"max"}]. Keys: descriptors (MW, LogP, TPSA, HBD, HBA, RotBonds, FrCSP3, QED, ...) or prop names. Default MW/LogP/TPSA min.',
  items: { type: 'object', properties: { key: { type: 'string' }, direction: { enum: ['min', 'max'] } }, required: ['key', 'direction'] },
};

export interface ToolDef { name: string; description: string; inputSchema: Record<string, unknown>; run: (a: Record<string, unknown>) => unknown }

export const TOOLS: ToolDef[] = [
  { name: 'score_molecules', description: 'Compute RDKit descriptors (MW, LogP, TPSA, HBD, HBA, RotBonds, FrCSP3, rings, QED, SC estimate) for molecules. Use this instead of estimating descriptors yourself.', inputSchema: { type: 'object', properties: { molecules: molSchema }, required: ['molecules'] }, run: scoreMolecules },
  { name: 'pareto_front', description: 'Rank molecules by Pareto dominance over the given objectives. Returns the front (rank 1), each rank, and who dominates whom.', inputSchema: { type: 'object', properties: { molecules: molSchema, objectives: objSchema }, required: ['molecules'] }, run: paretoFront },
  { name: 'apply_profile', description: `Score molecules with a versioned scoring profile (MPO desirability, filter rules, profile objectives). Profiles: ${listProfiles().map((p) => p.ref).join(', ')}.`, inputSchema: { type: 'object', properties: { molecules: molSchema, profile: { type: 'string', description: 'Profile ref, default oral@1' } }, required: ['molecules'] }, run: applyProfile },
  { name: 'explain_tradeoff', description: 'Explain the trade-off structure: front size, sharpest anti-correlated objective pair, and optionally a head-to-head of two named molecules.', inputSchema: { type: 'object', properties: { molecules: molSchema, objectives: objSchema, compare: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2 } }, required: ['molecules'] }, run: explainTradeoff },
  { name: 'open_review_url', description: 'Build a paretomol.com review link (#r=) so a human can Accept/Reject your picks and export a decision record. Give the link to the user. Keep it under ~200 molecules.', inputSchema: { type: 'object', properties: { molecules: molSchema, objectives: objSchema, profile: { type: 'string' }, title: { type: 'string' }, note: { type: 'string' }, source: { type: 'string' }, suggested: { type: 'array', items: { type: 'string' } } }, required: ['molecules'] }, run: openReviewUrl },
  { name: 'verify_claims', description: 'Check descriptor values and optimisation directions claimed for molecules (yours or another agent\'s) against RDKit. Flags invalid SMILES, value mismatches and flipped directions.', inputSchema: { type: 'object', properties: { claims: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, smiles: { type: 'string' }, properties: { type: 'object', additionalProperties: { type: 'number' } }, objectives: objSchema }, required: ['smiles'] } } }, required: ['claims'] }, run: verifyClaimsTool },
];
