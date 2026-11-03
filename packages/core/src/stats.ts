/**
 * Client-side statistical tests for Scaffold Intelligence.
 * No external dependencies -- pure TypeScript.
 */

/** Mann-Whitney U test (two-tailed). Returns { U, z, p } */
export function mannWhitneyU(
  a: number[],
  b: number[]
): { U: number; z: number; p: number } {
  const n1 = a.length;
  const n2 = b.length;
  if (n1 === 0 || n2 === 0) return { U: 0, z: 0, p: 1 };

  // Combine and rank
  const combined = [
    ...a.map((v) => ({ v, group: 0 })),
    ...b.map((v) => ({ v, group: 1 })),
  ];
  combined.sort((x, y) => x.v - y.v);

  // Assign ranks with tie correction
  const n = combined.length;
  const ranks = new Array<number>(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n && combined[j].v === combined[i].v) j++;
    const avgRank = (i + 1 + j) / 2; // 1-indexed average
    for (let k = i; k < j; k++) ranks[k] = avgRank;
    i = j;
  }

  // Sum ranks for group a
  let R1 = 0;
  for (let k = 0; k < n; k++) {
    if (combined[k].group === 0) R1 += ranks[k];
  }

  const U1 = R1 - (n1 * (n1 + 1)) / 2;
  const U2 = n1 * n2 - U1;
  const U = Math.min(U1, U2);

  // Normal approximation (valid for n1, n2 >= 5)
  const mu = (n1 * n2) / 2;
  const sigma = Math.sqrt((n1 * n2 * (n1 + n2 + 1)) / 12);
  if (sigma === 0) return { U, z: 0, p: 1 };

  const z = (U1 - mu) / sigma;
  // Two-tailed p-value using standard normal approximation
  const p = 2 * (1 - normalCDF(Math.abs(z)));
  return { U, z, p };
}

/** Standard normal CDF approximation (Abramowitz & Stegun 26.2.17) */
function normalCDF(x: number): number {
  if (x < -8) return 0;
  if (x > 8) return 1;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + p * Math.abs(x));
  const y =
    1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-0.5 * x * x);
  return 0.5 * (1 + sign * y);
}

/** Significance level for display */
export function sigStars(p: number): string {
  if (p < 0.001) return '***';
  if (p < 0.01) return '**';
  if (p < 0.05) return '*';
  return '';
}

/** Bonferroni-corrected significance */
export function bonferroniSig(p: number, nTests: number): string {
  const corrP = Math.min(p * nTests, 1);
  return sigStars(corrP);
}
