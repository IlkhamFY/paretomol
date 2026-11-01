// Open review URL: an agent packs molecules, objectives and a profile into a
// link; ParetoMol opens it in review mode with Accept/Reject per molecule and
// exports the decisions as a decision record. The payload sits in the URL
// fragment (#r=...), which browsers never send to the server.
// Spec: docs/review-url.md.

import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import LZString from 'lz-string';
import type { ParetoObjective } from './types.js';
import { getProfile } from './profiles.js';

export const REVIEW_SCHEMA = 'paretomol.review/0' as const;
export const REVIEW_BASE_URL = 'https://paretomol.com/';
/** Browsers and chat apps handle links up to roughly this size reliably. */
export const REVIEW_URL_SOFT_LIMIT = 32000;
/**
 * Current tokens are `v1.` + base64url(raw deflate(JSON)).
 * Tokens without this prefix are the original lz-string encoding and still open.
 */
export const REVIEW_TOKEN_PREFIX = 'v1.';

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

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = new Uint8Array(128).fill(255);
for (let i = 0; i < B64.length; i++) B64_LOOKUP[B64.charCodeAt(i)] = i;

function bytesToBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
      + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=')
      + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(input: string): Uint8Array {
  const s = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s + pad;
  const len = b64.length;
  const bytes = new Uint8Array((len / 4) * 3 - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0));
  let j = 0;
  for (let i = 0; i < len; i += 4) {
    const at = (ch: string) => {
      const code = ch.charCodeAt(0);
      return code < 128 ? B64_LOOKUP[code] : 255;
    };
    const c0 = at(b64[i]);
    const c1 = at(b64[i + 1]);
    const c2 = b64[i + 2] === '=' ? 0 : at(b64[i + 2]);
    const c3 = b64[i + 3] === '=' ? 0 : at(b64[i + 3]);
    if (c0 === 255 || c1 === 255 || (b64[i + 2] !== '=' && c2 === 255) || (b64[i + 3] !== '=' && c3 === 255)) {
      throw new Error('bad base64');
    }
    const n = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    bytes[j++] = (n >> 16) & 255;
    if (b64[i + 2] !== '=') bytes[j++] = (n >> 8) & 255;
    if (b64[i + 3] !== '=') bytes[j++] = n & 255;
  }
  return bytes;
}

function reviewCorrupt(detail: string): Error {
  return new Error(`Review link is corrupt (${detail}). For a large set, use a decision record file instead.`);
}

/** Compressed, URL-safe token for a payload. `v1.` + base64url(raw deflate). */
export function encodeReview(input: ReviewInput): string {
  const json = JSON.stringify(validateReview(input));
  return REVIEW_TOKEN_PREFIX + bytesToBase64Url(deflateSync(strToU8(json), { level: 9 }));
}

function jsonFromToken(token: string): string {
  if (token.startsWith(REVIEW_TOKEN_PREFIX)) {
    try {
      return strFromU8(inflateSync(base64UrlToBytes(token.slice(REVIEW_TOKEN_PREFIX.length))));
    } catch {
      throw reviewCorrupt('could not decompress');
    }
  }
  // Unprefixed tokens are the original lz-string links.
  let json: string | null = null;
  try { json = LZString.decompressFromEncodedURIComponent(token); } catch { json = null; }
  if (!json) throw reviewCorrupt('could not decompress');
  return json;
}

/** Inverse of encodeReview. Also accepts the original unprefixed lz-string tokens. */
export function decodeReview(token: string): ReviewPayload {
  const json = jsonFromToken(token);
  let obj: unknown;
  try { obj = JSON.parse(json); } catch { throw reviewCorrupt('not JSON'); }
  return validateReview(obj);
}

/**
 * Set when a review URL is still longer than browsers and chat apps reliably keep.
 * The caller should show this instead of pretending the link will survive.
 */
export function reviewUrlWarning(url: string): string | undefined {
  if (url.length <= REVIEW_URL_SOFT_LIMIT) return undefined;
  return `Review link is ${url.length} characters, past the ${REVIEW_URL_SOFT_LIMIT} characters browsers and chat apps reliably keep. Use a decision record file instead.`;
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
