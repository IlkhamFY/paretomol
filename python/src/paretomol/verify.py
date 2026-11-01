"""Claim verifier.

An agent says a molecule has MW 312.4 and that IC50 should be maximised.
This recomputes the descriptors RDKit can recompute and checks directions
against the ones ParetoMol knows. Properties it cannot recompute, and
objectives with no established direction, are reported as unchecked.
"""

from __future__ import annotations

import math
import re
from typing import Any, Mapping, Optional, Sequence

from .canonical import js_round
from .descriptors import molecule_descriptors
from .objectives import infer_objective_direction

Checked = str

DEFAULT_TOLERANCES: dict[str, dict[str, float]] = {
    "MW": {"abs": 0.5},
    "LogP": {"abs": 0.5},
    "TPSA": {"abs": 1.5},
    "MR": {"abs": 1.5},
    "QED": {"abs": 0.02},
    "FrCSP3": {"abs": 0.02},
    "HBD": {"abs": 0},
    "HBA": {"abs": 0},
    "RotBonds": {"abs": 0},
    "Rings": {"abs": 0},
    "AromaticRings": {"abs": 0},
    "HeavyAtoms": {"abs": 0},
}

_ALIASES: dict[str, str] = {
    "mw": "MW", "molwt": "MW", "molecularweight": "MW", "amw": "MW",
    "logp": "LogP", "clogp": "LogP", "alogp": "LogP", "crippenlogp": "LogP", "slogp": "LogP",
    "hbd": "HBD", "numhdonors": "HBD", "hdonors": "HBD",
    "hba": "HBA", "numhacceptors": "HBA", "hacceptors": "HBA",
    "tpsa": "TPSA", "psa": "TPSA",
    "rotbonds": "RotBonds", "rotb": "RotBonds", "numrotatablebonds": "RotBonds", "rotatablebonds": "RotBonds",
    "frcsp3": "FrCSP3", "fsp3": "FrCSP3", "fractioncsp3": "FrCSP3",
    "rings": "Rings", "numrings": "Rings", "ringcount": "Rings",
    "aromaticrings": "AromaticRings", "numaromaticrings": "AromaticRings",
    "heavyatoms": "HeavyAtoms", "heavyatomcount": "HeavyAtoms", "numheavyatoms": "HeavyAtoms",
    "mr": "MR", "molmr": "MR",
    "qed": "QED",
}

# Directions that hold regardless of project. MW, LogP and TPSA have no
# universal direction and stay unchecked.
_KNOWN_DIRECTIONS = {
    "qed": "max", "sc": "min", "sascore": "min", "sa": "min", "scscore": "min",
    "rascore": "max", "vendors": "max",
}


def _norm_key(key: str) -> str:
    return re.sub(r"[^a-z0-9]", "", key.lower())


def canonical_property(key: str) -> Optional[str]:
    """Descriptor name for a claimed key, or None when it is not recomputed."""
    return _ALIASES.get(_norm_key(key))


def expected_direction(key: str) -> Optional[str]:
    """Known optimisation direction for ``key``, or None when none is established."""
    known = _KNOWN_DIRECTIONS.get(_norm_key(key))
    if known:
        return known
    return infer_objective_direction(key)


def _r4(value: float) -> float:
    return js_round(value * 1e4) / 1e4


def verify_claims(
    claims: Sequence[Mapping[str, Any]],
    tolerances: Optional[Mapping[str, Mapping[str, float]]] = None,
) -> dict[str, Any]:
    """Check claimed descriptor values and objective directions.

    Requires the ``rdkit`` extra. Returns ``ok``, ``flags``, ``checked`` and
    ``unchecked`` (claimed keys that could not be checked, per claim id).
    """
    tol = dict(DEFAULT_TOLERANCES)
    if tolerances:
        for key, spec in tolerances.items():
            merged = dict(tol.get(key, {}))
            merged.update(spec)
            tol[key] = merged
    flags: list[dict[str, Any]] = []
    unchecked: dict[str, list[str]] = {}
    checked = 0
    for i, claim in enumerate(claims):
        cid = claim.get("id") or f"claim_{i + 1}"
        skip: list[str] = []
        props = molecule_descriptors(str(claim.get("smiles") or ""))
        if props is None:
            flags.append({
                "id": cid,
                "kind": "invalid_smiles",
                "message": f"{cid}: SMILES does not parse: {claim.get('smiles')}",
            })
        else:
            for key, claimed in dict(claim.get("properties") or {}).items():
                canon = canonical_property(str(key))
                if canon is None or isinstance(claimed, bool) or not isinstance(claimed, (int, float)):
                    skip.append(str(key))
                    continue
                actual = props[canon]
                if not math.isfinite(actual):
                    skip.append(str(key))
                    continue
                spec = tol[canon]
                allowed = max(float(spec.get("abs", 0)), float(spec.get("rel") or 0) * abs(actual)) + 1e-9
                checked += 1
                if not (abs(float(claimed) - actual) <= allowed):
                    flags.append({
                        "id": cid,
                        "kind": "value_mismatch",
                        "key": key,
                        "claimed": claimed,
                        "actual": _r4(actual),
                        "tolerance": spec.get("abs", 0),
                        "message": f"{cid}: {key} claimed {claimed}, RDKit gives {_r4(actual)} (tolerance ±{spec.get('abs', 0)})",
                    })
        for obj in claim.get("objectives") or []:
            exp = expected_direction(str(obj.get("key")))
            if not exp:
                skip.append(f"objective:{obj.get('key')}")
                continue
            checked += 1
            if obj.get("direction") != exp:
                word = "maximised" if exp == "max" else "minimised"
                flags.append({
                    "id": cid,
                    "kind": "direction_flipped",
                    "key": obj.get("key"),
                    "claimed": obj.get("direction"),
                    "actual": exp,
                    "message": f"{cid}: {obj.get('key')} should be {word}, claim says {obj.get('direction')}",
                })
        if skip:
            unchecked[cid] = skip
    return {"ok": len(flags) == 0, "flags": flags, "checked": checked, "unchecked": unchecked}
