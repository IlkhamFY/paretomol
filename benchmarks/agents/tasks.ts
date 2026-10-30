// ParetoMol agent benchmark v0: 20 multi-objective tasks an agent must answer.
// Ground truth comes from @paretomol/core (via the MCP tool functions), never by hand.
import type { MolIn } from '@paretomol/mcp/tools';

export type AnswerKind = 'set' | 'name' | 'number' | 'string';
export interface Task {
  id: string;
  prompt: string;
  kind: AnswerKind;
  /** Absolute tolerance for 'number' answers. */
  tol?: number;
  molecules?: MolIn[];
  objectives?: { key: string; direction: 'min' | 'max' }[];
  profile?: string;
  compare?: [string, string];
  claims?: { id: string; smiles: string; properties?: Record<string, number>; objectives?: { key: string; direction: 'min' | 'max' }[] }[];
  /** What the ground truth computes. */
  truth: 'front' | 'rank2' | 'unranked' | 'top_mpo' | 'filter_fail' | 'descriptor' | 'relation' | 'tradeoff_pair' | 'flagged' | 'front_size';
  descriptor?: { name: string; key: string };
}

const D = (smiles: string, name: string, props?: Record<string, number>): MolIn => ({ smiles, name, ...(props ? { props } : {}) });

export const DRUGS: MolIn[] = [
  D('CC(=O)Oc1ccccc1C(=O)O', 'aspirin'),
  D('CC(C)Cc1ccc(cc1)C(C)C(=O)O', 'ibuprofen'),
  D('CC(=O)Nc1ccc(O)cc1', 'paracetamol'),
  D('CN1C=NC2=C1C(=O)N(C(=O)N2C)C', 'caffeine'),
  D('CN1CCC[C@H]1c1cccnc1', 'nicotine'),
  D('COc1ccc2[nH]cc(CCN(C)C)c2c1', '5-MeO-DMT'),
  D('CN(C)CCCN1c2ccccc2CCc2ccccc21', 'imipramine'),
  D('Clc1ccc2c(c1)C(=NCC(=O)N2C)c1ccccc1', 'diazepam'),
  D('CC(C)NCC(O)COc1cccc2ccccc12', 'propranolol'),
  D('CN1CCN(CC1)C(=O)OC1N=C(c2ccccc2)c2cc(Cl)ccc2NC1=O', 'camazepam-like'),
  D('OC(=O)CCCCC1SCC2NC(=O)NC12', 'biotin'),
  D('CC1(C)SC2C(NC(=O)Cc3ccccc3)C(=O)N2C1C(=O)O', 'penicillin G'),
];

const SERIES: MolIn[] = [
  D('c1ccc(cc1)C(=O)Nc1ccccc1', 'A1', { pIC50: 5.1, solubility: -3.2 }),
  D('Cc1ccc(cc1)C(=O)Nc1ccccc1', 'A2', { pIC50: 5.6, solubility: -3.6 }),
  D('Clc1ccc(cc1)C(=O)Nc1ccccc1', 'A3', { pIC50: 6.4, solubility: -4.1 }),
  D('COc1ccc(cc1)C(=O)Nc1ccccc1', 'A4', { pIC50: 5.9, solubility: -3.4 }),
  D('Clc1ccc(cc1)C(=O)Nc1ccc(F)cc1', 'A5', { pIC50: 7.0, solubility: -4.6 }),
  D('OC(=O)c1ccc(cc1)C(=O)Nc1ccccc1', 'A6', { pIC50: 4.8, solubility: -2.1 }),
  D('Clc1ccc(cc1)C(=O)Nc1ccc(cc1)N1CCOCC1', 'A7', { pIC50: 7.3, solubility: -3.9 }),
  D('Nc1ccc(cc1)C(=O)Nc1ccccc1', 'A8', { pIC50: 5.0 }),
];

const BEYOND_RO5: MolIn[] = [
  ...DRUGS,
  D('CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC', 'tetracontane'),
  D('CC(C)c1c(C(=O)Nc2ccccc2)c(-c2ccccc2)c(-c2ccc(F)cc2)n1CC[C@@H](O)C[C@@H](O)CC(=O)O', 'atorvastatin'),
  D('CCCCCCCCCCCCCCCC(=O)OCC(COC(=O)CCCCCCCCCCCCCCC)OC(=O)CCCCCCCCCCCCCCC', 'tripalmitin'),
];

const MIN = (key: string) => ({ key, direction: 'min' as const });
const MAX = (key: string) => ({ key, direction: 'max' as const });

