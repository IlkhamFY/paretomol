"""Generate publication-quality figure v4: FDA drugs P6 vs P9 Pareto scatter.
V4 fixes: alpha, leader lines, legend position, Ro5 labels, panel titles, output filenames."""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
try:
    from _paths import PAPER, LATEX, RESULTS, FIGURES, FDA_CSV, EGFR_CSV, BENCHMARKS, SCRIPTS
except ImportError:  # script lives outside paper/scripts
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent / 'scripts'))
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'paper' / 'scripts'))
    from _paths import PAPER, LATEX, RESULTS, FIGURES, FDA_CSV, EGFR_CSV, BENCHMARKS, SCRIPTS

import csv
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

plt.rcParams.update({
    'font.family':     'sans-serif',
    'font.sans-serif': ['Arial', 'Helvetica', 'DejaVu Sans'],
})

BLUE = '#0072B2'
VERMILLION = '#D55E00'  # True Okabe-Ito vermillion, more saturated
GREY = '#BBBBBB'
DASHED = '#888888'

# The original read an absolute path to an intermediate JSON dump on the
# author's machine. The deposited CSV carries the same records and is what
# ships with the manuscript, so the figure regenerates from the repository.
with open(FDA_CSV, newline='') as f:
    drugs = []
    for row in csv.DictReader(f):
        d = {'name': row.get('name'), 'chembl_id': row.get('chembl_id')}
        for key in ('MW', 'LogP', 'HBD', 'HBA', 'TPSA', 'RotBonds',
                    'admet_hERG', 'admet_DILI', 'admet_ClinTox'):
            try:
                d[key] = float(row[key])
            except (KeyError, TypeError, ValueError):
                d[key] = None
        drugs.append(d)

required = ['MW', 'LogP', 'HBD', 'HBA', 'TPSA', 'RotBonds', 'admet_hERG', 'admet_DILI', 'admet_ClinTox']
valid = [d for d in drugs if all(d.get(k) is not None for k in required)]
names = [d.get('name', d.get('chembl_id', '?')) for d in valid]

data6 = np.array([[d['MW'], d['LogP'], d['HBD'], d['HBA'], d['TPSA'], d['RotBonds']] for d in valid])
data9 = np.column_stack([
    data6,
    np.array([d['admet_hERG'] for d in valid]),
    np.array([d['admet_DILI'] for d in valid]),
    np.array([d['admet_ClinTox'] for d in valid]),
])

def pareto_optimal(data):
    n = len(data)
    is_optimal = np.ones(n, dtype=bool)
    for i in range(n):
        if not is_optimal[i]:
            continue
        for j in range(n):
            if i == j or not is_optimal[j]:
                continue
            if np.all(data[j] <= data[i]) and np.any(data[j] < data[i]):
                is_optimal[i] = False
                break
    return is_optimal

p6_mask = pareto_optimal(data6)
p9_mask = pareto_optimal(data9)
gained = (~p6_mask) & p9_mask
retained = p6_mask & p9_mask
dominated = ~p9_mask
mw = np.array([d['MW'] for d in valid])
logp = np.array([d['LogP'] for d in valid])

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(6.73, 3.3))

