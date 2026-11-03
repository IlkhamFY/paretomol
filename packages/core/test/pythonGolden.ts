// Inputs and expected outputs shared with python/tests. The vitest file checks
// this object against python/tests/fixtures/golden.json. Regenerate with
// WRITE_GOLDEN=1 npx vitest run packages/core/test/python-golden.test.ts
import {
  sha256Hex, canonicalJSON, listProfiles, mpoScore, computeParetoAndDominance,
  inferObjectiveDirection, inferObjectives, buildDecisionRecord, stringifyDecisionRecord,
  reviewUrl, canonicalProperty, expectedDirection,
} from '../src/index.js';

const round = (x: number) => Math.round(x * 1e6) / 1e6;

const MPO_PROPS: Record<string, Record<string, number>> = {
  aspirin: { MW: 180.16, LogP: 1.31, HBD: 1, HBA: 3, TPSA: 63.6, RotBonds: 2 },
  caffeine: { MW: 194.19, LogP: -1.03, HBD: 0, HBA: 6, TPSA: 61.82, RotBonds: 0 },
  ibuprofen: { MW: 206.28, LogP: 3.07, HBD: 1, HBA: 1, TPSA: 37.3, RotBonds: 4 },
  atorvastatin: { MW: 558.65, LogP: 6.31, HBD: 4, HBA: 5, TPSA: 111.79, RotBonds: 12 },
  cyclosporin: { MW: 1202.64, LogP: 3.27, HBD: 5, HBA: 12, TPSA: 278.8, RotBonds: 15 },
};

const DIRECTION_NAMES = [
  'IC50', 'ic50_nM', 'EC50', 'Ki', 'Kd', 'MIC', 'GI50', 'LD50',
  'pIC50', 'pKi', 'pKd', 'pEC50', 'pChEMBL', 'pchembl_value',
  'kinase_family', 'skin_reaction', 'kind', 'making',
  'assay_id', 'confidence', 'year', 'chembl_id', 'standard_units', 'doi',
  'hERG', 'DILI', 'ClinTox', 'toxicity', 'Ames', 'clearance', 'price',
  'solubility', 'permeability', 'bioavailability', 'absorption',
  'toxicity_score', 'tox_risk_score', 'batch', 'notes', 'my_column', 'lot', 'colour',
  'IC-50', 'p_IC50', 'Assay ID', 'IC 50', 'p IC50', 'potency', 'selectivity',
  'yield', 'efficacy', 'score', 'hazard', 'cost', 'SA_Score', 'QED', 'MW', 'RAScore',
];

type Obj = { key: string; direction: 'min' | 'max' };
type Spec = { name: string; props?: Record<string, number>; customProps?: Record<string, number> };

function paretoCase(id: string, specs: Spec[], objectives: Obj[] | null) {
  const molecules = specs.map((s) => ({
    name: s.name,
    smiles: s.name,
    props: { ...(s.props ?? {}) },
    customProps: { ...(s.customProps ?? {}) },
    paretoRank: null as number | null,
    dominates: [] as number[],
    dominatedBy: [] as number[],
    missingObjectives: undefined as string[] | undefined,
  }));
  computeParetoAndDominance(molecules as never, objectives ?? undefined);
  return {
    id,
    objectives,
    molecules: specs.map((s) => ({
      name: s.name,
      props: s.props ?? {},
      customProps: s.customProps ?? {},
    })),
    ranks: molecules.map((m) => m.paretoRank),
    missing: molecules.map((m) => m.missingObjectives ?? null),
    dominates: molecules.map((m) => [...m.dominates]),
    dominatedBy: molecules.map((m) => [...m.dominatedBy]),
  };
}

function decisionMol(
  name: string,
  smiles: string,
  props: Record<string, number>,
  customProps: Record<string, number> = {},
  paretoRank: number | null = null,
) {
  return { name, smiles, props, customProps, paretoRank };
}

function decisionCase(id: string, partial: {
  molecules: ReturnType<typeof decisionMol>[];
  objectives: Obj[];
  profile?: string;
  selected?: number[];
  rationale?: string;
  rdkitVersion: string;
  timestamp: string;
  admetEndpoint?: string | null;
  view?: Record<string, unknown> | null;
  review?: { source?: string; decisions: Record<number, 'accept' | 'reject'>; suggested?: number[] } | null;
}) {
  const rec = buildDecisionRecord({
    molecules: partial.molecules as never,
    objectives: partial.objectives,
    profile: partial.profile,
    selected: partial.selected,
    rationale: partial.rationale,
    rdkitVersion: partial.rdkitVersion,
    admetEndpoint: partial.admetEndpoint,
    view: partial.view ?? undefined,
    review: partial.review ?? undefined,
    timestamp: partial.timestamp,
  });
  return {
    id,
    molecules: partial.molecules,
    objectives: partial.objectives,
    profile: partial.profile ?? 'oral@1',
    selected: partial.selected ?? [],
    rationale: partial.rationale ?? '',
    rdkitVersion: partial.rdkitVersion,
    timestamp: partial.timestamp,
    admetEndpoint: partial.admetEndpoint ?? null,
    view: partial.view ?? null,
    review: partial.review ?? null,
    text: stringifyDecisionRecord(rec),
    recordHash: rec.recordHash,
    inputHash: rec.input.sha256,
  };
}

