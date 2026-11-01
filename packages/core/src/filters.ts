import type { FilterResult, MolProps } from './types.js';
import { DRUG_FILTERS } from './types.js';

/** Evaluate one named drug-likeness filter (see DRUG_FILTERS) against a property bag. */
export function checkFilter(filterName: string, props: MolProps | Record<string, number>): FilterResult {
  const bag = props as Record<string, number>;
  const filter = DRUG_FILTERS[filterName as keyof typeof DRUG_FILTERS];
  if (!filter) return { pass: false, violations: 0 };
  let violations = 0;
  for (const rule of filter.rules) {
    const val = bag[rule.key];
    if (rule.op === '<=' && val > rule.val) violations++;
    else if (rule.op === '>=' && val < rule.val) violations++;
    else if (rule.op === '<' && val >= rule.val) violations++;
    else if (rule.op === '>' && val <= rule.val) violations++;
  }
  return { pass: violations <= filter.maxViolations, violations };
}
