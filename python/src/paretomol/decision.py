"""Decision records, schema ``paretomol.decision/0``.

A record is a hash-stable JSON account of one multi-objective decision: which
molecules went in, which profile scored them, which objectives ranked them,
and what was picked. ``recordHash`` covers the canonical JSON of every field
except itself. ``input.sha256`` covers only the molecules.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Mapping, Optional, Sequence

from .canonical import canonical_json, js_stringify, round6, sha256_hex
from .mpo import mpo_score
from .pareto import Molecule, coerce_molecules, normalize_objectives, plain_number
from .profiles import ResolvedProfile, get_profile

DECISION_RECORD_SCHEMA = "paretomol.decision/0"
# Version of @paretomol/core that defines this record. Kept identical so a
# record built here hashes the same as one built in the TypeScript core.
CORE_VERSION = "0.1.0"
DEFAULT_ADMET_ENDPOINT = "https://ilkhamfy-admet-ai-api.hf.space"
ADMET_MODEL = "ADMET-AI v2.0.1 (Chemprop D-MPNN, TDC)"


def molecule_ids(names: Sequence[str]) -> list[str]:
    """Stable ids: the name, with ``~2``, ``~3`` appended to repeats. Blank names become ``mol``."""
    seen: dict[str, int] = {}
    out: list[str] = []
    for raw in names:
        n = (raw or "").strip() or "mol"
        k = seen.get(n, 0) + 1
        seen[n] = k
        out.append(n if k == 1 else f"{n}~{k}")
    return out


def clean_custom(custom: Optional[Mapping[str, Any]]) -> Optional[dict[str, Any]]:
    if not custom:
        return None
    out: dict[str, Any] = {}
    for key, value in custom.items():
        num = plain_number(value)
        if num is not None:
            out[str(key)] = num
    return out or None


def _hash_molecules(molecules: Sequence[Mapping[str, Any]]) -> str:
    payload = []
    for mol in molecules:
        item: dict[str, Any] = {"id": mol["id"], "name": mol["name"], "smiles": mol["smiles"]}
        custom = clean_custom(mol.get("customProps"))
        if custom:
            item["customProps"] = custom
        payload.append(item)
    return "sha256:" + sha256_hex(canonical_json(payload))


def input_hash(molecules: Sequence[Mapping[str, Any]]) -> str:
    """``sha256:<hex>`` over the ordered molecules (id, name, SMILES, finite custom columns)."""
    return _hash_molecules(molecules)


def record_hash(rec: Mapping[str, Any]) -> str:
    """``sha256:<hex>`` of the record with ``recordHash`` removed."""
    rest = {k: v for k, v in rec.items() if k != "recordHash"}
    return "sha256:" + sha256_hex(canonical_json(rest))


def _now_iso() -> str:
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def _as_index(key: Any, n: int) -> Optional[int]:
    if isinstance(key, bool):
        return None
    if isinstance(key, int):
        i = key
    elif isinstance(key, float):
        if not key.is_integer():
            return None
        i = int(key)
    elif isinstance(key, str):
        try:
            f = float(key.strip()) if key.strip() != "" else 0.0
        except ValueError:
            return None
        if not f.is_integer():
            return None
        i = int(f)
    else:
        return None
    if 0 <= i < n:
        return i
    return None


def _build_review(review: Mapping[str, Any], ids: Sequence[str]) -> dict[str, Any]:
    decisions: dict[str, str] = {}
    for key, verdict in dict(review.get("decisions") or {}).items():
        i = _as_index(key, len(ids))
        if i is not None and verdict in ("accept", "reject"):
            decisions[ids[i]] = verdict
    out: dict[str, Any] = {"decisions": decisions}
    source = review.get("source")
    if source:
        out["source"] = source
    suggested = review.get("suggested") or []
    seen: list[int] = []
    for item in suggested:
        if isinstance(item, bool) or not isinstance(item, int):
            continue
        if 0 <= item < len(ids) and item not in seen:
            seen.append(item)
    if seen:
        out["suggested"] = [ids[i] for i in sorted(seen)]
    return out


def _selected_ids(selected: Optional[Sequence[int]], ids: Sequence[str]) -> list[str]:
    seen: list[int] = []
    for item in selected or []:
        if isinstance(item, bool) or not isinstance(item, int):
            continue
        if 0 <= item < len(ids) and item not in seen:
            seen.append(item)
    return [ids[i] for i in sorted(seen)]


def build_decision_record(
    molecules: Any,
    objectives: Sequence[Any],
    profile: Any = "oral@1",
    selected: Optional[Sequence[int]] = None,
    rationale: Optional[str] = None,
    rdkit_version: str = "",
    admet_endpoint: Optional[str] = None,
    view: Optional[Mapping[str, Any]] = None,
    review: Optional[Mapping[str, Any]] = None,
    timestamp: Optional[str] = None,
    curve: str = "linear",
) -> dict[str, Any]:
    """Build a ``paretomol.decision/0`` record, including ``recordHash``."""
    if curve not in ("linear", "sigmoid"):
        raise ValueError("Decision record: curve must be linear or sigmoid")
    if isinstance(profile, str) or profile is None:
        resolved = get_profile(profile or "oral@1")
    elif isinstance(profile, ResolvedProfile):
        resolved = profile
    else:
        raise TypeError("profile must be a ref like oral@1 or a loaded profile")
    mols = coerce_molecules(molecules)
    objs = normalize_objectives(objectives)
    ids = molecule_ids([m.name for m in mols])
    in_mols: list[dict[str, Any]] = []
    for mol, mid in zip(mols, ids):
        item: dict[str, Any] = {"id": mid, "name": mol.name, "smiles": mol.smiles}
        custom = clean_custom(mol.custom_props)
        if custom:
            item["customProps"] = custom
        in_mols.append(item)
    results: list[dict[str, Any]] = []
    for mol, mid in zip(mols, ids):
        merged = {**mol.props, **mol.custom_props}
        score = mpo_score(merged, resolved.desirability, curve)["score"]
        results.append({
            "id": mid,
            "paretoRank": mol.pareto_rank if mol.pareto_rank is not None else None,
            "mpo": round6(score),
        })
    rec: dict[str, Any] = {
        "schema": DECISION_RECORD_SCHEMA,
        "input": {"sha256": input_hash(in_mols), "count": len(in_mols), "molecules": in_mols},
        "profile": {"ref": resolved.ref, "hash": resolved.hash, "curve": curve},
        "models": {
            "core": CORE_VERSION,
            "rdkitjs": rdkit_version,
            "admet": {"endpoint": admet_endpoint, "model": ADMET_MODEL} if admet_endpoint else None,
        },
        "objectives": [{"key": o["key"], "direction": o["direction"]} for o in objs],
        "results": results,
        "selected": _selected_ids(selected, ids),
        "rationale": "" if rationale is None else rationale,
    }
    if view is not None:
        rec["view"] = dict(view)
    if review is not None:
        rec["review"] = _build_review(review, ids)
    rec["timestamp"] = timestamp if timestamp is not None else _now_iso()
    rec["recordHash"] = record_hash(rec)
    return rec


def stringify_decision_record(rec: Mapping[str, Any]) -> str:
    """Sorted keys, 2-space indent, trailing newline. The file bytes are stable."""
    parsed = _parse_canonical(canonical_json(rec))
    return js_stringify(parsed, indent=2) + "\n"


def _parse_canonical(text: str) -> Any:
    """Parse canonical JSON with ``json.loads``, which preserves key order."""
    import json
    return json.loads(text)


def parse_decision_record(data: Any) -> dict[str, Any]:
    """Parse and verify a record.

    Raises when the schema is wrong, a hash does not match, a built-in profile
    hash differs from this package, or a selected id is not in the input.
    """
    import json
    if isinstance(data, str):
        rec = json.loads(data)
    elif isinstance(data, dict):
        rec = data
    else:
        raise ValueError("Not a ParetoMol decision record (schema paretomol.decision/0)")
    if not isinstance(rec, dict) or rec.get("schema") != DECISION_RECORD_SCHEMA:
        raise ValueError("Not a ParetoMol decision record (schema paretomol.decision/0)")
    inp = rec.get("input")
    if not isinstance(inp, dict) or not isinstance(inp.get("molecules"), list):
        raise ValueError("Decision record: missing input.molecules")
    if input_hash(inp["molecules"]) != inp.get("sha256"):
        raise ValueError("Decision record: input hash mismatch")
    if inp.get("count") != len(inp["molecules"]):
        raise ValueError("Decision record: input count mismatch")
    if record_hash(rec) != rec.get("recordHash"):
        raise ValueError("Decision record: record hash mismatch (edited after export?)")
    pref = (rec.get("profile") or {}).get("ref")
    try:
        known = get_profile(pref) if isinstance(pref, str) else None
    except ValueError:
        known = None
    if known is not None and known.hash != (rec.get("profile") or {}).get("hash"):
        raise ValueError(f"Decision record: profile {pref} hash differs from this version of ParetoMol")
    stored_curve = (rec.get("profile") or {}).get("curve")
    if stored_curve is not None and stored_curve not in ("linear", "sigmoid"):
        raise ValueError("Decision record: profile.curve must be linear or sigmoid")
    ids = {m.get("id") for m in inp["molecules"]}
    for sid in rec.get("selected") or []:
        if sid not in ids:
            raise ValueError(f"Decision record: selected id not in input: {sid}")
    review = rec.get("review")
    if review:
        for mid, verdict in dict(review.get("decisions") or {}).items():
            if mid not in ids:
                raise ValueError(f"Decision record: review decision for unknown id: {mid}")
            if verdict not in ("accept", "reject"):
                raise ValueError(f"Decision record: review decision must be accept or reject: {mid}")
    return rec


def selected_indices(rec: Mapping[str, Any]) -> list[int]:
    """Indices of the selected molecules in input order."""
    chosen = set(rec.get("selected") or [])
    return [i for i, mol in enumerate(rec["input"]["molecules"]) if mol.get("id") in chosen]
