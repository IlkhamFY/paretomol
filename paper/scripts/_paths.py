"""Repository-relative paths for the deposited analysis scripts.

Every script previously hard-coded absolute paths from the author's machine
(``C:/Users/...``), so none of them ran anywhere else — the deposited code was
not reproducible even in principle. Scripts now resolve their inputs and
outputs through this module.

The repository root is located by searching upward for marker files rather than
by counting parent directories, because the scripts live at two different
depths (``paper/`` and ``paper/scripts/``, plus ``benchmarks/``) and a fixed
``parents[n]`` is wrong for at least one of them.

Usage from any script in the repository::

    import sys, pathlib
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    from _paths import PAPER, LATEX, RESULTS, FDA_CSV
"""
from __future__ import annotations

import os
import pathlib

_MARKERS = ("package.json", "paper")


def _find_root(start: pathlib.Path) -> pathlib.Path:
    for candidate in (start, *start.parents):
        if all((candidate / m).exists() for m in _MARKERS):
            return candidate
    raise RuntimeError(
        f"could not locate the repository root above {start}; "
        f"expected a directory containing {' and '.join(_MARKERS)}"
    )


ROOT = _find_root(pathlib.Path(__file__).resolve())

PAPER = ROOT / "paper"
SCRIPTS = PAPER / "scripts"

# Figure output directory. Overridable so a reproduction run can regenerate
# every figure into a scratch directory and be compared against the committed
# ones, rather than overwriting them in place: a verification run that mutates
# the artefact it is verifying is not a verification.
LATEX = pathlib.Path(os.environ.get("PARETOMOL_FIGURE_OUT", str(PAPER / "latex")))
# Overridable for the same reason as LATEX: a reduced or exploratory run
# must be able to write somewhere other than the deposited results.
RESULTS = pathlib.Path(os.environ.get("PARETOMOL_RESULTS_OUT", str(PAPER / "results")))
FIGURES = PAPER / "figures"
BENCHMARKS = ROOT / "benchmarks"

# Deposited datasets.
FDA_CSV = PAPER / "fda_approved_1949.csv"
EGFR_CSV = PAPER / "egfr_top50.csv"

LATEX.mkdir(parents=True, exist_ok=True)

for _d in (RESULTS, FIGURES):
    _d.mkdir(parents=True, exist_ok=True)


def rel(path: pathlib.Path) -> str:
    """Path for display, relative to the repository when it lies inside it.

    Output directories are overridable, so a path may point outside the
    repository; `relative_to` raises in that case, which would turn a
    successful run into a crash in its final print statement.
    """
    try:
        return str(pathlib.Path(path).relative_to(ROOT))
    except ValueError:
        return str(path)
