// ─── Assay value parsing ─────────────────────────────────────────────────────
// Imported assay columns are not plain numbers. They carry censoring ("> 10000",
// meaning the true value lies beyond the tested range) and units ("10 uM",
// "0.5 nM"), and coercing them with Number() destroys both: Number('>10000') is
// NaN, so the record silently vanishes, and Number('10 uM') is NaN likewise.
//
// Censored values are kept with their relation intact but are NOT admitted as
// Pareto objectives: "greater than 10 uM" cannot be ordered against a measured
// 12 uM without assuming something the experiment did not establish.

export type Relation = '=' | '>' | '<' | '>=' | '<=';

export interface AssayValue {
  value: number;
  relation: Relation;
  /** Unit as written, normalised in case only. Null when none was given. */
  unit: string | null;
  /** The original cell, retained for the merge report. */
  raw: string;
}

/** Textual placeholders that mean "no measurement", not "zero". */
const MISSING = /^(na|n\/a|nan|nd|n\.d\.|null|none|-|\.|\?|inactive|not tested|nt)$/i;

const RELATIONS: [RegExp, Relation][] = [
  [/^>=|^≥/, '>='],
  [/^<=|^≤/, '<='],
  [/^>/, '>'],
  [/^</, '<'],
  [/^=/, '='],
];

/**
 * Parse one assay cell.
 *
 * Returns null when the cell carries no measurement. Note that an empty string
 * must return null rather than 0: `Number('')` is 0, and a blank cell entering
 * the analysis as a real zero is the most damaging form this bug takes, since
 * zero is the best attainable value for any minimised objective.
 */
