#!/usr/bin/env python3
"""Regenerate every reported result from the deposited data.

    pip install -r paper/requirements.txt
    python3 paper/scripts/run_all.py            # run everything
    python3 paper/scripts/run_all.py --check    # verify only; write nothing

--check runs the analyses and asserts the headline numbers reported in the
manuscript, without touching any committed artefact. This is what CI runs, so a
change that silently moves a reported number fails the build.

Figures are regenerated into a scratch directory (PARETOMOL_FIGURE_OUT) rather
than over the committed ones: a verification run that overwrites the artefact
it is verifying proves nothing.

Every script in paper/scripts/ appears in one of the tables below -- driven,
listed as requiring network, or named with the reason it cannot be part of a
reproduction run. A script that is merely absent from the runner is
indistinguishable from one that has quietly stopped working.
"""
from __future__ import annotations

import argparse
import csv
import os
import pathlib
import subprocess
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _paths import FDA_CSV, PAPER, RESULTS, ROOT, SCRIPTS, rel  # noqa: E402

# Values reported in the manuscript. Each is re-derived below, not trusted.
EXPECTED = {
    "n_compounds": 1949,
    "p6_front": 50,
    "p9_front": 181,
    "newly_non_dominated": 131,
    "qed_alert_smarts": 116,
}

# The deposit itself, not the redirectable output directory. RESULTS moves when
# PARETOMOL_RESULTS_OUT is set, and a check that follows it would assert the
# contents of a scratch directory the run had just written -- which is no check
# at all. --check asserts what was committed.
DEPOSIT = PAPER / "results"

PHYS = ["MW", "LogP", "HBD", "HBA", "TPSA", "RotBonds"]
SAFETY = ["admet_hERG", "admet_DILI", "admet_ClinTox"]

# Membership below is by what each script does, established by reading it, not
# by what it is named.

# Reproduce a reported number offline from the deposited data. All but
# cs1_experimental.py write only where PARETOMOL_RESULTS_OUT redirects them;
# cs1_experimental.py regenerates its LaTeX table in place, which is
# deterministic from the deposited CSV.
ANALYSES = (
    ("pareto_null_controls.py", "Demonstration 1 null models"),
    ("pareto_sensitivity.py", "Demonstration 1 sensitivity, epsilon-dominance, composition"),
    ("validate_qed.py", "QED against the reference implementation"),
    ("rdkitjs_alert_parity.py", "QED alert counts, RDKit.js against RDKit Python"),
    ("benchmark_sest.py", "S_est against the Ertl-Schuffenhauer score"),
    ("cs1_experimental.py", "rescued drugs against clinical reference data"),
    ("cs3_statistics.py", "Demonstration 3 cross-class tests"),
)

# Write only into PARETOMOL_FIGURE_OUT, so a run cannot reach the committed
# figures. Checked by reading each one rather than assumed.
FIGURE_SCRIPTS = (
    ("generate_fig2_fda.py", "Figure 2"),
    ("generate_fig3_cs2.py", "Figure 3"),
    ("generate_fig4_heatmap.py", "Figure 4"),
    ("generate_figures_final.py", "Figure 1 and the supplementary panels"),
    ("cs2b_ahr_known.py", "the SI panel: EGFR series against known AhR activators"),
    ("make_toc_graphic.py", "the table-of-contents graphic"),
)

# Re-derive numbers quoted in the text. The first three print them; the fourth
# also asserts them and deposits what it derived under PARETOMOL_RESULTS_OUT.
VERIFICATION = (
    ("verify_pareto.py", "Demonstration 2 front membership"),
    ("verify_pchembl.py", "Demonstration 2 mean pChEMBL"),
    ("verify_corr.py", "Demonstration 2 endpoint correlations"),
    ("verify_fig3_data.py", "Demonstration 2 AhR group statistics and tests"),
)

