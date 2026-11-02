import { describe, it, expect } from 'vitest';
import { computeQED } from '../qed';
import { QED_ALERT_SMARTS } from '../../data/qedAlerts';

/**
 * QED tests.
 *
 * Reference values come from RDKit's rdkit.Chem.QED.qed() called with the same
 * descriptors the application feeds it (see paper/scripts/validate_qed.py), so
 * these pin the arithmetic against the canonical implementation rather than
 * against a value this project computed for itself.
 */

const CASES = [
  { name: 'aspirin',      MW: 180.1590, ALOGP:  1.3101, HBA: 3, HBD: 1, PSA:  63.6000, ROTB:  2, AROM: 1, ALERTS: 2, expected: 0.550860 },
  { name: 'caffeine',     MW: 194.1940, ALOGP: -1.0293, HBA: 3, HBD: 0, PSA:  61.8200, ROTB:  0, AROM: 2, ALERTS: 0, expected: 0.538463 },
  { name: 'ibuprofen',    MW: 206.2850, ALOGP:  3.0732, HBA: 1, HBD: 1, PSA:  37.3000, ROTB:  4, AROM: 1, ALERTS: 0, expected: 0.807228 },
  { name: 'nitrobenzene', MW: 123.1110, ALOGP:  1.5948, HBA: 2, HBD: 0, PSA:  43.1400, ROTB:  1, AROM: 1, ALERTS: 2, expected: 0.420076 },
  { name: 'atorvastatin', MW: 558.6500, ALOGP:  6.3136, HBA: 4, HBD: 4, PSA: 111.7900, ROTB: 12, AROM: 4, ALERTS: 0, expected: 0.163175 },
];

describe('QED matches the canonical RDKit implementation', () => {
  for (const c of CASES) {
    it(`reproduces RDKit QED for ${c.name}`, () => {
      const { qedWeighted } = computeQED(c);
      expect(qedWeighted).toBeCloseTo(c.expected, 5);
    });
  }
});

describe('the structural-alert term', () => {
  it('lowers QED as alerts accumulate', () => {
    // The defect this replaces pinned ALERTS to 0 for every molecule, which is
    // the argmax over the attainable domain, so every score was inflated.
    const base = { MW: 300, ALOGP: 2, HBA: 4, HBD: 2, PSA: 60, ROTB: 4, AROM: 2 };
    const scores = [0, 1, 2, 3, 5].map(ALERTS => computeQED({ ...base, ALERTS }).qedWeighted);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThan(scores[i - 1]);
    }
  });

  it('is materially different from pinning alerts to zero', () => {
    // Aspirin matches two canonical QED alerts; the previous behaviour scored
    // it as though it matched none.
    const aspirin = CASES[0];
    const withAlerts = computeQED(aspirin).qedWeighted;
    const withoutAlerts = computeQED({ ...aspirin, ALERTS: 0 }).qedWeighted;
    expect(withoutAlerts).toBeGreaterThan(withAlerts);
    expect(withoutAlerts - withAlerts).toBeGreaterThan(0.05);
  });

  it('keeps QED within [0, 1] across the attainable alert range', () => {
    const base = { MW: 350, ALOGP: 3, HBA: 5, HBD: 2, PSA: 70, ROTB: 5, AROM: 2 };
    for (let ALERTS = 0; ALERTS <= 12; ALERTS++) {
      const q = computeQED({ ...base, ALERTS }).qedWeighted;
      expect(q).toBeGreaterThanOrEqual(0);
      expect(q).toBeLessThanOrEqual(1);
    }
  });
});

describe('the canonical QED alert catalogue', () => {
  it('carries the full reference list', () => {
    // RDKit's rdkit.Chem.QED.StructuralAlertSmarts defines exactly 116
    // patterns. A short list would silently deflate every alert count.
    expect(QED_ALERT_SMARTS).toHaveLength(116);
  });

  it('contains no duplicates or empty patterns', () => {
    expect(new Set(QED_ALERT_SMARTS).size).toBe(QED_ALERT_SMARTS.length);
    expect(QED_ALERT_SMARTS.every(s => s.trim().length > 0)).toBe(true);
  });

  it('is distinct from the PAINS/Brenk/NIH catalogue used elsewhere', () => {
    // Substituting the application's own alert catalogue would give a count
    // that is wrong in a different way; the two lists only partly overlap.
    expect(QED_ALERT_SMARTS).toContain('*1[O,S,N]*1');
  });
});
