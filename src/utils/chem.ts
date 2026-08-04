import type { Molecule, FilterResult, MolProps, ParetoObjective } from './types';
import { DRUG_FILTERS, DEFAULT_PARETO_OBJECTIVES } from './types';
import { computeQED } from './qed';
import { QED_ALERT_SMARTS } from '../data/qedAlerts';
import { parseAssayValue, isCensored, aggregate, isConflicting } from './assayValue';
import type { AssayValue } from './assayValue';

// Let the window object hold RDKitModule globally just like index.html
declare global {
  interface Window {
    initRDKitModule: () => Promise<any>;
    RDKitModule: any;
  }
}

export async function initRDKitCache(): Promise<any> {
  if (window.RDKitModule) return window.RDKitModule;
  if (!window.initRDKitModule) throw new Error("RDKit minimal JS not loaded via CDN");
  window.RDKitModule = await window.initRDKitModule();
  return window.RDKitModule;
}

// ─── Lazy SVG cache ──────────────────────────────────────────────────────────
const svgCache = new Map<string, string>();

/** Generate SVG lazily — only on first render. Caches by SMILES + theme. */
export function getMolSvg(smiles: string): string {
  const isDark = document.documentElement.classList.contains('dark');
  const cacheKey = `${smiles}:${isDark ? 'd' : 'l'}`;
  const cached = svgCache.get(cacheKey);
  if (cached !== undefined) return cached;
  if (!window.RDKitModule) return '';
  try {
    const mol = window.RDKitModule.get_mol(smiles);
    if (!mol || !mol.is_valid()) { svgCache.set(cacheKey, ''); return ''; }
    const drawOpts = mol.get_svg_with_highlights(JSON.stringify({
      width: 200,
      height: 150,
      bondLineWidth: isDark ? 1.8 : 1.5,
      backgroundColour: [0, 0, 0, 0],
    }));
    // Replace default black (#000000) atom labels/bonds with theme-aware color
    const molStroke = getComputedStyle(document.documentElement).getPropertyValue('--mol-stroke').trim() || '#E8E6E3';
    // Replace atom label background (#FFFFFF) with transparent so labels sit cleanly on any bg
    let svg = drawOpts
      .replace(/#000000/gi, molStroke)
      .replace(/#FFFFFF/gi, 'transparent');
    // Lighten heteroatom colors in dark mode for better contrast
    if (isDark) {
      svg = svg.replace(/#0000FF/gi, '#809FFF')   // N: blue → periwinkle
               .replace(/#FF0000/gi, '#FF8A80')   // O: red → salmon
               .replace(/#00CC00/gi, '#69DB7C')   // Cl: green → mint
               .replace(/#33CCCC/gi, '#66E0E0')   // F: teal → light cyan
               .replace(/#B2B200/gi, '#E0D64A')   // S: olive → bright yellow
               .replace(/#FF8000/gi, '#FFB366')   // P: orange → light orange
               .replace(/#7F7F7F/gi, '#B0B0B0');  // other → mid gray
    }
    mol.delete();
    svgCache.set(cacheKey, svg);
    return svg;
  } catch {
    svgCache.set(cacheKey, '');
    return '';
  }
}

/** Clear SVG cache (e.g. on reset). */
export function clearSvgCache(): void {
  svgCache.clear();
}

/** Re-color RDKit SVG output to be theme-aware (atoms/bonds + heteroatom hues). */
function themeRecolorSvg(svgRaw: string, isDark: boolean): string {
  const molStroke = getComputedStyle(document.documentElement).getPropertyValue('--mol-stroke').trim() || '#E8E6E3';
  let svg = svgRaw.replace(/#000000/gi, molStroke).replace(/#FFFFFF/gi, 'transparent');
  if (isDark) {
    svg = svg.replace(/#0000FF/gi, '#809FFF').replace(/#FF0000/gi, '#FF8A80')
             .replace(/#00CC00/gi, '#69DB7C').replace(/#33CCCC/gi, '#66E0E0')
             .replace(/#B2B200/gi, '#E0D64A').replace(/#FF8000/gi, '#FFB366')
             .replace(/#7F7F7F/gi, '#B0B0B0');
  }
  return svg;
}

/** Render a 2D depiction with the given atoms/bonds highlighted (e.g. a matched
 *  structural-alert fragment). Amber highlight by default; size and colour are
 *  configurable so the alerts panel can render large, prominent depictions. */
export function getMolSvgHighlighted(
  smiles: string,
  atoms: number[],
  bonds: number[] = [],
  opts: { width?: number; height?: number; color?: [number, number, number, number] } = {},
): string {
  const RDKit = (globalThis as { RDKitModule?: RDKitMinimal }).RDKitModule;
  if (!RDKit) return '';
  const isDark = document.documentElement.classList.contains('dark');
  try {
    const mol = RDKit.get_mol(smiles);
    if (!mol || !mol.is_valid()) { mol?.delete(); return ''; }
    const details = {
      width: opts.width ?? 280,
      height: opts.height ?? 210,
      bondLineWidth: isDark ? 1.8 : 1.5,
      backgroundColour: [0, 0, 0, 0],
      atoms,
      bonds,
      highlightColour: opts.color ?? [1.0, 0.62, 0.10, 0.62], // brighter, more-opaque amber (#FF9E1A)
      highlightRadius: 0.42,            // larger highlight circles so flagged atoms stand out
      highlightBondWidthMultiplier: 18, // thicker highlighted bonds outline the fragment
    };
    const raw = mol.get_svg_with_highlights(JSON.stringify(details));
    mol.delete();
    return themeRecolorSvg(raw, isDark);
  } catch {
    return '';
  }
}

// ─── Make-ability map: where the synthetic difficulty lives ──────────────────
// Highlights the features that drive synthetic complexity — stereocentres (exact
// CIP atoms) and saturated / non-aromatic (fused) ring systems — so "SA 4.6" stops
// being an opaque number and becomes "the difficulty is concentrated here".
export interface DifficultyHighlight { atoms: number[]; bonds: number[]; nStereo: number; nRingAtoms: number; }

export function getDifficultyHighlight(smiles: string): DifficultyHighlight {
  const empty: DifficultyHighlight = { atoms: [], bonds: [], nStereo: 0, nRingAtoms: 0 };
  const RDKit = (globalThis as { RDKitModule?: RDKitMinimal }).RDKitModule;
  if (!RDKit) return empty;
  let mol: RDKitMol | null = null;
  try {
    mol = RDKit.get_mol(smiles);
    if (!mol || !mol.is_valid()) { mol?.delete(); return empty; }
    const atomSet = new Set<number>();
    const bondSet = new Set<number>();

    // Stereocentres — the single biggest make-ability driver, taken exactly from CIP tags.
    let nStereo = 0;
    try {
      const tags = JSON.parse(mol.get_stereo_tags() || '{}') as { CIP_atoms?: [number, string][] };
      for (const [a] of tags.CIP_atoms ?? []) { atomSet.add(a); nStereo++; }
    } catch { /* no stereo info */ }

    // Saturated / fused (non-aromatic) ring systems — the other dominant driver.
    let nRingAtoms = 0;
    try {
      const q = RDKit.get_qmol('[R;!a]~[R;!a]'); // adjacent non-aromatic ring atoms → atoms + ring bonds
      if (q && q.is_valid()) {
        const matches = JSON.parse(mol.get_substruct_matches(q) || '[]') as { atoms: number[]; bonds: number[] }[];
        const ringAtoms = new Set<number>();
        for (const m of matches) {
          for (const a of m.atoms) { atomSet.add(a); ringAtoms.add(a); }
          for (const bd of m.bonds) bondSet.add(bd);
        }
        nRingAtoms = ringAtoms.size;
      }
      q?.delete();
    } catch { /* no ring info */ }

    mol.delete();
    return { atoms: [...atomSet], bonds: [...bondSet], nStereo, nRingAtoms };
  } catch {
    mol?.delete();
    return empty;
  }
}

// ─── Structural-alert detection (client-side, RDKit FilterCatalog SMARTS) ─────
// Catalog (PAINS / Brenk / NIH) is bundled from RDKit's canonical FilterCatalog
// data and lazy-loaded on first use. See paper/scripts/build_structural_alerts.py.

export interface AlertHit {
  ruleSet: string;          // 'PAINS' | 'Brenk' | 'NIH'
  name: string;             // RDKit alert name, e.g. 'quinone_A'
  atoms: number[];          // matched atom indices (for highlighting)
  bonds: number[];          // matched bond indices
}

interface RDKitMinimal {
  get_mol: (s: string) => RDKitMol | null;
  get_qmol: (s: string) => RDKitMol | null;
}
interface RDKitMol {
  is_valid: () => boolean;
  delete: () => void;
  get_substruct_match: (q: RDKitMol) => string;
  get_substruct_matches: (q: RDKitMol) => string;
  get_stereo_tags: () => string;
  get_svg_with_highlights: (details: string) => string;
}

type AlertCatalog = Record<string, { name: string; smarts: string }[]>;
let alertCatalogPromise: Promise<AlertCatalog> | null = null;
const qmolCache = new Map<string, RDKitMol | null>();

/** Number of canonical-QED structural alerts a molecule matches.
 *
 *  QED's alert term counts how many of the reference implementation's 116
 *  patterns match at least once — not the total number of matches. These
 *  patterns are specific to QED and are not the PAINS/Brenk/NIH catalogues
 *  used elsewhere in this file, so the two counts are not interchangeable.
 *  Compiled queries are cached across molecules; without that, 116 SMARTS
 *  would be recompiled for every structure. */
function countQEDAlerts(mol: RDKitMol, RDKit: RDKitMinimal): number {
  let n = 0;
  for (const smarts of QED_ALERT_SMARTS) {
    let q = qmolCache.get(smarts);
    if (q === undefined) {
      try {
        q = RDKit.get_qmol(smarts);
        if (q && !q.is_valid()) { q.delete(); q = null; }
      } catch { q = null; }
      qmolCache.set(smarts, q);
    }
    if (!q) continue;
    try {
      // Existence is all QED needs, so stop at the first match rather than
      // enumerating every occurrence.
      const hit = mol.get_substruct_match(q);
      if (hit && hit !== '{}' && hit !== '') n++;
    } catch { /* pattern not applicable to this molecule */ }
  }
  return n;
}

function loadAlertCatalog(): Promise<AlertCatalog> {
  if (!alertCatalogPromise) {
    alertCatalogPromise = import('../data/structural_alerts.json')
      .then((m) => (m.default ?? m) as unknown as AlertCatalog)
      .catch((e) => { alertCatalogPromise = null; throw e; }); // allow retry after a transient chunk-load failure
  }
  return alertCatalogPromise;
}

/** Detect PAINS/Brenk/NIH structural alerts in a molecule and return the matched
 *  fragment atom/bond indices so the offending substructure can be highlighted. */
export async function detectStructuralAlerts(smiles: string): Promise<AlertHit[]> {
  const RDKit = (globalThis as { RDKitModule?: RDKitMinimal }).RDKitModule;
  if (!RDKit) return [];
  const catalog = await loadAlertCatalog();
  const mol = RDKit.get_mol(smiles);
  if (!mol || !mol.is_valid()) { mol?.delete(); return []; }
  const hits: AlertHit[] = [];
  try {
    for (const ruleSet of Object.keys(catalog)) {
      for (const { name, smarts } of catalog[ruleSet]) {
        let q = qmolCache.get(smarts);
        if (q === undefined) {
          try {
            q = RDKit.get_qmol(smarts);
            if (!q || !q.is_valid()) { q?.delete(); q = null; }
          } catch { q = null; }
          qmolCache.set(smarts, q);
        }
        if (!q) continue;
        let matchStr = '';
        try { matchStr = mol.get_substruct_match(q); } catch { matchStr = ''; }
        if (matchStr && matchStr !== '{}') {
          try {
            const parsed = JSON.parse(matchStr) as { atoms?: number[]; bonds?: number[] };
            if (parsed.atoms && parsed.atoms.length) {
              hits.push({ ruleSet, name, atoms: parsed.atoms, bonds: parsed.bonds ?? [] });
            }
          } catch { /* ignore malformed match */ }
        }
      }
    }
  } finally {
    mol.delete();
  }
  return hits;
}

// ─── Packed fingerprint utilities ────────────────────────────────────────────
const EMPTY_FP_PACKED = new Uint32Array(64); // 2048 bits / 32

/** Pack a '0'/'1' bit-string fingerprint into a Uint32Array for fast bitwise ops. */
export function packFingerprint(fp: string): Uint32Array {
  if (!fp || fp.length === 0) return EMPTY_FP_PACKED;
  const packed = new Uint32Array(Math.ceil(fp.length / 32));
  for (let i = 0; i < fp.length; i++) {
    if (fp.charCodeAt(i) === 49) { // '1'
      packed[i >>> 5] |= (1 << (i & 31));
    }
  }
  return packed;
}

/** Popcount (Hamming weight) for a 32-bit integer. */
function popcount32(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24;
}

/** Fast Tanimoto using packed Uint32Array fingerprints. */
export function tanimotoPacked(a: Uint32Array, b: Uint32Array): number {
  let inter = 0, union = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    inter += popcount32(a[i] & b[i]);
    union += popcount32(a[i] | b[i]);
  }
  return union === 0 ? 0 : inter / union;
}

export type SimilarityMetric = 'tanimoto-r2' | 'tanimoto-r3' | 'tanimoto-r6' | 'selfies-ted';

/**
 * Compute n×n Tanimoto matrix with Morgan fingerprints at arbitrary radius.
 * Uses RDKit.js to recompute fingerprints on the fly.
 * Falls back to pre-packed r=2 FPs if RDKit unavailable.
 */
function computeTanimotoMatrixRadius(molecules: Molecule[], radius: number): number[][] {
  const RDKit = (globalThis as any).RDKitModule;
  const n = molecules.length;
  const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  if (!RDKit) return computeTanimotoMatrix(molecules); // fallback

  // Compute fingerprints at requested radius
  const fps: Uint32Array[] = [];
  for (const m of molecules) {
    try {
      const mol = RDKit.get_mol(m.smiles);
      if (mol && mol.is_valid()) {
        const fpStr: string = mol.get_morgan_fp(JSON.stringify({ radius, nBits: 2048 }));
        mol.delete();
        fps.push(packFingerprint(fpStr));
      } else {
        mol?.delete();
        fps.push(new Uint32Array(64));
      }
    } catch {
      fps.push(new Uint32Array(64));
    }
  }

  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      const t = tanimotoPacked(fps[i], fps[j]);
      matrix[i][j] = matrix[j][i] = t;
    }
  }
  return matrix;
}

/** Compute similarity matrix using specified metric (sync metrics only — selfies-ted is async, handled in views). */
export function computeSimilarityMatrix(molecules: Molecule[], metric: SimilarityMetric = 'tanimoto-r2'): number[][] {
  if (metric === 'tanimoto-r3') return computeTanimotoMatrixRadius(molecules, 3);
  if (metric === 'tanimoto-r6') return computeTanimotoMatrixRadius(molecules, 6);
  // tanimoto-r2: use pre-packed fingerprints (fast path)
  return computeTanimotoMatrix(molecules);
}

/** Morgan fingerprint bit strings at a given radius, for the chemical-space projection.
 *  radius 2 reuses each molecule's pre-packed fingerprint (fast path); higher radii
 *  recompute via RDKit.js (falls back to the stored r=2 string if RDKit is unavailable). */
export function morganFpStrings(molecules: Molecule[], radius: number): string[] {
  if (radius === 2) return molecules.map(m => m.fingerprint);
  const RDKit = (globalThis as { RDKitModule?: { get_mol: (s: string) => { is_valid: () => boolean; delete: () => void; get_morgan_fp: (o: string) => string } | null } }).RDKitModule;
  if (!RDKit) return molecules.map(m => m.fingerprint);
  return molecules.map(m => {
    try {
      const mol = RDKit.get_mol(m.smiles);
      if (mol && mol.is_valid()) {
        const fp = mol.get_morgan_fp(JSON.stringify({ radius, nBits: 2048 }));
        mol.delete();
        return fp;
      }
      mol?.delete();
    } catch { /* fall through to stored r=2 */ }
    return m.fingerprint;
  });
}

export function looksLikeName(line: string): boolean {
  const s = line.trim().split(/\s+/)[0];
  return !/[()=[\]#/\\@+]/.test(s) && !/[A-Za-z]\d/.test(s) && !/^\d/.test(s);
}

/** Parse SDF text to "SMILES name" lines (one per molecule). Requires RDKit to be inited. */
export function parseSDFToSmilesLines(sdfText: string, RDKit: any): string[] {
  const blocks = sdfText.split('$$$$').filter((b) => b.trim());
  const results: string[] = [];

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 4) continue;

    const molName = lines[0].trim() || '';
    const endIdx = lines.findIndex((l) => l.trim().startsWith('M  END'));
    if (endIdx === -1) continue;

    const molblock = lines.slice(0, endIdx + 1).join('\n');

    try {
      const mol = RDKit.get_mol(molblock);
      if (mol && mol.is_valid()) {
        const smiles = mol.get_smiles();
        let name = molName;
        if (!name) {
          const nameMatch = block.match(/>\s*<(?:Name|MOLNAME|name|ID|_Name)>\s*\n([^\n]+)/i);
          if (nameMatch) name = nameMatch[1].trim();
        }
        results.push(name ? `${smiles} ${name}` : smiles);
        mol.delete();
      }
    } catch {
      // Skip invalid molecules
    }
  }
  return results;
}

/** Load SDF file text and return "SMILES name" lines for parseAndAnalyze. */
export async function parseSDFFile(sdfText: string): Promise<string[]> {
  const RDKit = await initRDKitCache();
  return parseSDFToSmilesLines(sdfText, RDKit);
}

export async function lookupSMILES(name: string): Promise<string | null> {
  try {
    const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(name)}/property/CanonicalSMILES/JSON`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json();
    const props = data?.PropertyTable?.Properties;
    return props?.[0]?.CanonicalSMILES || props?.[0]?.ConnectivitySMILES || null;
  } catch {
    return null;
  }
}

/**
 * Reverse lookup: SMILES → preferred name via PubChem.
 * Returns IUPACName (preferred) or first synonym, or null if not found.
 */
export async function lookupNameFromSMILES(smiles: string): Promise<string | null> {
  try {
    // PubChem PUG-REST: post SMILES, get IUPACName + Title (preferred name)
    const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/property/IUPACName,Title/JSON`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `smiles=${encodeURIComponent(smiles)}`,
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const props = data?.PropertyTable?.Properties?.[0];
    // Prefer Title (common name) over IUPAC (which can be very long)
    return props?.Title || props?.IUPACName || null;
  } catch {
    return null;
  }
}

/**
 * Background enrichment: for molecules with fallback names (mol_N),
 * look up their real names from PubChem and call onUpdate with the patched array.
 * Runs concurrently (up to `concurrency` at a time) and updates incrementally.
 */
export async function enrichMoleculeNames(
  molecules: Molecule[],
  onUpdate: (updated: Molecule[]) => void,
  concurrency = 5
): Promise<void> {
  // Find indices of molecules with fallback names
  const tasks: { idx: number; smiles: string }[] = [];
  for (let i = 0; i < molecules.length; i++) {
    if (/^mol[\s_]\d+$/i.test(molecules[i].name)) {
      tasks.push({ idx: i, smiles: molecules[i].smiles });
    }
  }
  if (tasks.length === 0) return;

  // Shallow copy so we don't mutate the original array
  const updated = [...molecules];
  let anyUpdated = false;

  for (let start = 0; start < tasks.length; start += concurrency) {
    const batch = tasks.slice(start, start + concurrency);
    const results = await Promise.allSettled(
      batch.map(async (task) => {
        const name = await lookupNameFromSMILES(task.smiles);
        return { idx: task.idx, name };
      })
    );
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.name) {
        const { idx, name } = r.value;
        updated[idx] = { ...updated[idx], name: name! };
        anyUpdated = true;
      }
    }
    if (anyUpdated) {
      onUpdate([...updated]);
      anyUpdated = false;
    }
  }
}

/** Fetch canonical SMILES for a ChEMBL molecule ID (e.g. CHEMBL1). */
export async function lookupChEMBL(chemblId: string): Promise<{ smiles: string; name: string } | null> {
  const id = chemblId.trim().toUpperCase();
  if (!id.startsWith('CHEMBL')) return null;
  try {
    const url = `https://www.ebi.ac.uk/chembl/api/data/molecule/${encodeURIComponent(id)}.json`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json();
    // ChEMBL API: molecule_structures.canonical_smiles is a string; some versions use molecule_value
    const struct = data?.molecule_structures;
    const smiles =
      data?.molecule_properties?.canonical_smiles ??
      data?.canonical_smiles ??
      (typeof struct?.canonical_smiles === 'string' ? struct.canonical_smiles : struct?.canonical_smiles?.molecule_value);
    const name = data?.pref_name ?? data?.molecule_chembl_id ?? id;
    return smiles ? { smiles, name } : null;
  } catch {
    return null;
  }
}

/** Fetch SMILES for multiple ChEMBL IDs with rate limiting. Returns "SMILES name" lines. */
export async function fetchChEMBLBatch(
  ids: string[],
  onProgress?: (done: number, total: number) => void
): Promise<string[]> {
  const lines: string[] = [];
  for (let i = 0; i < ids.length; i++) {
    onProgress?.(i + 1, ids.length);
    const result = await lookupChEMBL(ids[i]);
    if (result) lines.push(`${result.smiles} ${result.name}`);
    await delay(200);
  }
  return lines;
}

function checkFilter(filterName: string, props: any): FilterResult {
  const filter = DRUG_FILTERS[filterName as keyof typeof DRUG_FILTERS];
  if (!filter) return { pass: false, violations: 0 };
  let violations = 0;
  for (const rule of filter.rules) {
    const val = props[rule.key as keyof typeof props];
    if (rule.op === '<=' && val > rule.val) violations++;
    else if (rule.op === '>=' && val < rule.val) violations++;
    else if (rule.op === '<' && val >= rule.val) violations++;
    else if (rule.op === '>' && val <= rule.val) violations++;
  }
  return { pass: violations <= filter.maxViolations, violations };
}

/** Detect if input is CSV/TSV with a header row. Returns parsed rows + header info, or null if not CSV. */
function detectCSV(input: string): { separator: string; headers: string[]; rows: string[][]; smilesCol: number } | null {
  const lines = input.split('\n').filter(l => l.trim());
  if (lines.length < 2) return null;
  const firstLine = lines[0];
  // Detect separator: tabs first, then commas
  let separator = '';
  if (firstLine.includes('\t') && firstLine.split('\t').length >= 2) separator = '\t';
  else if (firstLine.includes(',') && firstLine.split(',').length >= 2) separator = ',';
  if (!separator) return null;

  const headers = firstLine.split(separator).map(h => h.trim());

  // Find SMILES column by header name (case-insensitive) — can be ANY position
  const SMILES_HEADERS = ['smiles', 'smi', 'structure', 'canonical_smiles', 'molecule', 'mol', 'compound_smiles'];
  let smilesCol = -1;
  for (let i = 0; i < headers.length; i++) {
    if (SMILES_HEADERS.includes(headers[i].toLowerCase())) {
      smilesCol = i;
      break;
    }
  }

  // If no header match, check if any column in second row looks like SMILES
  if (smilesCol === -1) {
    const secondRowCells = lines[1].split(separator).map(c => c.trim());
    for (let i = 0; i < secondRowCells.length; i++) {
      const cell = secondRowCells[i];
      if (/[()=[\]#@\\/]/.test(cell) || /^[A-Za-z][A-Za-z0-9()=[\]#@\\/+\-.*]+$/.test(cell)) {
        smilesCol = i;
        break;
      }
    }
  }

  if (smilesCol === -1) return null;

  // Determine if first line is a header row (SMILES column header is a known keyword, not actual SMILES)
  const smilesHeader = headers[smilesCol].toLowerCase();
  const isHeaderRow = SMILES_HEADERS.includes(smilesHeader) || !/[()=[\]#@\\/]/.test(headers[smilesCol]);

  // Parse all data rows
  const dataStart = isHeaderRow ? 1 : 0;
  const actualHeaders = isHeaderRow ? headers : headers.map((_, i) => `Col${i}`);
  const rows: string[][] = [];
  for (let i = dataStart; i < lines.length; i++) {
    const cells = lines[i].split(separator).map(c => c.trim());
    if (cells.length > 0 && cells[smilesCol]) rows.push(cells);
  }
  return { separator, headers: actualHeaders, rows, smilesCol };
}

/** Parse a CSV cell as a number, or null if it carries no measurement.
 *  `Number('')` is 0 and `Number('   ')` is 0, so a naive coercion turns every
 *  blank cell into a real-looking 0.0 — which then enters the Pareto analysis
 *  as the best possible value for any minimised objective. Common textual
 *  missing-data placeholders are treated as absent for the same reason. */
function parseNumericCell(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (s === '' || /^(na|n\/a|nan|nd|null|none|-|\.)$/i.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

/** Extract SMILES lines and custom properties from CSV data. */
function parseCSVData(csv: { headers: string[]; rows: string[][]; smilesCol: number }): { smilesLines: string[]; customPropNames: string[]; customPropValues: Record<string, number>[] } {
  const { headers, rows, smilesCol } = csv;
  const NAME_HEADERS = ['name', 'id', 'molecule', 'compound', 'compound id', 'compound_id', 'mol_name', 'title'];
  let nameIdx = -1;
  const customCols: { idx: number; name: string }[] = [];

  for (let i = 0; i < headers.length; i++) {
    if (i === smilesCol) continue; // skip the SMILES column
    const h = headers[i].toLowerCase();
    if (nameIdx === -1 && NAME_HEADERS.includes(h)) {
      nameIdx = i;
    } else {
      // Check if this column has numeric data (check first few data rows)
      let numericCount = 0;
      const checkRows = Math.min(3, rows.length);
      for (let r = 0; r < checkRows; r++) {
        if (parseNumericCell(rows[r]?.[i]) !== null) numericCount++;
      }
      if (numericCount > 0) {
        customCols.push({ idx: i, name: headers[i] });
      } else if (nameIdx === -1) {
        // First non-numeric, non-SMILES column becomes name
        nameIdx = i;
      }
    }
  }

  const smilesLines: string[] = [];
  const customPropValues: Record<string, number>[] = [];

  for (const row of rows) {
    const smiles = row[smilesCol];
    if (!smiles) continue;
    const name = nameIdx >= 0 ? row[nameIdx] || '' : '';
    smilesLines.push(name ? `${smiles} ${name}` : smiles);

    const props: Record<string, number> = {};
    for (const col of customCols) {
      const val = parseNumericCell(row[col.idx]);
      if (val !== null) props[col.name] = val;
    }
    customPropValues.push(props);
  }

  return { smilesLines, customPropNames: customCols.map(c => c.name), customPropValues };
}

export interface AssayMergeReport {
  /** Data rows read from the file. */
  rowsParsed: number;
  /** Molecules that received at least one value. */
  matched: number;
  /** How the matches were made, most reliable key first. */
  matchedBy: { canonicalSmiles: number; inchi: number; name: number };
  /** Input rows that matched no molecule, with the key that was tried. */
  unmatchedRows: string[];
  /** Columns where repeated rows for one compound disagreed materially. */
  conflicts: { molecule: string; column: string; values: number[]; resolved: number }[];
  /** Censored values ("> 10000") kept out of the merged column. */
  censored: { molecule: string; column: string; raw: string }[];
  /** Compounds whose repeated rows were aggregated to a single value. */
  aggregated: number;
  /** Units seen per column; more than one means the column mixes scales. */
  unitsByColumn: Record<string, string[]>;
}

export interface AssayMergeResult {
  /** New custom prop column names found in the CSV */
  newPropNames: string[];
  /** How many molecules matched */
  matchCount: number;
  /** Updated molecules array with assay data merged into customProps */
  molecules: Molecule[];
  /** Per-record account of what happened, for display rather than a bare count. */
  report: AssayMergeReport;
}

/** Canonical SMILES via RDKit, or null when the structure will not parse.
 *  Canonicalising both sides makes matching independent of atom ordering,
 *  aromatic vs Kekule notation, and how the input happened to be written. */
function canonicalSmiles(smiles: string): string | null {
  const RDKit = (globalThis as { RDKitModule?: { get_mol: (s: string) => RDKitMol | null } }).RDKitModule;
  if (!RDKit || !smiles) return null;
  let mol: RDKitMol | null = null;
  try {
    mol = RDKit.get_mol(smiles);
    if (!mol || !mol.is_valid()) return null;
    const out = (mol as unknown as { get_smiles: () => string }).get_smiles();
    return out || null;
  } catch {
    return null;
  } finally {
    mol?.delete();
  }
}

/** Standard InChI, used as a second matching key. */
function inchiKeyOf(smiles: string): string | null {
  const RDKit = (globalThis as { RDKitModule?: { get_mol: (s: string) => RDKitMol | null } }).RDKitModule;
  if (!RDKit || !smiles) return null;
  let mol: RDKitMol | null = null;
  try {
    mol = RDKit.get_mol(smiles);
    if (!mol || !mol.is_valid()) return null;
    const out = (mol as unknown as { get_inchi: () => string }).get_inchi();
    return out || null;
  } catch {
    return null;
  } finally {
    mol?.delete();
  }
}

/**
 * Parse an assay CSV and join its columns onto existing molecules.
 *
 * Matching proceeds down an explicit ladder and reports which rung each match
 * was made on: canonical SMILES, then standard InChI, then case-folded name.
 * Both sides are canonicalised, so equivalent structures written with a
 * different atom order or aromatic notation match where exact string equality
 * previously failed silently.
 *
 * Two things are deliberately NOT done, and are reported rather than papered
 * over. Salt parents are not stripped by taking the largest fragment: for
 * metformin pamoate the counter-ion is the larger fragment, so that rule
 * selects the wrong parent, and a silent wrong match is worse than a reported
 * non-match. Tautomer and protonation normalisation is not performed either;
 * the tautomer enumerator is not part of the browser build, so a compound
 * supplied in a different tautomeric form is reported unmatched.
 *
 * Repeated rows for one compound are aggregated by median rather than the last
 * row overwriting the earlier ones, and material disagreement is reported.
 */
export function mergeAssayData(
  csvText: string,
  molecules: Molecule[],
  existingCustomPropNames: string[] = []
): AssayMergeResult {
  const BUILTIN = new Set(['MW','LogP','HBD','HBA','TPSA','RotBonds','FrCSP3','Rings','AromaticRings','HeavyAtoms','MR','NumAtoms']);
  const NAME_HEADERS = ['name','id','molecule','compound','compound id','compound_id','mol_name','title','chembl_id'];
  const SMILES_HEADERS = ['smiles','smi','structure','canonical_smiles','molecule','mol','compound_smiles'];

  const emptyReport: AssayMergeReport = {
    rowsParsed: 0, matched: 0,
    matchedBy: { canonicalSmiles: 0, inchi: 0, name: 0 },
    unmatchedRows: [], conflicts: [], censored: [], aggregated: 0, unitsByColumn: {},
  };

  const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return { newPropNames: [], matchCount: 0, molecules, report: emptyReport };

  const sep = lines[0].includes('\t') ? '\t' : ',';
  const cellsOf = (line: string) => line.split(sep).map(c => c.trim().replace(/^"|"$/g, ''));
  const headers = cellsOf(lines[0]);

  let smilesCol = -1, nameCol = -1;
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase();
    if (smilesCol === -1 && SMILES_HEADERS.includes(h)) smilesCol = i;
    if (nameCol === -1 && NAME_HEADERS.includes(h)) nameCol = i;
  }

  const valueCols: { idx: number; name: string }[] = [];
  for (let i = 0; i < headers.length; i++) {
    if (i === smilesCol || i === nameCol) continue;
    if (BUILTIN.has(headers[i]) || existingCustomPropNames.includes(headers[i])) continue;
    let numCount = 0;
    for (let r = 1; r <= Math.min(3, lines.length - 1); r++) {
      if (parseAssayValue(cellsOf(lines[r])[i]) !== null) numCount++;
    }
    if (numCount > 0) valueCols.push({ idx: i, name: headers[i] });
  }
  if (valueCols.length === 0) return { newPropNames: [], matchCount: 0, molecules, report: emptyReport };

  // Collect every row under each available key, keeping all repeats. Each
  // bucket also carries the indices of the rows that went into it, because
  // which rows a match consumed cannot be recovered afterwards by rebuilding a
  // key from the row: a match on the InChI rung is by construction one whose
  // canonical SMILES differs from the molecule's, and a match on name one whose
  // structure is not the molecule's, so a rebuilt key finds neither.
  type Bucket = { values: Map<string, AssayValue[]>; rows: number[] };
  const byCanonical = new Map<string, Bucket>();
  const byInchi = new Map<string, Bucket>();
  const byName = new Map<string, Bucket>();
  const unitsByColumn: Record<string, Set<string>> = {};
  const rowKeys: string[] = [];

  const bucketFor = (index: Map<string, Bucket>, key: string) => {
    let bucket = index.get(key);
    if (!bucket) { bucket = { values: new Map(), rows: [] }; index.set(key, bucket); }
    return bucket;
  };

  let rowsParsed = 0;
  for (let r = 1; r < lines.length; r++) {
    const cells = cellsOf(lines[r]);
    const rawSmiles = smilesCol >= 0 ? cells[smilesCol] ?? '' : '';
    const rawName = nameCol >= 0 ? (cells[nameCol] ?? '') : '';
    if (!rawSmiles && !rawName) continue;
    rowsParsed++;
    const rowIndex = rowKeys.length;
    rowKeys.push(rawSmiles || rawName);

    const canon = rawSmiles ? canonicalSmiles(rawSmiles) : null;
    const inchi = rawSmiles ? inchiKeyOf(rawSmiles) : null;
    const lowerName = rawName.toLowerCase();

    // Registered under its keys whether or not any cell parses, so that a row
    // left blank alongside a row that did carry a value is accounted for by the
    // same match rather than reported as a record nothing was done with.
    const buckets: Bucket[] = [];
    if (canon) buckets.push(bucketFor(byCanonical, canon));
    if (inchi) buckets.push(bucketFor(byInchi, inchi));
    if (lowerName) buckets.push(bucketFor(byName, lowerName));
    for (const bucket of buckets) bucket.rows.push(rowIndex);

    for (const col of valueCols) {
      const parsed = parseAssayValue(cells[col.idx]);
      if (!parsed) continue;
      if (parsed.unit) (unitsByColumn[col.name] ??= new Set()).add(parsed.unit);
      for (const bucket of buckets) {
        const list = bucket.values.get(col.name);
        if (list) list.push(parsed); else bucket.values.set(col.name, [parsed]);
      }
    }
  }

  const report: AssayMergeReport = {
    rowsParsed, matched: 0,
    matchedBy: { canonicalSmiles: 0, inchi: 0, name: 0 },
    unmatchedRows: [], conflicts: [], censored: [], aggregated: 0,
    unitsByColumn: Object.fromEntries(Object.entries(unitsByColumn).map(([k, v]) => [k, [...v]])),
  };

  // A bucket holding no value is a key seen in the file with nothing to give,
  // so it is not a match and the ladder continues past it.
  const hit = (index: Map<string, Bucket>, key: string | null) => {
    const bucket = key ? index.get(key) : undefined;
    return bucket && bucket.values.size > 0 ? bucket : undefined;
  };

  const consumedRows = new Set<number>();
  const updated = molecules.map(mol => {
    let bucket = hit(byCanonical, canonicalSmiles(mol.smiles));
    let via: keyof AssayMergeReport['matchedBy'] | null = bucket ? 'canonicalSmiles' : null;
    if (!bucket) {
      bucket = hit(byInchi, inchiKeyOf(mol.smiles));
      if (bucket) via = 'inchi';
    }
    if (!bucket) {
      bucket = hit(byName, mol.name.toLowerCase());
      if (bucket) via = 'name';
    }
    if (!bucket || !via) return mol;

    for (const row of bucket.rows) consumedRows.add(row);
    report.matched++;
    report.matchedBy[via]++;

    const merged: Record<string, number> = {};
    let aggregatedHere = false;
    for (const [col, values] of bucket.values) {
      for (const v of values) {
        if (isCensored(v)) report.censored.push({ molecule: mol.name, column: col, raw: v.raw });
      }
      const agg = aggregate(values);
      if (!agg) continue;
      if (agg.n > 1) {
        aggregatedHere = true;
        const measured = values.filter(v => !isCensored(v)).map(v => v.value);
        if (isConflicting(measured)) {
          report.conflicts.push({ molecule: mol.name, column: col, values: measured, resolved: agg.value });
        }
      }
      merged[col] = agg.value;
    }
    if (aggregatedHere) report.aggregated++;
    return { ...mol, customProps: { ...mol.customProps, ...merged } };
  });

  rowKeys.forEach((key, row) => {
    if (!consumedRows.has(row)) report.unmatchedRows.push(key);
  });

  return {
    newPropNames: valueCols.map(c => c.name),
    matchCount: report.matched,
    molecules: updated,
    report,
  };
}

export interface ParseResult {
  molecules: Molecule[];
  errors: number;
  failedLookups: number;
  customPropNames: string[];
}

/** Batch PubChem lookups with concurrency limit for speed. */
async function resolveNamesInBatch(
  smilesLines: string[],
  RDKit: any,
  concurrency = 5
): Promise<{ resolvedLines: string[]; failedLookups: number }> {
  const resolvedLines = [...smilesLines];
  let failedLookups = 0;

  // First pass: identify which lines need lookup
  const lookupTasks: { idx: number; name: string; rest: string }[] = [];
  for (let i = 0; i < smilesLines.length; i++) {
    const parts = smilesLines[i].trim().split(/\s+/);
    const potentialSmiles = parts[0];

    let isValidSmiles = false;
    try {
      const testMol = RDKit.get_mol(potentialSmiles);
      if (testMol && testMol.is_valid()) isValidSmiles = true;
      if (testMol) testMol.delete();
    } catch { /* descriptor unavailable */ }

    if (!isValidSmiles && looksLikeName(smilesLines[i])) {
      lookupTasks.push({ idx: i, name: parts[0], rest: parts.slice(1).join(' ') });
    }
  }

  // Batch lookups with concurrency
  for (let batchStart = 0; batchStart < lookupTasks.length; batchStart += concurrency) {
    const batch = lookupTasks.slice(batchStart, batchStart + concurrency);
    const results = await Promise.allSettled(
      batch.map(async (task) => {
        const smiles = await lookupSMILES(task.name);
        return { ...task, smiles };
      })
    );
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.smiles) {
        const { idx, smiles, rest, name } = result.value;
        resolvedLines[idx] = `${smiles} ${rest || name}`;
      } else {
        failedLookups++;
      }
    }
  }

  return { resolvedLines, failedLookups };
}

/** Parse a single resolved SMILES line into a Molecule (no SVG — deferred). */
// ─── Synthetic complexity (transparent client-side make-ability heuristic) ────
// A fast, interpretable estimate of synthetic difficulty (1 = trivial, 10 = very
// hard) from structural drivers chemists recognize: stereocenters, spiro/
// bridged/non-aromatic ring systems, molecular size, and 3-D (sp3) character.
// A triage proxy — NOT a retrosynthetic route or building-block price (those are
// the planned opt-in cost tier). Lower = easier / cheaper to make.

export interface SynthComplexity { score: number; factors: string[]; }

/** Synthetic-complexity score (1–10) + dominant contributing factors, from an
 *  RDKit get_descriptors() object. */
export function syntheticComplexityFromDescriptors(desc: Record<string, number>): SynthComplexity {
  const stereo = desc.NumAtomStereoCenters || 0;          // total potential stereocenters
  const spiro = desc.NumSpiroAtoms || 0;
  const bridge = desc.NumBridgeheadAtoms || 0;
  const nonAromRings = (desc.NumAliphaticRings || 0) + (desc.NumSaturatedRings || 0);
  const heavy = desc.NumHeavyAtoms || desc.HeavyAtomCount || 0;
  const fsp3 = desc.FractionCSP3 || 0;

  const raw = 1.0
    + 0.90 * stereo
    + 1.30 * spiro
    + 1.30 * bridge
    + 0.40 * nonAromRings
    + 0.10 * Math.max(0, heavy - 28)
    + 1.20 * fsp3;
  // Saturating map to 1–10 (T tuned so stereocenter-rich natural products ≈ 10).
  const score = 1 + 9 * (1 - Math.exp(-(raw - 1) / 6.6));

  const contrib = [
    { label: `${stereo} stereocentre${stereo === 1 ? '' : 's'}`, w: 0.90 * stereo },
    { label: `${bridge} bridgehead atom${bridge === 1 ? '' : 's'}`, w: 1.30 * bridge },
    { label: `${spiro} spiro atom${spiro === 1 ? '' : 's'}`, w: 1.30 * spiro },
    { label: `${nonAromRings} non-aromatic ring${nonAromRings === 1 ? '' : 's'}`, w: 0.40 * nonAromRings },
    { label: 'large size', w: 0.10 * Math.max(0, heavy - 28) },
    { label: 'high 3-D (sp³) character', w: 1.20 * fsp3 },
  ];
  const factors = contrib.filter(c => c.w >= 0.45).sort((a, b) => b.w - a.w).slice(0, 3).map(c => c.label);
  return { score: Math.min(10, Math.max(1, score)), factors };
}

/** Recompute synthetic complexity for a SMILES on demand (e.g. for a tooltip). */
export function getSyntheticComplexity(smiles: string): SynthComplexity | null {
  const RDKit = (globalThis as { RDKitModule?: { get_mol: (s: string) => { is_valid: () => boolean; delete: () => void; get_descriptors: () => string } | null } }).RDKitModule;
  if (!RDKit) return null;
  try {
    const mol = RDKit.get_mol(smiles);
    if (!mol || !mol.is_valid()) { mol?.delete(); return null; }
    const desc = JSON.parse(mol.get_descriptors()) as Record<string, number>;
    mol.delete();
    return syntheticComplexityFromDescriptors(desc);
  } catch { return null; }
}

function parseMolecule(
  line: string,
  index: number,
  RDKit: any,
  customPropValues: Record<string, number>[]
): Molecule | null {
  const parts = line.trim().split(/\s+/);
  const smiles = parts[0];
  const name = (parts.slice(1).join(' ') || `mol_${index + 1}`).replace(/_/g, ' ');

  try {
    const mol = RDKit.get_mol(smiles);
    if (!mol || !mol.is_valid()) return null;

    const desc = JSON.parse(mol.get_descriptors());
    const numAtoms = (desc.NumHeavyAtoms || desc.HeavyAtomCount || 0) + (desc.NumHs || 0);

    let fingerprint = '';
    try { fingerprint = mol.get_morgan_fp(JSON.stringify({ radius: 2, nBits: 2048 })); } catch { /* fingerprint unavailable */ }

    // Counted while the molecule is still alive — QED needs it below.
    const nAlerts = countQEDAlerts(mol, RDKit);

    mol.delete();

    // Average molecular weight, not the monoisotopic exact mass. Lipinski's
    // Ro5 (MW <= 500) is defined on average MW, and the reference datasets
    // used throughout are built with RDKit's Descriptors.MolWt (also average),
    // so `exactmw` made the app disagree with both by ~0.4 Da.
    const mw = desc.amw || desc.exactmw || 0;
    const logp = desc.CrippenClogP || 0;
    const hbd = desc.NumHBD || 0;
    const hba = desc.NumHBA || 0;
    const tpsa = desc.tpsa || 0;
    const rotBonds = desc.NumRotatableBonds || 0;
    const arom = desc.NumAromaticRings || 0;
    const { qedWeighted } = computeQED({ MW: mw, ALOGP: logp, HBA: hba, HBD: hbd, PSA: tpsa, ROTB: rotBonds, AROM: arom, ALERTS: nAlerts });
    const sc = syntheticComplexityFromDescriptors(desc);

    const props: MolProps = {
      MW: mw,
      LogP: logp,
      HBD: hbd,
      HBA: hba,
      TPSA: tpsa,
      RotBonds: rotBonds,
      FrCSP3: desc.FractionCSP3 || 0,
      Rings: desc.NumRings || 0,
      AromaticRings: arom,
      HeavyAtoms: desc.NumHeavyAtoms || desc.HeavyAtomCount || 0,
      MR: desc.CrippenMR || 0,
      NumAtoms: numAtoms > 0 ? numAtoms : (desc.NumHeavyAtoms || 0),
      QED: Math.round(qedWeighted * 1000) / 1000,
      SC: Math.round(sc.score * 10) / 10,
    };

    const filters: Record<string, FilterResult> = {};
    for (const filterName of Object.keys(DRUG_FILTERS)) {
      filters[filterName] = checkFilter(filterName, props);
    }

    return {
      name,
      smiles,
      svg: '', // deferred — use getMolSvg(smiles) on demand
      formula: desc.MolFormula || '',
      fingerprint,
      fpPacked: packFingerprint(fingerprint),
      props,
      customProps: customPropValues[index] || {},
      filters,
      lipinski: filters.lipinski,
      scFactors: sc.factors,
      paretoRank: null,
      dominates: [],
      dominatedBy: [],
    };
  } catch {
    return null;
  }
}

export async function parseAndAnalyze(input: string): Promise<ParseResult> {
  const RDKit = await initRDKitCache();

  // Detect CSV/TSV format
  const csv = detectCSV(input);
  let smilesLines: string[];
  let customPropNames: string[] = [];
  let customPropValues: Record<string, number>[] = [];

  if (csv) {
    const parsed = parseCSVData(csv);
    smilesLines = parsed.smilesLines;
    customPropNames = parsed.customPropNames;
    customPropValues = parsed.customPropValues;
  } else {
    smilesLines = input.split('\n').filter(l => l.trim());
  }

  // 1. Resolve names to SMILES (batched PubChem lookups)
  const { resolvedLines, failedLookups } = await resolveNamesInBatch(smilesLines, RDKit);

  const newMolecules: Molecule[] = [];
  let errors = 0;

  // 2. Compute properties using RDKit (SVG deferred)
  for (let i = 0; i < resolvedLines.length; i++) {
    const mol = parseMolecule(resolvedLines[i], i, RDKit, customPropValues);
    if (mol) {
      newMolecules.push(mol);
    } else {
      errors++;
    }
  }

  // 3. Compute Pareto ranks & Dominance (single pass)
  computeParetoAndDominance(newMolecules);

  return { molecules: newMolecules, errors, failedLookups, customPropNames };
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Chunked parse for large inputs; reports progress. phase: 'resolve' = name lookup, 'analyze' = RDKit parse. */
export async function parseAndAnalyzeChunked(
  input: string,
  options: { chunkSize?: number; onProgress?: (done: number, total: number, phase?: 'resolve' | 'analyze') => void } = {}
): Promise<ParseResult> {
  const chunkSize = options.chunkSize ?? 25;
  const onProgress = options.onProgress ?? (() => {});

  const RDKit = await initRDKitCache();

  // Detect CSV/TSV format
  const csv = detectCSV(input);
  let smilesLines: string[];
  let customPropNames: string[] = [];
  let customPropValues: Record<string, number>[] = [];

  if (csv) {
    const parsed = parseCSVData(csv);
    smilesLines = parsed.smilesLines;
    customPropNames = parsed.customPropNames;
    customPropValues = parsed.customPropValues;
  } else {
    smilesLines = input.split('\n').filter((l) => l.trim());
  }

  const total = smilesLines.length;

  // Resolve names with progress reporting (batched)
  onProgress(0, total, 'resolve');
  const { resolvedLines, failedLookups } = await resolveNamesInBatch(smilesLines, RDKit);
  onProgress(total, total, 'resolve');

  const newMolecules: Molecule[] = [];
  let errors = 0;
  for (let start = 0; start < resolvedLines.length; start += chunkSize) {
    const end = Math.min(start + chunkSize, resolvedLines.length);
    for (let i = start; i < end; i++) {
      const mol = parseMolecule(resolvedLines[i], i, RDKit, customPropValues);
      if (mol) {
        newMolecules.push(mol);
      } else {
        errors++;
      }
    }
    onProgress(end, total, 'analyze');
    await delay(0);
  }

  computeParetoAndDominance(newMolecules);
  return { molecules: newMolecules, errors, failedLookups, customPropNames };
}

/** Get a molecule's value for a Pareto objective key (built-in or custom).
 *  Returns null when the value is absent or non-finite. A missing value must
 *  never be substituted with a number: for a minimised objective such as a
 *  predicted hERG risk on [0,1], an imputed 0 is the infimum, so a *failed*
 *  prediction would weakly dominate every real measurement. */
function getMolValue(m: Molecule, key: string): number | null {
  const v = key in m.props
    ? (m.props[key as keyof MolProps] as number)
    : m.customProps[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Non-dominated fronts + dominance edges in a single O(n²) pass.
 *
 *  Missing values follow a complete-case policy: a molecule lacking a usable
 *  value for any active objective is excluded from the dominance relation
 *  entirely — it can neither dominate nor be dominated — and is left unranked
 *  (`paretoRank === null`) with the offending keys recorded in
 *  `missingObjectives` so the interface can report it. Excluding pairwise
 *  instead (comparing each pair on whichever objectives they happen to share)
 *  would break transitivity of the dominance relation and yield incoherent
 *  fronts, so it is deliberately not done.
 *
 *  Ranks are true non-dominated fronts (NSGA-II fast non-dominated sorting):
 *  rank 1 is the Pareto front, rank 2 the front remaining once rank 1 is
 *  removed, and so on. Rank 1 is identical to the previous front-membership
 *  flag, so every `paretoRank === 1` consumer is unaffected. Layering reuses
 *  the dominance edges materialised by the pairwise pass and costs O(n + |E|).
 */
export function computeParetoAndDominance(molecules: Molecule[], objectives?: ParetoObjective[]) {
  const objs = objectives ?? DEFAULT_PARETO_OBJECTIVES;
  const n = molecules.length;
  const k = objs.length;
  const minimise = objs.map(o => o.direction === 'min');

  // Resolve all objectives up front; `null` marks an incomplete molecule.
  const vals: (number[] | null)[] = new Array(n);
  const ranked: number[] = [];

  for (let i = 0; i < n; i++) {
    const m = molecules[i];
    m.dominates = [];
    m.dominatedBy = [];
    const row: number[] = [];
    const missing: string[] = [];
    for (const obj of objs) {
      const v = getMolValue(m, obj.key);
      if (v === null) missing.push(obj.key);
      else row.push(v);
    }
    if (missing.length > 0) {
      vals[i] = null;
      m.missingObjectives = missing;
      m.paretoRank = null;
    } else {
      vals[i] = row;
      delete m.missingObjectives;
      ranked.push(i);
    }
  }

  for (let a = 0; a < ranked.length; a++) {
    const i = ranked[a];
    const vi = vals[i]!;
    for (let b = a + 1; b < ranked.length; b++) {
      const j = ranked[b];
      const vj = vals[j]!;
      let iBetter = 0, jBetter = 0;
      for (let o = 0; o < k; o++) {
        const x = vi[o], y = vj[o];
        if (x === y) continue;
        if (minimise[o] ? x < y : x > y) iBetter++;
        else jBetter++;
      }
      if (iBetter > 0 && jBetter === 0) {
        molecules[i].dominates.push(j);
        molecules[j].dominatedBy.push(i);
      } else if (jBetter > 0 && iBetter === 0) {
        molecules[j].dominates.push(i);
        molecules[i].dominatedBy.push(j);
      }
    }
  }

  // Peel fronts: a molecule enters front r once every molecule dominating it
  // has been assigned to an earlier front.
  const dominatingCount = new Array<number>(n).fill(0);
  for (const i of ranked) dominatingCount[i] = molecules[i].dominatedBy.length;

  let front = ranked.filter(i => dominatingCount[i] === 0);
  let rank = 1;
  while (front.length > 0) {
    const next: number[] = [];
    for (const i of front) {
      molecules[i].paretoRank = rank;
      for (const j of molecules[i].dominates) {
        if (--dominatingCount[j] === 0) next.push(j);
      }
    }
    front = next;
    rank++;
  }
}

/** Compute n×n Tanimoto similarity matrix from molecules (fast packed fingerprints). */
export function computeTanimotoMatrix(molecules: Molecule[]): number[][] {
  const n = molecules.length;
  const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      const t = tanimotoPacked(molecules[i].fpPacked, molecules[j].fpPacked);
      matrix[i][j] = matrix[j][i] = t;
    }
  }
  return matrix;
}

/** Diversity score = mean(1 - T) over upper triangle. Higher = more diverse. */
export function getDiversityScore(matrix: number[][]): number {
  const n = matrix.length;
  if (n < 2) return 0;
  let sum = 0, count = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      sum += 1 - matrix[i][j];
      count++;
    }
  }
  return count === 0 ? 0 : sum / count;
}

/** Default cliff-score property set (physicochemical profile). */
export const DEFAULT_CLIFF_KEYS: string[] = ['MW', 'LogP', 'HBD', 'HBA', 'TPSA', 'RotBonds'];

/** Read a numeric property (built-in descriptor or custom/ADMET/activity column) for a molecule. */
export function readMolProp(m: Molecule, key: string): number | undefined {
  const v = (m.props as unknown as Record<string, number | undefined>)[key];
  if (typeof v === 'number' && isFinite(v)) return v;
  const cv = m.customProps?.[key];
  return typeof cv === 'number' && isFinite(cv) ? cv : undefined;
}

export interface ActivityCliff {
  i: number;
  j: number;
  tanimoto: number;
  propDistance: number;
  cliffScore: number;
  topDifferingProps: string[];
}

/**
 * Activity cliffs: structurally similar pairs with divergent properties.
 *
 * Cliff score (Structure–Activity Similarity, SAS):
 *   SAS_ij = T_ij · ||x̂_i − x̂_j||₂
 * where T_ij is the pairwise structural (or semantic) similarity supplied in
 * `tanimotoMatrix`, and x̂ is the per-property vector min–max normalized to [0,1]
 * across the loaded set. Min–max (rather than fixed) normalization lets any
 * property — including imported activity (pChEMBL/IC50) or predicted ADMET
 * endpoints — contribute on a comparable scale, enabling classic SAR activity
 * cliffs when a single activity property is selected (`propKeys = ['pChEMBL']`).
 */
export function computeActivityCliffs(
  molecules: Molecule[],
  tanimotoMatrix: number[][],
  threshold = 0.5,
  topN = 10,
  propKeys: string[] = DEFAULT_CLIFF_KEYS,
): ActivityCliff[] {
  const n = molecules.length;
  const cliffs: ActivityCliff[] = [];
  const keys = propKeys.length ? propKeys : DEFAULT_CLIFF_KEYS;

  // Per-property min/max over the loaded set for data-range normalization.
  const ranges: Record<string, { min: number; max: number }> = {};
  for (const k of keys) {
    let mn = Infinity, mx = -Infinity;
    for (const m of molecules) {
      const v = readMolProp(m, k);
      if (v === undefined) continue;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    ranges[k] = { min: mn, max: mx };
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const t = tanimotoMatrix[i][j];
      if (t <= threshold) continue;

      let sumSq = 0;
      const diffs: { key: string; diff: number }[] = [];
      for (const k of keys) {
        const v1 = readMolProp(molecules[i], k);
        const v2 = readMolProp(molecules[j], k);
        if (v1 === undefined || v2 === undefined) continue;
        const r = ranges[k];
        const span = r.max - r.min;
        const d = span > 1e-9 ? (v1 - v2) / span : 0;
        sumSq += d * d;
        diffs.push({ key: k, diff: Math.abs(d) });
      }
      if (diffs.length === 0) continue; // no comparable properties for this pair
      const propDist = Math.sqrt(sumSq);
      diffs.sort((a, b) => b.diff - a.diff);
      cliffs.push({
        i,
        j,
        tanimoto: t,
        propDistance: propDist,
        cliffScore: t * propDist,
        topDifferingProps: diffs.slice(0, 3).map((x) => x.key),
      });
    }
  }

  cliffs.sort((a, b) => b.cliffScore - a.cliffScore);
  return cliffs.slice(0, topN);
}


/**
 * Returns the indices of molecules that match the given SMARTS pattern.
 * Requires RDKit.js to be initialized (initRDKitCache).
 */
export function filterBySubstructure(molecules: Molecule[], smarts: string): number[] {
  const RDKit = window.RDKitModule;
  if (!RDKit || !smarts.trim()) return molecules.map((_, i) => i);
  let query: any = null;
  try {
    query = RDKit.get_qmol(smarts.trim());
    if (!query || !query.is_valid()) {
      query?.delete();
      return [];
    }
  } catch {
    query?.delete();
    return [];
  }
  const matchingIndices: number[] = [];
  for (let i = 0; i < molecules.length; i++) {
    try {
      const mol = RDKit.get_mol(molecules[i].smiles);
      if (mol && mol.is_valid()) {
        const matchStr = mol.get_substruct_match(query);
        mol.delete();
        // get_substruct_match returns "{}" if no match, non-empty JSON if match found
        if (matchStr && matchStr !== '{}') {
          matchingIndices.push(i);
        }
      }
    } catch {
      // skip invalid molecules
    }
  }
  query.delete();
  return matchingIndices;
}
