// ─── Synthetic complexity (transparent client-side make-ability heuristic) ────
// A fast, interpretable estimate of synthetic difficulty (1 = trivial, 10 = very
// hard) from structural drivers chemists recognize: stereocenters, spiro/
// bridged/non-aromatic ring systems, molecular size, and 3-D (sp3) character.
// A triage proxy — NOT a retrosynthetic route or building-block price (those are
// the planned opt-in cost tier). Lower = easier / cheaper to make.

export interface SynthComplexity { score: number; factors: string[]; }

/** Synthetic-complexity score (1–10) + dominant contributing factors, from an
 *  RDKit get_descriptors() object. */
export function syntheticComplexityFromDescriptors(desc: Record<string, number>): SynthComplexity {
  const stereo = desc.NumAtomStereoCenters || 0;          // total potential stereocenters
  const spiro = desc.NumSpiroAtoms || 0;
  const bridge = desc.NumBridgeheadAtoms || 0;
  const nonAromRings = (desc.NumAliphaticRings || 0) + (desc.NumSaturatedRings || 0);
  const heavy = desc.NumHeavyAtoms || desc.HeavyAtomCount || 0;
  const fsp3 = desc.FractionCSP3 || 0;

  const raw = 1.0
    + 0.90 * stereo
    + 1.30 * spiro
    + 1.30 * bridge
    + 0.40 * nonAromRings
    + 0.10 * Math.max(0, heavy - 28)
    + 1.20 * fsp3;
  // Saturating map to 1–10 (T tuned so stereocenter-rich natural products ≈ 10).
  const score = 1 + 9 * (1 - Math.exp(-(raw - 1) / 6.6));

  const contrib = [
    { label: `${stereo} stereocentre${stereo === 1 ? '' : 's'}`, w: 0.90 * stereo },
    { label: `${bridge} bridgehead atom${bridge === 1 ? '' : 's'}`, w: 1.30 * bridge },
    { label: `${spiro} spiro atom${spiro === 1 ? '' : 's'}`, w: 1.30 * spiro },
    { label: `${nonAromRings} non-aromatic ring${nonAromRings === 1 ? '' : 's'}`, w: 0.40 * nonAromRings },
    { label: 'large size', w: 0.10 * Math.max(0, heavy - 28) },
    { label: 'high 3-D (sp³) character', w: 1.20 * fsp3 },
  ];
  const factors = contrib.filter(c => c.w >= 0.45).sort((a, b) => b.w - a.w).slice(0, 3).map(c => c.label);
  return { score: Math.min(10, Math.max(1, score)), factors };
}
