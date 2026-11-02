#!/usr/bin/env python3
"""Generate src/data/qedAlerts.ts — the structural-alert SMARTS used by the
canonical QED implementation.

ParetoMol computes QED client-side. The alert term of QED counts matches
against a specific list of 116 SMARTS defined by the reference implementation
(Bickerton et al. 2012, as shipped in RDKit's rdkit.Chem.QED). That list is
NOT the same as the PAINS/Brenk/NIH filter catalogues the application uses
elsewhere for structural-alert flagging: only a subset of the QED patterns
appears in those catalogues, so substituting a catalogue count would give a
number that is wrong in a different way than hard-coding zero.

This script is the single source of truth for that list. Re-run it to
regenerate the TypeScript module, and record the RDKit version it came from.

    python3 paper/scripts/build_qed_alerts.py

Deposited alongside the manuscript so the alert term is reproducible.
"""
from __future__ import annotations

import pathlib
import sys

import rdkit
from rdkit import Chem
from rdkit.Chem import QED

OUT = pathlib.Path(__file__).resolve().parents[2] / "src" / "data" / "qedAlerts.ts"


def main() -> int:
    smarts = list(QED.StructuralAlertSmarts)

    # Every pattern must be a valid SMARTS under the Python toolkit before we
    # ship it to the browser build; an invalid pattern would silently never
    # match and quietly deflate the alert count.
    invalid = [s for s in smarts if Chem.MolFromSmarts(s) is None]
    if invalid:
        print(f"ERROR: {len(invalid)} SMARTS failed to parse:", file=sys.stderr)
        for s in invalid:
            print(f"  {s}", file=sys.stderr)
        return 1

    if len(smarts) != len(set(smarts)):
        print("WARNING: duplicate SMARTS present in the reference list", file=sys.stderr)

    body = ",\n".join(f"  {json_str(s)}" for s in smarts)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        "// GENERATED FILE - do not edit by hand.\n"
        "// Regenerate with: python3 paper/scripts/build_qed_alerts.py\n"
        f"// Source: rdkit.Chem.QED.StructuralAlertSmarts (RDKit {rdkit.__version__})\n"
        "//\n"
        "// The structural-alert SMARTS used by the canonical QED implementation\n"
        "// (Bickerton et al., Nat. Chem. 2012). This list is distinct from the\n"
        "// PAINS/Brenk/NIH catalogues used elsewhere in the application: QED's\n"
        "// alert term is defined against these patterns specifically.\n"
        "\n"
        "export const QED_ALERT_SMARTS: readonly string[] = [\n"
        f"{body},\n"
        "];\n"
        "\n"
        f"export const QED_ALERT_SOURCE = 'rdkit.Chem.QED (RDKit {rdkit.__version__})';\n",
        encoding="utf-8",
    )
    print(f"wrote {OUT} ({len(smarts)} SMARTS, RDKit {rdkit.__version__})")
    return 0


def json_str(s: str) -> str:
    """Emit a SMARTS as a single-quoted TS string literal, escaping safely."""
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"


if __name__ == "__main__":
    raise SystemExit(main())
