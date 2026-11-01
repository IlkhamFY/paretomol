// Caps shared with the web app. The app warns at MAX_MOLECULES and lets a
// person continue. Agents must pass an explicit override to go past it.
// Absolute ceilings still apply, so one call cannot exhaust the process.

export const MAX_MOLECULES = 2000;
export const MAX_SMILES_LENGTH = 10_000;
export const ABSOLUTE_MAX_MOLECULES = 20_000;
export const ABSOLUTE_MAX_SMILES_LENGTH = 100_000;

export type LimitCode = 'too_many_molecules' | 'smiles_too_long' | 'limit_too_high';

export interface LimitIssue {
  code: LimitCode;
  message: string;
}

export interface LimitOptions {
  /** Replaces MAX_MOLECULES for this call. Cannot exceed ABSOLUTE_MAX_MOLECULES. */
  maxMolecules?: number;
  /** Replaces MAX_SMILES_LENGTH for this call. Cannot exceed ABSOLUTE_MAX_SMILES_LENGTH. */
  maxSmilesLength?: number;
}

function badOverride(name: string, value: number, absolute: number): LimitIssue {
  return {
    code: 'limit_too_high',
    message: `${name} ${value} is above the absolute maximum of ${absolute}.`,
  };
}

/** Null when the list is inside the cap. The first problem otherwise. */
export function checkInputLimits(molecules: { smiles: string }[], opts: LimitOptions = {}): LimitIssue | null {
  let cap = MAX_MOLECULES;
  if (opts.maxMolecules !== undefined) {
    if (!Number.isInteger(opts.maxMolecules) || opts.maxMolecules < 1) {
      return { code: 'limit_too_high', message: `maxMolecules must be a positive integer, got ${String(opts.maxMolecules)}.` };
    }
    if (opts.maxMolecules > ABSOLUTE_MAX_MOLECULES) return badOverride('maxMolecules', opts.maxMolecules, ABSOLUTE_MAX_MOLECULES);
    cap = opts.maxMolecules;
  }
  if (molecules.length > cap) {
    return {
      code: 'too_many_molecules',
      message: `Molecule count ${molecules.length} is above the cap of ${cap}. The web app uses ${MAX_MOLECULES}. Pass maxMolecules to raise the cap, up to ${ABSOLUTE_MAX_MOLECULES}.`,
    };
  }

  let smileCap = MAX_SMILES_LENGTH;
  if (opts.maxSmilesLength !== undefined) {
    if (!Number.isInteger(opts.maxSmilesLength) || opts.maxSmilesLength < 1) {
      return { code: 'limit_too_high', message: `maxSmilesLength must be a positive integer, got ${String(opts.maxSmilesLength)}.` };
    }
    if (opts.maxSmilesLength > ABSOLUTE_MAX_SMILES_LENGTH) return badOverride('maxSmilesLength', opts.maxSmilesLength, ABSOLUTE_MAX_SMILES_LENGTH);
    smileCap = opts.maxSmilesLength;
  }
  for (let i = 0; i < molecules.length; i++) {
    const len = molecules[i].smiles.length;
    if (len > smileCap) {
      return {
        code: 'smiles_too_long',
        message: `molecules[${i}].smiles is ${len} characters, above the cap of ${smileCap}. Pass maxSmilesLength to raise it, up to ${ABSOLUTE_MAX_SMILES_LENGTH}.`,
      };
    }
  }
  return null;
}
