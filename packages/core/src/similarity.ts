import type { Molecule } from './types.js';

// ─── Packed fingerprint utilities ────────────────────────────────────────────
const EMPTY_FP_PACKED = new Uint32Array(64); // 2048 bits / 32

/** Pack a '0'/'1' bit-string fingerprint into a Uint32Array for fast bitwise ops. */
export function packFingerprint(fp: string): Uint32Array {
  if (!fp || fp.length === 0) return EMPTY_FP_PACKED;
  const packed = new Uint32Array(Math.ceil(fp.length / 32));
  for (let i = 0; i < fp.length; i++) {
    if (fp.charCodeAt(i) === 49) { // '1'
      packed[i >>> 5] |= (1 << (i & 31));
    }
  }
  return packed;
}

/** Popcount (Hamming weight) for a 32-bit integer. */
function popcount32(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24;
}

/** Fast Tanimoto using packed Uint32Array fingerprints. */
export function tanimotoPacked(a: Uint32Array, b: Uint32Array): number {
  let inter = 0, union = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    inter += popcount32(a[i] & b[i]);
    union += popcount32(a[i] | b[i]);
  }
  return union === 0 ? 0 : inter / union;
}

/** Compute n×n Tanimoto similarity matrix from molecules (fast packed fingerprints). */
export function computeTanimotoMatrix(molecules: Molecule[]): number[][] {
  const n = molecules.length;
  const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      const t = tanimotoPacked(molecules[i].fpPacked, molecules[j].fpPacked);
      matrix[i][j] = matrix[j][i] = t;
    }
  }
  return matrix;
}

/** Diversity score = mean(1 - T) over upper triangle. Higher = more diverse. */
export function getDiversityScore(matrix: number[][]): number {
  const n = matrix.length;
  if (n < 2) return 0;
  let sum = 0, count = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      sum += 1 - matrix[i][j];
      count++;
    }
  }
  return count === 0 ? 0 : sum / count;
}
