// ParetoMol agent benchmark. Molecule rows come from benchmarks/agents/data,
// fetched from ChEMBL_37. Core-derived answers are filled by groundtruth.ts.
// Tasks with `answer` set keep that value: it is not computed from core.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { MolIn } from '@paretomol/mcp/tools';
import moleculesDoc from './data/molecules.json' with { type: 'json' };
import rdkitDoc from './data/rdkit_python.json' with { type: 'json' };
import handDoc from './data/hand_front.json' with { type: 'json' };
import tampered from './data/decision_tampered.json' with { type: 'json' };

export type AnswerKind = 'set' | 'name' | 'number' | 'string';
export type Answer = string | number | string[];
export type Compute =
  | 'front' | 'rank2' | 'unranked' | 'top_mpo' | 'filter_fail' | 'descriptor'
  | 'relation' | 'tradeoff_pair' | 'flagged' | 'front_size'
  | 'quoted_csv' | 'duplicate_ids' | 'decision_status';
export type TruthSource = 'core' | 'rdkit-python' | 'hand' | 'csv' | 'decision';

export interface BenchMol extends MolIn { chembl_id: string }

export interface Task {
  id: string;
  prompt: string;
  kind: AnswerKind;
  tol?: number;
  molecules?: BenchMol[];
  objectives?: { key: string; direction: 'min' | 'max' }[];
  profile?: string;
  compare?: [string, string];
  claims?: { id: string; smiles: string; properties?: Record<string, number>; objectives?: { key: string; direction: 'min' | 'max' }[] }[];
  descriptor?: { name: string; key: string };
  /** How the reference client answers the task. */
  truth: Compute;
  /** Where the expected value comes from. Core tasks are filled by groundtruth.ts. */
  source: TruthSource;
  /** Independent expected value. When set, ground truth is this and not a core call. */
  answer?: Answer;
  text?: string;
  record?: unknown;
}

interface Cell { value: number }
interface MolRow {
  molecule_chembl_id: string;
  name: string;
  smiles: string;
  sets: string[];
  pchembl: Record<string, Cell>;
}

const PROP: Record<string, string> = {
  EGFR: 'pchembl_egfr',
  ERBB2: 'pchembl_erbb2',
  PTGS1: 'pchembl_ptgs1',
  PTGS2: 'pchembl_ptgs2',
  HMGCR: 'pchembl_hmgcr',
  PPIA: 'pchembl_ppia',
};

const ROWS = moleculesDoc.molecules as unknown as MolRow[];

function asMol(m: MolRow): BenchMol {
  const props: Record<string, number> = {};
  for (const [sym, cell] of Object.entries(m.pchembl)) {
    const key = PROP[sym];
    if (!key) throw new Error(`no property name for ${sym}`);
    props[key] = cell.value;
  }
  return { smiles: m.smiles, name: m.name, chembl_id: m.molecule_chembl_id, props };
}

export const PANEL: BenchMol[] = ROWS.map(asMol);
export const KINASE: BenchMol[] = ROWS.filter((m) => m.sets.includes('kinase')).map(asMol);

const MIN = (key: string) => ({ key, direction: 'min' as const });
const MAX = (key: string) => ({ key, direction: 'max' as const });

function rdkit(id: string) {
  const row = rdkitDoc.molecules.find((m) => m.molecule_chembl_id === id);
  if (!row) throw new Error(`rdkit row missing: ${id}`);
  return row;
}

const quotedText = readFileSync(fileURLToPath(new URL('./data/quoted.csv', import.meta.url)), 'utf8');
const duplicateText = readFileSync(fileURLToPath(new URL('./data/duplicate.csv', import.meta.url)), 'utf8');

const HAND: BenchMol[] = handDoc.molecules.map((m) => ({
  smiles: m.smiles,
  name: m.name,
  chembl_id: m.molecule_chembl_id,
  props: { pchembl_egfr: m.pchembl_egfr, pchembl_erbb2: m.pchembl_erbb2 },
}));

const smiles = (id: string) => {
  const m = ROWS.find((r) => r.molecule_chembl_id === id);
  if (!m) throw new Error(id);
  return m.smiles;
};

