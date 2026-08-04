#!/usr/bin/env python3
"""Reviewer 2, Point 2.1 — compare ADMET-AI predictions for the rescued drugs
against published experimental/clinical reference data.

As a computational tool ParetoMol does not generate wet-lab measurements; this
script pairs the model's predictions (already in paper/fda_approved_1949.csv)
with established experimental/clinical reference values for the six rescued
drugs (cardiac/hERG-QT liability, oral bioavailability, Ames mutagenicity, and
clinical hepatotoxicity/DILI), curated from FDA labels, DrugBank, and the
primary literature. Emits a LaTeX table and a concordance summary.

Run from repo root:  python paper/scripts/cs1_experimental.py
"""
import csv, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]

DRUGS = ["METFORMIN", "ALLOPURINOL", "CAPTOPRIL", "AMANTADINE", "FOSFOMYCIN", "FLUOROURACIL"]

# Curated experimental / clinical reference values (with provenance notes).
# F = reported oral bioavailability; status fields summarize clinical/assay evidence.
REFERENCE = {
    "METFORMIN":    dict(F="50-60%",  cardiac="No QT/hERG liability",        ames="Negative",            dili="No significant hepatotoxicity"),
    "ALLOPURINOL":  dict(F="80-90%",  cardiac="No QT liability",             ames="Negative",            dili="Rare severe (DRESS/hypersensitivity hepatitis)"),
    "CAPTOPRIL":    dict(F="60-75%",  cardiac="No QT liability",             ames="Negative",            dili="Rare cholestatic injury"),
    "AMANTADINE":   dict(F="86-94%",  cardiac="No significant QT",           ames="Negative",            dili="Very low"),
    "FOSFOMYCIN":   dict(F="30-40%",  cardiac="No QT liability",             ames="Negative",            dili="Very low"),
    "FLUOROURACIL": dict(F="erratic (IV-dosed)", cardiac="Vasospastic angina (non-hERG)", ames="Negative/equivocal", dili="Reported hepatotoxicity"),
}

PRED_COLS = {"hERG": "admet_hERG", "DILI": "admet_DILI", "AMES": "admet_AMES",
             "F": "admet_Bioavailability_Ma"}


def load_predictions():
    rows = {r["name"].upper(): r for r in csv.DictReader(open(ROOT / "paper/fda_approved_1949.csv"))}
    out = {}
    for d in DRUGS:
        r = rows[d]
        out[d] = {k: float(r[c]) for k, c in PRED_COLS.items()}
    return out


def concord(pred, lo=0.35, hi=0.65):
    """Map a probability to low/uncertain/high."""
    return "low" if pred < lo else ("high" if pred > hi else "mid")


def main():
    pred = load_predictions()
    # Console concordance summary
    print("Predicted vs reference concordance:")
    for d in DRUGS:
        p, ref = pred[d], REFERENCE[d]
        print(f"\n{d.title()}")
        print(f"  hERG pred={p['hERG']:.3f} ({concord(p['hERG'])})   | clinical cardiac: {ref['cardiac']}")
        print(f"  DILI pred={p['DILI']:.3f} ({concord(p['DILI'])})   | clinical hepatic: {ref['dili']}")
        print(f"  AMES pred={p['AMES']:.3f} ({concord(p['AMES'])})   | assay Ames:       {ref['ames']}")
        print(f"  F    pred={p['F']:.3f} ({concord(p['F'])})   | reported oral F:  {ref['F']}")

    # LaTeX table
    lines = [
        r"\begin{table}[h]", r"\centering",
        r"\caption{Predicted (ADMET-AI) vs.\ published experimental/clinical reference data for the six rescued drugs. Predicted values are positive-class probabilities; $F$ is the predicted high-bioavailability probability. Reference values from FDA labels, DrugBank, and the primary literature.}",
        r"\label{tbl:rescued_concordance}",
        r"\small",
        r"\begin{tabular}{lcccccc}",
        r"\toprule",
        r"Drug & hERG & cardiac (clinical) & DILI & hepatic (clinical) & $F_\mathrm{pred}$ & oral $F$ (lit.) \\",
        r"\midrule",
    ]
    for d in DRUGS:
        p, ref = pred[d], REFERENCE[d]
        lines.append(
            f"{d.title()} & {p['hERG']:.2f} & {ref['cardiac']} & {p['DILI']:.2f} & {ref['dili']} & {p['F']:.2f} & {ref['F']} \\\\"
        )
    lines += [r"\bottomrule", r"\end{tabular}", r"\end{table}"]
    table = "\n".join(lines)
    out = ROOT / "paper/scripts/rescued_concordance_table.tex"
    out.write_text(table)
    print("\nwrote", out)
    print("\n" + table)


if __name__ == "__main__":
    main()
