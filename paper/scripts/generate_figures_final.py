"""
MolParetoLab -- Publication figures FINAL
RSC Digital Discovery | 600 DPI | vector PDF primary

Strategy: Place labels at EXACT data coordinates (not offset points).
Each label position hand-tuned in data space to guarantee zero overlap.
"""

import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _paths import LATEX

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import Ellipse
from matplotlib.colors import LinearSegmentedColormap
import numpy as np
import os

DPI       = 600
SINGLE_IN = 3.27
DOUBLE_IN = 6.73
LFS       = 7.5    # label font size
AFS       = 9      # axis label
TFS       = 8      # tick labels
LEGFS     = 7.5
MS        = 40     # marker area (slightly smaller to give labels more room)

plt.rcParams.update({
    'font.family':        'sans-serif',
    'font.sans-serif':    ['Arial', 'Helvetica', 'DejaVu Sans'],
    'font.size':          8,
    'axes.labelsize':     AFS,
    'xtick.labelsize':    TFS,
    'ytick.labelsize':    TFS,
    'legend.fontsize':    LEGFS,
    'figure.dpi':         DPI,
    'savefig.dpi':        DPI,
    'savefig.bbox':       'tight',
    'savefig.pad_inches': 0.05,
    'axes.spines.top':    False,
    'axes.spines.right':  False,
    'axes.linewidth':     0.6,
    'xtick.major.width':  0.6,
    'ytick.major.width':  0.6,
})

BLUE   = '#0072B2'
ORANGE = '#D55E00'
GREY   = '#BBBBBB'
LCOLOR = '#333333'
ARROW  = dict(arrowstyle='-', color='#BBBBBB', lw=0.4, shrinkA=0, shrinkB=4)

OUT = str(LATEX)
os.makedirs(OUT, exist_ok=True)


def save(fig, name):
    for fmt, kw in [('pdf',  {}),
                    ('tiff', dict(dpi=DPI, pil_kwargs={'compression': 'tiff_lzw'})),
                    ('png',  dict(dpi=300))]:
        p = os.path.join(OUT, f'{name}.{fmt}')
        fig.savefig(p, format=fmt, **kw)
        print(f'  {name}.{fmt}: {os.path.getsize(p)//1024} KB')
    plt.close(fig)


# ---------- data -----------------------------------------------------------
NAMES = ['imatinib','nilotinib','sunitinib','erlotinib',
         'dasatinib','gefitinib','sorafenib','lapatinib']
MW    = np.array([493.6, 449.4, 397.5, 393.4, 488.0, 446.9, 464.8, 581.1])
LogP  = np.array([4.59,  5.86,  3.93,  3.41,  3.31,  4.28,  5.55,  6.14])
TPSA  = np.array([86.3,  79.8,  61.4,  74.7, 106.5,  68.7,  92.4, 106.4])
P6    = [True, True,  True, True, False, True,  True, False]
P9    = [True, False, True, True, False, True,  True, False]

hERG  = [0.984,0.938,0.893,0.806,0.910,0.964,0.569,0.978]
DILI  = [0.912,0.988,0.686,0.972,0.961,0.890,0.989,0.975]
Ames  = [0.183,0.238,0.820,0.519,0.356,0.604,0.157,0.807]
CTox  = [0.869,0.291,0.609,0.304,0.520,0.763,0.130,0.612]
Carc  = [0.119,0.073,0.322,0.091,0.221,0.127,0.261,0.292]
AhR   = [0.69, 0.94, 0.44, 0.89, 0.51, 0.82, 0.52, 0.94]
CYP   = [0.15, 0.86, 0.75, 0.61, 0.14, 0.55, 0.39, 0.82]


def pareto_step(xs, ys, mask):
    pts = sorted([(xs[i], ys[i]) for i in range(len(xs)) if mask[i]],
                 key=lambda p: p[0])
    if len(pts) < 2:
        return [], []
    ox, oy = [pts[0][0]], [pts[0][1]]
    for x, y in pts[1:]:
        ox += [x, x]; oy += [oy[-1], y]
    return ox, oy