# Reach live services, so they cannot run in CI. They are opt-in rather than
# attempted-and-tolerated, because neither reproduces the deposited files:
# ChEMBL and the ADMET-AI service return what they hold today, so running these
# replaces deposited inputs instead of confirming them.
NETWORK = (
    ("cs2_controls.py",
     "ChEMBL + ADMET-AI; replaces the deposited Demonstration 2 control inputs"),
    ("egfr_assay_composition.py",
     "ChEMBL; rewrites egfr_assay_composition_table.tex"),
)

# Named rather than omitted, so the inventory above is complete.
NOT_DRIVEN = (
    ("build_qed_alerts.py",
     "regenerates src/data/qedAlerts.ts; --check asserts the committed catalogue instead"),
    ("build_structural_alerts.py",
     "regenerates src/data/structural_alerts.json from a pinned RDKit release; needs network"),
)


def check_inventory() -> list[str]:
    """Every script in paper/scripts/ must appear in exactly one table above.

    The response letter states that this runner drives every analysis and
    figure script. That was false once, because scripts were added and nobody
    thought to add them here, and an omission is only visible if something goes
    looking for it.
    """
    listed = {s for group in (ANALYSES, FIGURE_SCRIPTS, VERIFICATION, NETWORK, NOT_DRIVEN)
              for s, _ in group}
    # _paths.py is an imported module rather than an entry point.
    present = {p.name for p in SCRIPTS.glob("*.py")} - {"_paths.py", pathlib.Path(__file__).name}
    missing, stale = sorted(present - listed), sorted(listed - present)
    status = "ok" if not (missing or stale) else "MISMATCH"
    print(f"  {'accounted for':32s} {len(listed & present):5d} of {len(present):5d}"
          f"           {status}")

    failures: list[str] = []
    if missing:
        failures.append("present in paper/scripts/ but not driven or listed by "
                        f"run_all.py: {', '.join(missing)}")
    if stale:
        failures.append(f"listed by run_all.py but no longer present: {', '.join(stale)}")
    return failures


def check_demonstration_1() -> list[str]:
    """Re-derive the Demonstration 1 front sizes from the deposited CSV."""
    import numpy as np

    failures: list[str] = []
    rows = list(csv.DictReader(FDA_CSV.open()))
    keys = PHYS + SAFETY
    valid = [r for r in rows if all((r.get(k) or "").strip() != "" for k in keys)]

    if len(valid) != EXPECTED["n_compounds"]:
        failures.append(f"compound count {len(valid)} != {EXPECTED['n_compounds']}")

    missing = sum(1 for r in rows if any((r.get(k) or "").strip() == "" for k in keys))
    if missing:
        failures.append(f"{missing} rows carry missing objective values")

    def front(data: np.ndarray) -> np.ndarray:
        n = len(data)
        opt = np.ones(n, dtype=bool)
        for i in range(n):
            if not opt[i]:
                continue
            if (np.all(data <= data[i], axis=1) & np.any(data < data[i], axis=1)).any():
                opt[i] = False
        return opt

    phys = np.array([[float(r[k]) for k in PHYS] for r in valid])
    full = np.column_stack([phys, np.array([[float(r[k]) for k in SAFETY] for r in valid])])
    p6, p9 = front(phys), front(full)
    gained = int(((~p6) & p9).sum())

    for label, got, want in (
        ("P6 front", int(p6.sum()), EXPECTED["p6_front"]),
        ("P9 front", int(p9.sum()), EXPECTED["p9_front"]),
        ("newly non-dominated", gained, EXPECTED["newly_non_dominated"]),
    ):
        status = "ok" if got == want else "MISMATCH"
        print(f"  {label:24s} {got:5d}   expected {want:5d}   {status}")
        if got != want:
            failures.append(f"{label}: {got} != {want}")
    return failures


