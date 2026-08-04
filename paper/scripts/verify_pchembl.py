import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
try:
    from _paths import PAPER, LATEX, RESULTS, FIGURES, FDA_CSV, EGFR_CSV, BENCHMARKS, SCRIPTS
except ImportError:  # script lives outside paper/scripts
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent / 'scripts'))
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'paper' / 'scripts'))
    from _paths import PAPER, LATEX, RESULTS, FIGURES, FDA_CSV, EGFR_CSV, BENCHMARKS, SCRIPTS

import csv, numpy as np

with open(str(EGFR_CSV)) as f:
    rows = list(csv.DictReader(f))

compounds = []
for r in rows:
    compounds.append({
        'pchembl': float(r['pChEMBL']),
        'herg': float(r['hERG']),
        'ames': float(r['AMES']),
    })

def is_dominated(i, comps):
    for j in range(len(comps)):
        if i == j: continue
        c, d = comps[i], comps[j]
        if (d['pchembl'] >= c['pchembl'] and d['herg'] <= c['herg'] and d['ames'] <= c['ames']):
            if (d['pchembl'] > c['pchembl'] or d['herg'] < c['herg'] or d['ames'] < c['ames']):
                return True
    return False

pareto = [c for i, c in enumerate(compounds) if not is_dominated(i, compounds)]
dominated = [c for i, c in enumerate(compounds) if is_dominated(i, compounds)]

dom_pchembl = np.mean([c['pchembl'] for c in dominated])
par_pchembl = np.mean([c['pchembl'] for c in pareto])

print(f'Dominated mean pChEMBL: {dom_pchembl:.4f} (rounds to {dom_pchembl:.2f})')
print(f'Pareto mean pChEMBL: {par_pchembl:.4f} (rounds to {par_pchembl:.2f})')
