// Sigmoid desirability functions for MPO scoring
// Based on logistic curves - industry standard (Schrodinger LiveDesign)

export interface Transition {
  center: number;
  rate: number;
}

// GOOD_Y = 0.9 (the desirability value at the "good" threshold)
// BAD_Y = 0.1 (the desirability value at the "bad" threshold)
const GOOD_Y = 0.9;

export function getRate(good: number, bad: number): number {
  const logit = Math.log(GOOD_Y / (1 - GOOD_Y)); // ln(9) ~ 2.197
  return (2 * logit) / (good - bad);
}

export function getCenter(good: number, bad: number): number {
  return (good + bad) / 2;
}

export function sigmoid(x: number, center: number, rate: number): number {
  return 1 / (1 + Math.exp(-rate * (x - center)));
}

export function doubleSigmoid(
  x: number,
  centerA: number, rateA: number,
  centerB: number, rateB: number
): number {
  const sA = sigmoid(x, centerA, rateA);
  const sB = sigmoid(x, centerB, rateB);
  return sA * sB;
}

/** Create a double sigmoid desirability function from 4 thresholds.
 *  Uses the same (acceptMin, idealMin, idealMax, acceptMax) interface as the trapezoid.
 *  Left sigmoid: ascending from acceptMin to idealMin
 *  Right sigmoid: descending from idealMax to acceptMax
 */
export function doubleSigmoidDesirability(
  x: number,
  acceptMin: number,
  idealMin: number,
  idealMax: number,
  acceptMax: number
): number {
  // Left ascending sigmoid: good=idealMin, bad=acceptMin
  const rate1 = getRate(idealMin, acceptMin);
  const center1 = getCenter(idealMin, acceptMin);

  // Right descending sigmoid: good=idealMax, bad=acceptMax
  // FIX: getRate(idealMax, acceptMax) gives negative rate → descending curve
  const rate2 = getRate(idealMax, acceptMax);
  const center2 = getCenter(idealMax, acceptMax);

  return doubleSigmoid(x, center1, rate1, center2, rate2);
}

// ─── Profile-based MPO scoring ──────────────────────────────────────────────

/** Desirability window for one property: 1 inside [idealMin, idealMax],
 *  falling to 0 at acceptMin / acceptMax. */
export interface PropDesirability {
  idealMin: number;
  idealMax: number;
  acceptMin: number;
  acceptMax: number;
}

export type CurveType = 'linear' | 'sigmoid';

/** Piecewise-linear (trapezoid) desirability. */
export function linearDesirability(value: number, d: PropDesirability): number {
  if (value < d.acceptMin || value > d.acceptMax) return 0;
  if (value >= d.idealMin && value <= d.idealMax) return 1;
  if (value < d.idealMin) {
    const range = d.idealMin - d.acceptMin;
    return range <= 0 ? 1 : (value - d.acceptMin) / range;
  }
  const range = d.acceptMax - d.idealMax;
  return range <= 0 ? 1 : (d.acceptMax - value) / range;
}

export function sigmoidDesirability(value: number, d: PropDesirability): number {
  return doubleSigmoidDesirability(value, d.acceptMin, d.idealMin, d.idealMax, d.acceptMax);
}

export function desirability(value: number, d: PropDesirability, curveType: CurveType = 'linear'): number {
  return curveType === 'sigmoid' ? sigmoidDesirability(value, d) : linearDesirability(value, d);
}

/** Geometric mean with a 0.01 floor so one bad property does not zero the score. */
export function geometricMean(values: number[]): number {
  if (values.length === 0) return 0;
  const product = values.reduce((acc, v) => acc * Math.max(v, 0.01), 1);
  return Math.pow(product, 1 / values.length);
}

/** MPO score: geometric mean of per-property desirabilities over the keys of `profile`
 *  that have a finite value in `props`. */
export function mpoScore(
  props: Record<string, number | undefined>,
  profile: Record<string, PropDesirability>,
  curveType: CurveType = 'linear',
): { score: number; perProp: Record<string, number> } {
  const perProp: Record<string, number> = {};
  const ds: number[] = [];
  for (const [key, d] of Object.entries(profile)) {
    const v = props[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const dv = desirability(v, d, curveType);
    perProp[key] = dv;
    ds.push(dv);
  }
  return { score: geometricMean(ds), perProp };
}
