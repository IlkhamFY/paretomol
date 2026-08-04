import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
try:
    from _paths import PAPER, LATEX, RESULTS, FIGURES, FDA_CSV, EGFR_CSV, BENCHMARKS, SCRIPTS
except ImportError:  # script lives outside paper/scripts
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent / 'scripts'))
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'paper' / 'scripts'))
    from _paths import PAPER, LATEX, RESULTS, FIGURES, FDA_CSV, EGFR_CSV, BENCHMARKS, SCRIPTS

import csv, numpy as np
from scipy import stats

with open(str(EGFR_CSV)) as f:
    rows = list(csv.DictReader(f))

ahr = np.array([float(r['NR-AhR']) for r in rows])
cyp1a2 = np.array([float(r['CYP1A2_Veith']) for r in rows])
are = np.array([float(r['SR-ARE']) for r in rows])
mmp = np.array([float(r['SR-MMP']) for r in rows])
dili = np.array([float(r['DILI']) for r in rows])

endpoints = {'AhR': ahr, 'CYP1A2': cyp1a2, 'ARE': are, 'MMP': mmp, 'DILI': dili}
names = ['AhR', 'CYP1A2', 'ARE', 'MMP', 'DILI']

print('Full Pearson correlation matrix:')
header = '        ' + '  '.join(f'{n:>7s}' for n in names)
print(header)
for n1 in names:
    row_vals = []
    for n2 in names:
        r, p = stats.pearsonr(endpoints[n1], endpoints[n2])
        row_vals.append(f'{r:7.3f}')
    print(f'{n1:>7s}  ' + '  '.join(row_vals))
