/**
 * Privacy-friendly usage counts via GoatCounter.
 * Event names only: never SMILES, filenames, or other molecule data.
 * Page hits drop the `m` query param, which is a compressed structure payload.
 */

export type MoleculeSource = 'upload' | 'paste' | 'example' | 'chembl';
export type ExportFormat = 'png' | 'svg' | 'csv' | 'sdf' | 'json' | 'md';
export type CitationFormat = 'bibtex' | 'ris';

export type TrackEvent =
  | `molecules/${MoleculeSource}`
  | 'pareto'
  | 'admet/requested'
  | 'admet/succeeded'
  | 'admet/failed'
  | `export/${ExportFormat}`
  | 'decision/exported'
  | 'decision/imported'
  | 'review/opened'
  | 'review/exported'
  | 'cite/opened'
  | `cite/${CitationFormat}/copied`
  | `cite/${CitationFormat}/downloaded`;

interface GoatHit {
  p?: string | null;
  q?: string;
  r?: string | null;
  e?: boolean;
}

interface GoatCounter {
  count: (vars?: { path?: string; title?: string; event?: boolean }) => void;
  get_data?: (vars?: { path?: string; title?: string; event?: boolean }) => GoatHit;
  no_onload?: boolean;
  __paretomol?: boolean;
}

declare global {
  interface Window {
    goatcounter?: GoatCounter;
  }
}

const PRODUCTION_HOST = 'paretomol.com';
const SAFE_QUERY_KEYS = ['tab', 'docs'];

function productionHost(): boolean {
  return typeof location !== 'undefined' && location.hostname === PRODUCTION_HOST;
}

const PAYLOAD_KEYS = ['m', 'r'];

/** Drop compressed molecule payloads (`m` share links, `r` review links) from a
 *  path, query, or referrer, in the query and in the fragment. */
export function stripMoleculePayload(value: string): string {
  const hashAt = value.indexOf('#');
  let hash = hashAt >= 0 ? value.slice(hashAt) : '';
  if (PAYLOAD_KEYS.some((k) => new URLSearchParams(hash.slice(1)).has(k))) hash = '';
  const beforeHash = hashAt >= 0 ? value.slice(0, hashAt) : value;
  const queryAt = beforeHash.indexOf('?');
  if (queryAt === -1) return beforeHash + hash;
  const params = new URLSearchParams(beforeHash.slice(queryAt + 1));
  if (!PAYLOAD_KEYS.some((k) => params.has(k))) return beforeHash + hash;
  for (const k of PAYLOAD_KEYS) params.delete(k);
  const rest = params.toString();
  return beforeHash.slice(0, queryAt) + (rest ? `?${rest}` : '') + hash;
}

/** Path sent for a page view. Only the route and non-sensitive view params. */
export function analyticsPath(): string {
  if (typeof location === 'undefined') return '/';
  const incoming = new URLSearchParams(location.search);
  const safe = new URLSearchParams();
  for (const key of SAFE_QUERY_KEYS) {
    if (!incoming.has(key)) continue;
    const value = incoming.get(key);
    if (value) safe.set(key, value);
  }
  const query = safe.toString();
  return location.pathname + (query ? `?${query}` : '');
}

function guardGoatcounter(): void {
  const gc = typeof window === 'undefined' ? undefined : window.goatcounter;
  if (!gc?.get_data || gc.__paretomol) return;
  const original = gc.get_data;
  gc.get_data = (vars) => {
    const data = original(vars);
    if (data.e) {
      data.q = '';
    } else if (typeof data.q === 'string') {
      data.q = stripMoleculePayload(data.q);
    }
    if (typeof data.p === 'string') data.p = stripMoleculePayload(data.p);
    if (typeof data.r === 'string') data.r = stripMoleculePayload(data.r);
    return data;
  };
  gc.__paretomol = true;
}

/** Count one named event. No-op when GoatCounter is absent, blocked, or not on paretomol.com. */
export function track(event: TrackEvent): void {
  const name = event;
  if (!productionHost() || typeof window === 'undefined') return;
  try {
    guardGoatcounter();
    window.goatcounter?.count({ path: 'event/' + name, title: name, event: true });
  } catch {
    // Script blocked or count() threw. Analytics must not affect the app.
  }
}

let pageviewsStarted = false;
let lastPage = '';

function countPage(path: string): void {
  if (!productionHost() || typeof window === 'undefined') return;
  try {
    guardGoatcounter();
    window.goatcounter?.count({ path });
  } catch {
    // Absent or blocked.
  }
}

function noteNavigation(): void {
  const path = analyticsPath();
  if (path === lastPage) return;
  lastPage = path;
  countPage(path);
}

/**
 * Count the first production page view, then later client-side view changes.
 * The script tag sets `no_onload` so its automatic hit (which would include
 * `location.search`) never leaves the browser before this sanitizer runs.
 */
export function startAnalytics(): void {
  if (pageviewsStarted || !productionHost() || typeof document === 'undefined') return;
  pageviewsStarted = true;

  const boot = () => {
    if (!window.goatcounter?.count) return;
    guardGoatcounter();
    lastPage = analyticsPath();
    countPage(lastPage);
    const originalReplace = history.replaceState.bind(history);
    const originalPush = history.pushState.bind(history);
    history.replaceState = (data, unused, url) => {
      originalReplace(data, unused, url);
      noteNavigation();
    };
    history.pushState = (data, unused, url) => {
      originalPush(data, unused, url);
      noteNavigation();
    };
    window.addEventListener('popstate', noteNavigation);
  };

  if (window.goatcounter?.count) {
    boot();
    return;
  }
  const script = document.querySelector('script[data-goatcounter]');
  script?.addEventListener('load', boot, { once: true });
  // The script can finish between the check above and the listener.
  if (window.goatcounter?.count) boot();
}
