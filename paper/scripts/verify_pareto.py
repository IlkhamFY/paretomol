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
    reader = csv.DictReader(f)
    rows = list(reader)

compounds = []
for r in rows:
    compounds.append({
        'name': r['Name'],
        'pchembl': float(r['pChEMBL']),
        'herg': float(r['hERG']),
        'ames': float(r['AMES']),
        'dili': float(r['DILI']),
        'ahr': float(r['NR-AhR']),
    })

def is_dominated(i, compounds):
    for j in range(len(compounds)):
        if i == j:
            continue
        c = compounds[i]
        d = compounds[j]
        # j is better: higher pchembl, lower herg, lower ames
        if (d['pchembl'] >= c['pchembl'] and d['herg'] <= c['herg'] and d['ames'] <= c['ames']):
            if (d['pchembl'] > c['pchembl'] or d['herg'] < c['herg'] or d['ames'] < c['ames']):
                return True
    return False

pareto = []
dominated = []
for i, c in enumerate(compounds):
    if not is_dominated(i, compounds):
        pareto.append(c)
    else:
        dominated.append(c)

print(f'Pareto optimal: {len(pareto)} of {len(compounds)}')

for c in pareto:
    nm = c['name']
    print(f'  {nm}: pCh={c["pchembl"]:.2f}, hERG={c["herg"]:.3f}, AMES={c["ames"]:.3f}, DILI={c["dili"]:.3f}, AhR={c["ahr"]:.3f}')

pareto_pchembl = np.mean([c['pchembl'] for c in pareto])
dom_pchembl = np.mean([c['pchembl'] for c in dominated])
pareto_herg = np.mean([c['herg'] for c in pareto])
dom_herg = np.mean([c['herg'] for c in dominated])
pareto_ames = np.mean([c['ames'] for c in pareto])
dom_ames = np.mean([c['ames'] for c in dominated])

print(f'\nMean pChEMBL: pareto={pareto_pchembl:.2f}, dominated={dom_pchembl:.2f}')
print(f'Mean hERG: pareto={pareto_herg:.3f}, dominated={dom_herg:.3f}')
print(f'Mean AMES: pareto={pareto_ames:.3f}, dominated={dom_ames:.3f}')

# Check CHEMBL339416 specifically
for c in compounds:
    if c['name'] == 'CHEMBL339416':
        print(f'\nCHEMBL339416: pChEMBL={c["pchembl"]:.2f}, hERG={c["herg"]:.3f}, AMES={c["ames"]:.3f}, DILI={c["dili"]:.3f}, AhR={c["ahr"]:.3f}')
