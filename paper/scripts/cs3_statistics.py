"""Compute cross-class statistical tests for CS3."""
import json
import numpy as np
from scipy import stats
from itertools import combinations

with open("paper/cross_class_admet.json") as f:
    data = json.load(f)

endpoints = ["hERG", "DILI", "NR-AhR", "CYP1A2_Veith", "CYP2D6_Veith",
             "CYP3A4_Veith", "CYP2C9_Veith", "AMES", "ClinTox",
             "SR-ARE", "SR-MMP", "SR-ATAD5", "SR-p53", "SR-HSE"]
class_order = ["hiv_protease", "ssris", "egfr", "beta_blockers", "statins", "nsaids"]
class_labels = {
    "hiv_protease": "HIV PI", "ssris": "SSRIs", "egfr": "EGFR",
    "beta_blockers": "Beta-blockers", "statins": "Statins", "nsaids": "NSAIDs"
}

def get_vals(cls, ep):
    return [c[ep] for c in data[cls] if ep in c and c[ep] is not None]

print("=" * 70)
print("KRUSKAL-WALLIS TESTS (6 classes)")
print("=" * 70)
for ep in endpoints:
    groups = [get_vals(cls, ep) for cls in class_order]
    if all(len(g) > 0 for g in groups):
        H, p = stats.kruskal(*groups)
        sig = "***" if p < 0.001 else ("**" if p < 0.01 else ("*" if p < 0.05 else "ns"))
        print(f"  {ep:20s}: H={H:8.3f}, p={p:.2e} ({sig})")

print()
print("=" * 70)
print("CLASS MEANS (HIV PI | SSRIs | EGFR | Beta-bl | Statins | NSAIDs)")
print("=" * 70)
for ep in endpoints:
    vals_per_class = []
    for cls in class_order:
        v = get_vals(cls, ep)
        vals_per_class.append(f"{np.mean(v):.3f}" if v else "N/A")
    sep = " | "
    print(f"  {ep:20s}: {sep.join(vals_per_class)}")

print()
print("=" * 70)
print("PAIRWISE MANN-WHITNEY U (hERG) — Bonferroni for 15 pairs")
print("=" * 70)
n_pairs = 15
alpha_bonf = 0.05 / n_pairs
for c1, c2 in combinations(class_order, 2):
    v1, v2 = get_vals(c1, "hERG"), get_vals(c2, "hERG")
    U, p = stats.mannwhitneyu(v1, v2, alternative="two-sided")
    sig = "*" if p < alpha_bonf else ""
    lab1, lab2 = class_labels[c1], class_labels[c2]
    print(f"  {lab1:>14s} vs {lab2:<14s}: U={U:6.0f}, p={p:.2e} {sig}")

print()
print("=" * 70)
print("PAIRWISE MANN-WHITNEY U (DILI) — Bonferroni for 15 pairs")
print("=" * 70)
for c1, c2 in combinations(class_order, 2):
    v1, v2 = get_vals(c1, "DILI"), get_vals(c2, "DILI")
    U, p = stats.mannwhitneyu(v1, v2, alternative="two-sided")
    sig = "*" if p < alpha_bonf else ""
    lab1, lab2 = class_labels[c1], class_labels[c2]
    print(f"  {lab1:>14s} vs {lab2:<14s}: U={U:6.0f}, p={p:.2e} {sig}")

# Effect sizes (eta-squared from Kruskal-Wallis)
print()
print("=" * 70)
print("EFFECT SIZES (eta-squared from KW: H/(n-1))")
print("=" * 70)
n_total = sum(len(data[cls]) for cls in class_order)
for ep in ["hERG", "DILI", "NR-AhR", "CYP1A2_Veith", "CYP2D6_Veith", "CYP3A4_Veith"]:
    groups = [get_vals(cls, ep) for cls in class_order]
    if all(len(g) > 0 for g in groups):
        H, p = stats.kruskal(*groups)
        eta_sq = H / (n_total - 1)
        size = "large" if eta_sq > 0.14 else ("medium" if eta_sq > 0.06 else "small")
        print(f"  {ep:20s}: eta^2={eta_sq:.3f} ({size})")

# NSAID DILI specificity — verify the orthogonal risk claim
print()
print("=" * 70)
print("NSAID RISK PROFILE (verifying orthogonal risk axes)")
print("=" * 70)
nsaid_means = {}
for ep in ["hERG", "AMES", "ClinTox", "NR-AhR", "DILI"]:
    v = get_vals("nsaids", ep)
    m = np.mean(v)
    nsaid_means[ep] = m
    # Rank among 6 classes
    all_means = [(cls, np.mean(get_vals(cls, ep))) for cls in class_order]
    all_means.sort(key=lambda x: x[1], reverse=True)
    rank = [i+1 for i, (c, _) in enumerate(all_means) if c == "nsaids"][0]
    print(f"  {ep:20s}: mean={m:.3f}, rank={rank}/6 (1=highest)")
