export interface MolProps {
  MW: number;
  LogP: number;
  HBD: number;
  HBA: number;
  TPSA: number;
  RotBonds: number;
  FrCSP3: number;
  Rings: number;
  AromaticRings: number;
  HeavyAtoms: number;
  MR: number;
  NumAtoms: number;
  QED: number;
}

export interface FilterResult {
  pass: boolean;
  violations: number;
}

export interface ParetoObjective {
  key: string;
  direction: 'min' | 'max';
}

export interface FormulaColumn {
  name: string;
  expr: string;
}

export const DEFAULT_PARETO_OBJECTIVES: ParetoObjective[] = [
  { key: 'MW', direction: 'min' },
  { key: 'LogP', direction: 'min' },
  { key: 'HBD', direction: 'min' },
  { key: 'HBA', direction: 'min' },
  { key: 'TPSA', direction: 'min' },
  { key: 'RotBonds', direction: 'min' },
];

export interface Molecule {
  name: string;
  smiles: string;
  svg: string;
  formula: string;
  fingerprint: string;
  /** Packed fingerprint for fast bitwise Tanimoto (Uint32Array of 64 words for 2048 bits) */
  fpPacked: Uint32Array;
  props: MolProps;
  customProps: Record<string, number>;
  filters: Record<string, FilterResult>;
  lipinski?: FilterResult;
  paretoRank: number | null;
  dominates: number[];
  dominatedBy: number[];
}

export const PROPERTIES = [
  { key: 'MW', label: 'Molecular Weight', unit: 'Da', lipinski: { max: 500 } },
  { key: 'LogP', label: 'Calc. LogP', unit: '', lipinski: { max: 5 } },
  { key: 'HBD', label: 'H-Bond Donors', unit: '', lipinski: { max: 5 } },
  { key: 'HBA', label: 'H-Bond Acceptors', unit: '', lipinski: { max: 10 } },
  { key: 'TPSA', label: 'Topological PSA', unit: 'Å²', lipinski: { max: 140 } },
  { key: 'RotBonds', label: 'Rotatable Bonds', unit: '', lipinski: { max: 10 } },
  { key: 'FrCSP3', label: 'Fraction Csp3', unit: '' },
  { key: 'HeavyAtoms', label: 'Heavy Atom Count', unit: '' },
  { key: 'MR', label: 'Molar Refractivity', unit: '' },
  { key: 'Rings', label: 'Ring Count', unit: '' },
  { key: 'AromaticRings', label: 'Aromatic Rings', unit: '' },
  { key: 'QED', label: 'QED (Drug-likeness)', unit: '' },
];

export const DRUG_FILTERS = {
  lipinski: {
    label: 'Lipinski Ro5',
    color: 'green',
    rules: [
      { key: 'MW', op: '<=', val: 500 },
      { key: 'LogP', op: '<=', val: 5 },
      { key: 'HBD', op: '<=', val: 5 },
      { key: 'HBA', op: '<=', val: 10 },
    ],
    maxViolations: 1,
  },
  veber: {
    label: 'Veber',
    color: 'yellow',
    rules: [
      { key: 'RotBonds', op: '<=', val: 10 },
      { key: 'TPSA', op: '<=', val: 140 },
    ],
    maxViolations: 0,
  },
  ghose: {
    label: 'Ghose',
    color: 'cyan',
    rules: [
      { key: 'LogP', op: '>=', val: -0.4 },
      { key: 'LogP', op: '<=', val: 5.6 },
      { key: 'MW', op: '>=', val: 160 },
      { key: 'MW', op: '<=', val: 480 },
      { key: 'MR', op: '>=', val: 40 },
      { key: 'MR', op: '<=', val: 130 },
      { key: 'NumAtoms', op: '>=', val: 20 },
      { key: 'NumAtoms', op: '<=', val: 70 },
    ],
    maxViolations: 0,
  },
  leadlike: {
    label: 'Lead-like',
    color: 'orange',
    rules: [
      { key: 'MW', op: '<=', val: 450 },
      { key: 'LogP', op: '<=', val: 4.5 },
      { key: 'RotBonds', op: '<=', val: 10 },
      { key: 'HBD', op: '<=', val: 5 },
      { key: 'HBA', op: '<=', val: 8 },
    ],
    maxViolations: 0,
  },
};