export function buildPythonGolden() {
  const profiles: Record<string, { hash: string; ref: string; canonical: string }> = {};
  for (const p of listProfiles()) {
    const { ref: _ref, hash: _hash, ...raw } = p;
    void _ref; void _hash;
    profiles[p.ref] = { hash: p.hash, ref: p.ref, canonical: canonicalJSON(raw) };
  }

  const mpo: Record<string, Record<string, number>> = {};
  for (const p of listProfiles()) {
    for (const curve of ['linear', 'sigmoid'] as const) {
      const row: Record<string, number> = {};
      for (const [name, props] of Object.entries(MPO_PROPS)) {
        row[name] = round(mpoScore(props, p.desirability, curve).score);
      }
      mpo[`${p.ref}/${curve}`] = row;
    }
  }

  const baseMols = [
    decisionMol('a', 'CCO', { MW: 46, LogP: -0.1, HBD: 1, HBA: 3, TPSA: 60, RotBonds: 3 }),
    decisionMol('b', 'c1ccccc1', { MW: 78, LogP: 1.7, HBD: 1, HBA: 3, TPSA: 60, RotBonds: 3 }, { pIC50: 6.2 }),
    decisionMol('a', 'CCN', { MW: 45, LogP: -0.2, HBD: 1, HBA: 3, TPSA: 60, RotBonds: 3 }),
  ];
  const baseObj: Obj[] = [{ key: 'MW', direction: 'min' }, { key: 'LogP', direction: 'max' }];

  const rankedSpecs: Spec[] = [
    { name: 'aspirin', props: { MW: 180.16, LogP: 1.31, TPSA: 63.6 }, customProps: { pIC50: 4.5 } },
    { name: 'caffeine', props: { MW: 194.19, LogP: -1.03, TPSA: 61.82 }, customProps: { pIC50: 5.1 } },
    { name: 'gap', props: { MW: 200, LogP: 2, TPSA: 50 } },
  ];
  const rankedObjs: Obj[] = [{ key: 'MW', direction: 'min' }, { key: 'pIC50', direction: 'max' }];
  const rankedLive = rankedSpecs.map((s) => ({
    name: s.name,
    smiles: s.name === 'aspirin' ? 'CC(=O)Oc1ccccc1C(=O)O' : s.name === 'caffeine' ? 'Cn1cnc2c1c(=O)n(C)c(=O)n2C' : 'CCO',
    props: { ...(s.props ?? {}) },
    customProps: { ...(s.customProps ?? {}) },
    paretoRank: null as number | null,
    dominates: [] as number[],
    dominatedBy: [] as number[],
  }));
  computeParetoAndDominance(rankedLive as never, rankedObjs);

  return {
    sha256: [
      { input: '', hex: sha256Hex('') },
      { input: 'abc', hex: sha256Hex('abc') },
      { input: 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', hex: sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq') },
      { input: '≤ Å²', hex: sha256Hex('≤ Å²') },
    ],
    canonical: [
      { value: { b: 1, a: { d: [3, { y: 1, x: 2 }], c: 'z' } }, json: canonicalJSON({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: 'z' } }) },
      { value: { s: 'a\u0000b\n\t"\\', n: null, ok: true }, json: canonicalJSON({ s: 'a\u0000b\n\t"\\', n: null, ok: true }) },
    ],
    profiles,
    directions: DIRECTION_NAMES.map((name) => ({ name, direction: inferObjectiveDirection(name) })),
    inferObjectives: {
      names: ['IC50', 'my_column', 'assay_id', 'pKi'],
      objectives: inferObjectives(['IC50', 'my_column', 'assay_id', 'pKi']),
    },
    expectedDirection: ['QED', 'SA_Score', 'SCScore', 'MW', 'pIC50', 'IC50 (nM)', 'hERG', 'RAScore', 'Vendors'].map((key) => ({
      key, direction: expectedDirection(key),
    })),
    canonicalProperty: ['cLogP', 'Num H Donors', 'Fsp3', 'RotB', 'pIC50', 'MW', 'TPSA'].map((key) => ({
      key, property: canonicalProperty(key),
    })),
    mpoProps: MPO_PROPS,
    mpo,
    pareto: [
      paretoCase('front', [
        { name: 'a', customProps: { a: 1, b: 5 } },
        { name: 'b', customProps: { a: 5, b: 1 } },
        { name: 'c', customProps: { a: 6, b: 6 } },
      ], [{ key: 'a', direction: 'min' }, { key: 'b', direction: 'min' }]),
      paretoCase('mixed', [
        { name: 'a', customProps: { a: 5, b: 1 } },
        { name: 'b', customProps: { a: 1, b: 9 } },
        { name: 'c', customProps: { a: 9, b: 0 } },
      ], [{ key: 'a', direction: 'min' }, { key: 'b', direction: 'max' }]),
      paretoCase('layers', [
        { name: 'f1', customProps: { a: 1, b: 1 } },
        { name: 'f2', customProps: { a: 2, b: 2 } },
        { name: 'f3', customProps: { a: 3, b: 3 } },
        { name: 'f4', customProps: { a: 4, b: 4 } },
      ], [{ key: 'a', direction: 'min' }, { key: 'b', direction: 'min' }]),
      paretoCase('missing', [
        { name: 'safe', customProps: { mw: 300, herg: 0.05 } },
        { name: 'gap', customProps: { mw: 300 } },
      ], [{ key: 'mw', direction: 'min' }, { key: 'herg', direction: 'min' }]),
      paretoCase('duplicates', [
        { name: 'a', customProps: { a: 2, b: 2 } },
        { name: 'b', customProps: { a: 2, b: 2 } },
        { name: 'c', customProps: { a: 2, b: 2 } },
      ], [{ key: 'a', direction: 'min' }, { key: 'b', direction: 'min' }]),
      paretoCase('none', [
        { name: 'a', customProps: { a: 1 } },
        { name: 'b', customProps: { a: 2 } },
      ], []),
      paretoCase('single', [
        { name: 'only', customProps: { a: 1, b: 1 } },
      ], [{ key: 'a', direction: 'min' }, { key: 'b', direction: 'min' }]),
      paretoCase('empty', [], [{ key: 'a', direction: 'min' }]),
      paretoCase('defaults', [
        { name: 'a', props: { MW: 100, LogP: 1, TPSA: 40 } },
        { name: 'b', props: { MW: 200, LogP: 2, TPSA: 80 } },
        { name: 'c', props: { MW: 150, LogP: 0.5, TPSA: 90 } },
      ], null),
      paretoCase('props-win', [
        { name: 'a', props: { MW: 5 }, customProps: { MW: 1 } },
        { name: 'b', props: { MW: 1 } },
      ], [{ key: 'MW', direction: 'min' }]),
    ],
    decisions: [
      decisionCase('base', {
        molecules: baseMols,
        objectives: baseObj,
        rdkitVersion: '2025.03.4',
        selected: [2, 0],
        rationale: 'small',
        timestamp: '2026-10-30T00:00:00.000Z',
      }),
      decisionCase('later', {
        molecules: baseMols,
        objectives: baseObj,
        rdkitVersion: '2025.03.4',
        selected: [0, 2, 2],
        rationale: 'x',
        timestamp: '2027-01-01T00:00:00.000Z',
      }),
      decisionCase('ranked', {
        molecules: rankedLive.map((m) => decisionMol(m.name, m.smiles, m.props, m.customProps, m.paretoRank)),
        objectives: rankedObjs,
        profile: 'cns@1',
        selected: [1],
        rationale: 'kept the higher pIC50, ≤ Å²',
        rdkitVersion: '2025.03.4',
        timestamp: '2026-10-30T06:00:00.000Z',
        admetEndpoint: 'https://x.example',
        view: { activeTab: 'pareto', customPropNames: ['pIC50'], propertyFilters: { MW: { min: 10, max: 500 } }, substructureFilter: '' },
        review: { source: 'test-agent', decisions: { 0: 'reject', 1: 'accept' }, suggested: [1] },
      }),
    ],
    review: [
      {
        id: 'shortlist',
        input: {
          molecules: [
            { name: 'aspirin', smiles: 'CC(=O)Oc1ccccc1C(=O)O', customProps: { pIC50: 5.1 } },
            { name: 'caffeine', smiles: 'Cn1cnc2c1c(=O)n(C)c(=O)n2C' },
          ],
          objectives: [{ key: 'MW', direction: 'min' }, { key: 'pIC50', direction: 'max' }],
          profile: 'cns@1',
          source: 'test-agent',
          note: 'Check the acid.',
          suggested: ['caffeine'],
        },
      },
      {
        id: 'defaults',
        input: { molecules: [{ smiles: 'CCO' }] },
      },
      {
        id: 'bare-profile',
        input: { molecules: [{ name: 'a', smiles: 'C' }], profile: 'oral', title: 'Kinase shortlist' },
      },
      {
        id: 'unicode',
        input: { molecules: [{ name: 'a', smiles: 'CCO' }], note: '≤ Å²', source: 'lab' },
      },
    ].map((c) => ({ ...c, url: reviewUrl(c.input) })),
  };
}
