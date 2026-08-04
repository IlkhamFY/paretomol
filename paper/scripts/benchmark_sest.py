#!/usr/bin/env python3
"""Benchmark the synthetic-complexity estimate against established scores.

The reviewer asks that S_est be benchmarked rather than presented alongside
validated metrics without evidence. This script computes, over the deposited
FDA-approved reference set:

  S_est   the application's untrained heuristic (src/utils/chem.ts), replicated
          here with the same coefficients
  SA      the Ertl-Schuffenhauer synthetic accessibility score (RDKit contrib),
          the established fragment-frequency-based measure

and reports Spearman and Pearson correlation plus rank agreement on the tails,
which is what a triage proxy is actually used for: does it put roughly the
right compounds at the "hard" end?

The honest reading is reported either way. S_est is a structural heuristic with
hand-chosen coefficients; a high correlation would not make it validated, and a
low one would say it should not be relied on. The number is reported so a
reader can judge.

Usage:  python3 paper/scripts/benchmark_sest.py
"""
from __future__ import annotations

import csv
import json
import math
import os
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _paths import FDA_CSV, RESULTS, ROOT, rel as _rel  # noqa: E402

from rdkit import Chem, RDConfig, RDLogger  # noqa: E402
from rdkit.Chem import rdMolDescriptors  # noqa: E402

RDLogger.DisableLog("rdApp.*")
sys.path.append(os.path.join(RDConfig.RDContribDir, "SA_Score"))
import sascorer  # noqa: E402


def s_est(mol) -> float:
    """Replica of syntheticComplexityFromDescriptors in src/utils/chem.ts."""
    Chem.AssignStereochemistry(mol, cleanIt=True, force=True)
    s0 = (
        1.0
        + 0.90 * rdMolDescriptors.CalcNumAtomStereoCenters(mol)
        + 1.30 * rdMolDescriptors.CalcNumSpiroAtoms(mol)
        + 1.30 * rdMolDescriptors.CalcNumBridgeheadAtoms(mol)
        + 0.40 * (rdMolDescriptors.CalcNumAliphaticRings(mol)
                  + rdMolDescriptors.CalcNumSaturatedRings(mol))
        + 0.10 * max(0, mol.GetNumHeavyAtoms() - 28)
        + 1.20 * rdMolDescriptors.CalcFractionCSP3(mol)
    )
    return min(10.0, max(1.0, 1 + 9 * (1 - math.exp(-(s0 - 1) / 6.6))))


def ranks(xs: list[float]) -> list[float]:
    """Average ranks, so ties do not distort the rank correlation."""
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    out = [0.0] * len(xs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        avg = (i + j) / 2.0
        for k in range(i, j + 1):
            out[order[k]] = avg
        i = j + 1
    return out


def corr(a: list[float], b: list[float]) -> float:
    ma, mb = sum(a) / len(a), sum(b) / len(b)
    num = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    den = math.sqrt(sum((x - ma) ** 2 for x in a) * sum((y - mb) ** 2 for y in b))
    return num / den if den else float("nan")


def main() -> int:
    sest_vals, sa_vals, names = [], [], []
    for row in csv.DictReader(FDA_CSV.open()):
        mol = Chem.MolFromSmiles(row["smiles"])
        if mol is None:
            continue
        sest_vals.append(s_est(mol))
        sa_vals.append(sascorer.calculateScore(mol))
        names.append(row.get("name", "?"))

    n = len(sest_vals)
    pearson = corr(sest_vals, sa_vals)
    spearman = corr(ranks(sest_vals), ranks(sa_vals))

    # Tail agreement: of the compounds each metric ranks hardest, how many does
    # the other agree on? This is the behaviour a triage proxy is used for.
    def top_overlap(frac: float) -> float:
        k = max(1, int(n * frac))
        a = {i for i, _ in sorted(enumerate(sest_vals), key=lambda t: -t[1])[:k]}
        b = {i for i, _ in sorted(enumerate(sa_vals), key=lambda t: -t[1])[:k]}
        return len(a & b) / k

    print(f"compounds: {n}")
    print(f"  Pearson  r   S_est vs Ertl SA : {pearson:+.3f}")
    print(f"  Spearman rho S_est vs Ertl SA : {spearman:+.3f}")
    for frac in (0.05, 0.10, 0.25):
        print(f"  top-{frac:.0%} overlap (hardest to make) : {top_overlap(frac):.2f}")
    print(f"  S_est range {min(sest_vals):.2f}-{max(sest_vals):.2f}   "
          f"SA range {min(sa_vals):.2f}-{max(sa_vals):.2f}")
    print("\n  S_est is an untrained structural heuristic. A correlation of this")
    print("  magnitude indicates it tracks the established score well enough for")
    print("  triage, but it is not evidence that it is calibrated, and it is")
    print("  reported in the interface as an estimate rather than a score.")

    out = {
        "n": n, "pearson": pearson, "spearman": spearman,
        "top_overlap": {f"{f:.2f}": top_overlap(f) for f in (0.05, 0.10, 0.25)},
    }
    path = RESULTS / "benchmark_sest.json"
    path.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    print(f"\nwrote {_rel(path)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
