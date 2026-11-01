"""Decision records. Writers emit ``paretomol.decision/1``. Readers still accept
``paretomol.decision/0``.

A v1 record embeds the desirability windows and curve, names the RDKit WASM
by hash, and stores ranks and MPO computed here. ``recordHash`` covers the
canonical JSON of every field except itself. ``input.sha256`` covers only
the molecules.
"""

from __future__ import annotations

import copy
from datetime import datetime, timezone
from typing import Any, Mapping, Optional, Sequence

from .canonical import canonical_json, js_stringify, round6, sha256_hex
from .constraints import explain_constraints, is_constraint, public_constraint
from .mpo import mpo_score
from .pareto import Molecule, coerce_molecules, compute_pareto, normalize_objectives, plain_number
from .profiles import ResolvedProfile, get_profile

DECISION_RECORD_SCHEMA_V0 = "paretomol.decision/0"
DECISION_RECORD_SCHEMA = "paretomol.decision/1"
# Version of @paretomol/core. Must match packages/core/package.json so a
# record built here hashes the same as one built in the TypeScript core.
CORE_VERSION = "0.1.0"
# SHA-256 of @rdkit/rdkit 2025.3.4-1.0.0 dist/RDKit_minimal.wasm.
RDKIT_WASM_SHA256 = "sha256:e0967d44fed59e44a2d07bfc08f3a86821c54a14c95bb7e6e392fe867333b8c8"
DEFAULT_ADMET_ENDPOINT = "https://ilkhamfy-admet-ai-api.hf.space"
ADMET_MODEL = "ADMET-AI v2.0.1 (Chemprop D-MPNN, TDC)"


def molecule_ids(names: Sequence[str]) -> list[str]:
    """Stable ids. The first use of a name keeps it. Repeats get ``~2``, ``~3``, skipping ids already taken.

    A name that is itself ``a~2`` does not collide with the second ``a``.
    Blank names become ``mol``.
    """
    bases = [(raw or "").strip() or "mol" for raw in names]
    first: dict[str, int] = {}
    for i, base in enumerate(bases):
        if base not in first:
            first[base] = i
    used: set[str] = set()
    out: list[Optional[str]] = [None] * len(bases)
    for base, i in first.items():
        out[i] = base
        used.add(base)
    nxt: dict[str, int] = {}
    for i, base in enumerate(bases):
        if out[i] is not None:
            continue
        k = nxt.get(base, 2)
        ident = f"{base}~{k}"
        while ident in used:
            k += 1
            ident = f"{base}~{k}"
        nxt[base] = k + 1
        used.add(ident)
        out[i] = ident
    return [ident or "mol" for ident in out]


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


def _public_objective(obj: Mapping[str, Any]) -> dict[str, Any]:
    item: dict[str, Any] = {"key": obj["key"], "direction": obj["direction"]}
    window = obj.get("window")
    if isinstance(window, Mapping):
        item["direction"] = "max"
        item["window"] = {
            "acceptMax": window["acceptMax"],
            "acceptMin": window["acceptMin"],
            "idealMax": window["idealMax"],
            "idealMin": window["idealMin"],
        }
    return item


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
    constraints: Optional[Sequence[Mapping[str, Any]]] = None,
) -> dict[str, Any]:
    """Build a ``paretomol.decision/1`` record, including ``recordHash``.

    Ranks and MPO are computed here. A review block requires ``selected`` to be
    the accepted molecules.
    """
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
    working = [Molecule(m.name, m.smiles, dict(m.props), dict(m.custom_props)) for m in mols]
    gates = [public_constraint(c) for c in (constraints or []) if is_constraint(c)]
    eligible = explain_constraints(working, gates) if gates else None
    compute_pareto(working, objs, eligible)
    windows = copy.deepcopy(resolved.desirability)
    results: list[dict[str, Any]] = []
    for mol, mid in zip(working, ids):
        merged = {**mol.props, **mol.custom_props}
        score = mpo_score(merged, windows, curve)["score"]
        results.append({
            "id": mid,
            "paretoRank": mol.pareto_rank if mol.pareto_rank is not None else None,
            "mpo": round6(score),
        })
    chosen = _selected_ids(selected, ids)
    built_review = _build_review(review, ids) if review is not None else None
    if built_review is not None and sorted(mid for mid, verdict in built_review["decisions"].items() if verdict == "accept") != sorted(chosen):
        raise ValueError("Decision record: selected ids do not match accepted review decisions")
    rec: dict[str, Any] = {
        "schema": DECISION_RECORD_SCHEMA,
        "input": {"sha256": input_hash(in_mols), "count": len(in_mols), "molecules": in_mols},
        "profile": {"ref": resolved.ref, "hash": resolved.hash, "curve": curve, "windows": windows},
        "models": {
            "core": CORE_VERSION,
            "rdkitjs": {"version": rdkit_version, "sha256": RDKIT_WASM_SHA256},
            "admet": {"endpoint": admet_endpoint, "model": ADMET_MODEL} if admet_endpoint else None,
        },
        "objectives": [_public_objective(o) for o in objs],
        **({"constraints": gates} if gates else {}),
        "results": results,
        "selected": chosen,
        "rationale": "" if rationale is None else rationale,
    }
    if view is not None:
        rec["view"] = dict(view)
    if built_review is not None:
        rec["review"] = built_review
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