def plot_pts(ax, xd, yd, mask):
    for i in range(len(xd)):
        c = BLUE if mask[i] else ORANGE
        m = 'o' if mask[i] else 's'
        ax.scatter(xd[i], yd[i], c=c, s=MS, marker=m,
                   edgecolors='white', linewidths=0.4, zorder=10)


def place_labels(ax, xd, yd, labels):
    """Place labels at exact data coordinates with leader lines.
    labels: list of (name, lx, ly, ha) where lx,ly are the label position
    in data coordinates, and ha is 'left','right', or 'center'."""
    for name, lx, ly, ha in labels:
        i = NAMES.index(name)
        ax.annotate(name, xy=(xd[i], yd[i]), xytext=(lx, ly),
                    fontsize=LFS, color=LCOLOR, ha=ha, va='center',
                    arrowprops=ARROW)


def leg_handles():
    return [
        plt.Line2D([0],[0], marker='o', ls='', mfc=BLUE, mec='white',
                   ms=5, mew=0.4, label='Pareto-optimal'),
        plt.Line2D([0],[0], marker='s', ls='', mfc=ORANGE, mec='white',
                   ms=5, mew=0.4, label='Dominated'),
    ]


# ======================================================================
# Fig 2: Two-panel Pareto scatter
# ======================================================================
# Panel a: MW vs LogP
# Data sorted by LogP: dasatinib(488,3.31) erlotinib(393,3.41) sunitinib(397,3.93)
#   gefitinib(447,4.28) imatinib(494,4.59) sorafenib(465,5.55) nilotinib(449,5.86) lapatinib(581,6.14)
#
# Label placement strategy:
#   - Bottom cluster (dasa/erlot/sunit): spread vertically, go RIGHT of cluster
#   - Middle (gefit/imat): one right, one left
#   - Top cluster (soraf/nilo/lapat): spread, lapat goes left (far right point)

LABELS_LOGP = [
    # (name, label_x, label_y, ha)
    # Legend is upper-left → avoid (320-420, 5.5-7.0)
    # Separate gefitinib(447,4.28) from imatinib(494,4.59): more vertical gap
    # Separate nilotinib(449,5.86) from sorafenib(465,5.55): more vertical gap
    ('dasatinib',  535,  2.6, 'left'),     # right+below
    ('erlotinib',  340,  2.6, 'left'),     # left+below
    ('sunitinib',  340,  3.9, 'left'),     # left, at same height
    ('gefitinib',  500,  3.8, 'left'),     # right, pushed DOWN from imatinib
    ('imatinib',   545,  4.8, 'left'),     # far right (gap: gefit 3.8, imat 4.8, soraf 5.6)
    ('sorafenib',  520,  5.6, 'left'),     # right (0.8 gap from imat, 0.9 from nilo)
    ('nilotinib',  500,  6.5, 'left'),     # right+above
    ('lapatinib',  535,  6.9, 'left'),     # right+far above
]

# Panel b: MW vs TPSA
# Data sorted by TPSA: sunitinib(397,61) gefitinib(447,69) erlotinib(393,75)
#   nilotinib(449,80) imatinib(494,86) sorafenib(465,92) lapatinib(581,106) dasatinib(488,107)
LABELS_TPSA = [
    # erlotinib(393,75) needs to go far enough left to clear marker
    # nilotinib(449,80) and gefitinib(447,69): same MW, separate in TPSA
    ('sunitinib',  335,  54, 'left'),      # left+below
    ('gefitinib',  500,  62, 'left'),      # right+below
    ('erlotinib',  335,  78, 'left'),      # far left
    ('nilotinib',  500,  76, 'left'),      # right, slight down from its point
    ('imatinib',   550,  90, 'left'),      # far right
    ('sorafenib',  550,  98, 'left'),      # far right+up
    ('lapatinib',  545,  113, 'left'),     # right
    ('dasatinib',  425,  113, 'left'),     # left of lapatinib
]


