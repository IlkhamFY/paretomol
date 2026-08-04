import { test, expect, waitForRDKit } from './rdkit';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Performance, memory and failure behaviour up to and beyond the stated batch
 * limit.
 *
 * The Digital Discovery data reviewer asked that performance tests report
 * "runtime, memory, and failure behaviour up to the stated batch limit". The
 * manuscript already reported runtime; this adds the other two and re-measures
 * runtime in the same run so all three come from one procedure.
 *
 * Molecules are drawn from the deposited FDA reference set rather than
 * synthesised, so the parsing cost reflects real drug-like structures.
 *
 * Heap figures come from Chromium's performance.memory, which is a rough
 * measure: it reports the JavaScript heap only, excludes the WebAssembly heap
 * where RDKit does most of its allocation, and is subject to when garbage
 * collection happens to run. It is reported as an order-of-magnitude
 * indication, not a precise footprint, and the caveat travels with the number.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, 'paper', 'results', 'performance.json');

/** Split one CSV line, honouring double-quoted fields.
 *  Four compound names in the reference set contain a comma, among them
 *  "CEFPROZIL ANHYDROUS, (E)-". Splitting naively on the comma shifts every
 *  later column on those rows, so the cell read as SMILES is in fact the
 *  ChEMBL identifier -- which the application correctly treats as a compound
 *  name and sends to PubChem for resolution. That is a measurement of the
 *  lookup path, not of parsing, and it does not belong in these numbers. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c !== '"') cur += c;
      else if (line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') { cells.push(cur); cur = ''; }
    else cur += c;
  }
  cells.push(cur);
  return cells;
}

/** N molecules drawn from the deposited reference set, as "SMILES name" lines. */
function corpus(n: number): string {
  const rows = readFileSync(join(ROOT, 'paper', 'fda_approved_1949.csv'), 'utf8')
    .split('\n').filter(l => l.trim() !== '');
  const header = splitCsvLine(rows[0]);
  const si = header.indexOf('smiles');
  const ni = header.indexOf('name');
  const lines: string[] = [];
  // Stops as soon as n rows are in hand. When n exceeds the file, this reads it
  // all and the repeat below expands from there.
  for (let i = 1; i < rows.length && lines.length < n; i++) {
    const cells = splitCsvLine(rows[i]);
    const smi = cells[si];
    if (!smi) continue;
    lines.push(`${smi} ${(cells[ni] || 'cmpd').replace(/\s+/g, '_')}_${lines.length}`);
  }
  if (lines.length === 0) throw new Error('no SMILES parsed from the reference set');
  // Repeat the set when more molecules are requested than the file holds. The
  // modulus is the number of lines collected, not the number of CSV rows: the
  // file ends in a newline, so the two differ by one, and indexing by the
  // latter reads past the end and appends a blank line to the corpus.
  const collected = lines.length;
  while (lines.length < n) lines.push(lines[lines.length % collected]);
  const out = lines.slice(0, n);
  if (out.some(l => !l)) throw new Error('corpus contains an empty line');
  return out.join('\n');
}

interface Measurement {
  molecules: number;
  seconds: number;
  heapMB: number | null;
  loaded: boolean;
}

const measurements: Measurement[] = [];

// Chromium only, and deliberately so. The heap figure comes from
// performance.memory, which no other engine implements, and this file writes a
// single tracked artefact: run under three projects with one worker, the last
// project to finish would overwrite the Chromium numbers with a set carrying
// heapMB: null. The deposited file says "headless Chromium" and must actually
// be that. Cross-engine coverage of the application's behaviour is the job of
// analysis.spec.ts, which does run under all three.
test.skip(({ browserName }) => browserName !== 'chromium',
  'performance.memory is Chromium-only, and the deposited artefact is single-writer');

/** Sizes spanning the interactive range, the stated soft limit, and beyond it. */
const SIZES = [100, 500, 1000, 2000];

