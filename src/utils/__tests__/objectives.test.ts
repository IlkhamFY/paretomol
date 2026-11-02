import { describe, it, expect } from 'vitest';
import { inferObjectiveDirection, inferObjectives } from '../objectives';

describe('objective direction inference', () => {
  it('minimises raw activity and affinity concentrations', () => {
    for (const n of ['IC50', 'ic50_nM', 'EC50', 'Ki', 'Kd', 'MIC', 'GI50']) {
      expect(inferObjectiveDirection(n), n).toBe('min');
    }
  });

  it('leaves convention-dependent quantities unresolved rather than guessing', () => {
    // LD50 in mg/kg is safer when higher; on the log(1/mol/kg) scale used by
    // several predictors it is more toxic when higher. Asking beats asserting.
    expect(inferObjectiveDirection('LD50')).toBeNull();
  });

  it('maximises p-scaled activities, which invert the raw direction', () => {
    // A higher pIC50 means a lower IC50 and greater potency. The previous
    // unanchored pattern saw the substring "ic50" and minimised these.
    for (const n of ['pIC50', 'pKi', 'pKd', 'pEC50', 'pChEMBL', 'pchembl_value']) {
      expect(inferObjectiveDirection(n), n).toBe('max');
    }
  });

  it('does not match activity tokens inside unrelated words', () => {
    // "ki" inside "kinase_family" / "skin_reaction" previously forced 'min'.
    for (const n of ['kinase_family', 'skin_reaction', 'kind', 'making']) {
      expect(inferObjectiveDirection(n), n).not.toBe('min');
    }
  });

  it('rejects metadata columns outright', () => {
    for (const n of ['assay_id', 'confidence', 'year', 'chembl_id', 'standard_units', 'doi']) {
      expect(inferObjectiveDirection(n), n).toBeNull();
    }
  });

  it('minimises safety liabilities', () => {
    for (const n of ['hERG', 'DILI', 'ClinTox', 'toxicity', 'Ames', 'clearance', 'price']) {
      expect(inferObjectiveDirection(n), n).toBe('min');
    }
  });

  it('maximises favourable ADME properties', () => {
    for (const n of ['solubility', 'permeability', 'bioavailability', 'absorption']) {
      expect(inferObjectiveDirection(n), n).toBe('max');
    }
  });

  it('treats a toxicity score as a liability, not a score to maximise', () => {
    expect(inferObjectiveDirection('toxicity_score')).toBe('min');
    expect(inferObjectiveDirection('tox_risk_score')).toBe('min');
  });

  it('returns null rather than guessing on unrecognised names', () => {
    for (const n of ['batch', 'notes', 'my_column', 'lot', 'colour']) {
      expect(inferObjectiveDirection(n), n).toBeNull();
    }
  });

  it('omits columns it cannot infer, instead of defaulting them to max', () => {
    // The defect this replaces registered *every* loaded column as 'max'.
    const objs = inferObjectives(['IC50', 'my_column', 'assay_id', 'pKi']);
    expect(objs).toEqual([
      { key: 'IC50', direction: 'min' },
      { key: 'pKi', direction: 'max' },
    ]);
  });

  it('is insensitive to separators and case', () => {
    expect(inferObjectiveDirection('IC-50')).toBe('min');
    expect(inferObjectiveDirection('p_IC50')).toBe('max');
    expect(inferObjectiveDirection('Assay ID')).toBeNull();
  });
});