export function parseAssayValue(raw: string | undefined | null): AssayValue | null {
  if (raw === undefined || raw === null) return null;
  const original = String(raw).trim();
  if (original === '' || MISSING.test(original)) return null;

  let rest = original;
  let relation: Relation = '=';
  for (const [pattern, rel] of RELATIONS) {
    if (pattern.test(rest)) {
      relation = rel;
      rest = rest.replace(pattern, '').trim();
      break;
    }
  }

  // Leading number, optionally in scientific notation; whatever follows is
  // treated as the unit.
  const m = rest.match(/^([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)\s*(.*)$/);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;

  const unit = m[2].trim() === '' ? null : normaliseUnit(m[2].trim());
  return { value, relation, unit, raw: original };
}

/** Canonicalise the common micro- prefixes so "uM", "µM" and "μM" agree. */
export function normaliseUnit(unit: string): string {
  return unit
    .replace(/µ|μ/g, 'u')  // MICRO SIGN and GREEK SMALL LETTER MU
    .replace(/\s+/g, '');
}

/** True when the value is censored, i.e. bounded rather than measured. */
export function isCensored(v: AssayValue): boolean {
  return v.relation !== '=';
}

/**
 * Aggregate repeated measurements of the same compound and column.
 *
 * Median rather than mean: assay replicates are frequently log-distributed and
 * contain occasional order-of-magnitude outliers, against which the median is
 * robust. Censored values are excluded from the aggregate but reported, since
 * averaging a bound with a measurement produces a number that means neither.
 *
 * Returns null when nothing aggregable remains.
 */
export function aggregate(values: AssayValue[]): { value: number; n: number; censoredExcluded: number } | null {
  const measured = values.filter(v => !isCensored(v)).map(v => v.value).sort((a, b) => a - b);
  const censoredExcluded = values.length - measured.length;
  if (measured.length === 0) return null;
  const mid = Math.floor(measured.length / 2);
  const value = measured.length % 2 === 0
    ? (measured[mid - 1] + measured[mid]) / 2
    : measured[mid];
  return { value, n: measured.length, censoredExcluded };
}

/**
 * Do repeated measurements disagree enough to be worth reporting?
 * Relative spread against the median, so the test is scale-free.
 */
const TO_NM: Record<string, number> = {
  nm: 1, um: 1e3, mm: 1e6, m: 1e9,
};

/** Factor from a concentration unit to nM, or null when the unit is not a concentration. */
export function nanomolarFactor(unit: string | null): number | null {
  if (!unit) return null;
  const key = normaliseUnit(unit).toLowerCase().replace(/[^a-z]/g, '');
  return TO_NM[key] ?? null;
}

/** p-scale from a concentration in nM. 1 nM is 9, 1 uM is 6. Non-positive values are not a concentration. */
export function pFromNanomolar(nM: number): number | null {
  if (!(nM > 0) || !Number.isFinite(nM)) return null;
  return 9 - Math.log10(nM);
}

export interface ActivityHeader {
  kind: string;
  /** Unit declared by the header, if any. */
  unit: string | null;
  /** The column is already on a p-scale. */
  alreadyP: boolean;
}

/** True for an activity column this importer knows, including the stored names (`pIC50`, `IC50_nM`, `pChEMBL`). */
export function isActivityColumn(name: string): boolean {
  return activityHeader(name) !== null;
}

/** IC50, Ki, Kd and the p-scaled forms. Other headers are left alone. */
export function activityHeader(header: string): ActivityHeader | null {
  const compact = header.trim().replace(/[^a-z0-9]+/gi, '').toLowerCase();
  if (/^p(ic50|ec50|ki|kd|gi50|mic|chembl)$/.test(compact)) {
    return { kind: header.trim(), unit: null, alreadyP: true };
  }
  const m = header.trim().match(/^(ic50|ec50|ki|kd|gi50|mic)(?:[\s_\-(]+(nM|uM|µM|μM|mM|M))?/i);
  if (!m) return null;
  const kindMap: Record<string, string> = { ic50: 'IC50', ec50: 'EC50', ki: 'Ki', kd: 'Kd', gi50: 'GI50', mic: 'MIC' };
  return { kind: kindMap[m[1].toLowerCase()], unit: m[2] ? normaliseUnit(m[2]) : null, alreadyP: false };
}

export interface ActivityColumns {
  rawName: string;
  pName: string;
  raw: (number | null)[];
  p: (number | null)[];
  note: string;
}

/**
 * Turn an activity column into a nM display column and a p-scale objective.
 * Returns null when the header is not an activity, or when it is already on a p-scale.
 * Mixed units are refused: both value lists stay empty and the note says why.
 */
export function activityColumns(header: string, cells: string[]): ActivityColumns | null {
  const spec = activityHeader(header);
  if (!spec || spec.alreadyP) return null;
  const parsed = cells.map((cell) => parseAssayValue(cell));
  const units = new Set<string>();
  if (spec.unit && nanomolarFactor(spec.unit) !== null) units.add(normaliseUnit(spec.unit).toLowerCase());
  for (const v of parsed) {
    if (v?.unit && nanomolarFactor(v.unit) !== null) units.add(normaliseUnit(v.unit).toLowerCase());
  }
  if (units.size === 0) {
    return null;
  }
  if (units.size > 1) {
    return { rawName: `${spec.kind}_nM`, pName: `p${spec.kind}`, raw: [], p: [], note: `${header} has mixed units, so it was not used as an objective.` };
  }
  const unit = [...units][0];
  const factor = nanomolarFactor(unit)!;
  let censored = 0;
  const raw: (number | null)[] = [];
  const p: (number | null)[] = [];
  for (const v of parsed) {
    if (!v || isCensored(v)) {
      if (v && isCensored(v)) censored++;
      raw.push(null); p.push(null);
      continue;
    }
    const nM = v.value * (v.unit && nanomolarFactor(v.unit) !== null ? nanomolarFactor(v.unit)! : factor);
    const pValue = pFromNanomolar(nM);
    raw.push(nM);
    p.push(pValue);
  }
  const from = unit === 'nm' ? 'nM' : unit === 'um' ? 'uM' : unit === 'mm' ? 'mM' : 'M';
  const censoredNote = censored ? ` ${censored} censored value${censored === 1 ? '' : 's'} left out.` : '';
  return {
    rawName: `${spec.kind}_nM`,
    pName: `p${spec.kind}`,
    raw,
    p,
    note: `${spec.kind} was read in ${from} and added as p${spec.kind}. ${spec.kind}_nM is kept for display.${censoredNote}`,
  };
}

export function isConflicting(values: number[], relativeTolerance = 0.5): boolean {
  if (values.length < 2) return false;
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median === 0) return sorted[0] !== sorted[sorted.length - 1];
  return (sorted[sorted.length - 1] - sorted[0]) / Math.abs(median) > relativeTolerance;
}
