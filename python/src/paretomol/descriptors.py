"""RDKit descriptors for claim checks.

Imported only when a caller asks for them. Install with ``pip install 'paretomol[rdkit]'``.
"""

from __future__ import annotations

from typing import Optional


def _rdkit():
    try:
        from rdkit import Chem
        from rdkit.Chem import Crippen, Descriptors, Lipinski, QED, rdMolDescriptors
    except ImportError as exc:
        raise ImportError(
            "RDKit is required for descriptor checks. Install it with: pip install 'paretomol[rdkit]'"
        ) from exc
    return Chem, Crippen, Descriptors, Lipinski, QED, rdMolDescriptors


def rdkit_version() -> str:
    """``rdkit.__version__`` from the installed toolkit."""
    try:
        import rdkit
    except ImportError as exc:
        raise ImportError(
            "RDKit is required for descriptor checks. Install it with: pip install 'paretomol[rdkit]'"
        ) from exc
    return str(getattr(rdkit, "__version__", ""))


def molecule_descriptors(smiles: str) -> Optional[dict[str, float]]:
    """Descriptors ParetoMol recomputes, or None when SMILES does not parse.

    Molecular weight is average mass (``MolWt``), LogP is Crippen, and QED is
    RDKit's Bickerton implementation. Counts are exact integers as floats.
    """
    Chem, Crippen, Descriptors, Lipinski, QED, rdMolDescriptors = _rdkit()
    token = (smiles or "").strip().split()
    if not token:
        return None
    mol = Chem.MolFromSmiles(token[0])
    if mol is None:
        return None
    try:
        qed = float(QED.qed(mol))
    except Exception:
        qed = float("nan")
    return {
        "MW": float(Descriptors.MolWt(mol)),
        "LogP": float(Crippen.MolLogP(mol)),
        "HBD": float(Lipinski.NumHDonors(mol)),
        "HBA": float(Lipinski.NumHAcceptors(mol)),
        "TPSA": float(Descriptors.TPSA(mol)),
        "RotBonds": float(Lipinski.NumRotatableBonds(mol)),
        "FrCSP3": float(rdMolDescriptors.CalcFractionCSP3(mol)),
        "Rings": float(rdMolDescriptors.CalcNumRings(mol)),
        "AromaticRings": float(rdMolDescriptors.CalcNumAromaticRings(mol)),
        "HeavyAtoms": float(Lipinski.HeavyAtomCount(mol)),
        "MR": float(Crippen.MolMR(mol)),
        "QED": qed,
    }
