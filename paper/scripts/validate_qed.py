#!/usr/bin/env python3
"""Quantify ParetoMol's QED against the canonical RDKit implementation.

The QED arithmetic in src/utils/qed.ts is a direct transcription of RDKit's
rdkit.Chem.QED (same ADS coefficients, same weights), so the remaining question
is what the *descriptors* fed into it are. This script isolates exactly that by
calling RDKit's own qed() with substituted QEDproperties, rather than
re-implementing the ADS function -- a re-implementation would introduce its own
errors into a number the manuscript reports.

Three variants over the deposited FDA-approved reference set:

  canonical  rdkit.Chem.QED.qed(mol), the reference implementation
  app_new    canonical arithmetic fed with the descriptors the application
             computes, plus the canonical structural-alert count
  app_old    as app_new but with ALERTS pinned to 0 -- the behaviour before the
             alert term was implemented

This separates the two deviations the manuscript reports:

  app_old -> app_new    magnitude of the alert-term correction
  app_new -> canonical  residual definitional deviation. QED counts hydrogen
                        bond acceptors as the total number of matches to its own
                        SMARTS list, and aromatic rings via SSSR after deleting
                        aliphatic rings; the application computes NumHBA and
                        NumAromaticRings. The residual is disclosed, not hidden.

Every number printed is also written to paper/results/validate_qed.json, so the
values the manuscript quotes from this script have a machine-readable source and
can be asserted rather than transcribed.

Usage:  python3 paper/scripts/validate_qed.py
"""
from __future__ import annotations

import csv
import json
import math
import pathlib
import statistics
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _paths import FDA_CSV, RESULTS, rel as _rel  # noqa: E402

import rdkit  # noqa: E402
from rdkit import Chem, RDLogger  # noqa: E402
from rdkit.Chem import Crippen, MolSurf  # noqa: E402
from rdkit.Chem import rdMolDescriptors as rdmd  # noqa: E402
from rdkit.Chem import QED  # noqa: E402
from rdkit.Chem.QED import QEDproperties  # noqa: E402
from scipy.stats import spearmanr  # noqa: E402

RDLogger.DisableLog("rdApp.*")

OUT = RESULTS / "validate_qed.json"


def app_properties(mol, alerts: int) -> QEDproperties:
    """The descriptors ParetoMol feeds to QED, as RDKit.js computes them."""
    return QEDproperties(
        MW=rdmd._CalcMolWt(mol),                 # desc.amw -- average MW
        ALOGP=Crippen.MolLogP(mol),              # desc.CrippenClogP
        HBA=rdmd.CalcNumHBA(mol),                # desc.NumHBA (QED uses its own SMARTS)
        HBD=rdmd.CalcNumHBD(mol),                # desc.NumHBD
        PSA=MolSurf.TPSA(mol),                   # desc.tpsa
        ROTB=rdmd.CalcNumRotatableBonds(mol),    # desc.NumRotatableBonds (QED uses Strict)
        AROM=rdmd.CalcNumAromaticRings(mol),     # desc.NumAromaticRings (QED uses SSSR)
        ALERTS=alerts,
    )


def main() -> int:
    rows = list(csv.DictReader(FDA_CSV.open()))
    canonical, app_new, app_old, n_alerts = [], [], [], []

    for r in rows:
        mol = Chem.MolFromSmiles(r["smiles"])
        if mol is None:
            continue
        alerts = sum(1 for a in QED.StructuralAlerts if mol.HasSubstructMatch(a))
        canonical.append(QED.qed(mol))
        app_new.append(QED.qed(mol, qedProperties=app_properties(mol, alerts)))
        app_old.append(QED.qed(mol, qedProperties=app_properties(mol, 0)))
        n_alerts.append(alerts)

    def report(label, a, b):
        """Print one deviation summary and return it for the deposit."""
        d = [x - y for x, y in zip(a, b)]
        rec = {
            "mean": statistics.mean(d),
            "rmse": math.sqrt(sum(v * v for v in d) / len(d)),
            "max_abs": max(abs(v) for v in d),
        }
        print(f"  {label:34s} mean {rec['mean']:+.4f}   "
              f"RMSE {rec['rmse']:.4f}   max |d| {rec['max_abs']:.4f}")
        return rec

    with_alert = sum(1 for a in n_alerts if a)
    print(f"molecules: {len(canonical)}")
    print(f"alerts per molecule: mean {statistics.mean(n_alerts):.2f}  "
          f"median {statistics.median(n_alerts):.0f}  max {max(n_alerts)}  "
          f"with at least one: {100 * with_alert / len(n_alerts):.1f}%")
    print()
    deviations = {
        "alert_correction_old_minus_new":
            report("alert correction (old - new)", app_old, app_new),
        "residual_new_minus_canonical":
            report("residual (new - canonical)", app_new, canonical),
        "previous_error_old_minus_canonical":
            report("previous error (old - canonical)", app_old, canonical),
    }
    # scipy's rank correlation rather than a hand-rolled one: the manuscript
    # quotes these two figures, and a library statistic is one fewer place for
    # such a number to be quietly wrong. The hand-rolled version this replaced
    # agreed to 4e-7 -- it ranked tied QED values in input order rather than
    # midranking them -- which is well inside the precision reported.
    rho_new = float(spearmanr(app_new, canonical).statistic)
    rho_old = float(spearmanr(app_old, canonical).statistic)
    print()
    print(f"  Spearman rho, app_new vs canonical:   {rho_new:.4f}")
    print(f"  Spearman rho, app_old vs canonical:   {rho_old:.4f}")

    # n_rows accompanies n_compounds because unparseable SMILES are skipped
    # above: the two agreeing is what shows the sample to be the whole file.
    OUT.write_text(json.dumps({
        "n_compounds": len(canonical),
        "n_rows": len(rows),
        "source": _rel(FDA_CSV),
        "rdkit_version": rdkit.__version__,
        "alerts_per_molecule_mean": statistics.mean(n_alerts),
        "alerts_per_molecule_median": float(statistics.median(n_alerts)),
        "alerts_per_molecule_max": max(n_alerts),
        "molecules_with_alert": with_alert,
        "fraction_with_alert": with_alert / len(n_alerts),
        "deviations": deviations,
        "spearman_app_new_vs_canonical": rho_new,
        "spearman_app_old_vs_canonical": rho_old,
    }, indent=2) + "\n", encoding="utf-8")
    print(f"\nwrote {_rel(OUT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