for ax, is_p9 in [(ax1, False), (ax2, True)]:
    mask = p9_mask if is_p9 else p6_mask

    # FIX 4: gray dominated points alpha 0.15 → 0.25
    ax.scatter(mw[~mask], logp[~mask], c=GREY, s=3, alpha=0.25, linewidths=0,
               zorder=1, marker='o', rasterized=True, label=f'Dominated ({(~mask).sum():,})')

    if is_p9:
        # Retained (blue) below rescued (orange) — rescued is the novel finding
        ax.scatter(mw[retained], logp[retained], c=BLUE, s=16, alpha=0.6,
                   linewidths=0.3, edgecolors='black', zorder=3, marker='o',
                   label=f'Retained P6-optimal ({retained.sum()})')
        ax.scatter(mw[gained], logp[gained], c=VERMILLION, s=16, alpha=0.7,
                   linewidths=0.3, edgecolors='#333333', zorder=4, marker='^',
                   label=f'Rescued by safety ({gained.sum()})')
    else:
        ax.scatter(mw[mask], logp[mask], c=BLUE, s=18, alpha=0.9,
                   linewidths=0.3, edgecolors='black', zorder=4, marker='o',
                   label=f'Pareto-optimal ({mask.sum()})')

    # Ro5 thresholds
    ax.axvline(x=500, color=DASHED, linestyle='--', linewidth=0.8, alpha=0.7)
    ax.axhline(y=5, color=DASHED, linestyle='--', linewidth=0.8, alpha=0.7)

    ax.set_xlabel('Molecular weight (Da)', fontsize=8, fontfamily='sans-serif')
    # Only left panel gets y-axis label
    if not is_p9:
        ax.set_ylabel('logP (Wildman–Crippen)', fontsize=8, fontfamily='sans-serif')
    else:
        ax.set_ylabel('')
    ax.set_xlim(80, 920)
    ax.set_ylim(-10, 14)
    ax.tick_params(labelsize=7)

    # FIX 3: legend in panel (b) → 'upper right'; panel (a) stays 'upper left'
    legend_loc = 'upper right' if is_p9 else 'upper left'
    leg = ax.legend(fontsize=6.5, loc=legend_loc, framealpha=1.0, edgecolor='#CCCCCC',
                    facecolor='white', markerscale=1.1, handletextpad=0.3, borderpad=0.4)

    panel = '(a)' if not is_p9 else '(b)'
    ax.text(0.02, 0.98, panel, transform=ax.transAxes, fontsize=9, fontweight='bold',
            fontfamily='sans-serif', va='top', ha='left')

    # FIX 5: updated panel titles
    title = 'P6: physicochemical' if not is_p9 else 'P9: + predicted hERG, DILI, ClinTox'
    ax.set_title(title, fontsize=8, fontfamily='sans-serif', pad=4)

    # Ro5 threshold labels — both panels, consistent position, darker
    ax.text(510, 12.5, 'MW \u2264 500', fontsize=7, color='#555555', fontfamily='sans-serif', fontstyle='italic')
    ax.text(85,  5.4,  'logP \u2264 5', fontsize=7, color='#555555', fontfamily='sans-serif', fontstyle='italic')

# Only 3 labels in panel (b), placed in empty corners with long leader lines
notable = {}
for i, name in enumerate(names):
    if name in ['METFORMIN', 'CAPTOPRIL', 'AMANTADINE'] and gained[i]:
        notable[name] = i

# Place in clearly empty regions of the plot
label_cfg = {
    'METFORMIN':   (700, -6),    # Far bottom-right (empty), nudged up from axis
    'CAPTOPRIL':   (700, -3),    # Right (empty)
    'AMANTADINE':  (700, 0),     # Right (empty)
}

for name, idx in notable.items():
    tx, ty = label_cfg[name]
    # FIX 2: increase linewidth from 0.5 → 0.8, increase arrowhead size
    ax2.annotate(name.capitalize(), xy=(mw[idx], logp[idx]),
                 xytext=(tx, ty), textcoords='data',
                 fontsize=7.5, fontfamily='sans-serif', color='black',
                 arrowprops=dict(arrowstyle='->', color='black', lw=0.8,
                                 mutation_scale=12,
                                 connectionstyle='arc3,rad=0.15'),
                 bbox=dict(boxstyle='round,pad=0.2', fc='white', ec='#AAAAAA',
                           alpha=0.95, lw=0.4),
                 zorder=10)

# Summary annotation — lower right, away from legend (LaTeX arrow for PDF safety)
summary = 'Front: 50 $\\rightarrow$ 181\n(+131 rescued, 3.6$\\times$)'
ax2.text(0.97, 0.03, summary, transform=ax2.transAxes, fontsize=7,
         fontfamily='sans-serif', va='bottom', ha='right',
         bbox=dict(boxstyle='round,pad=0.5', fc='#F5F5F5', ec='#AAAAAA', lw=0.5))

plt.tight_layout(w_pad=1.2)

# FIX 8: output as fig2.pdf/tiff/png (not fig2_fda.*)
outdir = str(LATEX)
fig.savefig(f'{outdir}/fig2.pdf', dpi=600, bbox_inches='tight', pad_inches=0.03)
fig.savefig(f'{outdir}/fig2.tiff', dpi=600, bbox_inches='tight', pad_inches=0.03)
fig.savefig(f'{outdir}/fig2.png', dpi=150, bbox_inches='tight', pad_inches=0.03)
print("Saved fig2.pdf, fig2.tiff, fig2.png")
plt.close()
