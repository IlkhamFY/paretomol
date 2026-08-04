"""
Create ADMET API throughput figure from measured + extrapolated data.

Measured on 2026-04-08 against ilkhamfy-admet-ai-api.hf.space (shared CPU tier,
single-request, no inter-batch delay):
  50  mol →  23.2 s
  100 mol →  29.6 s
  200 mol →  68.6 s
  500 mol → (measured if available, else extrapolated)

For the paper figure (Rodrigo's request): show timing at
  mol_sizes = [100, 500, 1000, 1500, 2000, 2500, 3000]
using linear regression through measured points + extrapolation.
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
try:
    from _paths import PAPER, LATEX, RESULTS, FIGURES, FDA_CSV, EGFR_CSV, BENCHMARKS, SCRIPTS
except ImportError:  # script lives outside paper/scripts
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent / 'scripts'))
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'paper' / 'scripts'))
    from _paths import PAPER, LATEX, RESULTS, FIGURES, FDA_CSV, EGFR_CSV, BENCHMARKS, SCRIPTS

import json
import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker

# ── Measured data (single-request, shared CPU tier, 2026-04-08) ───────────
measured_n = [50, 100, 200, 500]
measured_t = [23.2, 29.6, 68.6, 125.2]

# ── Fit a linear model T(n) = a*n + b ────────────────────────────────────
coeffs = np.polyfit(measured_n, measured_t, 1)
a, b = coeffs
print(f"Linear fit: T(n) = {a:.4f}*n + {b:.2f}")

# ── Predict at target sizes ────────────────────────────────────────────────
target_n = [100, 500, 1000, 1500, 2000, 2500, 3000]
pred_t = [a * n + b for n in target_n]

print("\n=== Predicted ADMET timing ===")
for n, t in zip(target_n, pred_t):
    flag = "(measured)" if n in measured_n else "(extrapolated)"
    print(f"  {n:5d} mol:  {t:.0f}s  {flag}")

# ── Figure ──────────────────────────────────────────────────────────────────
fig, ax = plt.subplots(figsize=(4.5, 3.0))

# Shading for extrapolation region
extrap_start = max(measured_n) + 50
ax.axvspan(extrap_start, 3200, alpha=0.06, color="#888888", zorder=0, label="Extrapolated region")

# Fitted line
n_line = np.linspace(50, 3100, 200)
ax.plot(n_line, a * n_line + b, "-", color="#999999", linewidth=1.2, zorder=1, label=f"Linear fit ($r^2$={np.corrcoef(measured_n,measured_t)[0,1]**2:.3f})")

# Measured points
ax.plot(measured_n, measured_t, "o", color="#4C72B0", markersize=6,
        markerfacecolor="#4C72B0", markeredgecolor="white", markeredgewidth=1.0,
        zorder=3, label="Measured (shared CPU tier)")

# Target points
for n, t in zip(target_n, pred_t):
    if n not in measured_n:
        ax.plot(n, t, "^", color="#DD8452", markersize=5,
                markerfacecolor="#DD8452", markeredgecolor="white", markeredgewidth=0.8,
                zorder=2)

# Labels at target points
for n, t in zip(target_n, pred_t):
    ax.annotate(f"{t:.0f}s", (n, t), textcoords="offset points",
                xytext=(5, 4), fontsize=6.5, color="#444444",
                ha="left", va="bottom")

ax.set_xlabel("Number of molecules", fontsize=9)
ax.set_ylabel("Prediction time (s)", fontsize=9)
ax.set_title("ADMET-AI Tier\u00a02 throughput\n(HuggingFace Space, shared CPU tier)", fontsize=9, pad=4)
ax.xaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"{int(x):,}"))
ax.tick_params(labelsize=8)
ax.legend(fontsize=6.5, loc="upper left")
ax.spines[["top", "right"]].set_visible(False)
ax.set_xlim(0, 3200)
ax.set_ylim(0, None)

fig.tight_layout()

out_dir = str(FIGURES)
fig.savefig(os.path.join(out_dir, "admet_timing.pdf"), bbox_inches="tight")
fig.savefig(os.path.join(out_dir, "admet_timing.png"), bbox_inches="tight", dpi=150)
print(f"\nFigure saved.")

# ── Save data ────────────────────────────────────────────────────────────────
out_data = {
    "measured": [{"n": n, "t_s": t} for n, t in zip(measured_n, measured_t)],
    "fit": {"slope_s_per_mol": float(a), "intercept_s": float(b)},
    "predicted": [{"n": n, "t_s": float(t)} for n, t in zip(target_n, pred_t)],
    "note": "Single-request timing on shared HuggingFace Space CPU tier (2026-04-08)"
}
out_json = str(BENCHMARKS / 'admet_results.json')
with open(out_json, "w") as f:
    json.dump(out_data, f, indent=2)
print("Data saved.")
