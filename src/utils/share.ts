import LZString from 'lz-string';
import type { Molecule } from '@paretomol/core';

/** Encode molecules to a string suitable for URL (SMILES + name per line). */
export function encodeMoleculesToPayload(molecules: Molecule[]): string {
  return molecules.map((m) => `${m.smiles} ${m.name}`).join('\n');
}

/** Compress payload for URL query param. */
export function compressPayload(payload: string): string {
  return LZString.compressToEncodedURIComponent(payload);
}

/** Decompress from URL query param; returns null on failure. */
export function decompressPayload(compressed: string): string | null {
  try {
    return LZString.decompressFromEncodedURIComponent(compressed) || null;
  } catch {
    return null;
  }
}

/** Read one raw parameter. `+` is kept (it is significant in lz-string tokens). */
function rawParam(part: string, key: string): string | null {
  const body = part.startsWith('?') || part.startsWith('#') ? part.slice(1) : part;
  for (const kv of body.split('&')) {
    if (!kv) continue;
    const eq = kv.indexOf('=');
    const k = eq < 0 ? kv : kv.slice(0, eq);
    let name = k;
    try { name = decodeURIComponent(k); } catch { /* keep the raw key */ }
    if (name === key && eq >= 0) return kv.slice(eq + 1);
  }
  return null;
}

function decodeToken(raw: string): string {
  try { return decodeURIComponent(raw); } catch { return raw; }
}

/**
 * Share link. Molecules travel in the fragment (`#m=`), never the query.
 * `pageUrl` is the current page; only its origin and path are kept, plus `tab`.
 */
export function buildShareUrl(pageUrl: string, payload: string, activeTab?: string): string {
  const u = new URL(pageUrl);
  const q = activeTab && activeTab !== 'pareto' ? `?tab=${encodeURIComponent(activeTab)}` : '';
  return `${u.origin}${u.pathname}${q}#m=${payload}`;
}

/** Get shareable URL with encoded molecules and optional active tab. */
export function getShareableUrl(molecules: Molecule[], activeTab?: string): string {
  return buildShareUrl(window.location.href, compressPayload(encodeMoleculesToPayload(molecules)), activeTab);
}

/** Read initial active tab from URL (?tab=). */
export function getInitialTabFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('tab');
}

/**
 * Molecule text from `#m=` or, for an old link, `?m=`.
 * Hash wins when both are present.
 */
export function moleculePayloadFromLocation(search: string, hash: string): string | null {
  const raw = rawParam(hash, 'm') ?? rawParam(search, 'm');
  if (!raw) return null;
  return decompressPayload(decodeToken(raw));
}

/** Read initial payload from the current URL. Call once on mount. */
export function getInitialPayloadFromUrl(): string | null {
  return moleculePayloadFromLocation(window.location.search, window.location.hash);
}

/**
 * Address bar after a view change.
 * Keeps `#m=` and `#r=` so reload and copy-link work, and moves any `?m=` or
 * `?r=` into the fragment so a molecule payload is not left in the query.
 * Analytics strip those keys separately and are not affected by this URL.
 */
export function urlForView(loc: { pathname: string; search: string; hash: string }, activeTab: string): string {
  const search = loc.search.startsWith('?') ? loc.search.slice(1) : loc.search;
  let hash = loc.hash.startsWith('#') ? loc.hash.slice(1) : loc.hash;
  const kept: string[] = [];
  for (const kv of search.split('&')) {
    if (!kv) continue;
    const eq = kv.indexOf('=');
    const k = eq < 0 ? kv : kv.slice(0, eq);
    let key = k;
    try { key = decodeURIComponent(k); } catch { /* keep */ }
    if (key === 'm' || key === 'r') {
      const raw = eq >= 0 ? kv.slice(eq + 1) : '';
      if (raw && rawParam(hash, key) === null) hash = hash ? `${hash}&${key}=${raw}` : `${key}=${raw}`;
      continue;
    }
    if (key === 'tab') continue;
    kept.push(kv);
  }
  if (activeTab && activeTab !== 'pareto') kept.push(`tab=${encodeURIComponent(activeTab)}`);
  const q = kept.join('&');
  return loc.pathname + (q ? `?${q}` : '') + (hash ? `#${hash}` : '');
}
