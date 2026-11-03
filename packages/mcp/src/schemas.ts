import { z } from 'zod';
import { ABSOLUTE_MAX_MOLECULES, ABSOLUTE_MAX_SMILES_LENGTH, MAX_MOLECULES, MAX_SMILES_LENGTH } from '@paretomol/core';

export const moleculesField = z.array(z.union([
  z.string(),
  z.object({
    smiles: z.string(),
    name: z.string().optional(),
    props: z.record(z.string(), z.number()).optional(),
  }),
])).min(1).describe('Molecules: SMILES strings or {smiles, name?, props?} where props are numeric columns (e.g. pIC50).');

export const objectivesField = z.array(z.object({
  key: z.string(),
  direction: z.enum(['min', 'max']),
})).min(1).describe('Objectives, e.g. [{"key":"MW","direction":"min"},{"key":"pIC50","direction":"max"}]. Keys: descriptors (MW, LogP, TPSA, HBD, HBA, RotBonds, FrCSP3, QED, ...) or prop names. Default MW/LogP/TPSA min.');

export const maxMoleculesField = z.number().int().positive().optional().describe(
  `Molecule cap for this call. Default ${MAX_MOLECULES}, the same cap as the web app. Set it to raise the cap, up to ${ABSOLUTE_MAX_MOLECULES}.`,
);

export const maxSmilesLengthField = z.number().int().positive().optional().describe(
  `SMILES length cap for this call. Default ${MAX_SMILES_LENGTH}. Set it to raise the cap, up to ${ABSOLUTE_MAX_SMILES_LENGTH}.`,
);

export const limitShape = {
  maxMolecules: maxMoleculesField,
  maxSmilesLength: maxSmilesLengthField,
};
