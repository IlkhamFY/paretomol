"""Which way is better for an imported column.

When the name does not say, the column is left out of the objective set.
Guessing would silently invert the ranking: maximising IC50 keeps the least
potent compounds, and nothing downstream would say so.
"""

from __future__ import annotations

import re
from typing import Optional, Sequence

Direction = Optional[str]

METADATA = frozenset({
    "assayid", "assaytype", "assaychemblid", "confidence", "confidencescore",
    "year", "docid", "documentid", "moleculechemblid", "chemblid", "targetid",
    "targetchemblid", "pubmedid", "doi", "reference", "source", "standardtype",
    "standardunits", "standardrelation", "units", "relation", "index", "id",
    "name", "smiles", "inchikey", "batch", "lot",
})

RAW_ACTIVITY = frozenset({"ic50", "ec50", "kd", "ki", "mic", "gi50", "kiapp"})
P_SCALED = frozenset({"pic50", "pki", "pkd", "pec50", "pmic", "pgi50", "pchembl"})

_LIABILITY = re.compile(r"(toxic|tox$|herg|dili|clintox|mutagen|carcinogen|ames|clearance|liabilit|risk|hazard|cost|price)")
_FAVOURABLE = re.compile(r"(solubility|permeability|bioavailability|absorption|potency|selectivity|yield|efficacy|score)")


def _tokenise(name: str) -> list[str]:
    parts = [p for p in re.split(r"[^a-z0-9]+", name.lower()) if p]
    out: list[str] = []
    i = 0
    while i < len(parts):
        p = parts[i]
        nxt = parts[i + 1] if i + 1 < len(parts) else None
        if re.fullmatch(r"[a-z]+", p) and nxt is not None and re.fullmatch(r"\d+", nxt):
            out.append(p + nxt)
            i += 2
        else:
            out.append(p)
            i += 1
    # "p_IC50" tokenises to ["p", "ic50"]; rejoin so the p-scaled form is seen
    # before the raw-activity rule.
    merged: list[str] = []
    i = 0
    while i < len(out):
        if out[i] == "p" and i + 1 < len(out):
            merged.append("p" + out[i + 1])
            i += 2
        else:
            merged.append(out[i])
            i += 1
    return merged


def infer_objective_direction(name: str) -> Optional[str]:
    """``min``, ``max``, or None when the name gives no dependable signal.

    pIC50 is maximised because a higher value is a lower concentration.
    LD50 is left unresolved: mg/kg and log(1/mol/kg) point opposite ways.
    """
    toks = _tokenise(name)
    joined = "".join(toks)
    if joined in METADATA or any(t in METADATA for t in toks):
        return None
    if any(t in P_SCALED for t in toks):
        return "max"
    if any(t in RAW_ACTIVITY for t in toks):
        return "min"
    # A toxicity score is still worse when higher, so liabilities win over "score".
    if _LIABILITY.search(joined):
        return "min"
    if _FAVOURABLE.search(joined):
        return "max"
    return None


def infer_objectives(names: Sequence[str]) -> list[dict[str, str]]:
    """Objective entries for columns whose direction can be inferred. Others are omitted."""
    out: list[dict[str, str]] = []
    for key in names:
        direction = infer_objective_direction(key)
        if direction:
            out.append({"key": key, "direction": direction})
    return out
