import { describe, it, expect } from 'vitest';
import { checkInputLimits, MAX_MOLECULES, ABSOLUTE_MAX_MOLECULES, MAX_SMILES_LENGTH } from '../src/limits';

const mol = (smiles: string) => ({ smiles });

describe('input limits', () => {
  it('allows the web app cap and refuses one past it', () => {
    expect(checkInputLimits(Array.from({ length: MAX_MOLECULES }, () => mol('CCO')))).toBeNull();
    const over = checkInputLimits(Array.from({ length: MAX_MOLECULES + 1 }, () => mol('CCO')));
    expect(over?.code).toBe('too_many_molecules');
  });

  it('accepts an explicit override under the absolute ceiling', () => {
    const n = MAX_MOLECULES + 1;
    expect(checkInputLimits(Array.from({ length: n }, () => mol('C')), { maxMolecules: n })).toBeNull();
    expect(checkInputLimits([mol('C')], { maxMolecules: ABSOLUTE_MAX_MOLECULES + 1 })?.code).toBe('limit_too_high');
    expect(checkInputLimits([mol('C')], { maxMolecules: 0 })?.code).toBe('limit_too_high');
  });

  it('caps SMILES length the same way', () => {
    expect(checkInputLimits([mol('C'.repeat(MAX_SMILES_LENGTH + 1))])?.code).toBe('smiles_too_long');
    expect(checkInputLimits([mol('C'.repeat(MAX_SMILES_LENGTH + 1))], { maxSmilesLength: MAX_SMILES_LENGTH + 1 })).toBeNull();
  });
});
