// ─── Real building-block prices via a deploy-your-own proxy (ChemPrice) ───────
// Commercial price APIs (Mcule/ChemSpace/Molport) are keyed and not CORS-enabled,
// so the price proxy (see hf-space-prices/) holds the key(s) server-side and
// returns the best real USD price per SMILES. Unlike ZINC's placeholder list
// price, this is a genuine, discriminating cost signal ($/g). Endpoint URL is
// user-configured (stored in localStorage).

const PRICE_URL_KEY = 'price_proxy_url';

export function getPriceUrl(): string | null {
  try { return localStorage.getItem(PRICE_URL_KEY); } catch { return null; }
}

export function setPriceUrl(url: string): void {
  try { localStorage.setItem(PRICE_URL_KEY, url.replace(/\/$/, '')); } catch { /* storage unavailable */ }
}

export interface PriceInfo { usdPerG: number; source?: string; supplier?: string }

interface PriceResponse {
  results?: { smiles: string; usd_per_g: number | null; source?: string; supplier?: string }[];
}

/** Fetch best real $/g per molecule from a deployed price proxy.
 *  Only molecules with a real quote are included in the map. */
export async function fetchPrices(smilesList: string[], url: string): Promise<Map<string, PriceInfo>> {
  const out = new Map<string, PriceInfo>();
  const base = url.replace(/\/$/, '');
  for (let i = 0; i < smilesList.length; i += 40) {   // proxy caps at 50/request
    const chunk = smilesList.slice(i, i + 40);
    const res = await fetch(`${base}/price`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ smiles: chunk }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(`Price proxy HTTP ${res.status}`);
    const data = (await res.json()) as PriceResponse;
    for (const r of data.results ?? []) {
      if (typeof r.usd_per_g === 'number') out.set(r.smiles, { usdPerG: r.usd_per_g, source: r.source, supplier: r.supplier });
    }
  }
  return out;
}
