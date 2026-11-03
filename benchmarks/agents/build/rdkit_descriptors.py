#!/usr/bin/env python3
"""RDKit Python descriptors for the agent-benchmark molecules.

Ground truth for the descriptor tasks that must not be graded by RDKit.js.
Pins rdkit==2026.03.4 (see requirements.txt). Writes
benchmarks/agents/data/rdkit_python.json. `--check` recomputes and exits 1
if the committed file would change.

    python3 benchmarks/agents/build/rdkit_descriptors.py
    python3 benchmarks/agents/build/rdkit_descriptors.py --check
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from rdkit import Chem, __version__ as rdkit_version
from rdkit.Chem import Crippen, Descriptors

ROOT = Path(__file__).resolve().parents[1]
MOLECULES = ROOT / "data" / "molecules.json"
OUT = ROOT / "data" / "rdkit_python.json"
PINNED = "2026.03.4"


def rows() -> list[dict]:
    if rdkit_version != PINNED:
        sys.exit(f"rdkit {rdkit_version} does not match the pin {PINNED}")
    doc = json.loads(MOLECULES.read_text())
    out = []
    for mol in doc["molecules"]:
        m = Chem.MolFromSmiles(mol["smiles"])
        if m is None:
            sys.exit(f"RDKit could not parse {mol['molecule_chembl_id']}")
        out.append({
            "molecule_chembl_id": mol["molecule_chembl_id"],
            "name": mol["name"],
            "smiles": mol["smiles"],
            # Average molecular weight, Crippen logP, topological polar surface area.
            # Rounded only for the JSON (6 d.p.); the tasks carry their own tolerance.
            "MW": round(Descriptors.MolWt(m), 6),
            "LogP": round(Crippen.MolLogP(m), 6),
            "TPSA": round(Descriptors.TPSA(m), 6),
        })
    out.sort(key=lambda r: r["molecule_chembl_id"])
    return out


def payload() -> dict:
    return {
        "schema": "paretomol.agentbench.rdkit-python/1",
        "rdkit": PINNED,
        "api": ["rdkit.Chem.Descriptors.MolWt", "rdkit.Chem.Crippen.MolLogP", "rdkit.Chem.Descriptors.TPSA"],
        "molecules": rows(),
    }


def main() -> None:
    text = json.dumps(payload(), indent=2) + "\n"
    check = "--check" in sys.argv
    if check:
        if not OUT.exists() or OUT.read_text() != text:
            sys.exit(f"{OUT} does not match RDKit {PINNED}. Re-run without --check.")
        print(f"check ok: {OUT.name} matches RDKit {PINNED}")
        return
    OUT.write_text(text)
    print(f"wrote {OUT} ({len(payload()['molecules'])} molecules, RDKit {PINNED})")


if __name__ == "__main__":
    main()
