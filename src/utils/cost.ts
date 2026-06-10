// ─── Buyability / cost via PubChem (free, no API key, CORS-enabled) ───────────
// PubChem's "Chemical Vendors" count is a strong availability/cost proxy:
//   100+ vendors  → commodity building block (cheap, in stock)
//   1–20 vendors  → specialty / catalog compound
//   0 vendors     → not a catalog compound → must be synthesized
// It also gives a one-click "buy" link to the vendor list (with real prices on
// the vendor sites). Literal $ prices need a commercial catalog API
// (Mcule/Molport/ChemSpace) routed through a keyed server proxy — see the cost
// tier roadmap; this client-side layer answers "can I buy it, and from how many?".
//
// Hardening: PubChem throttles under load (HTTP 503 PUGREST.ServerBusy / 429). A
// transient throttle must NOT be recorded as "not buyable" — we retry with
// backoff (honouring Retry-After), distinguish a genuine 404 (absent from
// PubChem) from a transient failure, and cache only confirmed results.
// Throttled molecules are left unknown so a re-run fills the gaps.

export interface Buyability {
  cid: number;        // PubChem CID (0 = confirmed not a catalog compound)
  vendors: number;    // number of chemical vendors listing it
  buyUrl: string | null;
}

const cache = new Map<string, Buyability>();

interface CidResponse { IdentifierList?: { CID?: number[] } }
interface CategoryResponse {
  SourceCategories?: { Categories?: { Category: string; Sources?: unknown[]; URL?: string }[] };
}

const PUBCHEM = 'https://pubchem.ncbi.nlm.nih.gov/rest';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
// 0.6s, 1.2s, 2.4s … with jitter, to ride out PubChem throttling.
const backoff = (attempt: number) => Math.round(600 * 2 ** attempt * (0.7 + Math.random() * 0.6));

/** InChIKey via RDKit.js — canonical, so the PubChem lookup is robust to
 *  SMILES-writing differences (a common cause of false "not buyable"). */
function inchiKey(smiles: string): string | null {
  const RDKit = (globalThis as {
    RDKitModule?: {
      get_mol: (s: string) => { is_valid: () => boolean; delete: () => void; get_inchi: () => string } | null;
      get_inchikey_for_inchi: (i: string) => string;
    };
  }).RDKitModule;
  if (!RDKit) return null;
  try {
    const m = RDKit.get_mol(smiles);
    if (!m || !m.is_valid()) { m?.delete(); return null; }
    const inchi = m.get_inchi();
    m.delete();
    if (!inchi) return null;
    return RDKit.get_inchikey_for_inchi(inchi) || null;
  } catch {
    return null;
  }
}

class TransientError extends Error {}

/** GET JSON with retry/backoff on PubChem throttling. Returns parsed JSON, or
 *  null for a genuine 404 (absent). Throws TransientError once retries exhaust. */
async function getJSON(url: string, retries = 3): Promise<unknown | null> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    } catch (e) {
      if (attempt >= retries) throw new TransientError(String(e));
      await sleep(backoff(attempt));
      continue;
    }
    if (res.status === 404) return null;                 // genuine: not in PubChem
    if (res.ok) {
      try { return await res.json(); }
      catch { if (attempt >= retries) throw new TransientError('bad json'); await sleep(backoff(attempt)); continue; }
    }
    // 429 / 503 / 5xx → transient; respect Retry-After if PubChem sent one
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const ra = Number(res.headers.get('retry-after'));
      await sleep(ra > 0 ? ra * 1000 : backoff(attempt));
      continue;
    }
    throw new TransientError('HTTP ' + res.status);
  }
}

const firstCid = (data: unknown): number => (data as CidResponse)?.IdentifierList?.CID?.[0] ?? 0;

/** Resolve a SMILES to a PubChem CID. 0 = confirmed absent. Throws on transient. */
async function resolveCID(smiles: string): Promise<number> {
  const key = inchiKey(smiles);
  if (key) {
    const byKey = await getJSON(`${PUBCHEM}/pug/compound/inchikey/${key}/cids/JSON`);
    if (byKey !== null) return firstCid(byKey);
    // InChIKey absent → fall back to SMILES (covers tautomer/standardisation gaps)
  }
  return firstCid(await getJSON(`${PUBCHEM}/pug/compound/smiles/${encodeURIComponent(smiles)}/cids/JSON`));
}

/** Look up PubChem purchasability (vendor count + buy link) for a SMILES.
 *  Returns null on transient failure (uncached → re-runnable); caches confirmed results. */
export async function fetchBuyability(smiles: string): Promise<Buyability | null> {
  const hit = cache.get(smiles);
  if (hit) return hit;
  try {
    const cid = await resolveCID(smiles);
    if (cid <= 0) {                                   // confirmed: not a catalog compound
      const r: Buyability = { cid: 0, vendors: 0, buyUrl: null };
      cache.set(smiles, r);
      return r;
    }
    const data = await getJSON(`${PUBCHEM}/pug_view/categories/compound/${cid}/JSON`);
    const fallback = `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}#section=Chemical-Vendors`;
    let result: Buyability;
    if (data) {
      const cats = (data as CategoryResponse)?.SourceCategories?.Categories ?? [];
      const cv = cats.find(c => c.Category === 'Chemical Vendors');
      result = { cid, vendors: cv?.Sources?.length ?? 0, buyUrl: cv?.URL ?? fallback };
    } else {
      // 404 on categories → compound exists but carries no vendor section
      result = { cid, vendors: 0, buyUrl: `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}` };
    }
    cache.set(smiles, result);
    return result;
  } catch {
    return null;                                      // transient — leave unknown, don't cache
  }
}

/** Fetch buyability for many molecules with polite concurrency + a retry pass for
 *  any that throttled. Only resolved molecules appear in the returned map. */
export async function fetchBuyabilityBatch(
  smilesList: string[],
  onProgress?: (done: number, total: number) => void,
  concurrency = 3,
): Promise<Map<string, Buyability>> {
  const out = new Map<string, Buyability>();
  let attempted = 0;
  const run = async (list: string[]) => {
    for (let i = 0; i < list.length; i += concurrency) {
      const chunk = list.slice(i, i + concurrency);
      const results = await Promise.all(chunk.map(s => fetchBuyability(s).then(b => [s, b] as const)));
      for (const [s, b] of results) if (b) out.set(s, b);
      attempted += chunk.length;
      onProgress?.(Math.min(attempted, smilesList.length), smilesList.length);
      if (i + concurrency < list.length) await sleep(350);   // PubChem ≈ 5 req/s
    }
  };
  await run(smilesList);
  // One retry pass for molecules that threw (throttled) the first time.
  const missing = smilesList.filter(s => !out.has(s));
  if (missing.length) {
    attempted = smilesList.length - missing.length;
    await sleep(1000);
    await run(missing);
  }
  return out;
}
