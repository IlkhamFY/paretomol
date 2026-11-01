/** MPO tab buttons and the versioned profile each one writes into a decision record. */
export const MPO_PROFILE_REFS = {
  oral: 'oral@1',
  cns: 'cns@1',
  leadlike: 'leadlike@1',
  custom: 'custom@1',
} as const;

export type MpoProfileKey = keyof typeof MPO_PROFILE_REFS;

export function mpoKeyForRef(ref: string): MpoProfileKey | null {
  for (const [key, value] of Object.entries(MPO_PROFILE_REFS) as [MpoProfileKey, string][]) {
    if (value === ref) return key;
  }
  return null;
}