def _windows_ok(windows: Any) -> bool:
    if not isinstance(windows, dict):
        return False
    for win in windows.values():
        if not isinstance(win, dict):
            return False
        for key in ("idealMin", "idealMax", "acceptMin", "acceptMax"):
            value = win.get(key)
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                return False
    return True


def parse_decision_record(data: Any) -> dict[str, Any]:
    """Parse and verify a record.

    Raises when the schema is wrong, a hash does not match, a built-in profile
    hash differs from this package, or a selected id is not in the input.
    v1 also requires unique ids, embedded windows, this build's WASM hash,
    and ``selected`` equal to the accepted review ids. v0 records still open.
    """
    import json
    if isinstance(data, str):
        rec = json.loads(data)
    elif isinstance(data, dict):
        rec = data
    else:
        raise ValueError("Not a ParetoMol decision record (schema paretomol.decision/0 or paretomol.decision/1)")
    schema = rec.get("schema") if isinstance(rec, dict) else None
    if schema not in (DECISION_RECORD_SCHEMA, DECISION_RECORD_SCHEMA_V0):
        raise ValueError("Not a ParetoMol decision record (schema paretomol.decision/0 or paretomol.decision/1)")
    inp = rec.get("input")
    if not isinstance(inp, dict) or not isinstance(inp.get("molecules"), list):
        raise ValueError("Decision record: missing input.molecules")
    if input_hash(inp["molecules"]) != inp.get("sha256"):
        raise ValueError("Decision record: input hash mismatch")
    if inp.get("count") != len(inp["molecules"]):
        raise ValueError("Decision record: input count mismatch")
    if record_hash(rec) != rec.get("recordHash"):
        raise ValueError("Decision record: record hash mismatch (edited after export?)")
    profile = rec.get("profile") or {}
    pref = profile.get("ref")
    try:
        known = get_profile(pref) if isinstance(pref, str) else None
    except ValueError:
        known = None
    if known is not None and known.hash != profile.get("hash"):
        raise ValueError(f"Decision record: profile {pref} hash differs from this version of ParetoMol")
    stored_curve = profile.get("curve")
    if stored_curve is not None and stored_curve not in ("linear", "sigmoid"):
        raise ValueError("Decision record: profile.curve must be linear or sigmoid")
    if "constraints" in rec and (not isinstance(rec["constraints"], list) or any(not is_constraint(c) for c in rec["constraints"])):
        raise ValueError("Decision record: constraints must be {key, op, value}")
    id_list = [m.get("id") for m in inp["molecules"]]
    ids = set(id_list)
    if schema == DECISION_RECORD_SCHEMA:
        if len(ids) != len(id_list):
            seen_ids: set[Any] = set()
            for mid in id_list:
                if mid in seen_ids:
                    raise ValueError(f"Decision record: duplicate input id: {mid}")
                seen_ids.add(mid)
        if not _windows_ok(profile.get("windows")):
            raise ValueError("Decision record: profile.windows must be desirability windows")
        if stored_curve not in ("linear", "sigmoid"):
            raise ValueError("Decision record: profile.curve must be linear or sigmoid")
        rdkit = (rec.get("models") or {}).get("rdkitjs")
        sha = rdkit.get("sha256") if isinstance(rdkit, dict) else None
        version = rdkit.get("version") if isinstance(rdkit, dict) else None
        if not isinstance(version, str) or not isinstance(sha, str) or not sha.startswith("sha256:") or len(sha) != 71:
            raise ValueError("Decision record: models.rdkitjs must include a version and a sha256 hash")
        if sha != RDKIT_WASM_SHA256:
            raise ValueError("Decision record: rdkitjs hash does not match this build")
        if known is not None and canonical_json(profile["windows"]) != canonical_json(known.desirability):
            raise ValueError(f"Decision record: profile {pref} windows differ from this version of ParetoMol")
        review_block = rec.get("review")
        if review_block:
            accepted = sorted(mid for mid, verdict in (review_block.get("decisions") or {}).items() if verdict == "accept")
            if accepted != sorted(rec.get("selected") or []):
                raise ValueError("Decision record: selected ids do not match accepted review decisions")
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
