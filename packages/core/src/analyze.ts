// RDKit-backed molecule analysis shared by the web app and the CLI.
// The RDKit.js module is passed in, so this file has no DOM or network access:
// the browser hands in window.RDKitModule, Node hands in @rdkit/rdkit.
import type { Molecule, MolProps, FilterResult } from './types.js';
import { DRUG_FILTERS } from './types.js';
import { checkFilter } from './filters.js';
import { computeQED } from './qed.js';
import { QED_ALERT_SMARTS } from './qedAlerts.js';
import { packFingerprint } from './similarity.js';
import { syntheticComplexityFromDescriptors } from './synth.js';

/** The subset of an RDKit.js molecule this module uses. */
export interface RDKitMolLike {
  is_valid: () => boolean;
  delete: () => void;
  get_descriptors: () => string;
  get_morgan_fp: (opts: string) => string;
  get_substruct_match: (q: RDKitMolLike) => string;
}
/** The subset of the RDKit.js module this module uses. */
export interface RDKitLike {
  get_mol: (s: string) => RDKitMolLike | null;
  get_qmol: (s: string) => RDKitMolLike | null;
  version?: () => string;
}

const qmolCaches = new WeakMap<RDKitLike, Map<string, RDKitMolLike | null>>();

/** Number of canonical-QED structural alerts a molecule matches.
 *
 *  QED's alert term counts how many of the reference implementation's 116
 *  patterns match at least once — not the total number of matches. These
 *  patterns are specific to QED and are not the PAINS/Brenk/NIH catalogues
 *  used elsewhere in this file, so the two counts are not interchangeable.
 *  Compiled queries are cached across molecules; without that, 116 SMARTS
 *  would be recompiled for every structure. */
export function countQEDAlerts(mol: RDKitMolLike, RDKit: RDKitLike): number {
  let qmolCache = qmolCaches.get(RDKit);
  if (!qmolCache) { qmolCache = new Map(); qmolCaches.set(RDKit, qmolCache); }
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


/** Detect if input is CSV/TSV with a header row. Returns parsed rows + header info, or null if not CSV. */
export function detectCSV(input: string): { separator: string; headers: string[]; rows: string[][]; smilesCol: number } | null {
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
export function parseNumericCell(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (s === '' || /^(na|n\/a|nan|nd|null|none|-|\.)$/i.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

/** Extract SMILES lines and custom properties from CSV data. */
export function parseCSVData(csv: { headers: string[]; rows: string[][]; smilesCol: number }): { smilesLines: string[]; customPropNames: string[]; customPropValues: Record<string, number>[] } {
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

/** Parse one resolved "SMILES name" line into a Molecule (no SVG: rendering is the caller's job).
 *  This is the single descriptor path shared by the web app and the CLI. */
export function analyzeMolecule(
  line: string,
  index: number,
  RDKit: RDKitLike,
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


export interface AnalyzeResult {
  molecules: Molecule[];
  /** Input lines that did not parse as SMILES. */
  errors: number;
  customPropNames: string[];
}

/** Split raw input (CSV/TSV with a SMILES column, or "SMILES name" lines). */
export function splitInput(input: string): { smilesLines: string[]; customPropNames: string[]; customPropValues: Record<string, number>[] } {
  const csv = detectCSV(input);
  if (csv) return parseCSVData(csv);
  return { smilesLines: input.split('\n').filter(l => l.trim()), customPropNames: [], customPropValues: [] };
}

/** Synchronous, offline analysis of raw input: no name resolution and no Pareto
 *  ranking (call computeParetoAndDominance with the objectives you want). */
export function analyzeInput(input: string, RDKit: RDKitLike): AnalyzeResult {
  const { smilesLines, customPropNames, customPropValues } = splitInput(input);
  const molecules: Molecule[] = [];
  let errors = 0;
  for (let i = 0; i < smilesLines.length; i++) {
    const m = analyzeMolecule(smilesLines[i], i, RDKit, customPropValues);
    if (m) molecules.push(m); else errors++;
  }
  return { molecules, errors, customPropNames };
}