export const TASKS: Task[] = [
  { id: 't01', kind: 'set', truth: 'front', molecules: DRUGS, objectives: [MIN('MW'), MIN('LogP'), MIN('TPSA')], prompt: 'Which molecules are on the Pareto front minimising MW, LogP and TPSA?' },
  { id: 't02', kind: 'set', truth: 'front', molecules: DRUGS, objectives: [MAX('QED'), MIN('MW')], prompt: 'Which molecules are Pareto-optimal for maximising QED and minimising MW?' },
  { id: 't03', kind: 'set', truth: 'front', molecules: SERIES, objectives: [MAX('pIC50'), MAX('solubility')], prompt: 'In the amide series, which compounds are Pareto-optimal for maximising both pIC50 and solubility (log S)?' },
  { id: 't04', kind: 'set', truth: 'front', molecules: SERIES, objectives: [MAX('pIC50'), MIN('LogP'), MIN('MW')], prompt: 'Which series compounds are on the front for max pIC50, min LogP, min MW?' },
  { id: 't05', kind: 'set', truth: 'rank2', molecules: SERIES, objectives: [MAX('pIC50'), MAX('solubility')], prompt: 'Which compounds form the second Pareto front (rank 2) for max pIC50 and max solubility?' },
  { id: 't06', kind: 'set', truth: 'unranked', molecules: SERIES, objectives: [MAX('pIC50'), MAX('solubility')], prompt: 'Which compounds cannot be ranked for max pIC50 / max solubility because a value is missing?' },
  { id: 't07', kind: 'name', truth: 'top_mpo', molecules: DRUGS, profile: 'oral@1', prompt: 'Under the oral@1 profile, which drug has the highest MPO score?' },
  { id: 't08', kind: 'name', truth: 'top_mpo', molecules: DRUGS, profile: 'cns@1', prompt: 'Under the cns@1 profile, which drug has the highest MPO score?' },
  { id: 't09', kind: 'set', truth: 'filter_fail', molecules: BEYOND_RO5, profile: 'lipinski@1', prompt: 'Which molecules fail the lipinski@1 filter (more than one Rule-of-5 violation)?' },
  { id: 't10', kind: 'name', truth: 'top_mpo', molecules: SERIES, profile: 'leadlike@1', prompt: 'Under the leadlike@1 profile, which series compound has the highest MPO score?' },
  { id: 't11', kind: 'number', tol: 0.5, truth: 'descriptor', descriptor: { name: 'imipramine', key: 'MW' }, molecules: DRUGS, prompt: 'What is the molecular weight of imipramine (Da)?' },
  { id: 't12', kind: 'number', tol: 0.5, truth: 'descriptor', descriptor: { name: 'diazepam', key: 'TPSA' }, molecules: DRUGS, prompt: 'What is the TPSA of diazepam (RDKit, A^2)?' },
  { id: 't13', kind: 'number', tol: 0.05, truth: 'descriptor', descriptor: { name: 'propranolol', key: 'LogP' }, molecules: DRUGS, prompt: 'What is the Crippen LogP of propranolol?' },
  { id: 't14', kind: 'number', tol: 0.02, truth: 'descriptor', descriptor: { name: 'penicillin G', key: 'QED' }, molecules: DRUGS, prompt: 'What is the QED of penicillin G?' },
  { id: 't15', kind: 'string', truth: 'relation', molecules: SERIES, objectives: [MAX('pIC50'), MAX('solubility')], compare: ['A3', 'A7'], prompt: 'For max pIC50 and max solubility, does A3 dominate A7, does A7 dominate A3, or neither? Answer "A3", "A7" or "neither".' },
  { id: 't16', kind: 'string', truth: 'relation', molecules: DRUGS, objectives: [MIN('MW'), MIN('LogP'), MIN('TPSA')], compare: ['aspirin', 'ibuprofen'], prompt: 'Minimising MW, LogP and TPSA: does aspirin dominate ibuprofen, ibuprofen dominate aspirin, or neither?' },
  { id: 't17', kind: 'set', truth: 'tradeoff_pair', molecules: SERIES, objectives: [MAX('pIC50'), MAX('solubility'), MIN('MW')], prompt: 'Among max pIC50, max solubility and min MW, which pair of objectives is in the sharpest trade-off? Answer the two keys.' },
  { id: 't18', kind: 'number', tol: 0, truth: 'front_size', molecules: DRUGS, objectives: [MAX('QED'), MIN('TPSA'), MAX('FrCSP3')], prompt: 'How many drugs are on the Pareto front for max QED, min TPSA, max FrCSP3?' },
  {
    id: 't19', kind: 'set', truth: 'flagged', prompt: 'Another agent made these claims. Which claim ids are wrong?',
    claims: [
      { id: 'c1', smiles: 'CCO', properties: { MW: 46.07, LogP: -0.0014 } },
      { id: 'c2', smiles: 'CC(=O)Oc1ccccc1C(=O)O', properties: { MW: 194.19 } },
      { id: 'c3', smiles: 'CN1C=NC2=C1C(=O)N(C(=O)N2C)C', properties: { HBD: 0, TPSA: 61.82 } },
      { id: 'c4', smiles: 'c1ccccc1', objectives: [{ key: 'QED', direction: 'min' }] },
      { id: 'c5', smiles: 'C1=CC=CN=C1C(', properties: { MW: 80 } },
    ],
  },
  {
    id: 't20', kind: 'set', truth: 'flagged', prompt: 'Which of these descriptor claims are wrong?',
    claims: [
      { id: 'd1', smiles: 'CC(C)Cc1ccc(cc1)C(C)C(=O)O', properties: { HBD: 1, HBA: 1, RotBonds: 4 } },
      { id: 'd2', smiles: 'CC(=O)Nc1ccc(O)cc1', properties: { HBD: 3 } },
      { id: 'd3', smiles: 'CN1CCC[C@H]1c1cccnc1', properties: { MW: 162.24, Rings: 2 } },
      { id: 'd4', smiles: 'Clc1ccc2c(c1)C(=NCC(=O)N2C)c1ccccc1', properties: { AromaticRings: 3 } },
    ],
  },
];
