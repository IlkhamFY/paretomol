#!/usr/bin/env python3
"""Reviewer 2, Point 2.2 — compare compounds predicted to activate AhR (the 50
EGFR 4-anilinoquinazolines) with *known* AhR activators, using both molecular
properties and fingerprints.

Known AhR activators are a literature-curated set of well-established AhR
agonists/ligands (environmental PAHs/dioxins, synthetic flavones, endogenous
tryptophan-derived ligands, and drug AhR agonists). ChEMBL was unreachable from
the build environment; this canonical set is the standard reference for AhR
pharmacology and can be supplemented by a ChEMBL AhR-target pull when available.

Outputs: fig_ahr_known.{pdf,png} in the figure directory (paper/latex unless
PARETOMOL_FIGURE_OUT overrides it) and printed summary statistics.
Run from repo root:  python paper/scripts/cs2b_ahr_known.py
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _paths import EGFR_CSV, LATEX, SCRIPTS, rel

import csv, json, statistics as st
import numpy as np
from rdkit import Chem, RDLogger
from rdkit.Chem import Descriptors, rdMolDescriptors
from rdkit.Chem import rdFingerprintGenerator
from rdkit import DataStructs
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

RDLogger.DisableLog("rdApp.*")

# ── Known AhR activators (literature-curated canonical ligands) ──────────────
KNOWN_AHR = {
    "TCDD": "Clc1cc2Oc3cc(Cl)c(Cl)cc3Oc2cc1Cl",
    "Benzo[a]pyrene": "c1ccc2c(c1)cc1ccc3cccc4ccc2c1c34",
    # PubChem CID 1674 (C21H16, InChIKey PPQNQXQZIWHJRB-UHFFFAOYSA-N). The
    # previous string left a ring-fusion carbon four-connected while aromatic,
    # so the ring system admitted no Kekule structure and RDKit rejected it.
    "3-Methylcholanthrene": "Cc1ccc2cc3c(ccc4ccccc43)c3c2c1CC3",
    "7,12-DMBA": "Cc1c2ccccc2c(C)c2c1cc1ccccc1c2",
    "beta-Naphthoflavone": "O=c1cc(-c2ccccc2)oc2c1ccc1ccccc12",
    "alpha-Naphthoflavone": "O=c1cc(-c2ccccc2)c2c(o1)ccc1ccccc12",
    "Flavone": "O=c1cc(-c2ccccc2)oc2ccccc12",
    "FICZ": "O=Cc1ccc2c(c1)[nH]c1c2cc2[nH]c3ccccc3c2c1",
    "Indolo[3,2-b]carbazole": "c1ccc2c(c1)[nH]c1c2cc2[nH]c3ccccc3c2c1",
    "Indirubin": r"O=C1Nc2ccccc2/C1=C1\Nc2ccccc2C1=O",
    "Indole-3-carbinol": "OCc1c[nH]c2ccccc12",
    "DIM": "c1ccc2c(c1)[nH]cc2Cc1c[nH]c2ccccc12",
    "L-Kynurenine": "N[C@@H](CC(=O)c1ccccc1N)C(=O)O",
    "Omeprazole": "COc1ccc2[nH]c(S(=O)Cc3ncc(C)c(OC)c3C)nc2c1",
    "Leflunomide": "Cc1oncc1C(=O)Nc1ccc(C(F)(F)F)cc1",
    "Tranilast": "COc1ccc(/C=C/C(=O)Nc2ccccc2C(=O)O)cc1OC",
    "Quercetin": "O=c1c(O)c(-c2ccc(O)c(O)c2)oc2cc(O)cc(O)c12",
    "Laquinimod": "CCN(c1ccccc1)C(=O)c1c(O)c2c(Cl)cccc2n(C)c1=O",
}

mfpgen = rdFingerprintGenerator.GetMorganGenerator(radius=2, fpSize=2048)

def featurize(smiles):
    m = Chem.MolFromSmiles(smiles)
    if m is None:
        return None
    heavy = m.GetNumHeavyAtoms()
    arom = sum(1 for a in m.GetAtoms() if a.GetIsAromatic())
    return dict(
        mol=m, fp=mfpgen.GetFingerprint(m),
        MW=Descriptors.MolWt(m), LogP=Descriptors.MolLogP(m),
        TPSA=Descriptors.TPSA(m),
        AromRings=rdMolDescriptors.CalcNumAromaticRings(m),
        FracArom=arom / heavy if heavy else 0.0,
    )

def load_known():
    """The reference set is hand-curated and fixed, so an entry RDKit cannot
    parse is a defect in the deposit, not a runtime condition to tolerate:
    skipping it would report every statistic below over a smaller set than the
    dictionary above describes, without the reader ever seeing which compound
    went missing.
    """
    out, bad = [], []
    for name, smi in KNOWN_AHR.items():
        f = featurize(smi)
        if f is None:
            bad.append(f"{name}: {smi}")
            continue
        f["name"] = name
        out.append(f)
    if bad:
        raise SystemExit(
            f"{len(bad)} of {len(KNOWN_AHR)} KNOWN_AHR entries did not parse; "
            "correct the SMILES rather than reporting statistics over a "
            "reduced set:\n  " + "\n  ".join(bad)
        )
    return out

def load_csv(path, smi_col="SMILES"):
    out = []
    for row in csv.DictReader(open(path)):
        f = featurize(row[smi_col])
        if f:
            f["name"] = row.get("Name", "")
            out.append(f)
    return out

def load_baseline():
    out = []
    for d in json.load(open(SCRIPTS / "population_baseline.json")):
        f = featurize(d["smiles"])
        if f:
            f["name"] = d.get("name", "")
            out.append(f)
    return out

def max_tanimoto_to(query_fp, ref_fps):
    return max(DataStructs.BulkTanimotoSimilarity(query_fp, ref_fps))

def summarize(label, items, keys):
    print(f"\n{label} (n={len(items)})")
    for k in keys:
        vals = [it[k] for it in items]
        print(f"  {k:10s} mean={st.mean(vals):7.2f}  median={st.median(vals):7.2f}  sd={st.pstdev(vals):6.2f}")

def main():
    print("Loading sets…")
    known = load_known()
    egfr = load_csv(EGFR_CSV)
    base = load_baseline()
    print(f"known AhR activators: {len(known)} | EGFR: {len(egfr)} | baseline: {len(base)}")

    known_fps = [k["fp"] for k in known]
    keys = ["MW", "LogP", "TPSA", "AromRings", "FracArom"]
    summarize("Known AhR activators", known, keys)
    summarize("EGFR inhibitors (predicted AhR-active)", egfr, keys)
    summarize("Approved-drug baseline", base, keys)

    # Fingerprint proximity to the known-AhR set
    egfr_sim = [max_tanimoto_to(e["fp"], known_fps) for e in egfr]
    base_sim = [max_tanimoto_to(b["fp"], known_fps) for b in base]
    # nearest known-AhR neighbour for each EGFR compound
    nn = []
    for e in egfr:
        sims = DataStructs.BulkTanimotoSimilarity(e["fp"], known_fps)
        j = int(np.argmax(sims))
        nn.append((e["name"], known[j]["name"], sims[j]))
    print("\nMax ECFP4 Tanimoto to nearest KNOWN AhR activator:")
    print(f"  EGFR     mean={st.mean(egfr_sim):.3f}  median={st.median(egfr_sim):.3f}")
    print(f"  baseline mean={st.mean(base_sim):.3f}  median={st.median(base_sim):.3f}")
    from scipy.stats import mannwhitneyu
    U, p = mannwhitneyu(egfr_sim, base_sim, alternative="greater")
    print(f"  Mann-Whitney (EGFR > baseline): U={U:.0f}  p={p:.2e}")
    print("  example nearest neighbours (EGFR -> known AhR | Tanimoto):")
    for a, b, s in sorted(nn, key=lambda x: -x[2])[:5]:
        print(f"    {a:14s} -> {b:22s} {s:.3f}")

    # Property-level tests: EGFR and known-AhR vs baseline, and EGFR vs known-AhR
    print("\nProperty comparisons (Mann-Whitney U):")
    for key in ("AromRings", "FracArom", "LogP"):
        e = [i[key] for i in egfr]; k = [i[key] for i in known]; b = [i[key] for i in base]
        _, p_eb = mannwhitneyu(e, b, alternative="greater")
        _, p_kb = mannwhitneyu(k, b, alternative="greater")
        _, p_ek = mannwhitneyu(e, k, alternative="two-sided")
        print(f"  {key:10s} EGFR>baseline p={p_eb:.2e} | known>baseline p={p_kb:.2e} | EGFR vs known p={p_ek:.2f}")

    # ── Figure: (a) property space, (b) similarity-to-known distribution ──────
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(8.4, 3.4))
    groups = [("Approved baseline", base, "#9ca3af", 8, 0.35),
              ("EGFR (pred. AhR+)", egfr, "#d1495b", 26, 0.9),
              ("Known AhR activators", known, "#1b9e77", 60, 0.95)]
    for label, items, color, sz, al in groups:
        ax1.scatter([i["LogP"] for i in items], [i["AromRings"] for i in items],
                    s=sz, c=color, alpha=al, edgecolors="none", label=label)
    ax1.set_xlabel("cLogP"); ax1.set_ylabel("# aromatic rings")
    ax1.set_title("(a) Property space", fontsize=10, loc="left")
    ax1.legend(fontsize=7, frameon=False, loc="upper left")

    bins = np.linspace(0, 1, 26)
    ax2.hist(base_sim, bins=bins, density=True, color="#9ca3af", alpha=0.6, label="baseline")
    ax2.hist(egfr_sim, bins=bins, density=True, color="#d1495b", alpha=0.7, label="EGFR")
    ax2.set_xlabel("max ECFP4 Tanimoto to a known AhR activator")
    ax2.set_ylabel("density")
    ax2.set_title("(b) Fingerprint proximity", fontsize=10, loc="left")
    ax2.legend(fontsize=7, frameon=False)
    fig.tight_layout()
    for ext in ("pdf", "png"):
        fig.savefig(LATEX / f"fig_ahr_known.{ext}", dpi=200, bbox_inches="tight")
    print(f"\nwrote {rel(LATEX)}/fig_ahr_known.{{pdf,png}}")

if __name__ == "__main__":
    main()