def check_qed_alerts() -> list[str]:
    """The generated alert catalogue must match the reference implementation."""
    failures: list[str] = []
    ts = ROOT / "src" / "data" / "qedAlerts.ts"
    if not ts.exists():
        return ["src/data/qedAlerts.ts is missing; run build_qed_alerts.py"]
    n = sum(1 for line in ts.read_text(encoding="utf-8").splitlines()
            if line.strip().startswith("'") and line.strip().endswith("',"))
    want = EXPECTED["qed_alert_smarts"]
    print(f"  {'QED alert SMARTS':24s} {n:5d}   expected {want:5d}   "
          f"{'ok' if n == want else 'MISMATCH'}")
    if n != want:
        failures.append(f"QED alert count: {n} != {want}")

    try:
        from rdkit.Chem import QED
        if len(QED.StructuralAlertSmarts) != n:
            failures.append(
                f"generated catalogue ({n}) disagrees with the installed RDKit "
                f"({len(QED.StructuralAlertSmarts)}); regenerate build_qed_alerts.py"
            )
    except ImportError:
        print("  (rdkit unavailable: skipped the cross-check against the reference)")
    return failures



def check_deposited_results() -> list[str]:
    """The deposited results must have been produced at full replicate counts.

    A reduced run writes the same filenames with different numbers. When that
    happened, the deposit quietly stopped supporting the values in the text: the
    manuscript cited the 200-replicate nulls while the committed JSON held
    25-replicate ones. --quick now redirects its output, and this asserts the
    invariant so the two cannot drift apart again unnoticed.
    """
    import json

    failures: list[str] = []
    expected_replicates = {
        "pareto_null_controls.json": 200,
        "pareto_sensitivity.json": 50,
    }
    for name, want in expected_replicates.items():
        path = DEPOSIT / name
        if not path.exists():
            failures.append(f"{name} is missing; run paper/scripts/run_all.py")
            continue
        got = json.loads(path.read_text()).get("replicates")
        status = "ok" if got == want else "MISMATCH"
        print(f"  {name:32s} {str(got):>5s} replicates   expected {want:5d}   {status}")
        if got != want:
            failures.append(
                f"{name} was produced with {got} replicates, not {want}: "
                f"the deposited values no longer match the manuscript"
            )
    return failures


def check_rdkitjs_parity() -> list[str]:
    """The browser and the reference toolkit must count the same QED alerts.

    The response letter states that the two agree over the reference set.
    Asserting the deposited comparison keeps that sentence attached to a result
    rather than to the memory of one.
    """
    import json

    path = DEPOSIT / "rdkitjs_alert_parity.json"
    if not path.exists():
        return [f"{rel(path)} is missing; run paper/scripts/rdkitjs_alert_parity.py "
                "(it needs node and the RDKit.js bundle from e2e/fetch-fixtures.mjs)"]

    failures: list[str] = []
    d = json.loads(path.read_text())
    n, disagree = d.get("n_compounds"), d.get("n_disagree")
    status = "ok" if disagree == 0 else "MISMATCH"
    print(f"  {'RDKit.js vs RDKit Python':32s} {str(disagree):>5s} disagreements   "
          f"over {n} compounds   {status}")
    if disagree != 0:
        failures.append(
            f"RDKit.js disagreed with RDKit Python on {disagree} of {n} compounds"
        )
    if not d.get("smarts_identical"):
        failures.append(
            "the parity run did not compare rdkit.Chem.QED.StructuralAlertSmarts, "
            "so the agreement it reports is not evidence of parity"
        )
    if d.get("n_alert_smarts") != EXPECTED["qed_alert_smarts"]:
        failures.append(
            f"parity run compared {d.get('n_alert_smarts')} alert patterns, "
            f"not {EXPECTED['qed_alert_smarts']}"
        )
    # Two engines that both find nothing agree perfectly, so an agreement over a
    # sample carrying no alerts would be vacuous.
    if not d.get("alerts_total"):
        failures.append("the parity run found no alerts at all; its agreement is vacuous")
    return failures


