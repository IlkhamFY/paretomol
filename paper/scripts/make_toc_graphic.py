#!/usr/bin/env python3
"""Generate the Table-of-Contents (TOC) graphic for the Digital Discovery submission.

Renders the safety-augmented Pareto rescue (Demonstration 1) at the journal's TOC
size (<= 8 cm wide x 4 cm high): 1,949 FDA drugs in MW-LogP space, with the
physicochemical Pareto-optimal set, the compounds rescued by adding predicted
safety objectives, and the dominated remainder.

Writes toc_graphic.{pdf,png} to the figure directory (paper/latex unless
PARETOMOL_FIGURE_OUT overrides it).
Run from repo root:  python paper/scripts/make_toc_graphic.py
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _paths import FDA_CSV, LATEX, rel

import csv
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

P6 = ["MW", "LogP", "HBD", "HBA", "TPSA", "RotBonds"]
SAFE = ["admet_hERG", "admet_DILI", "admet_ClinTox"]


def load():
    rows = list(csv.DictReader(open(FDA_CSV)))
    def col(c):
        return np.array([float(r[c]) for r in rows])
    phys = np.column_stack([col(c) for c in P6])
    safe = np.column_stack([col(c) for c in SAFE])
    return rows, phys, safe


def pareto_mask(X):
    """Boolean mask of non-dominated rows (all objectives minimized)."""
    n = X.shape[0]
    nd = np.ones(n, dtype=bool)
    for i in range(n):
        if not nd[i]:
            continue
        # j dominates i if j <= i on all and < on at least one
        le = np.all(X <= X[i], axis=1)
        lt = np.any(X < X[i], axis=1)
        dom = le & lt
        dom[i] = False
        if np.any(dom):
            nd[i] = False
    return nd


def main():
    rows, phys, safe = load()
    mw = phys[:, 0]; logp = phys[:, 1]
    p6 = pareto_mask(phys)
    p9 = pareto_mask(np.column_stack([phys, safe]))
    rescued = p9 & ~p6
    print(f"P6-optimal={p6.sum()}  P9-optimal={p9.sum()}  rescued={rescued.sum()}")

    # TOC size: 8 cm x 4 cm
    fig, ax = plt.subplots(figsize=(8 / 2.54, 4 / 2.54))
    dom = ~p9
    ax.scatter(mw[dom], logp[dom], s=4, c="#d9d9d9", edgecolors="none", label="dominated", rasterized=True)
    ax.scatter(mw[rescued], logp[rescued], s=12, marker="^", c="#e07b39", edgecolors="none", label=f"rescued by safety ({rescued.sum()})")
    ax.scatter(mw[p6], logp[p6], s=12, c="#2f6f8f", edgecolors="none", label=f"Pareto-optimal ({p6.sum()})")
    ax.axhline(5, ls="--", lw=0.5, c="#888"); ax.axvline(500, ls="--", lw=0.5, c="#888")
    ax.set_xlim(0, 900); ax.set_ylim(-6, 9)
    ax.set_xlabel("MW (Da)", fontsize=7); ax.set_ylabel("cLogP", fontsize=7)
    ax.tick_params(labelsize=6)
    ax.set_title("Safety objectives rescue 131 drugs hidden by\nphysicochemical Pareto screening", fontsize=7, loc="left")
    ax.legend(fontsize=5.2, frameon=False, loc="lower right", handletextpad=0.3, borderpad=0.2)
    fig.tight_layout(pad=0.3)
    for ext in ("pdf", "png"):
        fig.savefig(LATEX / f"toc_graphic.{ext}", dpi=300, bbox_inches="tight")
    print(f"wrote {rel(LATEX)}/toc_graphic.{{pdf,png}}")

    blurb = ("ParetoMol, a free browser-based tool, computes Pareto-optimal trade-offs across "
             "molecular safety and pharmacokinetic objectives, surfacing class-level liabilities "
             "and rescued drug-like compounds invisible to single-property screening.")
    print(f"\nTOC blurb ({len(blurb)} chars):\n{blurb}")


if __name__ == "__main__":
    main()
