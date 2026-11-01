import { describe, expect, it } from 'vitest';
import { decisionExportFields } from '../decisionExport';
import { MPO_PROFILE_REFS } from '../scoringProfile';

describe('decision export fields', () => {
  it('writes the MPO profile and curve the user applied', () => {
    expect(decisionExportFields({
      kind: 'workspace',
      profileRef: MPO_PROFILE_REFS.cns,
      curve: 'sigmoid',
      admetColumns: 0,
      admetEndpoint: 'https://admet.example',
    })).toEqual({ profile: 'cns@1', curve: 'sigmoid', admetEndpoint: null });
  });

  it('records the ADMET endpoint on a review export when ADMET columns exist', () => {
    expect(decisionExportFields({
      kind: 'review',
      profileRef: MPO_PROFILE_REFS.cns,
      curve: 'sigmoid',
      reviewProfile: 'leadlike@1',
      admetColumns: 2,
      admetEndpoint: 'https://admet.example',
    })).toEqual({ profile: 'leadlike@1', curve: 'linear', admetEndpoint: 'https://admet.example' });
  });
});