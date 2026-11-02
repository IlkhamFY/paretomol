#!/usr/bin/env python3
"""Compare QED structural-alert counts between RDKit.js and RDKit Python.

The application computes QED's alert term in the browser (countQEDAlerts in
src/utils/chem.ts), against the 116 patterns in src/data/qedAlerts.ts, using a
WebAssembly build of RDKit that is a year older than the Python one the analysis
scripts use. The response letter states that the two agree; that statement is
only worth anything if it can be re-run, so it is re-run here.

The Python side is the reference implementation, rdkit.Chem.QED.StructuralAlerts
with HasSubstructMatch. The browser side is driven by rdkitjs_alert_parity.mjs,
which loads the same bundle the end-to-end tests serve to the browser and
mirrors countQEDAlerts pattern for pattern.

Exits non-zero on any per-molecule disagreement, on any pattern the browser
build will not compile, and on any divergence between the application's alert
patterns and RDKit's own. The last two would each let counts agree for the wrong
reason, and agreement reached that way is not evidence of anything.

Requires Node and the RDKit.js bundle in e2e/fixtures (`node
e2e/fetch-fixtures.mjs`). Neither is present in a Python-only checkout, so the
script skips explicitly rather than failing or, worse, passing quietly.

Usage:  python3 paper/scripts/rdkitjs_alert_parity.py
"""
from __future__ import annotations

import csv
import json
import pathlib
import random
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _paths import FDA_CSV, RESULTS, ROOT, SCRIPTS, rel as _rel  # noqa: E402

import rdkit  # noqa: E402
from rdkit import Chem, RDLogger  # noqa: E402
from rdkit.Chem import QED  # noqa: E402

RDLogger.DisableLog("rdApp.*")

N_COMPOUNDS = 500
# A fixed random subset rather than the first 500 rows: the reference set is
# ordered by ChEMBL identifier, so its head is not a representative sample and
# agreement over it would be a soft spot in the check.
SEED = 20260727

HELPER = SCRIPTS / "rdkitjs_alert_parity.mjs"
FIXTURES = ROOT / "e2e" / "fixtures"
OUT = RESULTS / "rdkitjs_alert_parity.json"


def skip(reason: str) -> int:
    """Report an unrunnable check as a skip and write nothing.

    A result file saying "did not run" deposited over one saying "500 of 500
    agreed" would be a silent downgrade, and a skip that exits 0 without saying
    so is indistinguishable from a pass.
    """
    print(f"SKIP: {reason}")
    print("      RDKit.js was not compared against RDKit Python.")
    return 0


def run_rdkitjs(smiles: list[str]) -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        src = pathlib.Path(tmp) / "smiles.json"
        dst = pathlib.Path(tmp) / "counts.json"
        src.write_text(json.dumps({"smiles": smiles}), encoding="utf-8")
        subprocess.run(["node", str(HELPER), str(src), str(dst)], check=True)
        return json.loads(dst.read_text(encoding="utf-8"))


def main() -> int:
    if shutil.which("node") is None:
        return skip("node is not on PATH")
    missing = [n for n in ("RDKit_minimal.js", "RDKit_minimal.wasm")
               if not (FIXTURES / n).exists()]
    if missing:
        return skip(f"{', '.join(missing)} absent from {_rel(FIXTURES)}; "
                    "run `node e2e/fetch-fixtures.mjs`")

    population = [r["smiles"] for r in csv.DictReader(FDA_CSV.open())
                  if Chem.MolFromSmiles(r["smiles"]) is not None]
    if len(population) < N_COMPOUNDS:
        print(f"only {len(population)} parseable compounds in {_rel(FDA_CSV)}")
        return 1
    sample = random.Random(SEED).sample(population, N_COMPOUNDS)

    py_counts = [sum(1 for a in QED.StructuralAlerts if mol.HasSubstructMatch(a))
                 for mol in (Chem.MolFromSmiles(s) for s in sample)]

    js = run_rdkitjs(sample)
    js_counts = js["counts"]
    # Guarded rather than assumed: zip would quietly compare the shorter list
    # and the run would report 500 comparisons it had not made.
    if len(js_counts) != len(sample):
        print(f"RDKit.js returned {len(js_counts)} counts for {len(sample)} compounds")
        return 1

    identical = list(js["smarts"]) == list(QED.StructuralAlertSmarts)
    compiled = js["n_compiled"] == len(js["smarts"])
    disagree = [{"smiles": s, "rdkit_python": p, "rdkit_js": j}
                for s, p, j in zip(sample, py_counts, js_counts) if p != j]

    print(f"compounds: {len(sample)} of {len(population)} parseable, "
          f"seed {SEED}, from {_rel(FDA_CSV)}")
    print(f"engines: RDKit Python {rdkit.__version__} vs RDKit.js {js['rdkitjs_version']}")
    print(f"alert patterns: {len(js['smarts'])}, "
          f"{'identical to' if identical else 'DIFFERENT FROM'} "
          "rdkit.Chem.QED.StructuralAlertSmarts, "
          f"{js['n_compiled']} compiled by RDKit.js")
    print(f"  agree     {len(sample) - len(disagree):4d} / {len(sample)}")
    print(f"  disagree  {len(disagree):4d}")
    # Stated so agreement cannot be read as impressive when it is vacuous: two
    # engines that both find nothing agree perfectly.
    print(f"  alerts found: {sum(py_counts)} across "
          f"{sum(1 for c in py_counts if c)} molecules, max {max(py_counts)} in one")

    OUT.write_text(json.dumps({
        "n_compounds": len(sample),
        "n_agree": len(sample) - len(disagree),
        "n_disagree": len(disagree),
        "seed": SEED,
        "source": _rel(FDA_CSV),
        "rdkit_python_version": rdkit.__version__,
        "rdkit_js_version": js["rdkitjs_version"],
        "n_alert_smarts": len(js["smarts"]),
        "n_alert_smarts_compiled_by_rdkit_js": js["n_compiled"],
        "smarts_identical": identical,
        "alerts_total": sum(py_counts),
        "molecules_with_alert": sum(1 for c in py_counts if c),
        "disagreements": disagree,
    }, indent=2) + "\n", encoding="utf-8")
    print(f"\nwrote {_rel(OUT)}")

    if disagree:
        print(f"\nDISAGREEMENT on {len(disagree)} compound(s) "
              "(rdkit_js null means RDKit.js could not parse it):")
        for d in disagree:
            print(f"  {d['smiles']}\n    python {d['rdkit_python']}   "
                  f"rdkitjs {d['rdkit_js']}")
    if not identical:
        print("\nsrc/data/qedAlerts.ts no longer matches rdkit.Chem.QED; "
              "regenerate it with build_qed_alerts.py.")
    if not compiled:
        print(f"\nRDKit.js compiled only {js['n_compiled']} of {len(js['smarts'])} "
              "patterns, so the browser cannot see every alert.")
    return 1 if (disagree or not identical or not compiled) else 0


if __name__ == "__main__":
    raise SystemExit(main())
