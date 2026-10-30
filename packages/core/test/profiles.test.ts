import { describe, it, expect } from 'vitest';
import {
  getProfile, listProfiles, loadProfile, canonicalJSON, profileHash, sha256Hex,
  mpoScore, checkFilter, DEFAULT_PARETO_OBJECTIVES, DRUG_FILTERS,
} from '@paretomol/core';

// Descriptor values (RDKit) for a small fixed set. Inputs are frozen here so the
// pinned scores below depend only on the profile thresholds and scoring code.
const FIXTURES: Record<string, Record<string, number>> = {
  aspirin:      { MW: 180.16, LogP: 1.31, HBD: 1, HBA: 3,  TPSA: 63.6,  RotBonds: 2 },
  caffeine:     { MW: 194.19, LogP: -1.03, HBD: 0, HBA: 6, TPSA: 61.82, RotBonds: 0 },
  ibuprofen:    { MW: 206.28, LogP: 3.07, HBD: 1, HBA: 1,  TPSA: 37.3,  RotBonds: 4 },
  atorvastatin: { MW: 558.65, LogP: 6.31, HBD: 4, HBA: 5,  TPSA: 111.79, RotBonds: 12 },
  cyclosporin:  { MW: 1202.64, LogP: 3.27, HBD: 5, HBA: 12, TPSA: 278.8, RotBonds: 15 },
};

// The thresholds the MPO view hard-coded before profiles existed. The profiles
// must reproduce them exactly so default app output is unchanged.
const LEGACY = {
  oral: {
    MW: [150, 400, 100, 500], LogP: [0, 3.5, -1, 5], HBD: [0, 3, 0, 5],
    HBA: [0, 7, 0, 10], TPSA: [40, 100, 20, 140], RotBonds: [0, 5, 0, 10],
  },
  cns: {
    MW: [150, 330, 100, 400], LogP: [1, 3.5, 0, 5], HBD: [0, 2, 0, 3],
    HBA: [0, 5, 0, 7], TPSA: [20, 70, 0, 90], RotBonds: [0, 4, 0, 8],
  },
  leadlike: {
    MW: [120, 280, 80, 350], LogP: [-1, 2.5, -2, 3.5], HBD: [0, 2, 0, 4],
    HBA: [0, 5, 0, 8], TPSA: [20, 90, 0, 120], RotBonds: [0, 4, 0, 7],
  },
} as const;

describe('sha256Hex', () => {
  it('matches FIPS 180-4 test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))
      .toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    expect(sha256Hex('≤ Å²')).toBe('c13f4e7c4f8810f00239bc5e95bacb2c75bc56ef480545fc7cdae74be1599f1a');
  });
});

describe('canonicalJSON', () => {
  it('sorts keys recursively and drops whitespace', () => {
    expect(canonicalJSON({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: 'z' } }))
      .toBe('{"a":{"c":"z","d":[3,{"x":2,"y":1}]},"b":1}');
  });
});

describe('scoring profiles', () => {
  it('resolves id@version and bare id, and rejects unknown refs', () => {
    expect(getProfile('oral@1').ref).toBe('oral@1');
    expect(getProfile('oral')).toBe(getProfile('oral@1'));
    expect(() => getProfile('oral@2')).toThrow(/Unknown/);
    expect(() => getProfile('nope')).toThrow(/Unknown/);
  });

  it('ships oral, cns, leadlike, lipinski and the custom template', () => {
    expect(listProfiles().map(p => p.ref).sort())
      .toEqual(['cns@1', 'custom@1', 'leadlike@1', 'lipinski@1', 'oral@1']);
  });

  it('pins every content hash (bump the version if one changes)', () => {
    const hashes = Object.fromEntries(listProfiles().map(p => [p.ref, p.hash]));
    expect(hashes).toEqual({
      'oral@1': 'sha256:7080e8a28f05205467a7502f2f8092390e1b5c551922229e071b4ee5020c3a39',
      'cns@1': 'sha256:ba0d635cc0a44348f45fcd52a83b962116a388ee99abb429af6166211b6633ea',
      'leadlike@1': 'sha256:4bc6567d008958d9da9d285796caefec235018545e88aec48c793083560a27a3',
      'lipinski@1': 'sha256:714cb4b73dba4f0e69f51623311618b3fc61dafd6fd31c8bf00e95d42f079178',
      'custom@1': 'sha256:f8104d208bb53bca250d7c22d411a0093315eebc0eae172bbb8e9589ecacf4f7'
    });
    for (const p of listProfiles()) {
      const { ref: _r, hash: _h, ...raw } = p;
      expect(profileHash(raw)).toBe(p.hash);
    }
  });

  it('returns frozen profiles', () => {
    const p = getProfile('oral@1');
    expect(Object.isFrozen(p.desirability.MW)).toBe(true);
  });

  it('reproduces the legacy MPO view thresholds exactly', () => {
    for (const [id, props] of Object.entries(LEGACY)) {
      const d = getProfile(`${id}@1`).desirability;
      for (const [k, [idealMin, idealMax, acceptMin, acceptMax]] of Object.entries(props)) {
        expect(d[k]).toEqual({ idealMin, idealMax, acceptMin, acceptMax });
      }
    }
    expect(getProfile('custom@1').desirability).toEqual(getProfile('oral@1').desirability);
  });

  it('uses the app default Pareto objectives', () => {
    expect(getProfile('oral@1').objectives).toEqual(DEFAULT_PARETO_OBJECTIVES);
  });

  it('lipinski@1 filter agrees with DRUG_FILTERS.lipinski', () => {
    const f = getProfile('lipinski@1').filter!;
    expect(f.rules).toEqual(DRUG_FILTERS.lipinski.rules);
    expect(f.maxViolations).toBe(DRUG_FILTERS.lipinski.maxViolations);
    expect(checkFilter('lipinski', FIXTURES.atorvastatin)).toEqual({ pass: false, violations: 2 });
  });

  it('validates user profiles', () => {
    const raw = JSON.parse(JSON.stringify(getProfile('custom@1')));
    delete raw.ref; delete raw.hash;
    raw.id = 'my-target';
    expect(loadProfile(raw).ref).toBe('my-target@1');
    expect(() => loadProfile({ ...raw, version: 0 })).toThrow();
    expect(() => loadProfile({ ...raw, desirability: { MW: { acceptMin: 5, idealMin: 1, idealMax: 2, acceptMax: 3 } } })).toThrow();
  });
});

