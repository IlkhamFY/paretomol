import type { Molecule, FilterResult, MolProps, ParetoObjective } from './types';
import { DRUG_FILTERS, DEFAULT_PARETO_OBJECTIVES } from './types';
import { computeQED } from './qed';

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

export type SimilarityMetric = 'tanimoto-r2' | 'tanimoto-r3' | 'selfies-ted';

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
  if (metric === 'tanimoto-r3') {
    return computeTanimotoMatrixRadius(molecules, 3);
  }
  // tanimoto-r2: use pre-packed fingerprints (fast path)
  return computeTanimotoMatrix(molecules);
}

export function looksLikeName(line: string): boolean {
  const s = line.trim().split(/\s+/)[0];
  return !/[()=\[\]#/\\@+]/.test(s) && !/[A-Za-z]\d/.test(s) && !/^\d/.test(s);
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
  } catch (e) {
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
      if (/[()=\[\]#@\\\/]/.test(cell) || /^[A-Za-z][A-Za-z0-9()=\[\]#@\\\/+\-.*]+$/.test(cell)) {
        smilesCol = i;
        break;
      }
    }
  }

  if (smilesCol === -1) return null;

  // Determine if first line is a header row (SMILES column header is a known keyword, not actual SMILES)
  const smilesHeader = headers[smilesCol].toLowerCase();
  const isHeaderRow = SMILES_HEADERS.includes(smilesHeader) || !/[()=\[\]#@\\\/]/.test(headers[smilesCol]);

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
        const testVal = rows[r]?.[i];
        if (testVal !== undefined && testVal !== '' && !isNaN(Number(testVal))) numericCount++;
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
      const val = Number(row[col.idx]);
      if (!isNaN(val)) props[col.name] = val;
    }
    customPropValues.push(props);
  }

  return { smilesLines, customPropNames: customCols.map(c => c.name), customPropValues };
}

export interface AssayMergeResult {
  /** New custom prop column names found in the CSV */
  newPropNames: string[];
  /** How many molecules matched (by SMILES or name) */
  matchCount: number;
  /** Updated molecules array with assay data merged into customProps */
  molecules: Molecule[];
}

/**
 * Parse an assay CSV and join its numeric columns onto existing molecules.
 * Matching priority: exact SMILES → lowercase name.
 * Columns already named in builtinProps or existingCustomPropNames are skipped.
 */
export function mergeAssayData(
  csvText: string,
  molecules: Molecule[],
  existingCustomPropNames: string[] = []
): AssayMergeResult {
  const BUILTIN = new Set(['MW','LogP','HBD','HBA','TPSA','RotBonds','FrCSP3','Rings','AromaticRings','HeavyAtoms','MR','NumAtoms']);
  const NAME_HEADERS = ['name','id','molecule','compound','compound id','compound_id','mol_name','title','chembl_id'];
  const SMILES_HEADERS = ['smiles','smi','structure','canonical_smiles','molecule','mol','compound_smiles'];

  // Parse CSV/TSV
  const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return { newPropNames: [], matchCount: 0, molecules };

  const sep = lines[0].includes('\t') ? '\t' : ',';
  const headers = lines[0].split(sep).map(h => h.trim().replace(/^"|"$/g, ''));

  // Find SMILES and Name columns
  let smilesCol = -1, nameCol = -1;
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase();
    if (smilesCol === -1 && SMILES_HEADERS.includes(h)) smilesCol = i;
    if (nameCol === -1 && NAME_HEADERS.includes(h)) nameCol = i;
  }

  // Identify numeric value columns (skip SMILES/name cols and builtins)
  const valueCols: { idx: number; name: string }[] = [];
  for (let i = 0; i < headers.length; i++) {
    if (i === smilesCol || i === nameCol) continue;
    if (BUILTIN.has(headers[i]) || existingCustomPropNames.includes(headers[i])) continue;
    // Check first 3 data rows for numeric content
    let numCount = 0;
    for (let r = 1; r <= Math.min(3, lines.length - 1); r++) {
      const cells = lines[r].split(sep).map(c => c.trim().replace(/^"|"$/g, ''));
      if (!isNaN(Number(cells[i])) && cells[i] !== '') numCount++;
    }
    if (numCount > 0) valueCols.push({ idx: i, name: headers[i] });
  }

  if (valueCols.length === 0) return { newPropNames: [], matchCount: 0, molecules };

  // Build lookup maps: smiles → props, lowername → props
  const bySmiles = new Map<string, Record<string, number>>();
  const byName = new Map<string, Record<string, number>>();

  for (let r = 1; r < lines.length; r++) {
    const cells = lines[r].split(sep).map(c => c.trim().replace(/^"|"$/g, ''));
    const smiles = smilesCol >= 0 ? cells[smilesCol] ?? '' : '';
    const name = nameCol >= 0 ? (cells[nameCol] ?? '').toLowerCase() : '';
    const props: Record<string, number> = {};
    for (const col of valueCols) {
      const v = Number(cells[col.idx]);
      if (!isNaN(v)) props[col.name] = v;
    }
    if (smiles) bySmiles.set(smiles, props);
    if (name) byName.set(name, props);
  }

  // Join onto molecules
  let matchCount = 0;
  const updated = molecules.map(mol => {
    const hit = bySmiles.get(mol.smiles) ?? byName.get(mol.name.toLowerCase());
    if (!hit) return mol;
    matchCount++;
    return { ...mol, customProps: { ...mol.customProps, ...hit } };
  });

  return {
    newPropNames: valueCols.map(c => c.name),
    matchCount,
    molecules: updated,
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
    } catch {}

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
    try { fingerprint = mol.get_morgan_fp(JSON.stringify({ radius: 2, nBits: 2048 })); } catch {}

    mol.delete();

    const mw = desc.exactmw || desc.amw || 0;
    const logp = desc.CrippenClogP || 0;
    const hbd = desc.NumHBD || 0;
    const hba = desc.NumHBA || 0;
    const tpsa = desc.tpsa || 0;
    const rotBonds = desc.NumRotatableBonds || 0;
    const arom = desc.NumAromaticRings || 0;
    const { qedWeighted } = computeQED({ MW: mw, ALOGP: logp, HBA: hba, HBD: hbd, PSA: tpsa, ROTB: rotBonds, AROM: arom, ALERTS: 0 });

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

