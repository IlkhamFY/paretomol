// Count QED structural alerts with the browser build of RDKit, exactly the way
// the application does, and write the counts where the Python side can read
// them.
//
//   node paper/scripts/rdkitjs_alert_parity.mjs <input.json> <output.json>
//
// Input:  {"smiles": [...]}
// Output: {"rdkitjs_version", "smarts", "n_compiled", "counts"}
// A count is null where RDKit.js could not parse the molecule.
//
// Driven by paper/scripts/rdkitjs_alert_parity.py rather than run directly: the
// comparison is only meaningful against the Python reference computed there.
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = join(ROOT, 'e2e', 'fixtures');
const ALERTS_TS = join(ROOT, 'src', 'data', 'qedAlerts.ts');

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) {
  console.error('usage: node rdkitjs_alert_parity.mjs <input.json> <output.json>');
  process.exit(2);
}

/** The alert patterns the application itself uses, read from its data module.
 *  Re-listing them here would compare RDKit.js against a copy rather than
 *  against what ships in the browser. */
function alertSmarts() {
  const src = readFileSync(ALERTS_TS, 'utf8');
  // Terminated on `];` rather than the first `]`, which SMARTS atom
  // expressions are full of.
  const block = src.match(/QED_ALERT_SMARTS[^=]*=\s*\[([\s\S]*?)\]\s*;/);
  const out = block ? [...block[1].matchAll(/'([^']*)'/g)].map(m => m[1]) : [];
  if (out.length === 0) throw new Error(`no SMARTS found in ${ALERTS_TS}`);
  return out;
}

/** RDKit.js is a CommonJS UMD bundle and this package is ESM, so Node would
 *  parse it as a module and hand back an empty object. A .cjs copy forces the
 *  CommonJS loader; locateFile keeps the 7 MB WebAssembly file where it is. */
async function loadRDKit() {
  const js = join(FIXTURES, 'RDKit_minimal.js');
  const wasm = join(FIXTURES, 'RDKit_minimal.wasm');
  if (!existsSync(js) || !existsSync(wasm)) {
    throw new Error(`RDKit.js fixtures missing from ${FIXTURES}; run node e2e/fetch-fixtures.mjs`);
  }
  const cjs = join(mkdtempSync(join(tmpdir(), 'rdkitjs-')), 'RDKit_minimal.cjs');
  copyFileSync(js, cjs);
  const initRDKitModule = createRequire(cjs)(cjs);
  return initRDKitModule({ locateFile: () => wasm });
}

// Mirrors countQEDAlerts in src/utils/chem.ts. The receiver is the molecule and
// the argument is the query: the other way round silently matches nothing.
function countAlerts(mol, queries) {
  let n = 0;
  for (const q of queries) {
    if (!q) continue;
    try {
      const hit = mol.get_substruct_match(q);
      if (hit && hit !== '{}' && hit !== '') n++;
    } catch { /* pattern not applicable to this molecule */ }
  }
  return n;
}

const { smiles } = JSON.parse(readFileSync(inPath, 'utf8'));
const smarts = alertSmarts();
const RDKit = await loadRDKit();

// A pattern the browser build will not compile is skipped rather than fatal,
// as in the application; the count of those that did compile is reported so
// that silent under-counting cannot pass as agreement.
const queries = smarts.map(s => {
  try {
    const q = RDKit.get_qmol(s);
    if (q && !q.is_valid()) { q.delete(); return null; }
    return q;
  } catch { return null; }
});

const counts = smiles.map(s => {
  // get_mol throws on some malformed input and returns an invalid molecule on
  // the rest; the application treats both as unparseable, so this does too.
  let mol = null;
  try {
    mol = RDKit.get_mol(s);
    if (!mol || !mol.is_valid()) return null;
    return countAlerts(mol, queries);
  } catch { return null; } finally { mol?.delete(); }
});

for (const q of queries) q?.delete();

writeFileSync(outPath, JSON.stringify({
  rdkitjs_version: RDKit.version(),
  smarts,
  n_compiled: queries.filter(Boolean).length,
  counts,
}));