describe('pinned MPO scores on the fixture set', () => {
  const round = (x: number) => Math.round(x * 1e6) / 1e6;
  const table = () => {
    const out: Record<string, Record<string, number>> = {};
    for (const p of listProfiles()) {
      for (const curve of ['linear', 'sigmoid'] as const) {
        const row: Record<string, number> = {};
        for (const [name, props] of Object.entries(FIXTURES)) row[name] = round(mpoScore(props, p.desirability, curve).score);
        out[`${p.ref}/${curve}`] = row;
      }
    }
    return out;
  };
  // NaN entries are pinned on purpose: the sigmoid curve divides by zero when
  // idealMin === acceptMin (e.g. HBD 0..0) and the value sits on that edge.
  // This is existing app behaviour, kept identical in wave 1; see wave1-NOTES.md.
  it('matches the pinned table', () => {
    expect(table()).toEqual({
      'oral@1/linear': {
        'aspirin': 1,
        'caffeine': 0.464159,
        'ibuprofen': 0.976119,
        'atorvastatin': 0.084053,
        'cyclosporin': 0.021544
      },
      'oral@1/sigmoid': {
        'aspirin': 0.996569,
        'caffeine': NaN,
        'ibuprofen': 0.957322,
        'atorvastatin': 0.093419,
        'cyclosporin': 0.031334
      },
      'cns@1/linear': {
        'aspirin': 1,
        'caffeine': 0.413519,
        'ibuprofen': 1,
        'atorvastatin': 0.021544,
        'cyclosporin': 0.021544
      },
      'cns@1/sigmoid': {
        'aspirin': 0.987093,
        'caffeine': NaN,
        'ibuprofen': 0.976741,
        'atorvastatin': 0.021169,
        'cyclosporin': 0.021347
      },
      'leadlike@1/linear': {
        'aspirin': 1,
        'caffeine': 0.929922,
        'ibuprofen': 0.868783,
        'atorvastatin': 0.0374,
        'cyclosporin': 0.016864
      },
      'leadlike@1/sigmoid': {
        'aspirin': 0.995445,
        'caffeine': NaN,
        'ibuprofen': 0.849265,
        'atorvastatin': 0.053819,
        'cyclosporin': 0.01748
      },
      'lipinski@1/linear': {
        'aspirin': 1,
        'caffeine': 1,
        'ibuprofen': 1,
        'atorvastatin': 0.1,
        'cyclosporin': 0.1
      },
      'lipinski@1/sigmoid': {
        'aspirin': 1,
        'caffeine': NaN,
        'ibuprofen': 1,
        'atorvastatin': 0.149022,
        'cyclosporin': 0.0974
      },
      'custom@1/linear': {
        'aspirin': 1,
        'caffeine': 0.464159,
        'ibuprofen': 0.976119,
        'atorvastatin': 0.084053,
        'cyclosporin': 0.021544
      },
      'custom@1/sigmoid': {
        'aspirin': 0.996569,
        'caffeine': NaN,
        'ibuprofen': 0.957322,
        'atorvastatin': 0.093419,
        'cyclosporin': 0.031334
      }
    });
  });
});
