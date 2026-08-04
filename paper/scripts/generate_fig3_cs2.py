"""
Fig 3: CS2 AhR controls boxplot — v5 final.
The bracket p-values are computed here from the same arrays the boxes are drawn
from. They were previously typeset into the annotation by hand, so the figure
asserted p-values that no deposited code derived and that nothing stopped from
drifting away from the data behind them.
RSC single-column (3.27 in), 600 DPI.
V5 fixes: uniform % label y, x-axis wrapping, y=1.0 line, darker box borders.
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
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from scipy import stats

DPI = 600
SINGLE_IN = 3.27

BLUE   = '#0072B2'   # Okabe-Ito blue  — EGFR (focal group)
ORANGE = '#D55E00'   # Okabe-Ito vermillion — non-EGFR controls
GREY   = '#999999'   # neutral — population baseline

plt.rcParams.update({
    'font.family':     'sans-serif',
    'font.sans-serif': ['Arial', 'Helvetica', 'DejaVu Sans'],
    'font.size':       8,
    'axes.labelsize':  8,
    'xtick.labelsize': 7.5,
    'ytick.labelsize': 7.5,
    'figure.dpi':      DPI,
    'savefig.dpi':     DPI,
    'savefig.bbox':    'tight',
    'savefig.pad_inches': 0.03,
    'axes.spines.top':   False,
    'axes.spines.right': False,
})

SCRIPTS = str(SCRIPTS)
OUT     = str(LATEX)

import pandas as pd

# EGFR top-50: use egfr_top50.csv (pChEMBL >= 8.92, n=50) — matches paper exactly
PAPER = str(PAPER)
df_egfr = pd.read_csv(f'{PAPER}/egfr_top50.csv')
egfr_ahr = df_egfr['NR-AhR'].dropna().tolist()

with open(f'{SCRIPTS}/control_kinase_inhibitors.json') as f:
    controls = json.load(f)
with open(f'{SCRIPTS}/population_baseline.json') as f:
    population = json.load(f)

control_ahr = [d['ahr'] for d in controls  if 'ahr' in d and d['ahr'] is not None]
pop_ahr     = [d['ahr'] for d in population if 'ahr' in d and d['ahr'] is not None]

groups   = [pop_ahr, control_ahr, egfr_ahr]
# FIX 3: "EGFR inhibitors\n(top 50)" — 2 lines, not 3
labels   = ['Approved drugs', 'Non-EGFR\nkinase inhibitors', 'EGFR inhibitors']
ns       = [len(g) for g in groups]
colors   = [GREY, ORANGE, BLUE]
positions = [1, 2, 3]
pcts     = [sum(1 for v in g if v > 0.5) / len(g) * 100 for g in groups]

fig, ax = plt.subplots(figsize=(SINGLE_IN, SINGLE_IN * 1.0))

bp = ax.boxplot(groups, positions=positions, widths=0.42, patch_artist=True,
                showfliers=False,
                medianprops=dict(color='black', linewidth=1.4),
                whiskerprops=dict(linewidth=0.8, color='#555555'),
                capprops=dict(linewidth=0.8, color='#555555'),
                boxprops=dict(linewidth=0.8))
for patch, color in zip(bp['boxes'], colors):
    patch.set_facecolor(color)
    # FIX 6: increase box edge alpha — use alpha=0.65 for face but keep full edge
    patch.set_alpha(0.65)
    patch.set_edgecolor(color)

# Jittered individual points
np.random.seed(42)
for g, pos, color in zip(groups, positions, colors):
    n = len(g)
    jitter = np.random.uniform(-0.12, 0.12, n)
    ax.scatter(np.full(n, pos) + jitter, g,
               c='white', s=5, alpha=0.85, linewidths=0.5,
               edgecolors=color, zorder=3)

# Classification threshold
ax.axhline(0.5, color='#444444', linestyle='--', linewidth=0.7, alpha=0.7)
ax.text(3.35, 0.505, '0.5', fontsize=6.5, color='#444444', va='bottom', ha='right')

# y=1.0 tick visible on axis is sufficient (no extra line needed)

# FIX 1 & 2: all percentage labels at same y=0.97
LABEL_Y = 0.97
for pct, pos in zip(pcts, positions):
    ax.text(pos, LABEL_Y, f'{pct:.0f}%', ha='center', va='bottom', fontsize=6.5,
            fontstyle='italic', color='#222222', zorder=5,
            bbox=dict(boxstyle='round,pad=0.08', fc='white', ec='none', alpha=0.85))

# Significance brackets. Two-sided Mann-Whitney, the test the manuscript and SI
# Tables S2-S3 report; verify_fig3_data.py checks these against the reported ones.
def bracket(x1, x2, y, h, txt):
    ax.plot([x1, x1, x2, x2], [y, y+h, y+h, y], color='#222222', linewidth=0.75)
    ax.text((x1+x2)/2, y+h+0.005, txt, ha='center', va='bottom', fontsize=6.5)


def p_annotation(p):
    """LaTeX 'p = m x 10^e' at the one decimal the bracket has room for."""
    mantissa, exponent = f'{p:.1e}'.split('e')
    return rf'$p = {mantissa}{{\times}}10^{{{int(exponent)}}}$'


_, p_control = stats.mannwhitneyu(egfr_ahr, control_ahr, alternative='two-sided')
_, p_pop = stats.mannwhitneyu(egfr_ahr, pop_ahr, alternative='two-sided')
print(f'  p(EGFR vs controls) = {p_control:.3e}   p(EGFR vs population) = {p_pop:.3e}')

bracket(2, 3, 1.03, 0.025, p_annotation(p_control))
bracket(1, 3, 1.10, 0.025, p_annotation(p_pop))

ax.set_ylabel('Predicted AhR activation', fontsize=8)
ax.set_xticks(positions)
ax.set_xticklabels([f'{l}\n(n\u202f=\u202f{n})' for l, n in zip(labels, ns)], fontsize=6.5)
ax.set_ylim(-0.02, 1.24)
ax.set_xlim(0.42, 3.58)
ax.tick_params(axis='x', length=0)
ax.tick_params(axis='y', length=3)

plt.tight_layout()

for fmt, kw in [
    ('pdf',  {}),
    ('tiff', {'dpi': DPI, 'pil_kwargs': {'compression': 'tiff_lzw'}}),
    ('png',  {'dpi': 300}),
]:
    p = f'{OUT}/fig_cs2_controls.{fmt}'
    fig.savefig(p, format=fmt, **kw)
    import os; print(f'  {fmt}: {os.path.getsize(p)//1024} KB')

plt.close(fig)
print('Done — Fig 3 v5')
