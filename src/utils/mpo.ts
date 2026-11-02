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
