"""Non-dominated fronts (NSGA-II sorting) with a complete-case missing-value policy.

A molecule that lacks a finite value for any active objective is left unranked.
It is not filled in with 0: for a minimised objective, 0 is the best possible
value, so a failed prediction would look better than every real measurement.
"""

from __future__ import annotations

import math
from typing import Any, Iterable, Mapping, Optional, Sequence

from .mpo import linear_desirability

DEFAULT_OBJECTIVES: list[dict[str, str]] = [
    {"key": "MW", "direction": "min"},
    {"key": "LogP", "direction": "min"},
    {"key": "TPSA", "direction": "min"},
]

PROP_KEYS = frozenset({
    "MW", "LogP", "HBD", "HBA", "TPSA", "RotBonds", "FrCSP3", "Rings",
    "AromaticRings", "HeavyAtoms", "MR", "NumAtoms", "QED", "SC",
})

_SKIP_COLUMNS = frozenset({
    "name", "smiles", "props", "customProps", "custom_props",
    "pareto_rank", "paretoRank", "missing_objectives", "missingObjectives",
})


class Molecule:
    """One row of a Pareto analysis.

    ``props`` holds computed descriptors. ``custom_props`` holds imported or
    measured columns. Lookup checks ``props`` first and does not fall through
    when the key is present but unusable.
    """

    def __init__(
        self,
        name: str = "",
        smiles: str = "",
        props: Optional[Mapping[str, Any]] = None,
        custom_props: Optional[Mapping[str, Any]] = None,
        pareto_rank: Optional[int] = None,
    ) -> None:
        self.name = name
        self.smiles = smiles
        self.props: dict[str, Any] = dict(props or {})
        self.custom_props: dict[str, Any] = dict(custom_props or {})
        self.pareto_rank = pareto_rank
        self.missing_objectives: Optional[list[str]] = None
        self.dominates: list[int] = []
        self.dominated_by: list[int] = []

    def __repr__(self) -> str:
        return f"Molecule({self.name!r}, rank={self.pareto_rank})"


def plain_number(value: Any) -> Any:
    """Finite int or float, or None. Booleans and missing markers are not numbers."""
    if isinstance(value, bool) or value is None:
        return None
    if hasattr(value, "item") and callable(value.item) and not isinstance(value, (str, bytes, dict, list)):
        try:
            value = value.item()
        except Exception:
            return None
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    return None


def get_mol_value(mol: Molecule, key: str) -> Optional[float]:
    """Finite value for ``key``, or None when it is absent or not usable."""
    if key in mol.props:
        raw = mol.props[key]
    elif key in mol.custom_props:
        raw = mol.custom_props[key]
    else:
        return None
    num = plain_number(raw)
    if num is None:
        return None
    return float(num)


def _window(raw: Any) -> Optional[dict[str, float]]:
    if not isinstance(raw, Mapping):
        return None
    try:
        window = {k: float(raw[k]) for k in ("acceptMin", "idealMin", "idealMax", "acceptMax")}
    except (KeyError, TypeError, ValueError):
        return None
    if not all(math.isfinite(v) for v in window.values()):
        return None
    return window


def contract_objectives(profile: Any = None) -> list[dict[str, Any]]:
    """Desirability windows of a profile. Higher desirability is better."""
    if profile is None:
        from .profiles import get_profile
        profile = get_profile("oral@1")
    desirability = profile.desirability if hasattr(profile, "desirability") else profile["desirability"]
    out: list[dict[str, Any]] = []
    for key, window in desirability.items():
        out.append({
            "key": key,
            "direction": "max",
            "window": {
                "acceptMax": float(window["acceptMax"]),
                "acceptMin": float(window["acceptMin"]),
                "idealMax": float(window["idealMax"]),
                "idealMin": float(window["idealMin"]),
            },
        })
    return out


def normalize_objectives(objectives: Optional[Sequence[Any]]) -> list[dict[str, Any]]:
    if objectives is None:
        return contract_objectives()
    out: list[dict[str, Any]] = []
    for item in objectives:
        if isinstance(item, Mapping):
            key, direction = item["key"], item["direction"]
            window = _window(item.get("window"))
        else:
            key, direction = item[0], item[1]
            window = None
        if direction not in ("min", "max"):
            raise ValueError(f'objective direction must be "min" or "max", got {direction!r}')
        entry: dict[str, Any] = {"key": str(key), "direction": "max" if window else direction}
        if window:
            entry["window"] = window
        out.append(entry)
    return out


def _scalar(value: float, obj: Mapping[str, Any]) -> tuple[float, bool]:
    window = obj.get("window")
    if isinstance(window, Mapping):
        return linear_desirability(value, window), False
    return value, obj["direction"] == "min"


