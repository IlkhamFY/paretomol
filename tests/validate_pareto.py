"""
Validate MolParetoLab's Pareto front against pymoo's non-dominated sorting.

Test: Take a real ChEMBL-like dataset of drug molecules, compute 6 properties
(MW, LogP, HBD, HBA, TPSA, RotBonds) with RDKit, run non-dominated sorting
with pymoo (gold standard), and compare against MolParetoLab's JS logic
(replicated here in Python for exact comparison).

All 6 objectives are MINIMIZED (lower = better), matching MolParetoLab's
computeParetoRanks implementation.
"""

import numpy as np
from rdkit import Chem
from rdkit.Chem import Descriptors, rdMolDescriptors

# -- Test molecules: well-known drugs with diverse properties --
SMILES_NAMES = [
    ("CC(=O)Oc1ccccc1C(=O)O", "Aspirin"),
    ("CC(C)Cc1ccc(cc1)C(C)C(=O)O", "Ibuprofen"),
    ("CC(=O)Nc1ccc(O)cc1", "Acetaminophen"),
    ("CN1C=NC2=C1C(=O)N(C(=O)N2C)C", "Caffeine"),
    ("c1ccc2c(c1)cc1ccc3cccc4ccc2c1c34", "Triphenylene"),
    ("OC(=O)c1ccccc1O", "Salicylic acid"),
    ("CC12CCC3C(C1CCC2O)CCC4=CC(=O)CCC34C", "Testosterone"),
    ("CC(=O)OC1C(SC2=CC=CC=C2N(C1=O)CCN(C)C)C3=CC=CC=C3", "Diltiazem"),
    ("COc1cc2c(cc1OC)C(=O)C(CC3CCN(CC3)Cc4ccc(OC)c(OC)c4)C(=O)C2=O", "Papaverine-like"),
    ("CN1C2CCC1C(C(C2)OC(=O)C3=CC=CC=C3)C(=O)OC", "Cocaine"),
    ("OC(=O)C(F)(F)F", "Trifluoroacetic acid"),
    ("c1ccc(cc1)C(=O)O", "Benzoic acid"),
    ("CC(C)NCC(O)c1ccc(O)c(O)c1", "Isoproterenol"),
    ("CC(=O)O", "Acetic acid"),
    ("OC[C@H]1OC(O)[C@H](O)[C@@H](O)[C@@H]1O", "Glucose"),
    ("c1ccc(cc1)c2ccccc2", "Biphenyl"),
    ("CCCCCCCCCCCCCCCC(=O)O", "Palmitic acid"),
    ("CC(C)(C)NCC(O)c1ccc(O)c(CO)c1", "Salbutamol"),
    ("CN1C(=O)CN=C(C2=CC=CC=C2)C3=CC=C(Cl)C=C31", "Diazepam"),
    ("OC(=O)CCCCC(=O)O", "Adipic acid"),
    ("CC1=CC(=O)C=CC1=O", "Methylbenzoquinone"),
    ("CC(C)CC(=O)Oc1ccccc1OC(=O)CC(C)C", "Aspirin-derivative"),
    ("c1ccncc1", "Pyridine"),
    ("C1CCCCC1", "Cyclohexane"),
    ("CCO", "Ethanol"),
    ("CCCCCCCC", "Octane"),
    ("c1ccc(cc1)N", "Aniline"),
    ("CC(=O)Nc1ccc(cc1)S(=O)(=O)N", "Sulfacetamide"),
    ("OC(=O)c1cc(O)c(O)c(O)c1", "Gallic acid"),
    ("CC1(C)C2CCC1(C)C(=O)C2", "Camphor"),
    ("O=C(O)C(O)C(O)C(=O)O", "Tartaric acid"),
    ("CC(C)c1ccc(cc1)C(C)C(=O)O", "Ibuprofen-isomer"),
    ("C1=CC=C(C=C1)C2=CC=CC=C2O", "2-Phenylphenol"),
    ("CC1=C(C(=O)C(=C(C1=O)OC)OC)C", "Ubiquinone-fragment"),
    ("OC1=CC=C(C=C1)C(O)=O", "4-Hydroxybenzoic acid"),
    ("CC(C)(C)c1ccc(O)cc1", "4-tert-Butylphenol"),
    ("O=C1NC(=O)NC(=O)C1", "Barbituric acid"),
    ("CC(=O)c1ccccc1", "Acetophenone"),
    ("OC(=O)c1cccnc1", "Nicotinic acid"),
    ("CC(O)CC(=O)O", "3-Hydroxybutyric acid"),
]