def fig2():
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(DOUBLE_IN, 3.0))

    def panel(ax, yd, ylabel, ythr, labels, xlim, ylim):
        ax.set_xlim(*xlim)
        ax.set_ylim(*ylim)
        ax.axvline(500,  color=GREY, ls='--', lw=0.5, zorder=1)
        ax.axhline(ythr, color=GREY, ls='--', lw=0.5, zorder=1)
        plot_pts(ax, MW, yd, P6)
        ox, oy = pareto_step(MW, yd, P6)
        if ox:
            ax.plot(ox, oy, color=BLUE, lw=0.7, ls=':', alpha=0.35, zorder=5)
        place_labels(ax, MW, yd, labels)
        ax.set_xlabel('Molecular weight (Da)')
        ax.set_ylabel(ylabel)

    panel(ax1, LogP, 'LogP (Wildman\u2013Crippen)', 5.0, LABELS_LOGP,
          xlim=(320, 620), ylim=(2.3, 7.0))
    panel(ax2, TPSA, 'TPSA (\u00c5\u00b2)', 140.0, LABELS_TPSA,
          xlim=(320, 620), ylim=(48, 120))

    ax1.legend(handles=leg_handles(), loc='upper left', frameon=True,
               framealpha=0.95, edgecolor='#DDDDDD', borderpad=0.4,
               handlelength=1.2, handletextpad=0.4, labelspacing=0.3)

    ax1.text(-0.14, 1.04, 'a', transform=ax1.transAxes,
             fontsize=10, fontweight='bold')
    ax2.text(-0.14, 1.04, 'b', transform=ax2.transAxes,
             fontsize=10, fontweight='bold')

    plt.tight_layout(w_pad=2.5)
    save(fig, 'fig2')


# ======================================================================
# Fig 3: P9 Pareto with nilotinib dominated
# ======================================================================
LABELS_P9 = [
    # Legend is lower-right → avoid (520-630, 2.3-3.5)
    ('dasatinib',  430,  2.5, 'left'),     # LEFT of its point
    ('erlotinib',  340,  2.8, 'left'),
    ('sunitinib',  340,  3.9, 'left'),
    ('gefitinib',  500,  3.8, 'left'),     # pushed DOWN from imatinib
    ('imatinib',   545,  5.1, 'left'),     # pushed UP from gefitinib
    ('sorafenib',  520,  5.8, 'left'),     # pushed UP away from imatinib
    # nilotinib handled separately
    ('lapatinib',  535,  6.6, 'left'),
]


def fig3():
    fig, ax = plt.subplots(figsize=(SINGLE_IN, 3.0))

    ax.set_xlim(320, 630)
    ax.set_ylim(2.3, 7.2)

    ax.axvline(500, color=GREY, ls='--', lw=0.5, zorder=1)
    ax.axhline(5.0, color=GREY, ls='--', lw=0.5, zorder=1)

    plot_pts(ax, MW, LogP, P9)
    ox, oy = pareto_step(MW, LogP, P9)
    if ox:
        ax.plot(ox, oy, color=BLUE, lw=0.7, ls=':', alpha=0.35, zorder=5)

    place_labels(ax, MW, LogP, LABELS_P9)

    # Nilotinib: special annotation (now dominated)
    ni = NAMES.index('nilotinib')
    ax.annotate('nilotinib\n(now dominated)',
                xy=(MW[ni], LogP[ni]),
                xytext=(380, 6.8),
                fontsize=LFS, color=ORANGE, ha='left', va='center',
                fontstyle='italic',
                arrowprops=dict(arrowstyle='->', color=ORANGE, lw=0.8,
                                connectionstyle='arc3,rad=0.15',
                                shrinkA=0, shrinkB=4))

    ax.legend(handles=leg_handles(), loc='lower right', frameon=True,
              framealpha=0.95, edgecolor='#DDDDDD', borderpad=0.4,
              handlelength=1.2, labelspacing=0.3)
    ax.set_xlabel('Molecular weight (Da)')
    ax.set_ylabel('LogP (Wildman\u2013Crippen)')
    plt.tight_layout()
    save(fig, 'fig3')


