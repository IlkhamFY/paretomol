// ─── RAScore: retrosynthetic accessibility (isolated micro-service) ───────────
// RAScore (Thakkar et al., Chem. Sci. 2021) is the probability that AiZynthFinder
// can find a synthesis route: 0 = hard / no route, 1 = readily synthesizable.
// A learned make-ability signal that complements the Ertl SA score.
//
// It runs in its OWN container (see hf-space-rascore/) because its pretrained XGB
// model only loads under 2020-era pins incompatible with the ADMET-AI Space. The
// endpoint URL is user-configured (deploy-your-own), stored in localStorage.

const RASCORE_URL_KEY = 'rascore_url';
// Shared default RAScore Space — works out of the box. Power users can point at
// their own deployment by setting the 'rascore_url' localStorage key.
const DEFAULT_RASCORE_URL = 'https://ilkhamfy-rascore-api.hf.space';

export function getRascoreUrl(): string {
  try { return localStorage.getItem(RASCORE_URL_KEY) || DEFAULT_RASCORE_URL; } catch { return DEFAULT_RASCORE_URL; }
}

export function setRascoreUrl(url: string): void {
  try { localStorage.setItem(RASCORE_URL_KEY, url.replace(/\/$/, '')); } catch { /* storage unavailable */ }
}

interface RAResponse { results?: { smiles: string; SA_Score: number | null; RAScore: number | null; SCScore: number | null }[] }

/** Make-ability scores from the micro-service: SA score (Ertl, 1 easy – 10 hard),
 *  RAScore (0 hard – 1 easy), and SCScore (Coley complexity, 1 easy – 5 hard). */
export interface MakeabilityScores { sa?: number; ra?: number; sc?: number }

/** Fetch RAScore + SCScore for many molecules from a deployed make-ability endpoint.
 *  Returns a map of SMILES → scores (only molecules with at least one score). */
export async function fetchRAScore(smilesList: string[], url: string): Promise<Map<string, MakeabilityScores>> {
  const out = new Map<string, MakeabilityScores>();
  const base = url.replace(/\/$/, '');
  for (let i = 0; i < smilesList.length; i += 500) {
    const chunk = smilesList.slice(i, i + 500);
    const res = await fetch(`${base}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ smiles: chunk }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(`make-ability HTTP ${res.status}`);
    const data = (await res.json()) as RAResponse;
    for (const r of data.results ?? []) {
      const e: MakeabilityScores = {};
      if (typeof r.SA_Score === 'number') e.sa = r.SA_Score;
      if (typeof r.RAScore === 'number') e.ra = r.RAScore;
      if (typeof r.SCScore === 'number') e.sc = r.SCScore;
      if (e.sa !== undefined || e.ra !== undefined || e.sc !== undefined) out.set(r.smiles, e);
    }
  }
  return out;
}
