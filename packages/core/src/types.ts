export interface MolProps {
  MW: number;
  LogP: number;
  HBD: number;
  HBA: number;
  TPSA: number;
  RotBonds: number;
  FrCSP3: number;
  Rings: number;
  AromaticRings: number;
  HeavyAtoms: number;
  MR: number;
  NumAtoms: number;
  QED: number;
  SC: number; // synthetic complexity (1 easy – 10 hard); make-ability triage proxy
}

export interface FilterResult {
  pass: boolean;
  violations: number;
}

/** Ideal band for one property. 1 inside [idealMin, idealMax], 0 outside [acceptMin, acceptMax]. */
export interface ObjectiveWindow {
  idealMin: number;
  idealMax: number;
  acceptMin: number;
  acceptMax: number;
}

export interface ParetoObjective {
  key: string;
  direction: 'min' | 'max';
  /**
   * When set, dominance, the knee and the reading use linear desirability of
   * `key` (higher is better) instead of the raw number. `direction` is `max`.
   */
  window?: ObjectiveWindow;
}

export interface FormulaColumn {
  name: string;
  expr: string;
}

// Historical raw directions stored on oral@1 and the other v1 profiles.
// The app's default front does not use this list: it ranks desirability
// windows (see scoring.ts). This constant remains so a record that cites
// oral@1 still hashes, and so the paper reproduction preset can name the
// same minimize directions the Digital Discovery figures used.
// The synthetic-complexity estimate (SC) is deliberately not an objective:
// it is an untrained heuristic.
export const DEFAULT_PARETO_OBJECTIVES: ParetoObjective[] = [
  { key: 'MW', direction: 'min' },
  { key: 'LogP', direction: 'min' },
  { key: 'TPSA', direction: 'min' },
];

export interface MolCost {
  zincId: string | null;          // representative ZINC id (for the catalog link)
  catalogs: number;               // number of priced catalog entries across vendors
  pricePerMg: number | null;      // cheapest USD/mg across catalogs (cost objective)
  cheapest: { price: number; quantity: number; unit: string; shipping?: string; catalog: string } | null;
  purchasable: boolean;           // present in a ZINC catalog at all
}

export interface Molecule {
  name: string;
  smiles: string;
  svg: string;
  formula: string;
  fingerprint: string;
  /** Packed fingerprint for fast bitwise Tanimoto (Uint32Array of 64 words for 2048 bits) */
  fpPacked: Uint32Array;
  props: MolProps;
  customProps: Record<string, number>;
  filters: Record<string, FilterResult>;
  lipinski?: FilterResult;
  scFactors?: string[]; // dominant drivers of the synthetic-complexity estimate (for the "why")
  cost?: MolCost;       // building-block availability & price (ZINC-22 catalogs)
  /** Non-dominated front index: 1 = Pareto front, 2 = the front remaining once
   *  front 1 is removed, and so on. `null` when the molecule is unranked
   *  because it lacks a value for an active objective (see missingObjectives). */
  paretoRank: number | null;
  /** Active objectives this molecule has no usable value for. Such molecules are
   *  excluded from the dominance relation rather than imputed, so that a failed
   *  prediction is never read as a favourable measurement. */
  missingObjectives?: string[];
  /** Constraint failures. The molecule was left out of the front. */
  excluded?: string[];
  dominates: number[];
  dominatedBy: number[];
}

export const PROPERTIES = [
  { key: 'SC', label: 'Synth. (est., untrained)', unit: '' },
  { key: 'MW', label: 'Molecular Weight', unit: 'Da', lipinski: { max: 500 } },
  { key: 'LogP', label: 'Calc. LogP', unit: '', lipinski: { max: 5 } },
  { key: 'HBD', label: 'H-Bond Donors', unit: '', lipinski: { max: 5 } },
  { key: 'HBA', label: 'H-Bond Acceptors', unit: '', lipinski: { max: 10 } },
  { key: 'TPSA', label: 'Topological PSA', unit: 'Å²', lipinski: { max: 140 } },
  { key: 'RotBonds', label: 'Rotatable Bonds', unit: '', lipinski: { max: 10 } },
  { key: 'FrCSP3', label: 'Fraction Csp3', unit: '' },
  { key: 'HeavyAtoms', label: 'Heavy Atom Count', unit: '' },
  { key: 'MR', label: 'Molar Refractivity', unit: '' },
  { key: 'Rings', label: 'Ring Count', unit: '' },
  { key: 'AromaticRings', label: 'Aromatic Rings', unit: '' },
  { key: 'QED', label: 'QED (Drug-likeness)', unit: '' },
];

export const DRUG_FILTERS = {
  lipinski: {
    label: 'Lipinski Ro5',
    color: 'green',
    rules: [
      { key: 'MW', op: '<=', val: 500 },
      { key: 'LogP', op: '<=', val: 5 },
      { key: 'HBD', op: '<=', val: 5 },
      { key: 'HBA', op: '<=', val: 10 },
    ],
    maxViolations: 1,
  },
  veber: {
    label: 'Veber',
    color: 'yellow',
    rules: [
      { key: 'RotBonds', op: '<=', val: 10 },
      { key: 'TPSA', op: '<=', val: 140 },
    ],
    maxViolations: 0,
  },
  ghose: {
    label: 'Ghose',
    color: 'cyan',
    rules: [
      { key: 'LogP', op: '>=', val: -0.4 },
      { key: 'LogP', op: '<=', val: 5.6 },
      { key: 'MW', op: '>=', val: 160 },
      { key: 'MW', op: '<=', val: 480 },
      { key: 'MR', op: '>=', val: 40 },
      { key: 'MR', op: '<=', val: 130 },
      { key: 'NumAtoms', op: '>=', val: 20 },
      { key: 'NumAtoms', op: '<=', val: 70 },
    ],
    maxViolations: 0,
  },
  leadlike: {
    label: 'Lead-like',
    color: 'orange',
    rules: [
      { key: 'MW', op: '<=', val: 450 },
      { key: 'LogP', op: '<=', val: 4.5 },
      { key: 'RotBonds', op: '<=', val: 10 },
      { key: 'HBD', op: '<=', val: 5 },
      { key: 'HBA', op: '<=', val: 8 },
    ],
    maxViolations: 0,
  },
};
