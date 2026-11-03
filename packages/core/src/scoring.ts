// One scoring contract for Pareto, MPO and the decision record.
//
// A profile's desirability windows are the default objectives: higher
// desirability is better. Plain minimize / maximize is used only when the
// user picks it, or by the paper reproduction preset, which repeats the
// all-minimize directions of the Digital Discovery FDA figures.

import { inferObjectives, isPotencyColumn } from './objectives.js';
import type { PropDesirability } from './mpo.js';
import { getProfile, type ResolvedProfile, type ScoringProfile } from './profiles.js';
import type { ObjectiveWindow, ParetoObjective } from './types.js';

export const PAPER_PRESET = 'paper' as const;

/** Six physicochemical properties, all minimized. Matches paper/fda_pareto_summary.json p6. */
export const PAPER_REPRODUCTION_OBJECTIVES: readonly ParetoObjective[] = Object.freeze([
  { key: 'MW', direction: 'min' },
  { key: 'LogP', direction: 'min' },
  { key: 'HBD', direction: 'min' },
  { key: 'HBA', direction: 'min' },
  { key: 'TPSA', direction: 'min' },
  { key: 'RotBonds', direction: 'min' },
]);

export const WINDOW_PRESETS = ['oral@1', 'cns@1', 'leadlike@1'] as const;
export type WindowPreset = (typeof WINDOW_PRESETS)[number];
export type ScoringPreset = WindowPreset | typeof PAPER_PRESET | 'custom';

export function windowObjectives(desirability: Record<string, PropDesirability | ObjectiveWindow>): ParetoObjective[] {
  return Object.entries(desirability).map(([key, window]) => ({
    key,
    direction: 'max' as const,
    window: {
      acceptMin: window.acceptMin,
      acceptMax: window.acceptMax,
      idealMin: window.idealMin,
      idealMax: window.idealMax,
    },
  }));
}

/** Desirability windows of a profile. This is the front, not profile.objectives. */
export function contractObjectives(profile: ScoringProfile | ResolvedProfile): ParetoObjective[] {
  return windowObjectives(profile.desirability);
}

/**
 * Potency columns only. A p-scaled column wins over the raw concentration of
 * the same import, so IC50 and pIC50 are not both objectives.
 */
export function potencyObjectives(names: string[]): ParetoObjective[] {
  const all = inferObjectives(names).filter((o) => isPotencyColumn(o.key));
  const pScaled = all.filter((o) => o.direction === 'max');
  return pScaled.length > 0 ? pScaled : all;
}

export function objectivesForPreset(
  preset: ScoringPreset | string,
  extraNames: string[] = [],
  customWindows?: Record<string, PropDesirability | ObjectiveWindow> | null,
): ParetoObjective[] {
  const potency = potencyObjectives(extraNames);
  const base = preset === PAPER_PRESET
    ? PAPER_REPRODUCTION_OBJECTIVES.map((o) => ({ ...o }))
    : preset === 'custom' && customWindows
      ? windowObjectives(customWindows)
      : contractObjectives(getProfile(preset === 'custom' ? 'oral@1' : preset));
  const have = new Set(base.map((o) => o.key));
  return [...base, ...potency.filter((o) => !have.has(o.key))];
}

export function presetLabel(preset: ScoringPreset | string): string {
  if (preset === PAPER_PRESET) return 'Paper reproduction';
  if (preset === 'custom') return 'Custom windows';
  return getProfile(preset).label;
}

export function presetBlurb(preset: ScoringPreset | string): string {
  if (preset === PAPER_PRESET) {
    return 'Paper reproduction minimizes MW, LogP, HBD, HBA, TPSA and rotatable bonds, the directions in the Digital Discovery FDA figures.';
  }
  if (preset === 'custom') {
    return 'Custom windows. Higher desirability inside each band is better.';
  }
  const label = getProfile(preset).label;
  return `${label} windows. Higher desirability inside each band is better. The same windows score MPO.`;
}

/** Cycle window, then minimize, then maximize, then back to the profile window when one exists. */
export function cycleObjective(obj: ParetoObjective, windows?: Record<string, ObjectiveWindow> | null): ParetoObjective {
  if (obj.window) return { key: obj.key, direction: 'min' };
  if (obj.direction === 'min') return { key: obj.key, direction: 'max' };
  const w = windows?.[obj.key];
  if (w) return { key: obj.key, direction: 'max', window: { ...w } };
  return { key: obj.key, direction: 'min' };
}

export function directionWord(obj: ParetoObjective): string {
  if (obj.window) return 'window';
  return obj.direction === 'min' ? 'minimize' : 'maximize';
}

/** Objective to add when the user checks a property that the active profile windows. */
export function checkedObjective(key: string, windows?: Record<string, ObjectiveWindow> | null, fallback: 'min' | 'max' = 'min'): ParetoObjective {
  const w = windows?.[key];
  if (w) return { key, direction: 'max', window: { ...w } };
  return { key, direction: fallback };
}
