// Hard constraints prune. Objectives rank what remains.
// A missing value fails a constraint that names that column. A predicted
// column is still a gate, and the reason says so.

import type { Molecule } from './types.js';
import type { ParetoObjective } from './types.js';
import { computeParetoAndDominance, getMolValue } from './pareto.js';

export type ConstraintOp = '<=' | '>=' | '<' | '>';

export interface Constraint {
  key: string;
  op: ConstraintOp;
  value: number;
  /** The column is a model output, not a measurement. */
  predicted?: boolean;
}

const OPS: ConstraintOp[] = ['<=', '>=', '<', '>'];

export function isConstraint(value: unknown): value is Constraint {
  if (!value || typeof value !== 'object') return false;
  const c = value as Constraint;
  return typeof c.key === 'string' && c.key.length > 0
    && OPS.includes(c.op)
    && typeof c.value === 'number' && Number.isFinite(c.value)
    && (c.predicted === undefined || typeof c.predicted === 'boolean');
}

export function passesConstraint(value: number, c: Constraint): boolean {
  if (c.op === '<=') return value <= c.value;
  if (c.op === '>=') return value >= c.value;
  if (c.op === '<') return value < c.value;
  return value > c.value;
}

function fmt(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 100) return String(Math.round(n));
  if (abs >= 10) return String(Math.round(n * 10) / 10);
  return String(Math.round(n * 100) / 100);
}

/** Why this molecule fails the constraint, or null when it passes. */
export function constraintFailure(mol: Molecule, c: Constraint): string | null {
  const predicted = c.predicted ? ' (predicted)' : '';
  const v = getMolValue(mol, c.key);
  if (v === null) return `missing ${c.key}${predicted}`;
  if (passesConstraint(v, c)) return null;
  return `${c.key} ${fmt(v)} is not ${c.op} ${c.value}${predicted}`;
}

export interface ConstraintReport {
  eligible: boolean[];
  reasons: string[][];
}

export function explainConstraints(molecules: Molecule[], constraints: readonly Constraint[]): ConstraintReport {
  const eligible: boolean[] = [];
  const reasons: string[][] = [];
  for (const mol of molecules) {
    const why = constraints.map((c) => constraintFailure(mol, c)).filter((s): s is string => s !== null);
    reasons.push(why);
    eligible.push(why.length === 0);
  }
  return { eligible, reasons };
}

/** Rank `objectives` on the molecules that pass `constraints`. Others stay unranked, with `excluded` set. */
export function rankUnder(
  molecules: Molecule[],
  objectives: ParetoObjective[] | undefined,
  constraints: readonly Constraint[] = [],
): void {
  const report = explainConstraints(molecules, constraints);
  computeParetoAndDominance(molecules, objectives, constraints.length ? report.eligible : undefined);
  molecules.forEach((m, i) => {
    if (report.reasons[i].length) m.excluded = report.reasons[i];
    else delete m.excluded;
  });
}

/** One sentence for the plot. Empty when nothing was pruned. */
export function pruneSummary(molecules: Molecule[]): string | null {
  const pruned = molecules.filter((m) => m.excluded && m.excluded.length > 0);
  if (pruned.length === 0) return null;
  const sample = pruned.slice(0, 3).map((m) => `${m.name.replace(/_/g, ' ')}: ${m.excluded!.join('; ')}`);
  const more = pruned.length > 3 ? `, and ${pruned.length - 3} more` : '';
  return `Pruned ${pruned.length}. ${sample.join('. ')}${more}.`;
}

/** Lipinski rules as hard gates. A missing value fails. One violation is enough. */
export const LIPINSKI_CONSTRAINTS: readonly Constraint[] = Object.freeze([
  { key: 'MW', op: '<=', value: 500 },
  { key: 'LogP', op: '<=', value: 5 },
  { key: 'HBD', op: '<=', value: 5 },
  { key: 'HBA', op: '<=', value: 10 },
]);
