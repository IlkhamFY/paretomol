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
export function isConflicting(values: number[], relativeTolerance = 0.5): boolean {
  if (values.length < 2) return false;
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median === 0) return sorted[0] !== sorted[sorted.length - 1];
  return (sorted[sorted.length - 1] - sorted[0]) / Math.abs(median) > relativeTolerance;
}
