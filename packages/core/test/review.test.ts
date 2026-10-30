import { describe, it, expect } from 'vitest';
import { encodeReview, decodeReview, reviewUrl, reviewTokenFromUrl, validateReview, REVIEW_SCHEMA, buildDecisionRecord, parseDecisionRecord } from '../src/index';
import type { Molecule } from '../src/index';

const payload = {
  molecules: [
    { name: 'aspirin', smiles: 'CC(=O)Oc1ccccc1C(=O)O', customProps: { pIC50: 5.1 } },
    { name: 'caffeine', smiles: 'Cn1cnc2c1c(=O)n(C)c(=O)n2C' },
  ],
  objectives: [{ key: 'MW', direction: 'min' as const }, { key: 'pIC50', direction: 'max' as const }],
  profile: 'cns@1',
  source: 'test-agent',
  note: 'Check the acid.',
  suggested: ['caffeine'],
};

describe('review URL', () => {
  it('round-trips through the fragment', () => {
    const url = reviewUrl(payload);
    expect(url.startsWith('https://paretomol.com/#r=')).toBe(true);
    const tok = reviewTokenFromUrl(url)!;
    expect(decodeReview(tok)).toEqual({ schema: REVIEW_SCHEMA, ...payload });
  });

  it('also reads ?r= and ignores other params', () => {
    const tok = encodeReview(payload);
    expect(reviewTokenFromUrl(`https://paretomol.com/?tab=table&r=${tok}`)).toBe(tok);
    expect(reviewTokenFromUrl('https://paretomol.com/?m=abc')).toBeNull();
  });

  it('defaults profile to oral@1 and names unnamed molecules', () => {
    const p = validateReview({ molecules: [{ smiles: 'CCO' }] });
    expect(p.profile).toBe('oral@1');
    expect(p.molecules[0].name).toBe('mol1');
  });

  it('rejects bad payloads with actionable messages', () => {
    expect(() => validateReview({ molecules: [] })).toThrow(/non-empty/);
    expect(() => validateReview({ molecules: [{ smiles: 'C' }], profile: 'nope@9' })).toThrow();
    expect(() => validateReview({ molecules: [{ smiles: 'C' }], objectives: [{ key: 'MW', direction: 'up' }] })).toThrow(/direction/);
    expect(() => validateReview({ molecules: [{ name: 'a', smiles: 'C' }], suggested: ['b'] })).toThrow(/not in molecules/);
    expect(() => decodeReview('garbage!!')).toThrow(/corrupt/);
  });

  it('review verdicts land in a verifiable decision record', () => {
    const mols = payload.molecules.map((m) => ({ name: m.name, smiles: m.smiles, customProps: m.customProps ?? {}, props: { MW: 100 }, paretoRank: 1 })) as unknown as Molecule[];
    const rec = buildDecisionRecord({ molecules: mols, objectives: payload.objectives, profile: 'cns@1', selected: [1], rdkitVersion: 'x', timestamp: '2026-01-01T00:00:00.000Z', review: { source: 'test-agent', decisions: { 0: 'reject', 1: 'accept' }, suggested: [1] } });
    expect(rec.review).toEqual({ source: 'test-agent', decisions: { aspirin: 'reject', caffeine: 'accept' }, suggested: ['caffeine'] });
    expect(parseDecisionRecord(JSON.stringify(rec)).review?.decisions.caffeine).toBe('accept');
    const tampered = { ...rec, review: { ...rec.review!, decisions: { ghost: 'accept' as const } } };
    expect(() => parseDecisionRecord(tampered)).toThrow();
  });
});