for (const n of SIZES) {
  test(`loads ${n} molecules within the interactive budget`, async ({ page }) => {
    // Above the soft limit the application asks for confirmation; accept it so
    // the measurement covers the load itself rather than the dialog.
    page.on('dialog', d => d.accept());

    await page.goto('/');
    await waitForRDKit(page);

    const before = await page.evaluate(() =>
      (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null,
    );

    const box = page.locator('textarea').first();
    await box.fill(corpus(n));

    const started = Date.now();
    await page.getByRole('button', { name: /Analyze Molecules/i }).first().click();
    // The exact count, not merely that something loaded: a corpus that silently
    // delivered fewer molecules than asked for would otherwise be recorded as a
    // timing for n, and a cost per molecule is only meaningful if n is real.
    await expect(page.getByText(new RegExp(`\\b${n} molecules loaded`)).first())
      .toBeVisible({ timeout: 300_000 });
    const seconds = (Date.now() - started) / 1000;

    const after = await page.evaluate(() =>
      (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null,
    );
    const heapMB = before !== null && after !== null
      ? Math.round(((after - before) / 1024 / 1024) * 10) / 10
      : null;

    measurements.push({ molecules: n, seconds: Math.round(seconds * 100) / 100, heapMB, loaded: true });

    // The application must remain responsive, not merely finish: switching view
    // after a large load is the interaction that would expose a frozen tab.
    await page.getByRole('button', { name: /^Table$/i }).first().click();
    await expect(page.locator('#root')).toContainText(/pareto/i);
  });
}

test('warns before exceeding the stated soft limit, and honours a refusal', async ({ page }) => {
  // The documented behaviour above 2,000 molecules is a confirmation prompt.
  // Declining it must leave the application in its previous state rather than
  // half-loading or hanging.
  await page.goto('/');
  await waitForRDKit(page);

  let prompted = false;
  page.on('dialog', d => { prompted = true; d.dismiss(); });

  await page.locator('textarea').first().fill(corpus(2500));
  await page.getByRole('button', { name: /Analyze Molecules/i }).first().click();

  // Polled rather than slept on: a fixed delay passes or fails according to how
  // loaded the machine is, and the dialog handler already records the fact we
  // are waiting for.
  await expect
    .poll(() => prompted, {
      message: 'exceeding the soft limit should prompt for confirmation',
      timeout: 30_000,
    })
    .toBe(true);
  // Declined: nothing loaded, and the page is still usable.
  await expect(page.locator('#root')).toContainText(/ParetoMol/i);
});

test('degrades rather than failing beyond the soft limit', async ({ page }) => {
  // Accepting the warning at 2,500 must still produce a usable result. The
  // manuscript claims graceful degradation above the limit; this checks it.
  test.setTimeout(420_000);
  page.on('dialog', d => d.accept());

  await page.goto('/');
  await waitForRDKit(page);

  // Measured as the increase across the load, exactly as the sized tests above
  // do it. Recording the absolute heap here instead would put a different
  // quantity in the same column: the deposited note defines heapMB as an
  // increase, and an absolute figure alongside four deltas reads as a jump in
  // consumption that never happened.
  const before = await page.evaluate(() =>
    (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null,
  );

  await page.locator('textarea').first().fill(corpus(2500));

  const started = Date.now();
  await page.getByRole('button', { name: /Analyze Molecules/i }).first().click();
  await expect(page.getByText(/\b2500 molecules loaded/).first())
    .toBeVisible({ timeout: 360_000 });
  const seconds = (Date.now() - started) / 1000;

  const after = await page.evaluate(() =>
    (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null,
  );
  const heapMB = before !== null && after !== null
    ? Math.round(((after - before) / 1024 / 1024) * 10) / 10
    : null;
  measurements.push({ molecules: 2500, seconds: Math.round(seconds * 100) / 100, heapMB, loaded: true });

  await expect(page.locator('#root')).toContainText(/ParetoMol/i);
});

test.afterAll(() => {
  if (measurements.length === 0) return;
  measurements.sort((a, b) => a.molecules - b.molecules);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({
    note: 'Wall-clock from clicking Analyze to the application reporting exactly this many '
        + 'molecules loaded, headless Chromium. heapMB is the increase in Chromium '
        + 'performance.memory.usedJSHeapSize across the load, measured the same way at every '
        + 'size: the JavaScript heap only, excluding the WebAssembly heap where RDKit '
        + 'allocates, and subject to garbage-collection timing. Repeat runs on one machine '
        + 'moved the 2500 figure between 46 and 65 MB, so treat heapMB as an order-of-magnitude '
        + 'indication rather than a footprint. Chromium only, because no other engine '
        + 'implements performance.memory and this file writes a single artefact.',
    softLimit: 2000,
    measurements,
  }, null, 2) + '\n');
  // Surfaced in the run log so CI records it even when the artefact is not kept.
  for (const m of measurements) {
    console.log(`  ${String(m.molecules).padStart(5)} molecules  ${String(m.seconds).padStart(7)} s  `
              + `heap +${m.heapMB ?? 'n/a'} MB`);
  }
});
