#!/usr/bin/env python3
"""Stability and composition analyses for the multi-objective demonstration.

Four questions the reviewer raises, answered separately.

1. Stability under perturbation. How much of the front survives when the
   objective values are jittered? Two statistics are reported, because they say
   different things and quoting only one is misleading:

     retention  fraction of the ORIGINAL front still non-dominated after
                perturbation -- the question "would my selected compounds still
                be selected?"
     Jaccard    overlap of the two front SETS. This is systematically lower than
                retention because perturbation also ADMITS compounds: several
                objectives are small integers (HBD, HBA, RotBonds), so exact
                ties are common, and any jitter breaks those ties and lets tied
                compounds onto the front. A low Jaccard driven by admissions is
                not front instability, and reporting it alone would misstate the
                result.

2. epsilon-dominance. Front size as the dominance margin is relaxed, under both
   additive predicates a reader might have in mind. They differ in what the
   dominating point must do on the objective where it wins: beat the other by
   more than epsilon (strict), or merely be better (relaxed). The strict form
   is antisymmetric, so its epsilon-front is unique and its count of mutually
   epsilon-dominating pairs is necessarily zero -- that count is asserted here,
   not offered as evidence. The relaxed form is not antisymmetric and can admit
   mutual pairs, in which case "the epsilon-front" is not uniquely defined. The
   choice of predicate settles the question, so both are reported.

3. Composition. Are the compounds that become non-dominated once the safety
   objectives are added actually lower-risk, or is the apparent effect a
   selection artifact? Compared against the same shuffled null.

4. Lipinski compliance. Same question for the rule of five, whose apparent
   enrichment among those compounds the manuscript withdraws. A withdrawal
   needs deposited code as much as a finding does.

Usage:  python3 paper/scripts/pareto_sensitivity.py [--replicates N]
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
OUT = _RESULTS / "pareto_sensitivity.json"

PHYS = ["MW", "LogP", "HBD", "HBA", "TPSA", "RotBonds"]
SAFETY = ["admet_hERG", "admet_DILI", "admet_ClinTox"]
SEED = 20260727

# Rule of five, on the average molecular weight as everywhere in this deposit.
# Compliance here is zero violations of the four thresholds. The application's
# drug-likeness badge (src/utils/types.ts) instead allows one violation, which
# is the more common convention; the compliance rates the manuscript reports for
# this dataset are the zero-violation ones, so that is the definition analysed
# here and it is written into the output rather than left to be inferred.
RO5 = {"MW": 500.0, "LogP": 5.0, "HBD": 5.0, "HBA": 10.0}
RO5_DEFINITION = "MW <= 500, LogP <= 5, HBD <= 5, HBA <= 10; compliant = no violation"


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


def ro5_compliant(phys: np.ndarray) -> np.ndarray:
    idx = [PHYS.index(k) for k in RO5]
    return np.all(phys[:, idx] <= np.array(list(RO5.values())), axis=1)


def pareto_mask(data: np.ndarray) -> np.ndarray:
    n = len(data)
    optimal = np.ones(n, dtype=bool)
    for i in range(n):
        if not optimal[i]:
            continue
        if (np.all(data <= data[i], axis=1) & np.any(data < data[i], axis=1)).any():
            optimal[i] = False
    return optimal


def eps_fronts(data: np.ndarray, eps: float) -> dict[str, int]:
    """Additive epsilon-dominance under both predicates, on range-scaled data.

    With s the scaled objectives, j epsilon-dominates i when

      strict    (all k: s_j,k <= s_i,k + eps) and (some k: s_j,k <  s_i,k - eps)
      relaxed   (all k: s_j,k <= s_i,k + eps) and (some k: s_j,k <  s_i,k)

    The strict relation is antisymmetric for every eps, so its epsilon-front is
    unique and its mutual-pair count is necessarily zero rather than empirically
    zero: were i to epsilon-dominate j as well, some m would have
    s_i,m < s_j,m - eps, i.e. s_j,m > s_i,m + eps, contradicting the "all k"
    clause of j epsilon-dominating i. The count is still computed and asserted
    below, so that an edit to the predicate fails loudly instead of leaving a
    statistic that reads as a measurement but cannot be one.

    The relaxed relation carries no such guarantee -- the pair (0, 1), (1, 0) at
    eps = 1 dominates in both directions -- so its mutual-pair count is a real
    measurement, and where it is non-zero "the epsilon-front" is ill-defined.
    """
    rng = data.max(axis=0) - data.min(axis=0)
    rng[rng == 0] = 1.0
    scaled = data / rng
    n, m = scaled.shape
    within = np.ones((n, n), dtype=bool)      # [j, i]: all k, s_j,k <= s_i,k + eps
    beats_eps = np.zeros((n, n), dtype=bool)  # [j, i]: some k, s_j,k <  s_i,k - eps
    beats = np.zeros((n, n), dtype=bool)      # [j, i]: some k, s_j,k <  s_i,k
    for k in range(m):
        col_j, col_i = scaled[:, k][:, None], scaled[:, k][None, :]
        within &= col_j <= col_i + eps
        beats_eps |= col_j < col_i - eps
        beats |= col_j < col_i

    out: dict[str, int] = {}
    for name, wins in (("strict", beats_eps), ("relaxed", beats)):
        dominates = within & wins
        np.fill_diagonal(dominates, False)
        out[f"{name}_front_size"] = int((~dominates.any(axis=0)).sum())
        out[f"{name}_mutual_pairs"] = int(np.count_nonzero(dominates & dominates.T) // 2)
    if out["strict_mutual_pairs"]:
        raise AssertionError(
            f"{out['strict_mutual_pairs']} mutually epsilon-dominating pairs at eps={eps} "
            "under a predicate proved antisymmetric above: the predicate has been changed"
        )
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--replicates", type=int, default=50)
    args = ap.parse_args()

    rows = list(csv.DictReader(DATA.open()))
    keys = PHYS + SAFETY
    valid = [r for r in rows if all((r.get(k) or "").strip() != "" for k in keys)]
    phys = np.array([[float(r[k]) for k in PHYS] for r in valid])
    safety = np.array([[float(r[k]) for k in SAFETY] for r in valid])
    full = np.column_stack([phys, safety])
    n = len(full)

    p6, p9 = pareto_mask(phys), pareto_mask(full)
    gained = (~p6) & p9
    print(f"compounds {n}   P6 {p6.sum()}   P9 {p9.sum()}   newly non-dominated {gained.sum()}")

    out: dict[str, object] = {
        "n_compounds": n, "seed": SEED, "replicates": args.replicates,
        "p6": int(p6.sum()), "p9": int(p9.sum()), "gained": int(gained.sum()),
    }

    # ---- 1. perturbation stability -----------------------------------------
    rng = np.random.default_rng(SEED)
    scale = full.std(axis=0)
    print("\nperturbation stability (Gaussian noise, sigma as a fraction of each column's SD)")
    out["stability"] = []
    for frac in (0.01, 0.05, 0.10):
        ret, jac, sizes = [], [], []
        for _ in range(args.replicates):
            noisy = full + rng.normal(0.0, frac * scale, size=full.shape)
            m = pareto_mask(noisy)
            sizes.append(int(m.sum()))
            ret.append(float((m & p9).sum() / p9.sum()))
            jac.append(float((m & p9).sum() / (m | p9).sum()))
        rec = {
            "noise_fraction_of_sd": frac,
            "retention_mean": float(np.mean(ret)),
            "jaccard_mean": float(np.mean(jac)),
            "front_size_mean": float(np.mean(sizes)),
        }
        out["stability"].append(rec)
        print(f"  sigma={frac:4.0%}   retention {np.mean(ret):.3f}   "
              f"Jaccard {np.mean(jac):.3f}   front size {np.mean(sizes):6.1f} (observed {p9.sum()})")
    print("  Jaccard sits below retention because perturbation breaks integer ties and")
    print("  ADMITS compounds; it is not evidence that the original front is unstable.")

    # ---- 2. epsilon-dominance ----------------------------------------------
    print("\nepsilon-dominance (epsilon as a fraction of each objective's range)")
    out["epsilon"] = []
    for eps in (0.0, 0.01, 0.02, 0.05, 0.10):
        rec = {"epsilon": eps, **eps_fronts(full, eps)}
        out["epsilon"].append(rec)
        print(f"  eps={eps:4.2f}   strict front {rec['strict_front_size']:4d}   "
              f"relaxed front {rec['relaxed_front_size']:4d}   "
              f"relaxed mutual pairs {rec['relaxed_mutual_pairs']}")
    print("  The strict predicate is antisymmetric, so its front is unique and its mutual-pair")
    print("  count is zero by proof rather than by measurement (asserted, not reported).")
    if sum(e["relaxed_mutual_pairs"] for e in out["epsilon"]):
        print("  The relaxed predicate does admit mutual pairs here, so under that reading")
        print("  'the epsilon-front' is not uniquely defined at those settings.")
    else:
        print("  The relaxed predicate admits mutual pairs in principle but none arose here,")
        print("  so on this dataset both readings give a well-defined epsilon-front.")
    empty = [f"{e['epsilon']:g}" for e in out["epsilon"] if e["relaxed_front_size"] == 0]
    if empty:
        print(f"  The relaxed front is empty at eps={', '.join(empty)}: every compound is then")
        print("  relaxed-dominated by another, which only a cyclic relation permits.")

    # ---- 3. composition of the newly non-dominated compounds ---------------
    print("\ncomposition: mean predicted risk of the newly non-dominated compounds vs a shuffled null")
    out["composition"] = []
    for j, name in enumerate(SAFETY):
        observed = float(safety[gained, j].mean())
        null = []
        for _ in range(args.replicates * 4):
            perm = safety[rng.permutation(n)]
            g = (~p6) & pareto_mask(np.column_stack([phys, perm]))
            if g.any():
                null.append(float(perm[g, j].mean()))
        a = np.array(null)
        r = int((a <= observed).sum())
        p = permutation_p(r, a.size)
        out["composition"].append({
            "endpoint": name, "observed": observed,
            "null_mean": float(a.mean()), "null_sd": float(a.std(ddof=1)),
            "n_null_draws": int(a.size),
            "frac_null_le_observed": float(r / a.size),
            "p_permutation": p,
            "p_resolution_floor": permutation_p(0, a.size),
        })
        verdict = "survives" if p < 0.05 else "NOT significant"
        print(f"  {name:18s} observed {observed:.3f}   null {a.mean():.3f} +- {a.std(ddof=1):.3f}   "
              f"p={p:.4f}   {verdict}")
    print(f"  p is (r+1)/(R+1) over R={out['composition'][0]['n_null_draws']} draws; "
          f"no p below {out['composition'][0]['p_resolution_floor']:.4f} is attainable.")

    # ---- 4. Lipinski compliance of the newly non-dominated compounds -------
    # The same null as the composition analysis -- the safety triplet permuted
    # jointly -- but from a generator seeded afresh, so this analysis reproduces
    # on its own rather than depending on how many draws the sections above
    # happened to consume. Compliance is a function of the physicochemical
    # columns, which the permutation never touches; what it changes is which
    # compounds the safety objectives make non-dominated.
    #
    # This section withdraws a previously published claim, so the seed must not
    # be able to look chosen. The whole analysis is therefore repeated at a
    # second seed and both are deposited. What matters is not that the two agree
    # to the digit -- they do not, and should not -- but that the conclusion is
    # the same under both: the observation sits inside the null band either way.
    # That invariance is asserted below rather than left for a reader to check.
    print("\nLipinski compliance of the newly non-dominated compounds vs the same shuffled null")
    compliant = ro5_compliant(phys)
    observed = float(compliant[gained].mean())
    population = float(compliant.mean())

    def lipinski_null(seed: int) -> dict[str, object]:
        null_rng = np.random.default_rng(seed)
        null = []
        for _ in range(args.replicates * 4):
            perm = safety[null_rng.permutation(n)]
            g = (~p6) & pareto_mask(np.column_stack([phys, perm]))
            if g.any():
                null.append(float(compliant[g].mean()))
        a = np.array(null)
        lo, hi = np.percentile(a, [2.5, 97.5])
        # Enrichment is a claim of excess over the population, so the null is
        # read in the upper tail: how often does an uninformative objective set
        # do this well?
        r = int((a >= observed).sum())
        return {
            "seed": seed,
            "null_mean": float(a.mean()), "null_sd": float(a.std(ddof=1)),
            "null_ci95": [float(lo), float(hi)],
            "n_null_draws": int(a.size),
            "frac_null_ge_observed": float(r / a.size),
            "p_permutation": permutation_p(r, a.size),
            "p_resolution_floor": permutation_p(0, a.size),
            "inside_ci95": bool(lo <= observed <= hi),
            "enrichment_reproduced_by_null":
                float((a.mean() - population) / (observed - population)),
        }

    primary = lipinski_null(SEED)
    replicate = lipinski_null(SEED + 1)
    out["lipinski"] = {
        "definition": RO5_DEFINITION,
        "observed": observed,
        "population": population,
        **primary,
        "seed_robustness": replicate,
    }
    print(f"  {RO5_DEFINITION}")
    print(f"  observed {observed:.3f}   population {population:.3f}   "
          f"null {primary['null_mean']:.3f} +- {primary['null_sd']:.3f} "
          f"[{primary['null_ci95'][0]:.3f},{primary['null_ci95'][1]:.3f}]   "
          f"p={primary['p_permutation']:.3f}")
    print(f"  {primary['enrichment_reproduced_by_null']:.0%} of the apparent enrichment "
          f"over the population is reproduced by objectives carrying no information.")
    print(f"  seed {SEED + 1} for comparison: null {replicate['null_mean']:.3f} "
          f"+- {replicate['null_sd']:.3f}   p={replicate['p_permutation']:.3f}   "
          f"{replicate['enrichment_reproduced_by_null']:.0%} reproduced")
    # The withdrawal rests on the observation being inside the band, so that,
    # and not the individual digits, is what has to hold at both seeds.
    if not (primary["inside_ci95"] and replicate["inside_ci95"]):
        print("  SEED-DEPENDENT: the observation is inside the null band at one seed "
              "but not the other. The withdrawal cannot be stated as unconditional.")
        return 1
    print("  Conclusion is the same at both seeds: the observed rate lies inside the "
          "null band, so the enrichment is not evidence of anything beyond selection.")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    print(f"\nwrote {_rel(OUT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