export const TASKS: Task[] = [
  { id: 't01', kind: 'set', source: 'core', truth: 'front', molecules: PANEL, objectives: [MIN('MW'), MIN('LogP'), MIN('TPSA')], prompt: 'Which molecules are on the Pareto front minimising MW, LogP and TPSA?' },
  { id: 't02', kind: 'set', source: 'core', truth: 'front', molecules: PANEL, objectives: [MAX('QED'), MIN('MW')], prompt: 'Which molecules are Pareto-optimal for maximising QED and minimising MW?' },
  { id: 't03', kind: 'set', source: 'core', truth: 'front', molecules: KINASE, objectives: [MAX('pchembl_egfr'), MAX('pchembl_erbb2')], prompt: 'Which kinase inhibitors are on the Pareto front for maximum EGFR pChEMBL and maximum ERBB2 pChEMBL?' },
  { id: 't04', kind: 'set', source: 'core', truth: 'front', molecules: KINASE, objectives: [MAX('pchembl_egfr'), MIN('LogP'), MIN('MW')], prompt: 'Which kinase inhibitors are on the front for maximum EGFR pChEMBL, minimum LogP and minimum MW?' },
  { id: 't05', kind: 'set', source: 'core', truth: 'rank2', molecules: KINASE, objectives: [MAX('pchembl_egfr'), MAX('pchembl_erbb2')], prompt: 'Which compounds form the second Pareto front (rank 2) for maximum EGFR pChEMBL and maximum ERBB2 pChEMBL?' },
  { id: 't06', kind: 'set', source: 'core', truth: 'unranked', molecules: KINASE, objectives: [MAX('pchembl_egfr'), MAX('pchembl_erbb2')], prompt: 'Which compounds cannot be ranked for maximum EGFR pChEMBL and maximum ERBB2 pChEMBL because a value is missing?' },
  { id: 't07', kind: 'name', source: 'core', truth: 'top_mpo', molecules: PANEL, profile: 'oral@1', prompt: 'Under the oral@1 profile, which molecule has the highest MPO score?' },
  { id: 't08', kind: 'name', source: 'core', truth: 'top_mpo', molecules: KINASE, profile: 'cns@1', prompt: 'Under the cns@1 profile, which kinase inhibitor has the highest MPO score?' },
  { id: 't09', kind: 'set', source: 'core', truth: 'filter_fail', molecules: PANEL, profile: 'lipinski@1', prompt: 'Which molecules fail the lipinski@1 filter (more than one Rule-of-5 violation)?' },
  { id: 't10', kind: 'name', source: 'core', truth: 'top_mpo', molecules: PANEL, profile: 'leadlike@1', prompt: 'Under the leadlike@1 profile, which molecule has the highest MPO score?' },
  { id: 't11', kind: 'number', tol: 0.5, source: 'core', truth: 'descriptor', descriptor: { name: 'cyclosporine', key: 'MW' }, molecules: PANEL, prompt: 'What is the average molecular weight of cyclosporine (Da)?' },
  { id: 't12', kind: 'number', tol: 0.5, source: 'core', truth: 'descriptor', descriptor: { name: 'aspirin', key: 'TPSA' }, molecules: PANEL, prompt: 'What is the TPSA of aspirin (RDKit, A^2)?' },
  { id: 't13', kind: 'number', tol: 0.05, source: 'core', truth: 'descriptor', descriptor: { name: 'ibuprofen', key: 'LogP' }, molecules: PANEL, prompt: 'What is the Crippen LogP of ibuprofen?' },
  { id: 't14', kind: 'number', tol: 0.02, source: 'core', truth: 'descriptor', descriptor: { name: 'gefitinib', key: 'QED' }, molecules: PANEL, prompt: 'What is the QED of gefitinib?' },
  { id: 't15', kind: 'string', source: 'core', truth: 'relation', molecules: KINASE, objectives: [MAX('pchembl_egfr'), MAX('pchembl_erbb2')], compare: ['gefitinib', 'lapatinib'], prompt: 'For maximum EGFR pChEMBL and maximum ERBB2 pChEMBL, does gefitinib dominate lapatinib, does lapatinib dominate gefitinib, or neither? Answer "gefitinib", "lapatinib" or "neither".' },
  { id: 't16', kind: 'string', source: 'core', truth: 'relation', molecules: PANEL, objectives: [MIN('MW'), MIN('LogP'), MIN('TPSA')], compare: ['aspirin', 'cyclosporine'], prompt: 'Minimising MW, LogP and TPSA: does aspirin dominate cyclosporine, cyclosporine dominate aspirin, or neither? Answer "aspirin", "cyclosporine" or "neither".' },
  { id: 't17', kind: 'set', source: 'core', truth: 'tradeoff_pair', molecules: KINASE, objectives: [MAX('pchembl_egfr'), MAX('pchembl_erbb2'), MIN('MW')], prompt: 'Among maximum EGFR pChEMBL, maximum ERBB2 pChEMBL and minimum MW, which pair of objectives is in the sharpest trade-off? Answer the two keys.' },
  { id: 't18', kind: 'number', tol: 0, source: 'core', truth: 'front_size', molecules: PANEL, objectives: [MAX('QED'), MIN('TPSA'), MAX('FrCSP3')], prompt: 'How many molecules are on the Pareto front for maximum QED, minimum TPSA and maximum FrCSP3?' },
  {
    id: 't19', kind: 'set', source: 'core', truth: 'flagged', prompt: 'Another agent made these claims about ChEMBL_37 structures. Which claim ids are wrong?',
    claims: [
      { id: 'c1', smiles: smiles('CHEMBL939'), properties: { MW: 446.91, LogP: 4.28 } },
      { id: 'c2', smiles: smiles('CHEMBL160'), properties: { MW: 500 } },
      { id: 'c3', smiles: smiles('CHEMBL25'), properties: { HBD: 5 } },
      { id: 'c4', smiles: 'c1ccccc1', objectives: [{ key: 'QED', direction: 'min' }] },
      { id: 'c5', smiles: 'C1=CC=CN=C1C(', properties: { MW: 80 } },
    ],
  },
  {
    id: 't20', kind: 'set', source: 'core', truth: 'flagged', prompt: 'Which of these descriptor claims are wrong?',
    claims: [
      { id: 'd1', smiles: smiles('CHEMBL521'), properties: { HBD: 1, HBA: 2, RotBonds: 4 } },
      { id: 'd2', smiles: smiles('CHEMBL25'), properties: { HBD: 4 } },
      { id: 'd3', smiles: smiles('CHEMBL553'), properties: { MW: 393.44, Rings: 3 } },
      { id: 'd4', smiles: smiles('CHEMBL24828'), properties: { AromaticRings: 9 } },
    ],
  },
  { id: 't21', kind: 'number', tol: 0.01, source: 'rdkit-python', truth: 'descriptor', answer: rdkit('CHEMBL939').MW, descriptor: { name: 'gefitinib', key: 'MW' }, molecules: PANEL, prompt: 'What is the RDKit Descriptors.MolWt of gefitinib (Da)? The reference value is from RDKit Python 2026.03.4.' },
  { id: 't22', kind: 'number', tol: 0.01, source: 'rdkit-python', truth: 'descriptor', answer: rdkit('CHEMBL554').LogP, descriptor: { name: 'lapatinib', key: 'LogP' }, molecules: PANEL, prompt: 'What is the RDKit Crippen MolLogP of lapatinib? The reference value is from RDKit Python 2026.03.4.' },
  { id: 't23', kind: 'number', tol: 0.01, source: 'rdkit-python', truth: 'descriptor', answer: rdkit('CHEMBL160').TPSA, descriptor: { name: 'cyclosporine', key: 'TPSA' }, molecules: PANEL, prompt: 'What is the RDKit Descriptors.TPSA of cyclosporine? The reference value is from RDKit Python 2026.03.4.' },
  {
    id: 't24', kind: 'set', source: 'hand', truth: 'front', answer: [...handDoc.front].sort(),
    molecules: HAND, objectives: handDoc.objectives as { key: string; direction: 'min' | 'max' }[],
    prompt: 'Hand-checked subset. Which molecules are on the Pareto front for maximum EGFR pChEMBL and minimum ERBB2 pChEMBL?',
  },
  {
    id: 't25', kind: 'set', source: 'csv', truth: 'quoted_csv', answer: ['erlotinib', 'gefitinib, free base'],
    text: quotedText, objectives: [MAX('potency'), MIN('bulk')],
    prompt: 'This CSV quotes fields that contain commas. Which molecules are on the Pareto front for maximum potency and minimum bulk? Answer the name cells.',
  },
  {
    id: 't26', kind: 'set', source: 'csv', truth: 'duplicate_ids', answer: ['gefitinib', 'gefitinib~2'],
    text: duplicateText, objectives: [MAX('potency')],
    prompt: 'Two rows share the name gefitinib. What molecule ids does a decision record assign, in the documented name / name~2 scheme?',
  },
  {
    id: 't27', kind: 'string', source: 'decision', truth: 'decision_status', answer: 'fail',
    record: tampered,
    prompt: 'This decision record was edited after export: results[0].mpo was increased by 1 and recordHash was left unchanged. Does verification pass or fail? Answer "pass" or "fail".',
  },
];