def check_quoted_values() -> list[str]:
    """Values the manuscript quotes from a deposited JSON, asserted against it.

    Depositing a result only removes the possibility of drift once something
    reads it back. These are the numbers the text states to a given precision,
    checked at that precision -- comparing further would fail on the paper's own
    rounding rather than on a real disagreement.
    """
    import json

    # (file, dotted key, value as the manuscript prints it, format, where)
    quoted = [
        ("validate_qed.json", "fraction_with_alert", 0.581, "{:.3f}", "main.tex, letter"),
        ("validate_qed.json", "deviations.alert_correction_old_minus_new.mean",
         0.058, "{:.3f}", "letter"),
        ("validate_qed.json", "deviations.alert_correction_old_minus_new.rmse",
         0.103, "{:.3f}", "letter"),
        ("validate_qed.json", "deviations.residual_new_minus_canonical.mean",
         0.001, "{:.3f}", "main.tex, letter"),
        ("validate_qed.json", "deviations.residual_new_minus_canonical.rmse",
         0.009, "{:.3f}", "main.tex, letter"),
        ("validate_qed.json", "spearman_app_new_vs_canonical", 0.999, "{:.3f}", "main.tex"),
        ("validate_qed.json", "spearman_app_old_vs_canonical", 0.901, "{:.3f}", "letter"),
        ("pareto_sensitivity.json", "lipinski.observed", 0.901, "{:.3f}", "main.tex, si.tex"),
        ("pareto_sensitivity.json", "lipinski.null_mean", 0.888, "{:.3f}", "main.tex, si.tex"),
        ("pareto_sensitivity.json", "lipinski.null_sd", 0.022, "{:.3f}", "main.tex, si.tex"),
        ("pareto_sensitivity.json", "lipinski.p_permutation", 0.30, "{:.2f}", "main.tex, si.tex"),
        ("pareto_sensitivity.json", "composition.0.p_permutation", 0.020, "{:.3f}", "main.tex, si.tex"),
        ("pareto_sensitivity.json", "composition.1.p_permutation", 0.010, "{:.3f}", "main.tex, si.tex"),
        ("pareto_sensitivity.json", "composition.2.p_permutation", 0.005, "{:.3f}", "main.tex, si.tex"),
    ]

    def dig(obj, dotted: str):
        for part in dotted.split("."):
            obj = obj[int(part)] if part.isdigit() else obj[part]
        return obj

    failures: list[str] = []
    cache: dict[str, object] = {}
    for name, key, want, fmt, where in quoted:
        if name not in cache:
            path = DEPOSIT / name
            if not path.exists():
                failures.append(f"{name} is missing; run paper/scripts/run_all.py")
                cache[name] = None
            else:
                cache[name] = json.loads(path.read_text())
        doc = cache[name]
        if doc is None:
            continue
        try:
            got = dig(doc, key)
        except (KeyError, IndexError, TypeError):
            failures.append(f"{name} has no {key}; regenerate it")
            continue
        ok = fmt.format(got) == fmt.format(want)
        print(f"  {key:52s} {fmt.format(got):>6s}   {where:18s} "
              f"{'ok' if ok else 'MISMATCH'}")
        if not ok:
            failures.append(
                f"{name}:{key} is {fmt.format(got)}, but the manuscript states "
                f"{fmt.format(want)} in {where}"
            )
    return failures


