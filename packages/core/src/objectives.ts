// ─── Objective direction inference ───────────────────────────────────────────
// Which way is "better" for an imported column. Getting this wrong silently
// inverts the optimisation: a column of IC50 values optimised for *maximum*
// selects the least potent compounds in the set, and nothing in the interface
// would say so. When the direction cannot be established from the name we
// return null and leave the column out of the objective set rather than guess.

export type Direction = 'min' | 'max';

/** Columns that carry no optimisable quantity. Present as data, never as objectives. */
const METADATA = new Set([
  'assayid', 'assaytype', 'assaychemblid', 'confidence', 'confidencescore',
  'year', 'docid', 'documentid', 'moleculechemblid', 'chemblid', 'targetid',
  'targetchemblid', 'pubmedid', 'doi', 'reference', 'source', 'standardtype',
  'standardunits', 'standardrelation', 'units', 'relation', 'index', 'id',
  'name', 'smiles', 'inchikey', 'batch', 'lot',
]);

/** Raw activity/affinity concentrations: lower is more potent. */
const RAW_ACTIVITY = new Set(['ic50', 'ec50', 'kd', 'ki', 'mic', 'gi50', 'kiapp']);

/** p-scaled activities: a higher value means a lower concentration, so higher is better. */
const P_SCALED = new Set(['pic50', 'pki', 'pkd', 'pec50', 'pmic', 'pgi50', 'pchembl']);

/**
 * Split a column name into comparable tokens.
 *
 * Splitting on separators preserves the token boundaries that matter: matching
 * the bare substring "ki" previously fired inside "kinase_family" and
 * "skin_reaction". A trailing pure-digit run is rejoined to the word before it
 * so that "IC-50" and "IC 50" reduce to the same token as "IC50".
 */
function tokenise(name: string): string[] {
  const parts = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const next = parts[i + 1];
    if (/^[a-z]+$/.test(p) && next !== undefined && /^\d+$/.test(next)) {
      out.push(p + next);
      i++;
    } else {
      out.push(p);
    }
  }
  // "p_IC50" and "p IC50" tokenise to ["p", "ic50"]; rejoin so the p-scaled
  // form is recognised rather than falling through to the raw-activity rule.
  const merged: string[] = [];
  for (let i = 0; i < out.length; i++) {
    if (out[i] === 'p' && out[i + 1] !== undefined) {
      merged.push('p' + out[i + 1]);
      i++;
    } else {
      merged.push(out[i]);
    }
  }
  return merged;
}

/**
 * Infer the optimisation direction for a named column, or null when the name
 * gives no dependable signal.
 *
 * Note that p-scaled activities invert the direction of their raw
 * counterparts: a higher pIC50 means a lower IC50 and thus greater potency, so
 * pIC50 is maximised where IC50 is minimised. A pattern testing for the
 * substring "ic50" minimises "pIC50" — exactly backwards.
 *
 * Quantities whose direction depends on the reporting convention are
 * deliberately left unresolved. LD50 is the clearest case: in mg/kg a higher
 * value is safer, while on the log(1/mol/kg) scale used by several predictors a
 * higher value is more toxic. Returning null asks the user rather than
 * asserting one convention over the other.
 */
export function inferObjectiveDirection(name: string): Direction | null {
  const toks = tokenise(name);
  const joined = toks.join('');
  if (METADATA.has(joined) || toks.some(t => METADATA.has(t))) return null;

  // Order matters: p-scaled forms are checked before the raw forms they contain.
  if (toks.some(t => P_SCALED.has(t))) return 'max';
  if (toks.some(t => RAW_ACTIVITY.has(t))) return 'min';

  // Long, distinctive words are safe to match as substrings.
  const liability = /(toxic|tox$|herg|dili|clintox|mutagen|carcinogen|ames|clearance|liabilit|risk|hazard|cost|price)/;
  const favourable = /(solubility|permeability|bioavailability|absorption|potency|selectivity|yield|efficacy|score)/;

  // A "toxicity score" is still worse when higher, so liabilities win over "score".
  if (liability.test(joined)) return 'min';
  if (favourable.test(joined)) return 'max';

  return null;
}

/**
 * Build objective entries for newly available columns.
 * Columns whose direction cannot be inferred are omitted: the user selects them
 * explicitly, and chooses the direction, rather than the application silently
 * optimising in a direction it guessed.
 */
export function inferObjectives(names: string[]): { key: string; direction: Direction }[] {
  const out: { key: string; direction: Direction }[] = [];
  for (const key of names) {
    const direction = inferObjectiveDirection(key);
    if (direction) out.push({ key, direction });
  }
  return out;
}