export const EXAMPLES = {
  druglike: `CC(=O)Oc1ccccc1C(=O)O aspirin
CC(C)Cc1ccc(cc1)C(C)C(=O)O ibuprofen
CC(=O)Nc1ccc(O)cc1 acetaminophen
CN1C=NC2=C1C(=O)N(C(=O)N2C)C caffeine
CN(C)C(=N)NC(=N)N metformin
COc1ccc2[nH]c(S(=O)Cc3ncc(C)c(OC)c3C)nc2c1 omeprazole
CC12CCC3C(C1CCC2O)CCC1=CC(=O)CCC13C testosterone
CC(CS)C(=O)N1CCCC1C(=O)O captopril`,

  lipinski: `CC(=O)Oc1ccccc1C(=O)O aspirin
CC(=O)Nc1ccc(O)cc1 acetaminophen
CC(C)Cc1ccc(cc1)C(C)C(=O)O ibuprofen
CC(=O)CC(c1ccccc1)c1c(O)c2ccccc2oc1=O warfarin
CC(C)c1n(CC[C@@H](O)C[C@@H](O)CC(=O)O)c(-c2ccccc2)c(-c2ccc(F)cc2)c1C(=O)Nc1ccccc1 atorvastatin
CC(C)c1nc(CN(C)C(=O)NC(C(=O)NC(CC2CCCCC2)C(O)CN(Cc2cccnc2)S(=O)(=O)c2ccc(N)cc2)CSc2ccccc2)cs1 ritonavir
CC1=C2C(C(=O)C3(C(CC4C(C3C(C(C2(C)C)(CC1OC(=O)C(C(C5=CC=CC=C5)NC(=O)C6=CC=CC=C6)O)O)OC(=O)C7=CC=CC=C7)(CO4)OC(=O)C)O)C)OC(=O)C paclitaxel
O=C(O)c1ccccc1O salicylic_acid`,

  diverse: `CN(C)C(=N)NC(=N)N metformin
OC[C@H]1OC(O)[C@H](O)[C@@H](O)[C@@H]1O glucose
CN1C=NC2=C1C(=O)N(C(=O)N2C)C caffeine
CC(=O)Oc1ccccc1C(=O)O aspirin
CC12CCC3C(C1CCC2O)CCC1=CC(=O)CCC13C testosterone
CC(C)CCCC(C)C1CCC2C1(CCC3C2CC=C4C3(CCC(C4)O)C)C cholesterol
C[C@@H]1C[C@H]2[C@@H]3CCC4=CC(=O)C=C[C@]4(C)[C@@]3(F)[C@@H](O)C[C@]2(C)[C@@]1(O)C(=O)CO dexamethasone
CC1=C(/C=C/C(=C/C=C/C(=C/C=C/C=C(/C=C/C=C(/C=C/C2=C(CCCC2(C)C)C)\\C)\\C)/C)/C)C(CCC1)(C)C beta_carotene`,

  kinase: `CC1=C(C=C(C=C1)NC(=O)C2=CC=C(C=C2)CN3CCN(CC3)C)NC4=NC=CC(=N4)C5=CN=CC=C5 imatinib
CC1=C(C=C(C=C1)NC(=O)C2=CC(=CC=C2)C(F)(F)F)NC3=NC=CC(=N3)C4=CN=CC=C4 nilotinib
CCN(CC)CCNC(=O)c1c(C)[nH]c(/C=C\\2C(=O)Nc3ccc(F)cc32)c1C sunitinib
COCCOc1cc2ncnc(Nc3cccc(C#C)c3)c2cc1OCCOC erlotinib
Cc1nc(Nc2ncc(s2)C(=O)Nc2c(C)cccc2Cl)cc(n1)N1CCN(CCO)CC1 dasatinib
COc1cc2ncnc(Nc3ccc(F)c(Cl)c3)c2cc1OCCCN1CCOCC1 gefitinib
CNC(=O)c1cc(Oc2ccc(NC(=O)Nc3ccc(Cl)c(C(F)(F)F)c3)cc2)ccn1 sorafenib
CS(=O)(=O)CCNCc1ccc(-c2ccc3ncnc(Nc4ccc(OCc5cccc(F)c5)c(Cl)c4)c3c2)o1 lapatinib`,

  fda_approved: `CC(=O)Oc1ccccc1C(=O)O aspirin
CC(C)Cc1ccc(cc1)C(C)C(=O)O ibuprofen
CC(=O)Nc1ccc(O)cc1 acetaminophen
CN(C)C(=N)NC(=N)N metformin
COc1ccc2[nH]c(S(=O)Cc3ncc(C)c(OC)c3C)nc2c1 omeprazole
CC(CS)C(=O)N1CCCC1C(=O)O captopril
CC(=O)CC(c1ccccc1)c1c(O)c2ccccc2oc1=O warfarin
CNCCC(Oc1ccc(C(F)(F)F)cc1)c1ccccc1 fluoxetine
CCN(CC)CCCC(C)Nc1ccnc2cc(Cl)ccc12 chloroquine
O=C(O)c1cn(C2CC2)c2cc(N3CCNCC3)c(F)cc2c1=O ciprofloxacin
CC1(C)S[C@@H]2[C@H](NC(=O)[C@@H](N)c3ccc(O)cc3)C(=O)N2[C@@H]1C(=O)O amoxicillin
CC1(C)S[C@@H]2[C@H](NC(=O)Cc3ccccc3)C(=O)N2[C@@H]1C(=O)O penicillin_G
C[C@@H]1C[C@H]2[C@@H]3CCC4=CC(=O)C=C[C@]4(C)[C@@]3(F)[C@@H](O)C[C@]2(C)[C@@]1(O)C(=O)CO dexamethasone
CC(C)c1n(CC[C@@H](O)C[C@@H](O)CC(=O)O)c(-c2ccccc2)c(-c2ccc(F)cc2)c1C(=O)Nc1ccccc1 atorvastatin
CN(Cc1cnc2nc(N)nc(N)c2n1)c1ccc(C(=O)N[C@@H](CCC(=O)O)C(=O)O)cc1 methotrexate
CCCCc1nc(Cl)c(CO)n1Cc1ccc(-c2ccccc2-c2nn[nH]n2)cc1 losartan
Nc1ccc(cc1)S(=O)(=O)N sulfanilamide
CCCc1nn(C)c2c(nc(-c3cc(S(=O)(=O)N4CCN(C)CC4)ccc3OCC)nn2)c1=O sildenafil`,

  antihypertensives: `CC(CS)C(=O)N1CCCC1C(=O)O captopril
C(CCN1CCCCC1)CN1CCCCC1 JJ282
CCCCc1nc(Cl)c(CO)n1Cc1ccc(-c2ccccc2-c2nn[nH]n2)cc1 losartan
CCOC(=O)C1=C(COCCN)NC(C)=C(C1c1ccccc1[N+](=O)[O-])C(=O)OC amlodipine
CC(C)NCC(O)c1ccc(O)c(O)c1 isoproterenol
CC(=O)OC1CC2CCC1(C)C2(C)C abiraterone
Clc1ccc(C(c2ccccc2)n2ccnc2)cc1 clotrimazole
CC(C)(C)NCC(O)c1ccc(O)c(CO)c1 albuterol
CCCCCCCCSC(=O)NC1CCCC1C(=O)O enalapril_analog
OC(=O)C(CC1CCCCC1)NC(=O)C(O)C1CCCCC1 ramipril_acid
CC(C)c1ccc(cc1)C(O)CCCN(CC)CC verapamil_analog
ClC1=CC=CC=C1C(=O)NC2CCCCC2 ticlopidine_analog`,

  cns_drugs: `CNCCC(Oc1ccc(C(F)(F)F)cc1)c1ccccc1 fluoxetine
CN(C)CCCN1c2ccccc2Sc2ccc(Cl)cc21 chlorpromazine
CN1CCC(=C2c3ccccc3C=Cc3ccccc32)CC1 cyproheptadine
CC(=O)Nc1ccc(O)cc1 acetaminophen
CN1C=NC2=C1C(=O)N(C(=O)N2C)C caffeine
CCN(CC)C(=O)C1CN(C)C2CC3=CNC4=CC=CC(=C34)C2=C1 LSD
CN1C2CCC1C(C(=O)OC)C2OC(=O)C1=CC=CC=C1 cocaine
C1CCCN(C1)CCCC(C2=CC=CC=C2)C3=CC=C(C=C3)F haloperidol
CC(CC1=CC=CC=C1)NC methamphetamine
CC(CC1=CC2=C(C=C1)OCO2)NC amphetamine_MDA
ClC1=CC=C(C=C1)C(C2=CC=CC=N2)N3CCNCC3 meclizine
OC1(CCN(CCCC(=O)C2=CC=C(F)C=C2)CC1)C3=CC=C(Cl)C=C3 haloperidol_decanoate`,

  statins: `CC(C)c1n(CC[C@@H](O)C[C@@H](O)CC(=O)O)c(-c2ccccc2)c(-c2ccc(F)cc2)c1C(=O)Nc1ccccc1 atorvastatin
CC(C)C(=O)Oc1ccc(-c2c(C(C)C)nc(-c3ccccc3)c(C=CC(O)CC(O)CC(=O)O)c2-c2ccc(F)cc2)cc1 pitavastatin
CC(C)c1nc(N(C)S(=O)(=O)c2ccc(F)cc2)nc(-c2ccc(F)cc2)c1/C=C/[C@@H](O)C[C@@H](O)CC(=O)O rosuvastatin
C[C@H]1C(=O)OC(CC[C@@H](O)C[C@@H](O)C=Cc2c(C)c(OC)c(C)c(O)c2C(=O)O)C[C@H]1O lovastatin_acid
CCC(C)(C)C(=O)OC1CC(O)C=C2C=CC(C)C(CCC3CC(O)CC(=O)O3)C21 simvastatin
CC(O)CC(=O)Oc1cc(-c2ccc(F)cc2)c2C=CC(O)CC(O)Cc2c1C fluvastatin_analog
OC(CC(O)CC(=O)O)C=Cc1c(C2CCCCC2)nc(-c2ccccc2)c(-c2ccc(F)cc2)c1-c1ccccc1 cerivastatin_acid
CC(C)c1nc(-c2ccccc2)c(-c2ccc(F)cc2)c(/C=C/[C@@H](O)C[C@@H](O)CC(=O)O)c1C(=O)NC(CC)CC atorvastatin_ethyl`,
};
