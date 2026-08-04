#!/usr/bin/env python3
"""Re-derive the Demonstration 2 AhR statistics from the deposited data.

Every value checked here is one a reader will look up -- the abstract, Sec. 4.2,
Fig. 3, SI Tables S2-S3 -- so each is recomputed and compared against the
manuscript, and disagreement exits non-zero. A verification that only prints its
numbers next to the reported ones is one nobody notices failing.

The EGFR series is paper/egfr_top50.csv (pChEMBL >= 8.92, n = 50), the set the
manuscript, Fig. 3 and SI Tables S2-S3 report. An earlier version of this script
read paper/scripts/egfr_broad.json and took its first 50 rows; that file is the
pChEMBL >= 8.0 sensitivity set, whose own statistics the SI reports separately
over all 237 compounds. Printing a truncation of a different set beside the
manuscript's numbers made a result that reproduces exactly read as a failure to
reproduce it.

Usage:  python3 paper/scripts/verify_fig3_data.py
"""
from __future__ import annotations

import csv
import json
import pathlib
import sys

import numpy as np
from scipy import stats

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _paths import EGFR_CSV, RESULTS, SCRIPTS, rel  # noqa: E402

CONTROLS = SCRIPTS / "control_kinase_inhibitors.json"
POPULATION = SCRIPTS / "population_baseline.json"
OUT = RESULTS / "verify_fig3_data.json"

THRESHOLD = 0.5

# What the manuscript reports, at the precision it reports it: Sec. 4.2 and the
# abstract for the headline, SI Tables S2-S3 for the group statistics, Fig. 3 for
# the two p-values. Every one is re-derived below rather than trusted.
MANUSCRIPT = {
    "egfr_n": 50,
    "egfr_mean": 0.890,
    "egfr_sd": 0.127,
    "egfr_pct_above": 100.0,
    "control_n": 50,
    "control_mean": 0.533,
    "control_sd": 0.317,
    "control_pct_above": 50.0,
    "population_n": 500,
    "population_mean": 0.135,
    "population_pct_above": 6.6,
    "u_egfr_vs_control": 2150,
    "p_egfr_vs_control": 5.61e-10,
    "glass_delta": 1.12,
    "p_egfr_vs_population": 8.52e-30,
}

# Both conventions were tried against the deposited data and only one reproduces
# what the manuscript prints, so these are findings rather than assumptions:
#
#   SD is the population SD (ddof = 0). The sample SD gives 0.129 and 0.320 for
#   the two groups and a Glass's delta of 1.11, none of which the paper prints.
#   Glass's delta divides by the control SD, as its definition requires.
#
#   The Mann-Whitney tests are two-sided. The one-sided alternative gives
#   p = 2.81e-10 against the controls, not the reported 5.61e-10.
DDOF = 0
ALTERNATIVE = "two-sided"


def ahr_from_json(path: pathlib.Path) -> list[float]:
    return [d["ahr"] for d in json.loads(path.read_text()) if d.get("ahr") is not None]


def pct_above(values: np.ndarray) -> float:
    return float((values > THRESHOLD).mean() * 100.0)


def agrees(fmt: str, got: float, want: float) -> bool:
    """Compare at the precision the manuscript prints, not to machine precision.

    The paper rounds, so an exact comparison would fail on its own rounding;
    a tolerance loose enough to absorb that would let a real change through.
    Formatting both sides the same way makes the reported digits the tolerance.
    """
    return fmt.format(got) == fmt.format(want)