def compute_pareto(molecules: list[Molecule], objectives: Optional[Sequence[Any]] = None) -> list[Molecule]:
    """Assign Pareto ranks and dominance edges in place. Returns the same list.

    Rank 1 is the non-dominated front. Rank 2 is the front that remains once
    rank 1 is removed, and so on. Incomplete rows stay at ``pareto_rank is None``.
    """
    objs = normalize_objectives(objectives)
    n = len(molecules)
    k = len(objs)
    minimise = [not isinstance(o.get("window"), Mapping) and o["direction"] == "min" for o in objs]
    vals: list[Optional[list[float]]] = [None] * n
    ranked: list[int] = []

    for i, mol in enumerate(molecules):
        mol.dominates = []
        mol.dominated_by = []
        row: list[float] = []
        missing: list[str] = []
        for obj in objs:
            value = get_mol_value(mol, obj["key"])
            if value is None:
                missing.append(obj["key"])
            else:
                scalar, _min = _scalar(value, obj)
                if not math.isfinite(scalar):
                    missing.append(obj["key"])
                else:
                    row.append(scalar)
        if missing:
            vals[i] = None
            mol.missing_objectives = missing
            mol.pareto_rank = None
        else:
            vals[i] = row
            mol.missing_objectives = None
            ranked.append(i)

    for a in range(len(ranked)):
        i = ranked[a]
        vi = vals[i]
        assert vi is not None
        for b in range(a + 1, len(ranked)):
            j = ranked[b]
            vj = vals[j]
            assert vj is not None
            i_better = 0
            j_better = 0
            for o in range(k):
                x, y = vi[o], vj[o]
                if x == y:
                    continue
                if (x < y) if minimise[o] else (x > y):
                    i_better += 1
                else:
                    j_better += 1
            if i_better > 0 and j_better == 0:
                molecules[i].dominates.append(j)
                molecules[j].dominated_by.append(i)
            elif j_better > 0 and i_better == 0:
                molecules[j].dominates.append(i)
                molecules[i].dominated_by.append(j)

    dominating = [0] * n
    for i in ranked:
        dominating[i] = len(molecules[i].dominated_by)
    front = [i for i in ranked if dominating[i] == 0]
    rank = 1
    while front:
        nxt: list[int] = []
        for i in front:
            molecules[i].pareto_rank = rank
            for j in molecules[i].dominates:
                dominating[j] -= 1
                if dominating[j] == 0:
                    nxt.append(j)
        front = nxt
        rank += 1
    return molecules


def molecule_from_mapping(row: Mapping[str, Any]) -> Molecule:
    """Build a molecule from a dict row or a record with ``props`` / ``customProps``."""
    name = row.get("name")
    smiles = row.get("smiles")
    props: dict[str, Any] = {}
    custom: dict[str, Any] = {}
    nested_props = row.get("props")
    if isinstance(nested_props, Mapping):
        props.update(nested_props)
    for alt in ("customProps", "custom_props"):
        nested = row.get(alt)
        if isinstance(nested, Mapping):
            custom.update(nested)
    for key, value in row.items():
        if key in _SKIP_COLUMNS:
            continue
        num = plain_number(value)
        if num is None:
            continue
        if key in PROP_KEYS and key not in props:
            props[key] = num
        elif key not in custom:
            custom[key] = num
    mol = Molecule("" if name is None else str(name), "" if smiles is None else str(smiles), props, custom)
    if "paretoRank" in row:
        mol.pareto_rank = row.get("paretoRank")
    elif "pareto_rank" in row:
        mol.pareto_rank = row.get("pareto_rank")
    return mol


def _is_frame(obj: Any) -> bool:
    return hasattr(obj, "columns") and hasattr(obj, "iloc") and not isinstance(obj, (dict, list, tuple))


def _column_name(columns: Iterable[Any], accepted: set[str]) -> Optional[Any]:
    for col in columns:
        if str(col).casefold() in accepted:
            return col
    return None


def molecules_from_frame(frame: Any) -> list[Molecule]:
    smiles_col = _column_name(frame.columns, {"smiles", "smi"})
    if smiles_col is None:
        raise ValueError("DataFrame needs a smiles column")
    name_col = _column_name(frame.columns, {"name"})
    ignore = {smiles_col}
    if name_col is not None:
        ignore.add(name_col)
    mols: list[Molecule] = []
    for i in range(len(frame)):
        row = frame.iloc[i]
        props: dict[str, Any] = {}
        custom: dict[str, Any] = {}
        for col in frame.columns:
            if col in ignore or str(col) in _SKIP_COLUMNS:
                continue
            num = plain_number(row[col])
            if num is None:
                continue
            if str(col) in PROP_KEYS:
                props[str(col)] = num
            else:
                custom[str(col)] = num
        name = "" if name_col is None else row[name_col]
        name_s = "" if name is None or (isinstance(name, float) and not math.isfinite(name)) else str(name)
        if name_s == "nan":
            name_s = ""
        mols.append(Molecule(name_s, "" if row[smiles_col] is None else str(row[smiles_col]), props, custom))
    return mols


def coerce_molecules(data: Any) -> list[Molecule]:
    if _is_frame(data):
        return molecules_from_frame(data)
    if isinstance(data, Molecule):
        return [data]
    if isinstance(data, list):
        out: list[Molecule] = []
        for item in data:
            if isinstance(item, Molecule):
                out.append(item)
            elif isinstance(item, Mapping):
                out.append(molecule_from_mapping(item))
            else:
                raise TypeError(f"expected a molecule dict, got {type(item).__name__}")
        return out
    raise TypeError("molecules must be a list of dicts, a list of Molecule, or a DataFrame")


def rank(data: Any, objectives: Optional[Sequence[Any]] = None) -> Any:
    """Rank molecules and return them.

    A DataFrame comes back as a copy with a ``pareto_rank`` column (None when
    the row is missing an objective). A list is ranked in place when it already
    holds :class:`Molecule` objects, and returned as molecules otherwise.
    """
    if _is_frame(data):
        mols = molecules_from_frame(data)
        compute_pareto(mols, objectives)
        out = data.copy()
        out["pareto_rank"] = [m.pareto_rank for m in mols]
        return out
    mols = coerce_molecules(data)
    return compute_pareto(mols, objectives)
