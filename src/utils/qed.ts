// QED (Quantitative Estimate of Drug-Likeness) - Bickerton et al., Nature Chemistry 2012
// Uses Asymmetric Double Sigmoid (ADS) functions with published parameters
// Parameters verified against canonical RDKit QED.py implementation

// Each property has [A, B, C, D, E, F, DMAX] for the ADS function
// ADS(x) = A + (B / (1 + exp(-1*(x-C+D/2)/E)) * (1 - 1/(1 + exp(-1*(x-C-D/2)/F))))
const QED_PARAMS: Record<string, number[]> = {
  MW:     [2.817065973, 392.5754953,  290.7489764, 2.419764353,  49.22325677,  65.37051707, 104.9805561],
  ALOGP:  [3.172690585, 137.8624751,  2.534937431, 4.581497897,  0.822739154,  0.576295591, 131.3186604],
  HBA:    [2.948620388, 160.4605972,  3.615294657, 4.435986202,  0.290141953,  1.300669958, 148.7763046],
  HBD:    [1.618662227, 1010.051101,  0.985094388, 0.000000001,  0.713820843,  0.920922555, 258.1632616],
  PSA:    [1.876861559, 125.2232657,  62.90773536, 87.83366614,  12.01999824,  28.51324732, 104.5686167],
  ROTB:   [0.01,        272.4121427,  2.558379970, 1.565547684,  1.271567166,  2.758063707, 105.4420403],
  AROM:   [3.217788970, 957.7374108,  2.274627939, 0.000000001,  1.317690384,  0.375760881, 312.3372610],
  // ALERTS: parameters from RDKit QED.py (canonical reference)
  // Note: ALERTS input is always 0 (no PAINS check) — scores are approximate
  ALERTS: [0.010000000, 1199.094025, -0.09002883,  0.000000001,  0.185904477,  0.875193782, 417.7253140],
};

// Weighted QED weights from Bickerton et al. 2012 (WEIGHT_MEAN)
const QED_WEIGHTS: Record<string, number> = {
  MW: 0.66, ALOGP: 0.46, HBA: 0.05, HBD: 0.61,
  PSA: 0.06, ROTB: 0.65, AROM: 0.48, ALERTS: 0.95,
};

function ads(x: number, params: number[]): number {
  const [A, B, C, D, E, F, DMAX] = params;
  const numerator = A + B / (1 + Math.exp(-1 * (x - C + D / 2) / E)) *
                    (1 - 1 / (1 + Math.exp(-1 * (x - C - D / 2) / F)));
  return numerator / DMAX;
}

export interface QEDResult {
  qed: number;
  qedWeighted: number;
  perProp: Record<string, number>;
}

export function computeQED(props: {
  MW: number; ALOGP: number; HBA: number; HBD: number;
  PSA: number; ROTB: number; AROM: number; ALERTS: number;
}): QEDResult {
  const perProp: Record<string, number> = {};
  let sumLogD = 0;
  let sumWeightedLogD = 0;
  let totalWeight = 0;

  for (const [key, params] of Object.entries(QED_PARAMS)) {
    const val = props[key as keyof typeof props];
    const d = Math.max(0, Math.min(1, ads(val, params)));
    perProp[key] = d;
    sumLogD += Math.log(Math.max(d, 1e-10));
    const w = QED_WEIGHTS[key];
    sumWeightedLogD += w * Math.log(Math.max(d, 1e-10));
    totalWeight += w;
  }

  const qed = Math.exp(sumLogD / 8);             // unweighted geometric mean
  const qedWeighted = Math.exp(sumWeightedLogD / totalWeight); // weighted

  return { qed, qedWeighted, perProp };
}