/** Get a molecule's value for a Pareto objective key (built-in or custom). */
function getMolValue(m: Molecule, key: string): number {
  if (key in m.props) return m.props[key as keyof MolProps];
  return m.customProps[key] ?? 0;
}

/** Merged Pareto + Dominance in a single O(n²) pass. */
export function computeParetoAndDominance(molecules: Molecule[], objectives?: ParetoObjective[]) {
  const objs = objectives ?? DEFAULT_PARETO_OBJECTIVES;
  const n = molecules.length;
  const dominated = new Array(n).fill(false);

  for (let i = 0; i < n; i++) {
    molecules[i].dominates = [];
    molecules[i].dominatedBy = [];
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let iBetter = 0, jBetter = 0;
      for (const obj of objs) {
        const vi = getMolValue(molecules[i], obj.key);
        const vj = getMolValue(molecules[j], obj.key);
        if (obj.direction === 'min') {
          if (vi < vj) iBetter++;
          else if (vi > vj) jBetter++;
        } else {
          if (vi > vj) iBetter++;
          else if (vi < vj) jBetter++;
        }
      }
      if (iBetter > 0 && jBetter === 0) {
        molecules[i].dominates.push(j);
        molecules[j].dominatedBy.push(i);
        dominated[j] = true;
      } else if (jBetter > 0 && iBetter === 0) {
        molecules[j].dominates.push(i);
        molecules[i].dominatedBy.push(j);
        dominated[i] = true;
      }
    }
  }

  molecules.forEach((m, i) => {
    m.paretoRank = dominated[i] ? 2 : 1;
  });
}

/** Backward-compatible wrapper: compute Pareto ranks only (calls merged function). */
export function computeParetoRanks(molecules: Molecule[], objectives?: ParetoObjective[]) {
  computeParetoAndDominance(molecules, objectives);
}

/** Backward-compatible wrapper: dominance only. Kept for external callers but now a no-op if already computed. */
export function computeDominance(molecules: Molecule[], objectives?: ParetoObjective[]) {
  // If dominates arrays are already populated (from computeParetoAndDominance), skip.
  if (molecules.length > 0 && molecules[0].dominates && molecules[0].dominates.length >= 0 && molecules[0].paretoRank !== null) {
    return;
  }
  computeParetoAndDominance(molecules, objectives);
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

const PARETO_KEYS: (keyof MolProps)[] = ['MW', 'LogP', 'HBD', 'HBA', 'TPSA', 'RotBonds'];
const LIPINSKI_MAX: Record<string, number> = { MW: 500, LogP: 5, HBD: 5, HBA: 10, TPSA: 140, RotBonds: 10 };

export interface ActivityCliff {
  i: number;
  j: number;
  tanimoto: number;
  propDistance: number;
  cliffScore: number;
  topDifferingProps: string[];
}

/** Activity cliffs: high similarity but large property difference. */
export function computeActivityCliffs(
  molecules: Molecule[],
  tanimotoMatrix: number[][],
  threshold = 0.5,
  topN = 10
): ActivityCliff[] {
  const n = molecules.length;
  const cliffs: ActivityCliff[] = [];

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const t = tanimotoMatrix[i][j];
      if (t <= threshold) continue;

      const norm = (k: string, v: number) => v / (LIPINSKI_MAX[k] || 1);
      let sumSq = 0;
      const diffs: { key: string; diff: number }[] = [];
      for (const k of PARETO_KEYS) {
        const v1 = molecules[i].props[k];
        const v2 = molecules[j].props[k];
        const n1 = norm(k, v1);
        const n2 = norm(k, v2);
        const d = n1 - n2;
        sumSq += d * d;
        diffs.push({ key: k, diff: Math.abs(d) });
      }
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

// computeDominance is now defined above as a backward-compatible wrapper for computeParetoAndDominance

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
