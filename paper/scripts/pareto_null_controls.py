#!/usr/bin/env python3
"""Null-model controls for the multi-objective demonstration.

The reviewer's objection is that enlarging the objective set enlarges the
non-dominated front for purely combinatorial reasons, so the growth from a
6-objective to a 9-objective front is not by itself evidence that the added
safety endpoints carry information. That objection is correct, and this script
quantifies it.

Three null models replace the three predicted-safety objectives with columns
that carry no compound-specific information while preserving other structure:

  independent   each safety column permuted independently across compounds.
                Destroys both the structure-property association and the
                correlation among the three endpoints.
  block         the safety triplet permuted jointly, so the three values stay
                together and only their assignment to compounds is broken.
                This preserves endpoint-endpoint correlation and is the more
                conservative null.
  uniform       i.i.d. uniform draws on each column's observed range.

Reported for k = 2..9 objectives, cumulative in the order the manuscript uses.

Interpretation, stated carefully because it is easy to phrase misleadingly: an
observed front SMALLER than the null does not mean the objectives perform
worse than noise. It means they are partly redundant with the physicochemical
objectives already present -- predicted hERG risk correlates with
lipophilicity, for instance -- so they enlarge the front by less than
statistically independent columns of the same marginal distribution would.

Usage:
    python3 paper/scripts/pareto_null_controls.py            # R = 200
    python3 paper/scripts/pareto_null_controls.py --quick    # R = 25
"""
from __future__ import annotations

import argparse
import csv
import json
import pathlib
import sys

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _paths import RESULTS as _RESULTS, rel as _rel  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[2]
DATA = ROOT / "paper" / "fda_approved_1949.csv"
OUT = _RESULTS / "pareto_null_controls.json"

PHYS = ["MW", "LogP", "HBD", "HBA", "TPSA", "RotBonds"]
SAFETY = ["admet_hERG", "admet_DILI", "admet_ClinTox"]
SEED = 20260727


def permutation_p(exceedances: int, draws: int) -> float:
    """Permutation p-value (r + 1) / (R + 1), not the raw fraction r / R.

    r / R is the maximum-likelihood estimate of an exceedance probability and is
    biased at the boundary: it returns exactly zero whenever no null draw
    reaches the observation, asserting an exactness that R draws cannot deliver.
    Counting the observed statistic as one of its own null draws bounds the
    estimate below by 1 / (R + 1), the finest resolution the sampling supports
    (Phipson and Smyth, Stat. Appl. Genet. Mol. Biol. 2010).
    """
    return (exceedances + 1) / (draws + 1)


def pareto_front_size(data: np.ndarray) -> int:
    """Number of non-dominated rows, all objectives minimised."""
    n = len(data)
    optimal = np.ones(n, dtype=bool)
    for i in range(n):
        if not optimal[i]:
            continue
        dominated_by_i = np.all(data <= data[i], axis=1) & np.any(data < data[i], axis=1)
        if dominated_by_i.any():
            optimal[i] = False
    return int(optimal.sum())


def load() -> tuple[np.ndarray, np.ndarray]:
    rows = list(csv.DictReader(DATA.open()))
    keys = PHYS + SAFETY
    valid = [r for r in rows if all((r.get(k) or "").strip() != "" for k in keys)]
    if len(valid) != len(rows):
        print(f"note: {len(rows) - len(valid)} of {len(rows)} rows dropped for missing values")
    phys = np.array([[float(r[k]) for k in PHYS] for r in valid])
    safety = np.array([[float(r[k]) for k in SAFETY] for r in valid])
    return phys, safety


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true", help="R = 25 instead of 200")
    ap.add_argument("--replicates", type=int, default=None)
    args = ap.parse_args()
    R = args.replicates if args.replicates else (25 if args.quick else 200)

    phys, safety = load()
    full = np.column_stack([phys, safety])
    n, n_phys = len(full), phys.shape[1]
    print(f"compounds: {n}   objectives: {full.shape[1]}   replicates: {R}   seed: {SEED}")

    rng = np.random.default_rng(SEED)
    results: dict[str, object] = {
        "n_compounds": n,
        "replicates": R,
        "seed": SEED,
        "objective_order": PHYS + SAFETY,
        "by_k": [],
    }

    for k in range(2, full.shape[1] + 1):
        observed = pareto_front_size(full[:, :k])
        entry: dict[str, object] = {"k": k, "observed": observed, "nulls": {}}

        # Nulls only differ once at least one safety column is in play.
        if k <= n_phys:
            entry["nulls"] = None
            results["by_k"].append(entry)
            print(f"  k={k}: observed {observed:4d}   (physicochemical only, no null)")
            continue

        n_safe = k - n_phys
        cols = safety[:, :n_safe]

        draws: dict[str, list[int]] = {"independent": [], "block": [], "uniform": []}
        for _ in range(R):
            ind = np.column_stack([rng.permutation(cols[:, j]) for j in range(n_safe)])
            draws["independent"].append(pareto_front_size(np.column_stack([phys, ind])))

            blk = cols[rng.permutation(n)]
            draws["block"].append(pareto_front_size(np.column_stack([phys, blk])))

            uni = rng.uniform(cols.min(axis=0), cols.max(axis=0), size=(n, n_safe))
            draws["uniform"].append(pareto_front_size(np.column_stack([phys, uni])))

        line = f"  k={k}: observed {observed:4d}"
        for name, vals in draws.items():
            a = np.array(vals, dtype=float)
            lo, hi = np.percentile(a, [2.5, 97.5])
            # Where the observation sits in the null distribution, read in the
            # lower tail: the observed front is below the null mean at every k.
            r = int((a <= observed).sum())
            entry["nulls"][name] = {
                "mean": float(a.mean()), "sd": float(a.std(ddof=1)),
                "ci95": [float(lo), float(hi)],
                "min": int(a.min()), "max": int(a.max()),
                "frac_null_le_observed": float(r / a.size),
                "p_permutation": permutation_p(r, a.size),
                "p_resolution_floor": permutation_p(0, a.size),
                "inside_ci": bool(lo <= observed <= hi),
            }
            flag = "  INSIDE 95% null band" if lo <= observed <= hi else ""
            line += f"   {name} {a.mean():6.1f} [{lo:.0f},{hi:.0f}]{flag}"
        results["by_k"].append(entry)
        print(line)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    print(f"\nwrote {_rel(OUT)}")

    # Surface any k where the observation is not distinguishable from the null,
    # so it is reported rather than discovered by a reader.
    inside = [
        (e["k"], name)
        for e in results["by_k"] if e["nulls"]
        for name, s in e["nulls"].items() if s["inside_ci"]
    ]
    if inside:
        print("\nnot distinguishable from the null (must be stated in the caption):")
        for k, name in inside:
            print(f"  k={k} vs {name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