def main() -> int:
    with EGFR_CSV.open() as f:
        egfr = np.array([float(r["NR-AhR"]) for r in csv.DictReader(f)
                         if (r.get("NR-AhR") or "").strip() != ""])
    control = np.array(ahr_from_json(CONTROLS))
    population = np.array(ahr_from_json(POPULATION))

    u_control, p_control = stats.mannwhitneyu(egfr, control, alternative=ALTERNATIVE)
    u_population, p_population = stats.mannwhitneyu(egfr, population,
                                                    alternative=ALTERNATIVE)
    glass_delta = (egfr.mean() - control.mean()) / control.std(ddof=DDOF)

    checks = (
        ("EGFR top-50 n", "{:.0f}", len(egfr), MANUSCRIPT["egfr_n"]),
        ("EGFR mean AhR", "{:.3f}", egfr.mean(), MANUSCRIPT["egfr_mean"]),
        ("EGFR SD", "{:.3f}", egfr.std(ddof=DDOF), MANUSCRIPT["egfr_sd"]),
        ("EGFR % above 0.5", "{:.1f}", pct_above(egfr), MANUSCRIPT["egfr_pct_above"]),
        ("controls n", "{:.0f}", len(control), MANUSCRIPT["control_n"]),
        ("controls mean AhR", "{:.3f}", control.mean(), MANUSCRIPT["control_mean"]),
        ("controls SD", "{:.3f}", control.std(ddof=DDOF), MANUSCRIPT["control_sd"]),
        ("controls % above 0.5", "{:.1f}", pct_above(control),
         MANUSCRIPT["control_pct_above"]),
        ("population n", "{:.0f}", len(population), MANUSCRIPT["population_n"]),
        ("population mean AhR", "{:.3f}", population.mean(),
         MANUSCRIPT["population_mean"]),
        ("population % above 0.5", "{:.1f}", pct_above(population),
         MANUSCRIPT["population_pct_above"]),
        ("EGFR vs controls U", "{:.0f}", u_control, MANUSCRIPT["u_egfr_vs_control"]),
        ("EGFR vs controls p", "{:.2e}", p_control, MANUSCRIPT["p_egfr_vs_control"]),
        ("Glass's delta", "{:.2f}", glass_delta, MANUSCRIPT["glass_delta"]),
        ("EGFR vs population p", "{:.2e}", p_population,
         MANUSCRIPT["p_egfr_vs_population"]),
    )

    print(f"Demonstration 2 AhR statistics, re-derived from {rel(EGFR_CSV)},")
    print(f"{rel(CONTROLS)} and {rel(POPULATION)}\n")

    failures: list[str] = []
    for label, fmt, got, want in checks:
        ok = agrees(fmt, got, want)
        print(f"  {label:24s} {fmt.format(got):>10s}   manuscript {fmt.format(want):>10s}"
              f"   {'ok' if ok else 'MISMATCH'}")
        if not ok:
            failures.append(f"{label}: {fmt.format(got)} != {fmt.format(want)}")

    # The manuscript quotes only the p-value for the population comparison, so U
    # is deposited rather than checked: an expected constant that no sentence in
    # the paper prints would only be asserting this script against itself.
    print(f"  {'EGFR vs population U':24s} {u_population:>10.0f}   "
          f"not quoted in the manuscript")

    out = {
        "sources": {
            "egfr": rel(EGFR_CSV),
            "controls": rel(CONTROLS),
            "population": rel(POPULATION),
        },
        "conventions": {"sd_ddof": DDOF, "mannwhitney_alternative": ALTERNATIVE,
                        "threshold": THRESHOLD},
        "groups": {
            name: {"n": len(v), "mean": float(v.mean()), "sd": float(v.std(ddof=DDOF)),
                   "pct_above_threshold": pct_above(v)}
            for name, v in (("egfr_top50", egfr), ("matched_kinase_controls", control),
                            ("population_baseline", population))
        },
        "tests": {
            "egfr_vs_controls": {"U": float(u_control), "p": float(p_control),
                                 "glass_delta": float(glass_delta)},
            "egfr_vs_population": {"U": float(u_population), "p": float(p_population)},
        },
        "manuscript": MANUSCRIPT,
        "checks": [{"value": label, "derived": fmt.format(got),
                    "manuscript": fmt.format(want), "agrees": agrees(fmt, got, want)}
                   for label, fmt, got, want in checks],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    print(f"\nwrote {rel(OUT)}")

    if failures:
        print(f"\nFAILED ({len(failures)}):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("All Demonstration 2 values reported in the manuscript reproduce.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
