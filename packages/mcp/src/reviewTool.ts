// Experimental MCP App payload: structures, ranks and an export that writes
// the same paretomol.decision/0 review record as the web app.
import {
  buildDecisionRecord, computeParetoAndDominance, getMolValue, moleculeIds, mpoScore,
  reviewUrl, stringifyDecisionRecord, REVIEW_URL_SOFT_LIMIT,
} from '@paretomol/core';
import type { Molecule, ParetoObjective, ReviewVerdict } from '@paretomol/core';
import { loadRDKit } from '@paretomol/core/node';
import { ToolError } from './errors.js';
import { analyze, asMols, assertLimits, profileOrThrow, reviewInput } from './tools.js';

export const REVIEW_UI_URI = 'ui://paretomol/review.html';

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

type DepictMol = {
  is_valid(): boolean;
  delete(): void;
  get_svg_with_highlights?(details: string): string;
  get_svg?(): string;
};

function depict(RDKit: { get_mol(s: string): DepictMol | null }, smiles: string): string {
  let mol: DepictMol | null = null;
  try {
    mol = RDKit.get_mol(smiles);
    if (!mol || !mol.is_valid()) return '';
    const raw = mol.get_svg_with_highlights?.(JSON.stringify({
      width: 220, height: 140, bondLineWidth: 1.4, backgroundColour: [0, 0, 0, 0],
    })) ?? mol.get_svg?.() ?? '';
    return raw.includes('<svg') ? raw : '';
  } catch {
    return '';
  } finally {
    try { mol?.delete(); } catch { /* already freed */ }
  }
}

function freshView(molecules: Molecule[]) {
  const customPropNames: string[] = [];
  for (const m of molecules) for (const k of Object.keys(m.customProps)) if (!customPropNames.includes(k)) customPropNames.push(k);
  return {
    activeTab: 'pareto',
    formulaColumns: [] as [],
    customPropNames,
    admetPropNames: [] as [],
    propertyFilters: {} as Record<string, { min: number; max: number }>,
    substructureFilter: '',
  };
}

/** Link when it fits, otherwise a refusal. Never a URL over the soft limit. */
export function reviewLink(args: Record<string, unknown>, mols: ReturnType<typeof asMols>): { fallbackUrl?: string; fallbackError?: { code: 'review_url_too_long'; message: string } } {
  let url: string;
  try { url = reviewUrl(reviewInput(args, mols)); }
  catch (e) { throw e instanceof ToolError ? e : new ToolError('invalid_input', e instanceof Error ? e.message : String(e)); }
  if (url.length > REVIEW_URL_SOFT_LIMIT) {
    return {
      fallbackError: {
        code: 'review_url_too_long',
        message: `Review URL is ${url.length} characters, above ${REVIEW_URL_SOFT_LIMIT}. Write a decision record file instead of a link. Browsers and chat apps cut links of this size.`,
      },
    };
  }
  return { fallbackUrl: url };
}

export async function reviewShortlist(args: Record<string, unknown>) {
  const mols = asMols(args.molecules);
  assertLimits(mols, args);
  const link = reviewLink(args, mols);
  const profile = profileOrThrow(typeof args.profile === 'string' ? args.profile : 'oral@1');
  const input = reviewInput(args, mols);
  const objectives: ParetoObjective[] = input.objectives ?? profile.objectives.map((o) => ({ key: o.key, direction: o.direction }));
  const RDKit = await loadRDKit();
  const { molecules, invalid } = await analyze(mols);
  computeParetoAndDominance(molecules, objectives);
  const suggested = new Set(input.suggested ?? []);
  const ids = moleculeIds(molecules.map((m) => m.name));
  const rows = molecules.map((m, i) => {
    const values = Object.fromEntries(objectives.map((o) => [o.key, getMolValue(m, o.key)]));
    const mpo = round6(mpoScore({ ...(m.props as unknown as Record<string, number>), ...m.customProps }, profile.desirability, 'linear').score);
    return {
      index: i,
      id: ids[i],
      name: m.name,
      smiles: m.smiles,
      props: m.customProps,
      svg: depict(RDKit, m.smiles),
      paretoRank: m.paretoRank,
      mpo,
      values,
      suggested: suggested.has(m.name),
      ...(m.missingObjectives?.length ? { missingObjectives: m.missingObjectives } : {}),
    };
  });
  return {
    experimental: true,
    ui: REVIEW_UI_URI,
    ...link,
    title: input.title,
    source: input.source,
    note: input.note,
    profile: { ref: profile.ref, hash: profile.hash, label: profile.label },
    objectives,
    rdkitVersion: RDKit.version(),
    invalid,
    molecules: rows,
  };
}

function asDecisions(x: unknown, ids: string[]): Record<number, ReviewVerdict> {
  if (x === undefined) return {};
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw new ToolError('invalid_input', 'decisions must be an object of molecule id to "accept" or "reject"');
  const out: Record<number, ReviewVerdict> = {};
  for (const [id, v] of Object.entries(x as Record<string, unknown>)) {
    if (v !== 'accept' && v !== 'reject') throw new ToolError('invalid_input', `decisions.${id} must be "accept" or "reject"`);
    const i = ids.indexOf(id);
    if (i < 0) throw new ToolError('invalid_input', `decisions key is not a molecule id: ${id}`);
    out[i] = v;
  }
  return out;
}

/** The web app's review export: accepted ids in `selected`, verdicts in `review`. */
export async function exportReviewDecision(args: Record<string, unknown>) {
  const mols = asMols(args.molecules);
  assertLimits(mols, args);
  const input = reviewInput(args, mols);
  const profile = profileOrThrow(input.profile ?? 'oral@1');
  const objectives = input.objectives ?? profile.objectives.map((o) => ({ key: o.key, direction: o.direction }));
  const RDKit = await loadRDKit();
  const { molecules, invalid } = await analyze(mols);
  if (invalid.length) throw new ToolError('invalid_input', `SMILES did not parse: ${invalid.map((x) => x.smiles).join(', ')}`);
  computeParetoAndDominance(molecules, objectives);
  const ids = moleculeIds(molecules.map((m) => m.name));
  const decisions = asDecisions(args.decisions, ids);
  const names = new Map(molecules.map((m, i) => [m.name, i] as const));
  const suggested = (input.suggested ?? []).flatMap((n) => names.has(n) ? [names.get(n)!] : []);
  const unknown = (input.suggested ?? []).filter((n) => !names.has(n));
  if (unknown.length) throw new ToolError('invalid_input', `suggested names not in molecules: ${unknown.join(', ')}`);
  const selected = Object.entries(decisions).filter(([, v]) => v === 'accept').map(([k]) => Number(k));
  const rationale = typeof args.rationale === 'string' ? args.rationale : '';
  const timestamp = typeof args.timestamp === 'string' ? args.timestamp : undefined;
  const record = buildDecisionRecord({
    molecules,
    objectives,
    profile,
    selected,
    rationale,
    rdkitVersion: RDKit.version(),
    admetEndpoint: null,
    view: freshView(molecules),
    review: { source: input.source, decisions, suggested },
    timestamp,
  });
  const json = stringifyDecisionRecord(record);
  return { filename: 'paretomol_review.json', json, record };
}
