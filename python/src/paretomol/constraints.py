"""Hard constraints prune. Objectives rank what remains.

A missing value fails a constraint that names that column.
"""

from __future__ import annotations

from typing import Any, Mapping, Optional, Sequence

from .pareto import Molecule, get_mol_value

OPS = ("<=", ">=", "<", ">")


def is_constraint(value: Any) -> bool:
    if not isinstance(value, Mapping):
        return False
    key = value.get("key")
    op = value.get("op")
    number = value.get("value")
    predicted = value.get("predicted", False)
    return (
        isinstance(key, str) and key != ""
        and op in OPS
        and isinstance(number, (int, float)) and not isinstance(number, bool)
        and predicted in (True, False)
    )


def passes(value: float, op: str, cut: float) -> bool:
    if op == "<=":
        return value <= cut
    if op == ">=":
        return value >= cut
    if op == "<":
        return value < cut
    return value > cut


def explain_constraints(molecules: Sequence[Molecule], constraints: Sequence[Mapping[str, Any]]) -> list[bool]:
    eligible: list[bool] = []
    for mol in molecules:
        ok = True
        for raw in constraints:
            if not is_constraint(raw):
                continue
            value = get_mol_value(mol, str(raw["key"]))
            if value is None or not passes(value, str(raw["op"]), float(raw["value"])):
                ok = False
                break
        eligible.append(ok)
    return eligible


def public_constraint(raw: Mapping[str, Any]) -> dict[str, Any]:
    item: dict[str, Any] = {"key": raw["key"], "op": raw["op"], "value": raw["value"]}
    if raw.get("predicted") is True:
        item["predicted"] = True
    return item
