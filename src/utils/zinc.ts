// ─── Building-block prices via ZINC-22 / CartBlanche (free, no API key, CORS) ──
// ZINC aggregates real vendor catalogs (Enamine, eMolecules, Mcule, WuXi, …) with
// per-pack prices, quantities, and lead times across zinc20 (in-stock) and zinc22
// (make-on-demand). Unlike PubChem's vendor *count*, this returns actual money.
//
// The search is an async job: POST a SMILES file -> {task}; poll the status
// endpoint until status === 'SUCCESS'; then read the JSON results. Each match
// carries `matched_smiles` (verbatim the query) so correlation back to the input
// is an exact string group-by — no canonicalisation needed.

import type { MolCost } from './types';

const CB = 'https://cartblanche22.docking.org';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface SubmitResponse { task?: string }
interface StatusResponse { status?: string }
interface ZincCatalog {
  catalog_name?: string; price?: number | null; quantity?: number | null;
  unit?: string | null; shipping?: string | null;
}
interface ZincMatch { matched_smiles?: string; zinc_id?: string; catalogs?: ZincCatalog[] }

const notFound = (): MolCost => ({ zincId: null, catalogs: 0, pricePerMg: null, cheapest: null, purchasable: false });

async function submit(smilesList: string[]): Promise<string> {
  const fd = new FormData();
  fd.append('smiles', new Blob([smilesList.join('\n') + '\n'], { type: 'text/plain' }), 'query.smi');
  fd.append('database', 'zinc20,zinc22');
  fd.append('format', 'json');
  const res = await fetch(`${CB}/smiles.json`, { method: 'POST', body: fd, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`ZINC submit failed (HTTP ${res.status})`);
  const data = (await res.json()) as SubmitResponse;
  if (!data?.task) throw new Error('ZINC: no task id returned');
  return data.task;
}

/** Poll the status endpoint until the Celery task reports SUCCESS.
 *  Jobs over many compounds take a while (≈2 min for a few dozen), so allow 5 min. */
async function waitDone(task: string, onElapsed?: (sec: number) => void): Promise<void> {
  const start = Date.now();
  const deadline = start + 300_000;
  let first = true;
  while (Date.now() < deadline) {
    await sleep(first ? 1500 : 3000);
    first = false;
    onElapsed?.(Math.round((Date.now() - start) / 1000));
    try {
      const res = await fetch(`${CB}/search/result/${task}`, { signal: AbortSignal.timeout(20000) });
      if (!(res.headers.get('content-type') || '').includes('application/json')) continue; // SPA / not ready
      const st = (await res.json()) as StatusResponse;
      if (st?.status === 'SUCCESS') return;
      if (st?.status === 'FAILURE') throw new Error('ZINC search failed');
      // PENDING / STARTED / PROGRESS → keep polling
    } catch (e) {
      if (e instanceof Error && e.message === 'ZINC search failed') throw e;
      /* transient network/parse error → keep polling */
    }
  }
  throw new Error('ZINC search timed out');
}

/** Fetch building-block prices for many molecules in one ZINC job.
 *  Returns a MolCost per input (not-found inputs map to a not-purchasable entry). */
export async function fetchZincPrices(
  smilesList: string[],
  onElapsed?: (sec: number) => void,
): Promise<Map<string, MolCost>> {
  const out = new Map<string, MolCost>();
  if (smilesList.length === 0) return out;

  const task = await submit(smilesList);
  await waitDone(task, onElapsed);

  const res = await fetch(`${CB}/search/result/${task}.json`, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`ZINC result failed (HTTP ${res.status})`);
  const arr = (await res.json()) as unknown[];

  // Group matches by the query SMILES they came from (exact string).
  const groups = new Map<string, ZincMatch[]>();
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue;
    const m = it as ZincMatch;
    if (!m.matched_smiles) continue;
    let g = groups.get(m.matched_smiles);
    if (!g) { g = []; groups.set(m.matched_smiles, g); }
    g.push(m);
  }

  for (const smi of smilesList) {
    const items = groups.get(smi);
    if (!items || items.length === 0) { out.set(smi, notFound()); continue; }
    let zincId: string | null = null;
    let priced = 0;
    let bestPerMg = Infinity;
    let cheapest: MolCost['cheapest'] = null;
    for (const it of items) {
      if (!zincId && it.zinc_id) zincId = it.zinc_id;
      for (const c of it.catalogs ?? []) {
        if (c.price == null) continue;
        priced++;
        if (c.unit === 'mg' && c.quantity) bestPerMg = Math.min(bestPerMg, c.price / c.quantity);
        if (!cheapest || c.price < cheapest.price) {
          cheapest = { price: c.price, quantity: c.quantity ?? 0, unit: c.unit ?? '', shipping: c.shipping ?? undefined, catalog: c.catalog_name ?? 'vendor' };
        }
      }
    }
    out.set(smi, {
      zincId,
      catalogs: priced,
      pricePerMg: bestPerMg === Infinity ? null : Math.round(bestPerMg * 100) / 100,
      cheapest,
      purchasable: true, // matched in a ZINC catalog
    });
  }
  return out;
}
