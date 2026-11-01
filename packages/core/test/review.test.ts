import { describe, it, expect } from 'vitest';
import LZString from 'lz-string';
import { encodeReview, decodeReview, reviewUrl, reviewTokenFromUrl, validateReview, ensureReviewFragment, withoutReviewToken, REVIEW_SCHEMA, REVIEW_TOKEN_PREFIX, REVIEW_URL_SOFT_LIMIT, buildDecisionRecord, parseDecisionRecord } from '../src/index';
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
    expect(() => decodeReview('1.!!!!')).toThrow(/corrupt/);
  });

  it('still opens legacy lz-string tokens and raw JSON', () => {
    const validated = validateReview(payload);
    const legacy = LZString.compressToEncodedURIComponent(JSON.stringify(validated));
    expect(legacy.startsWith(REVIEW_TOKEN_PREFIX)).toBe(false);
    expect(decodeReview(legacy)).toEqual(validated);
    expect(decodeReview(JSON.stringify(validated))).toEqual(validated);
    expect(encodeReview(payload).startsWith(REVIEW_TOKEN_PREFIX)).toBe(true);
  });

  it('keeps a 500-molecule shortlist under the soft limit', () => {
    const tails = ['C', 'CC', 'O', 'N', 'F', 'Cl', 'C(=O)O', 'c1ccccc1', 'OC', 'NC(=O)C'];
    const molecules = Array.from({ length: 500 }, (_, i) => ({
      name: `cmpd${i + 1}`,
      smiles: `C${tails[i % tails.length]}c1ccc(${tails[(i * 3) % tails.length]})cc1${tails[(i * 7) % tails.length]}`,
      customProps: { pIC50: Math.round((4 + (i % 40) / 10) * 100) / 100 },
    }));
    const url = reviewUrl({ title: 'Large shortlist', source: 'bench', profile: 'oral@1', molecules });
    expect(url.startsWith('https://paretomol.com/#r=1.')).toBe(true);
    expect(url.length).toBeLessThanOrEqual(REVIEW_URL_SOFT_LIMIT);
    const back = decodeReview(reviewTokenFromUrl(url)!);
    expect(back.molecules).toHaveLength(500);
    expect(back.molecules[499]).toEqual(molecules[499]);
    expect(back.title).toBe('Large shortlist');
  });

  it('restores a review fragment that a navigation dropped, and can remove it again', () => {
    const token = encodeReview(payload);
    const kept = `https://paretomol.com/?tab=table#r=${token}`;
    expect(ensureReviewFragment(kept, token)).toBe(kept);
    expect(ensureReviewFragment(`https://paretomol.com/?r=${token}`, token)).toBe(`https://paretomol.com/?r=${token}`);
    const stripped = 'https://paretomol.com/?tab=table';
    expect(ensureReviewFragment(stripped, token)).toBe(`https://paretomol.com/?tab=table#r=${token}`);
    expect(reviewTokenFromUrl(ensureReviewFragment(stripped, token))).toBe(token);
    expect(withoutReviewToken(kept)).toBe('https://paretomol.com/?tab=table');
    expect(withoutReviewToken(`https://paretomol.com/?tab=table&r=${token}#intro`)).toBe('https://paretomol.com/?tab=table#intro');
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