def check_lipinski_withdrawal() -> list[str]:
    """A withdrawn claim needs its withdrawal to be robust, not just recorded.

    The Lipinski enrichment is withdrawn because the observation falls inside the
    null band. If that depended on the particular draw the withdrawal would be as
    weak as the claim it retracts, so the analysis is repeated at a second seed
    and both must agree that the observation is inside.
    """
    import json

    path = DEPOSIT / "pareto_sensitivity.json"
    if not path.exists():
        return [f"{rel(path)} is missing; run paper/scripts/run_all.py"]
    lip = json.loads(path.read_text()).get("lipinski")
    if not lip:
        return ["pareto_sensitivity.json has no lipinski section; regenerate it"]
    other = lip.get("seed_robustness") or {}
    both_inside = bool(lip.get("inside_ci95")) and bool(other.get("inside_ci95"))
    print(f"  {'Lipinski withdrawal, both seeds':52s} "
          f"{str(both_inside):>6s}   si.tex             "
          f"{'ok' if both_inside else 'MISMATCH'}")
    if not both_inside:
        return ["the Lipinski observation is inside the null band at one seed but not "
                "the other; the withdrawal cannot be stated as unconditional"]
    return []


def run(script: str, note: str, args: list[str], env: dict[str, str]) -> bool:
    path = SCRIPTS / script
    label = f"{script} {' '.join(args)}".strip()
    if not path.exists():
        print(f"  {label:34s}  skipped (not present)")
        return True
    print(f"  {label:34s}  {note}")
    result = subprocess.run([sys.executable, str(path), *args], env=env, cwd=str(ROOT))
    if result.returncode != 0:
        print(f"  FAILED: {script} exited {result.returncode}")
        return False
    return True


def run_group(title: str, entries: tuple, env: dict[str, str],
              extra: dict[str, list[str]]) -> list[str]:
    print(f"\n{title}")
    return [script for script, note in entries
            if not run(script, note, extra.get(script, []), env)]


def announce(title: str, entries: tuple) -> None:
    print(f"\n{title}")
    for script, note in entries:
        print(f"  {script:34s}  {note}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="verify reported numbers without writing any artefact")
    ap.add_argument("--quick", action="store_true",
                    help="fewer replicates; writes results to a scratch directory, "
                         "since a reduced run must not replace the deposited values")
    ap.add_argument("--network", action="store_true",
                    help="also run the scripts that query ChEMBL and ADMET-AI; they "
                         "refetch rather than reproduce, and overwrite deposited inputs")
    args = ap.parse_args()

    failures: list[str] = []

    print("Scripts in paper/scripts/")
    failures += check_inventory()

    print("\nDemonstration 1 — front sizes re-derived from the deposited data")
    failures += check_demonstration_1()

    print("\nQED structural-alert catalogue")
    failures += check_qed_alerts()

    print("\nDeposited results")
    failures += check_deposited_results()
    failures += check_rdkitjs_parity()

    print("\nValues the manuscript quotes from the deposit")
    failures += check_quoted_values()
    failures += check_lipinski_withdrawal()

    if not args.check:
        env = dict(os.environ)
        scratch = tempfile.mkdtemp(prefix="paretomol-figures-")
        env["PARETOMOL_FIGURE_OUT"] = scratch
        if args.quick:
            # A reduced run produces different numbers from the ones the
            # manuscript cites, so it must never overwrite the deposited
            # results. Redirect them to scratch. (This is not hypothetical:
            # a --quick run previously replaced the 200-replicate values with
            # 25-replicate ones, leaving the deposit disagreeing with the text.)
            env["PARETOMOL_RESULTS_OUT"] = scratch
            print("  --quick: results redirected to scratch, deposited values untouched")
        extra = {"pareto_null_controls.py": ["--quick"]} if args.quick else {}

        failures += run_group("Analyses", ANALYSES, env, extra)
        failures += run_group(f"Figures (-> {scratch})", FIGURE_SCRIPTS, env, extra)
        failures += run_group("Verification", VERIFICATION, env, extra)
        if args.network:
            failures += run_group("Network", NETWORK, env, extra)
        else:
            announce("Network (skipped; --network to run)", NETWORK)
        announce("Not driven by a reproduction run", NOT_DRIVEN)

        print(f"\nResults written to {rel(RESULTS)}")
        print(f"Figures written to {scratch} (committed figures untouched)")

    print()
    if failures:
        print(f"FAILED ({len(failures)}):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("All reported values reproduce.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