def compute_properties(smiles: str):
    """Compute the 6 MolParetoLab properties."""
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None
    return {
        'MW': Descriptors.MolWt(mol),
        'LogP': Descriptors.MolLogP(mol),
        'HBD': rdMolDescriptors.CalcNumHBD(mol),
        'HBA': rdMolDescriptors.CalcNumHBA(mol),
        'TPSA': Descriptors.TPSA(mol),
        'RotBonds': rdMolDescriptors.CalcNumRotatableBonds(mol),
    }


def molparetolab_pareto(props_list):
    """
    Exact replica of MolParetoLab's computeParetoRanks.
    All objectives minimized. Molecule i is dominated if there exists j
    where j <= i on all keys AND j < i on at least one.
    """
    keys = ['MW', 'LogP', 'HBD', 'HBA', 'TPSA', 'RotBonds']
    n = len(props_list)
    dominated = [False] * n

    for i in range(n):
        for j in range(n):
            if i == j:
                continue
            all_leq = True
            any_lt = False
            for k in keys:
                if props_list[j][k] > props_list[i][k]:
                    all_leq = False
                if props_list[j][k] < props_list[i][k]:
                    any_lt = True
            if all_leq and any_lt:
                dominated[i] = True
                break

    return [2 if d else 1 for d in dominated]


def pymoo_pareto(props_list):
    """
    Use pymoo's non-dominated sorting (gold standard).
    All objectives minimized.
    """
    from pymoo.util.nds.non_dominated_sorting import NonDominatedSorting

    keys = ['MW', 'LogP', 'HBD', 'HBA', 'TPSA', 'RotBonds']
    F = np.array([[p[k] for k in keys] for p in props_list])

    nds = NonDominatedSorting()
    fronts = nds.do(F)

    ranks = [2] * len(props_list)
    for idx in fronts[0]:  # front 0 = rank 1 (non-dominated)
        ranks[idx] = 1
    return ranks


def main():
    print("=" * 70)
    print("MolParetoLab Pareto Front Validation")
    print("=" * 70)

    # Compute properties
    names = []
    props_list = []
    for smi, name in SMILES_NAMES:
        props = compute_properties(smi)
        if props is None:
            print(f"  SKIP: {name} (invalid SMILES)")
            continue
        names.append(name)
        props_list.append(props)

    print(f"\nDataset: {len(props_list)} molecules, 6 objectives (all minimized)")
    print(f"Properties: MW, LogP, HBD, HBA, TPSA, RotBonds\n")

    # Run both methods
    mpl_ranks = molparetolab_pareto(props_list)
    pymoo_ranks = pymoo_pareto(props_list)

    # Compare
    mpl_front = set(i for i, r in enumerate(mpl_ranks) if r == 1)
    pymoo_front = set(i for i, r in enumerate(pymoo_ranks) if r == 1)

    print(f"MolParetoLab Pareto front: {len(mpl_front)} molecules")
    print(f"pymoo Pareto front:        {len(pymoo_front)} molecules")
    print()

    if mpl_front == pymoo_front:
        print("RESULT: PERFECT MATCH")
        print()
        print("Pareto-optimal molecules:")
        for i in sorted(mpl_front):
            p = props_list[i]
            print(f"  {names[i]:25s}  MW={p['MW']:7.2f}  LogP={p['LogP']:6.2f}  "
                  f"HBD={p['HBD']}  HBA={p['HBA']}  TPSA={p['TPSA']:6.2f}  RotB={p['RotBonds']}")
    else:
        print("RESULT: MISMATCH!")
        only_mpl = mpl_front - pymoo_front
        only_pymoo = pymoo_front - mpl_front
        if only_mpl:
            print(f"\n  Only in MolParetoLab ({len(only_mpl)}):")
            for i in sorted(only_mpl):
                print(f"    {names[i]}: {props_list[i]}")
        if only_pymoo:
            print(f"\n  Only in pymoo ({len(only_pymoo)}):")
            for i in sorted(only_pymoo):
                print(f"    {names[i]}: {props_list[i]}")

    print()

    # Also print dominated molecules for reference
    print("Dominated molecules:")
    for i in range(len(props_list)):
        if mpl_ranks[i] == 2:
            p = props_list[i]
            print(f"  {names[i]:25s}  MW={p['MW']:7.2f}  LogP={p['LogP']:6.2f}  "
                  f"HBD={p['HBD']}  HBA={p['HBA']}  TPSA={p['TPSA']:6.2f}  RotB={p['RotBonds']}")

    print()
    print("=" * 70)
    return mpl_front == pymoo_front


if __name__ == '__main__':
    success = main()
    exit(0 if success else 1)