# ======================================================================
# Fig 4: BOILED-Egg
# ======================================================================
# TPSA vs LogP
# Data:  sunit(61,3.93) gefit(69,4.28) erlot(75,3.41) nilo(80,5.86)
#        imat(86,4.59) soraf(92,5.55) dasa(107,3.31) lapat(106,6.14)
LABELS_EGG = [
    # Strategy: split labels into LEFT zone (x<50) and RIGHT zone (x>120)
    # Left zone: sunitinib, gefitinib, erlotinib, sorafenib, nilotinib
    # Right zone: imatinib, dasatinib, lapatinib
    # Stagger y-positions by 0.8 LogP units minimum for legibility
    # Data: sunit(61,3.93) gefit(69,4.28) erlot(75,3.41) nilo(80,5.86)
    #        imat(86,4.59) soraf(92,5.55) dasa(107,3.31) lapat(106,6.14)
    ('erlotinib',  20,   2.5, 'left'),    # far left, bottom
    ('sunitinib',  20,   3.4, 'left'),    # far left, low
    ('gefitinib',  20,   4.2, 'left'),    # far left, mid
    ('imatinib',  125,   4.5, 'left'),    # right, mid
    ('sorafenib',  20,   5.5, 'left'),    # far left, high
    ('nilotinib',  20,   6.3, 'left'),    # far left, top
    ('dasatinib', 125,   3.0, 'left'),    # right, low
    ('lapatinib', 125,   6.3, 'left'),    # right, top
]


def fig4():
    fig, ax = plt.subplots(figsize=(SINGLE_IN, 3.2))

    ax.set_facecolor('#F0F0F0')

    # GI ellipse: center (71.05, 2.29), semi-axes (142.08, 6.13)
    gi = Ellipse(xy=(71.05, 2.29), width=142.08*2, height=6.13*2,
                 fc='white', ec='#999999', lw=0.8, zorder=1)
    ax.add_patch(gi)
    # BBB ellipse: center (38.0, 2.5), semi-axes (70.0, 3.5)
    bbb = Ellipse(xy=(38.0, 2.5), width=70.0*2, height=3.5*2,
                  fc='#FFF8E1', ec='#B8860B', lw=0.8, zorder=2)
    ax.add_patch(bbb)

    def in_ell(t, l, cx, cy, a, b):
        return ((t-cx)/a)**2 + ((l-cy)/b)**2 <= 1.0

    for i in range(len(NAMES)):
        if in_ell(TPSA[i], LogP[i], 38, 2.5, 70, 3.5):
            c = BLUE
        elif in_ell(TPSA[i], LogP[i], 71.05, 2.29, 142.08, 6.13):
            c = BLUE
        else:
            c = ORANGE
        ax.scatter(TPSA[i], LogP[i], c=c, s=MS,
                   marker='o', edgecolors='white', lw=0.4, zorder=10)

    place_labels(ax, TPSA, LogP, LABELS_EGG)

    # Full GI ellipse visible: extends to TPSA 213, LogP 8.42
    ax.set_xlim(-15, 220)
    ax.set_ylim(-2.0, 9.0)
    ax.set_xlabel('TPSA (\u00c5\u00b2)')
    ax.set_ylabel('LogP (Wildman\u2013Crippen)')

    rh = [mpatches.Patch(fc='#FFF8E1', ec='#B8860B', lw=0.6,
                         label='BBB penetrant (predicted)'),
          mpatches.Patch(fc='white', ec='#999999', lw=0.6,
                         label='GI absorbed (predicted)'),
          mpatches.Patch(fc='#F0F0F0', ec='#CCCCCC', lw=0.6,
                         label='Poorly absorbed')]
    ax.legend(handles=rh, loc='lower left', frameon=True,
              framealpha=0.95, edgecolor='#DDDDDD',
              fontsize=LEGFS, handlelength=1.2, labelspacing=0.3)
    plt.tight_layout()
    save(fig, 'fig4')


