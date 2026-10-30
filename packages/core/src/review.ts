// Open review URL: an agent packs molecules, objectives and a profile into a
// link; ParetoMol opens it in review mode with Accept/Reject per molecule and
// exports the decisions as a decision record. The payload sits in the URL
// fragment (#r=...), which browsers never send to the server.
// Spec: docs/review-url.md.

import LZString from 'lz-string';
import type { ParetoObjective } from './types.js';
import { getProfile } from './profiles.js';

export const REVIEW_SCHEMA = 'paretomol.review/0' as const;
export const REVIEW_BASE_URL = 'https://paretomol.com/';
/** Browsers and chat apps handle links up to roughly this size reliably. */
export const REVIEW_URL_SOFT_LIMIT = 32000;

export interface ReviewMolecule {
  name: string;
  smiles: string;
  customProps?: Record<string, number>;
}

export interface ReviewPayload {
  schema: typeof REVIEW_SCHEMA;
  molecules: ReviewMolecule[];
  /** Ranking objectives. Omitted: the profile's objectives. */
  objectives?: ParetoObjective[];
  /** Scoring profile ref, e.g. 'oral@1'. Default 'oral@1'. */
  profile?: string;
  title?: string;
  /** Who produced the link (agent or tool name). */
  source?: string;
  /** Agent's note to the reviewer. */
  note?: string;
  /** Names the agent proposes to accept; shown as suggestions, not decisions. */
  suggested?: string[];
}

export type ReviewInput = Omit<ReviewPayload, 'schema'> & { schema?: typeof REVIEW_SCHEMA };

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** Validate and normalise a payload. Throws with a message an agent can act on. */
export function validateReview(input: unknown): ReviewPayload {
  if (!isObj(input)) throw new Error('Review payload must be an object');
  if (input.schema !== undefined && input.schema !== REVIEW_SCHEMA) throw new Error(`Review payload: schema must be ${REVIEW_SCHEMA}`);
  const mols = input.molecules;
  if (!Array.isArray(mols) || mols.length === 0) throw new Error('Review payload: molecules must be a non-empty array');
  const molecules: ReviewMolecule[] = mols.map((m, i) => {
    if (!isObj(m) || typeof m.smiles !== 'string' || !m.smiles.trim()) throw new Error(`Review payload: molecules[${i}].smiles must be a non-empty string`);
    const out: ReviewMolecule = { name: typeof m.name === 'string' && m.name.trim() ? m.name.trim() : `mol${i + 1}`, smiles: m.smiles.trim() };
    if (m.customProps !== undefined) {
      if (!isObj(m.customProps)) throw new Error(`Review payload: molecules[${i}].customProps must be an object of numbers`);
      const cp: Record<string, number> = {};
      for (const [k, v] of Object.entries(m.customProps)) if (typeof v === 'number' && Number.isFinite(v)) cp[k] = v;
      if (Object.keys(cp).length) out.customProps = cp;
    }
    return out;
  });
  const profile = input.profile === undefined ? 'oral@1' : input.profile;
  if (typeof profile !== 'string') throw new Error('Review payload: profile must be a string like oral@1');
  const resolved = getProfile(profile);
  let objectives: ParetoObjective[] | undefined;
  if (input.objectives !== undefined) {
    if (!Array.isArray(input.objectives) || input.objectives.length === 0) throw new Error('Review payload: objectives must be a non-empty array');
    objectives = input.objectives.map((o, i) => {
      if (!isObj(o) || typeof o.key !== 'string' || (o.direction !== 'min' && o.direction !== 'max')) throw new Error(`Review payload: objectives[${i}] must be {key, direction: "min"|"max"}`);
      return { key: o.key, direction: o.direction };
    });
  }
  const str = (k: string) => (typeof input[k] === 'string' && (input[k] as string).trim() ? (input[k] as string) : undefined);
  const out: ReviewPayload = { schema: REVIEW_SCHEMA, molecules, profile: resolved.ref };
  if (objectives) out.objectives = objectives;
  for (const k of ['title', 'source', 'note'] as const) { const v = str(k); if (v) out[k] = v; }
  if (input.suggested !== undefined) {
    if (!Array.isArray(input.suggested) || input.suggested.some((s) => typeof s !== 'string')) throw new Error('Review payload: suggested must be an array of molecule names');
    const names = new Set(molecules.map((m) => m.name));
    const bad = (input.suggested as string[]).filter((s) => !names.has(s));
    if (bad.length) throw new Error(`Review payload: suggested names not in molecules: ${bad.join(', ')}`);
    out.suggested = input.suggested as string[];
  }
  return out;
}

/** Compressed, URL-safe token for a payload. */
export function encodeReview(input: ReviewInput): string {
  return LZString.compressToEncodedURIComponent(JSON.stringify(validateReview(input)));
}

/** Inverse of encodeReview. Throws on a corrupt or invalid token. */
export function decodeReview(token: string): ReviewPayload {
  let json: string | null = null;
  try { json = LZString.decompressFromEncodedURIComponent(token); } catch { json = null; }
  if (!json) throw new Error('Review link is corrupt (could not decompress)');
  let obj: unknown;
  try { obj = JSON.parse(json); } catch { throw new Error('Review link is corrupt (not JSON)'); }
  return validateReview(obj);
}

/** `https://paretomol.com/#r=<token>`. */
export function reviewUrl(input: ReviewInput, base: string = REVIEW_BASE_URL): string {
  return `${base.split('#')[0]}#r=${encodeReview(input)}`;
}

function param(part: string, key: string): string | null {
  for (const kv of part.split('&')) {
    const eq = kv.indexOf('=');
    const k = eq < 0 ? kv : kv.slice(0, eq);
    if (k === key && eq >= 0) {
      const v = kv.slice(eq + 1);
      try { return decodeURIComponent(v) || null; } catch { return v || null; }
    }
  }
  return null;
}

/** Read the review token from a URL's fragment (#r=) or query (?r=). Null when absent. */
export function reviewTokenFromUrl(url: string): string | null {
  const hashAt = url.indexOf('#');
  const hash = hashAt >= 0 ? url.slice(hashAt + 1) : '';
  const before = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const q = before.indexOf('?');
  return param(hash, 'r') ?? (q >= 0 ? param(before.slice(q + 1), 'r') : null);
}
