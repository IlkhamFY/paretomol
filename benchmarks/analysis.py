#!/usr/bin/env python3
"""Generate paper-ready performance table from benchmark results."""
import json
from pathlib import Path

with open(Path(__file__).parent / "results.json") as f:
    data = json.load(f)

results = data["results"]

print("LaTeX table:")
print(r"""\begin{table}[h]
\centering
\caption{ParetoMol load time as a function of dataset size (CSV upload, measured in a headless Chromium browser, paretomol.com, 3 runs each). Time includes CSV parsing, RDKit.js descriptor computation, drug-likeness filter evaluation, and Pareto ranking.}
\label{tab:performance}
\begin{tabular}{rrrr}
\toprule
\textbf{Molecules} & \textbf{Mean (s)} & \textbf{Range (s)} & \textbf{Std (ms)} \\
\midrule""")

for r in results:
    n = r["n"]
    mean_s = r["mean_ms"] / 1000
    min_s = r["min_ms"] / 1000
    max_s = r["max_ms"] / 1000
    std_ms = r["std_ms"]
    print(f"  {n:>6} & {mean_s:.2f} & {min_s:.2f}--{max_s:.2f} & {std_ms:.0f} \\\\")

print(r"""\bottomrule
\end{tabular}
\end{table}""")

print()
print("Markdown table:")
print(f"| Molecules | Mean (s) | Min (s) | Max (s) | Std (ms) |")
print(f"|----------:|---------:|--------:|--------:|---------:|")
for r in results:
    n = r["n"]
    mean_s = r["mean_ms"] / 1000
    min_s = r["min_ms"] / 1000
    max_s = r["max_ms"] / 1000
    std_ms = r["std_ms"]
    print(f"| {n:>9} | {mean_s:>8.2f} | {min_s:>7.2f} | {max_s:>7.2f} | {std_ms:>8.0f} |")

# Scaling analysis
print()
print("Scaling analysis:")
ns = [r["n"] for r in results]
ms = [r["mean_ms"] for r in results]
import math
# Fit log-linear: log(t) ~ a*log(n) + b
log_n = [math.log(n) for n in ns]
log_t = [math.log(t) for t in ms]
n_pts = len(ns)
sum_x = sum(log_n); sum_y = sum(log_t)
sum_xx = sum(x*x for x in log_n); sum_xy = sum(x*y for x,y in zip(log_n, log_t))
slope = (n_pts*sum_xy - sum_x*sum_y) / (n_pts*sum_xx - sum_x**2)
print(f"  Power law exponent: t ~ n^{slope:.3f}")
print(f"  (1.0 = linear, 2.0 = quadratic)")
print(f"  Practical ceiling: {ns[-1]} molecules in {ms[-1]/1000:.1f}s")