# ======================================================================
# Fig 5: ADMET toxicity heatmap
# ======================================================================
def fig5():
    endpoints = ['hERG', 'DILI', 'Ames', 'ClinTox',
                 'Carc.', 'AhR', 'CYP1A2']
    data = np.array([hERG, DILI, Ames, CTox, Carc, AhR, CYP]).T
    mean_risk = data.mean(axis=1)
    order = np.argsort(-mean_risk)
    data  = data[order]
    names = [NAMES[i] for i in order]
    means = mean_risk[order]
    nC, nR = len(endpoints), len(names)

    def h2r(h):
        h = h.lstrip('#')
        return tuple(int(h[j:j+2],16)/255 for j in (0,2,4))

    segs = [(0.00,'#FFFFFF'),(0.25,'#FFF7BC'),(0.45,'#FFE082'),
            (0.55,'#FFB300'),(0.65,'#E65100'),(0.78,'#8B1A00'),
            (0.90,'#4A0030'),(1.00,'#1A000E')]
    pos = [s[0] for s in segs]; rgb = [h2r(s[1]) for s in segs]
    cmap = LinearSegmentedColormap('risk', {
        'red':   [(p,c[0],c[0]) for p,c in zip(pos,rgb)],
        'green': [(p,c[1],c[1]) for p,c in zip(pos,rgb)],
        'blue':  [(p,c[2],c[2]) for p,c in zip(pos,rgb)],
    }, N=256)

    fig = plt.figure(figsize=(DOUBLE_IN, 2.8))
    gs = fig.add_gridspec(2, 2, width_ratios=[6.0,0.65],
                          height_ratios=[1.0,0.06],
                          hspace=0.50, wspace=0.04)
    ax_h = fig.add_subplot(gs[0,0])
    ax_m = fig.add_subplot(gs[0,1])
    ax_c = fig.add_subplot(gs[1,0])

    im = ax_h.imshow(data, cmap=cmap, aspect='auto', vmin=0, vmax=1)

    ax_h.set_xticks(range(nC))
    ax_h.set_xticklabels(endpoints, fontsize=TFS)
    ax_h.xaxis.set_ticks_position('top')
    ax_h.xaxis.set_label_position('top')
    ax_h.tick_params(axis='x', pad=3, length=0)
    ax_h.set_yticks(range(nR))
    ax_h.set_yticklabels(names, fontsize=TFS)
    ax_h.tick_params(axis='y', length=0)

    for i in range(nR):
        for j in range(nC):
            v = data[i,j]
            tc = 'white' if v > 0.63 else '#111111'
            wt = 'bold' if v > 0.5 else 'normal'
            ax_h.text(j, i, f'{v:.2f}', ha='center', va='center',
                      fontsize=7, color=tc, fontweight=wt)

    for x in np.arange(-0.5, nC, 1): ax_h.axvline(x, color='white', lw=1.2)
    for y in np.arange(-0.5, nR, 1): ax_h.axhline(y, color='white', lw=1.2)
    for sp in ax_h.spines.values():
        sp.set_visible(True); sp.set_linewidth(0.6); sp.set_color('#999999')

    ax_m.set_xlim(0,1); ax_m.set_ylim(-0.5, nR-0.5); ax_m.invert_yaxis()
    for sp in ax_m.spines.values(): sp.set_linewidth(0.6); sp.set_color('#999999')
    ax_m.set_xticks([0.5])
    ax_m.set_xticklabels(['Mean'], fontsize=7.5, fontweight='bold', color='#444444')
    ax_m.xaxis.set_ticks_position('top'); ax_m.xaxis.set_label_position('top')
    ax_m.tick_params(axis='x', pad=3, length=0); ax_m.set_yticks([])
    for i in range(nR):
        mr = means[i]
        tc = 'white' if mr > 0.63 else '#111111'
        ax_m.add_patch(plt.Rectangle((0,i-0.5),1,1,color=cmap(mr),zorder=0))
        ax_m.text(0.5, i, f'{mr:.2f}', ha='center', va='center',
                  fontsize=7, color=tc,
                  fontweight='bold' if mr > 0.5 else 'normal')

    cb = plt.colorbar(im, cax=ax_c, orientation='horizontal')
    cb.set_label('Predicted probability', fontsize=7.5, labelpad=3)
    cb.ax.tick_params(labelsize=7)
    cb.outline.set_linewidth(0.4)
    cb.ax.axvline(0.5, color='#333333', lw=1.0, ls='--')
    cb.ax.text(0.5, 1.7, '0.5', ha='center', va='bottom', fontsize=7,
               color='#333333', transform=cb.ax.transAxes)
    fig.delaxes(fig.add_subplot(gs[1,1]))
    save(fig, 'fig5')


if __name__ == '__main__':
    print('MolParetoLab figures FINAL\n')
    fig2(); print()
    fig3(); print()
    fig4(); print()
    fig5(); print()
    print('Done.')
