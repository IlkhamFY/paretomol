"""
Fig 4: Cross-class ADMET heatmap — v7 (clean).
600 DPI | double-column (6.73 in).
Okabe-Ito diverging at 0.5. Horizontal labels. Minimal chrome.
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _paths import LATEX

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import json
import os
from matplotlib.colors import LinearSegmentedColormap

DPI = 600
WIDTH = 6.73

plt.rcParams.update({
    'font.family':     'sans-serif',
    'font.sans-serif': ['Arial', 'Helvetica', 'DejaVu Sans'],
    'font.size':       8,
    'axes.labelsize':  9,
    'figure.dpi':      DPI,
    'savefig.dpi':     DPI,
    'savefig.bbox':    'tight',
    'savefig.pad_inches': 0.04,
})

OUT = str(LATEX)
os.makedirs(OUT, exist_ok=True)

with open(os.path.join(os.path.dirname(__file__), '..', 'cross_class_admet.json')) as f:
    data = json.load(f)

# Columns: Safety | CYP | Stress
endpoints  = ['hERG', 'DILI', 'AMES', 'ClinTox',
              'CYP1A2_Veith', 'CYP2D6_Veith', 'CYP3A4_Veith',
              'NR-AhR', 'SR-ARE']
ep_labels  = ['hERG', 'DILI', 'AMES', 'ClinTox',
              'CYP1A2', 'CYP2D6', 'CYP3A4',
              'AhR', 'ARE']

class_order  = ['hiv_protease', 'ssris', 'egfr', 'beta_blockers', 'statins', 'nsaids']
class_labels = ['HIV PI (n=8)', 'SSRIs (n=8)', 'EGFR (n=50)',
                '\u03b2-blockers (n=8)', 'Statins (n=8)', 'NSAIDs (n=10)']

def get_vals(cls, ep):
    return [c[ep] for c in data[cls] if ep in c and c[ep] is not None]

matrix = np.zeros((len(class_order), len(endpoints)))
for i, cls in enumerate(class_order):
    for j, ep in enumerate(endpoints):
        v = get_vals(cls, ep)
        matrix[i, j] = np.mean(v) if v else 0

# Okabe-Ito diverging: blue (safe) — white (0.5) — vermillion (risk)
cmap = LinearSegmentedColormap.from_list('oi_div', [
    (0.00, '#0072B2'),
    (0.25, '#7FBDD4'),
    (0.45, '#D6E8F0'),
    (0.50, '#F5F5F5'),
    (0.55, '#F0D0B8'),
    (0.75, '#E08050'),
    (1.00, '#D55E00'),
], N=512)

fig, ax = plt.subplots(figsize=(WIDTH, WIDTH * 0.42))

im = ax.imshow(matrix, cmap=cmap, aspect='auto', vmin=0, vmax=1,
               interpolation='nearest')

# Cell text with contrast
def lum(rgba):
    r, g, b = rgba[:3]
    def lin(c): return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)

for i in range(len(class_order)):
    for j in range(len(endpoints)):
        val = matrix[i, j]
        tc = 'white' if lum(cmap(val)) < 0.4 else '#222222'
        ax.text(j, i, f'{val:.2f}', ha='center', va='center',
                fontsize=7, color=tc, fontweight='medium')

# Axes
ax.set_xticks(range(len(endpoints)))
ax.set_xticklabels(ep_labels, fontsize=7.5, ha='center')
ax.set_yticks(range(len(class_order)))
ax.set_yticklabels(class_labels, fontsize=8)
ax.xaxis.set_ticks_position('top')
ax.tick_params(top=True, bottom=False, left=True, right=False, length=0)

# Thin white grid
for i in range(len(class_order) + 1):
    ax.axhline(i - 0.5, color='white', linewidth=0.8)
for j in range(len(endpoints) + 1):
    ax.axvline(j - 0.5, color='white', linewidth=0.8)

# Group separators (heavier)
for gb in [4, 7]:
    ax.axvline(gb - 0.5, color='#888888', linewidth=1.2, zorder=5)

ax.set_xlim(-0.5, len(endpoints) - 0.5)
ax.set_ylim(len(class_order) - 0.5, -0.5)

# Colorbar
cbar = plt.colorbar(im, ax=ax, shrink=0.85, pad=0.02, aspect=20)
cbar.set_label('Predicted probability', fontsize=8, labelpad=6)
cbar.ax.tick_params(labelsize=7)
cbar.set_ticks([0, 0.25, 0.5, 0.75, 1.0])
cbar.ax.axhline(y=0.5, color='#555555', linewidth=0.8, linestyle='--')

for sp in ax.spines.values():
    sp.set_visible(False)

plt.tight_layout()

for fmt, kw in [
    ('pdf',  {}),
    ('png',  {'dpi': 300}),
]:
    p = os.path.join(OUT, f'fig_cs3_heatmap.{fmt}')
    fig.savefig(p, format=fmt, **kw)
    print(f'  {fmt}: {os.path.getsize(p) // 1024} KB')

plt.close(fig)
print('Done — Fig 4 v7')
