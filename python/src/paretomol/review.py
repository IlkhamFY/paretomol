"""Open review URLs (``paretomol.review/0``).

The payload is compressed into the URL fragment (``#r=``). Browsers do not
send the fragment to the server. ``review_url`` accepts a list of molecule
dicts or a pandas DataFrame.
"""

from __future__ import annotations

import base64
import zlib
from typing import Any, Mapping, Optional, Sequence
from urllib.parse import unquote

import lzstring

from .canonical import js_stringify
from .pareto import _is_frame, normalize_objectives, plain_number
from .profiles import get_profile

REVIEW_SCHEMA = "paretomol.review/0"
REVIEW_BASE_URL = "https://paretomol.com/"
REVIEW_URL_SOFT_LIMIT = 32000
REVIEW_TOKEN_PREFIX = "v1."

_lz = lzstring.LZString()
_RESERVED = frozenset({
    "name", "smiles", "props", "customProps", "custom_props",
    "pareto_rank", "paretoRank", "missing_objectives", "missingObjectives",
})


def _finite_prop(value: Any) -> Any:
    return plain_number(value)


def _is_obj(value: Any) -> bool:
    return isinstance(value, dict)


def validate_review(data: Any) -> dict[str, Any]:
    """Validate and normalise a review payload. Raises with a message an agent can act on."""
    if not _is_obj(data):
        raise ValueError("Review payload must be an object")
    if "schema" in data and data["schema"] is not None and data["schema"] != REVIEW_SCHEMA:
        raise ValueError(f"Review payload: schema must be {REVIEW_SCHEMA}")
    mols = data.get("molecules")
    if not isinstance(mols, list) or len(mols) == 0:
        raise ValueError("Review payload: molecules must be a non-empty array")
    molecules: list[dict[str, Any]] = []
    for i, mol in enumerate(mols):
        if not _is_obj(mol) or not isinstance(mol.get("smiles"), str) or not mol["smiles"].strip():
            raise ValueError(f"Review payload: molecules[{i}].smiles must be a non-empty string")
        name = mol["name"].strip() if isinstance(mol.get("name"), str) and mol["name"].strip() else f"mol{i + 1}"
        out: dict[str, Any] = {"name": name, "smiles": mol["smiles"].strip()}
        if "customProps" in mol and mol["customProps"] is not None:
            raw = mol["customProps"]
            if not _is_obj(raw):
                raise ValueError(f"Review payload: molecules[{i}].customProps must be an object of numbers")
            custom: dict[str, Any] = {}
            for key, value in raw.items():
                num = _finite_prop(value)
                if num is not None:
                    custom[str(key)] = num
            if custom:
                out["customProps"] = custom
        molecules.append(out)
    if "profile" not in data or data["profile"] is None:
        profile: Any = "oral@1"
    else:
        profile = data["profile"]
    if not isinstance(profile, str):
        raise ValueError("Review payload: profile must be a string like oral@1")
    resolved = get_profile(profile)
    objectives = None
    if "objectives" in data and data["objectives"] is not None:
        raw_obj = data["objectives"]
        if not isinstance(raw_obj, list) or len(raw_obj) == 0:
            raise ValueError("Review payload: objectives must be a non-empty array")
        objectives = []
        for i, obj in enumerate(raw_obj):
            if not _is_obj(obj) or not isinstance(obj.get("key"), str) or obj.get("direction") not in ("min", "max"):
                raise ValueError(f'Review payload: objectives[{i}] must be {{key, direction: "min"|"max"}}')
            objectives.append({"key": obj["key"], "direction": obj["direction"]})

    def string_field(key: str) -> Optional[str]:
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value
        return None

    out_payload: dict[str, Any] = {"schema": REVIEW_SCHEMA, "molecules": molecules, "profile": resolved.ref}
    if objectives:
        out_payload["objectives"] = objectives
    for key in ("title", "source", "note"):
        value = string_field(key)
        if value:
            out_payload[key] = value
    if "suggested" in data and data["suggested"] is not None:
        suggested = data["suggested"]
        if not isinstance(suggested, list) or any(not isinstance(s, str) for s in suggested):
            raise ValueError("Review payload: suggested must be an array of molecule names")
        names = {m["name"] for m in molecules}
        bad = [s for s in suggested if s not in names]
        if bad:
            raise ValueError("Review payload: suggested names not in molecules: " + ", ".join(bad))
        out_payload["suggested"] = list(suggested)
    return out_payload


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(text: str) -> bytes:
    pad = "=" * ((4 - len(text) % 4) % 4)
    return base64.urlsafe_b64decode(text + pad)


def encode_review(data: Any) -> str:
    """``v1.`` plus base64url(raw deflate) of the JSON. Old lz-string tokens still decode."""
    raw = js_stringify(validate_review(data)).encode("utf-8")
    comp = zlib.compressobj(level=9, wbits=-15)
    return REVIEW_TOKEN_PREFIX + _b64url(comp.compress(raw) + comp.flush())


def _corrupt(detail: str) -> ValueError:
    return ValueError(
        f"Review link is corrupt ({detail}). For a large set, use a decision record file instead."
    )


def decode_review(token: str) -> dict[str, Any]:
    """Inverse of :func:`encode_review`. Also accepts the original lz-string tokens."""
    import json
    if token.startswith(REVIEW_TOKEN_PREFIX):
        try:
            raw = zlib.decompress(_b64url_decode(token[len(REVIEW_TOKEN_PREFIX):]), -15)
            text = raw.decode("utf-8")
        except Exception as exc:
            raise _corrupt("could not decompress") from exc
    else:
        try:
            text = _lz.decompressFromEncodedURIComponent(token)
        except Exception:
            text = None
        if not text:
            raise _corrupt("could not decompress")
    try:
        obj = json.loads(text)
    except Exception as exc:
        raise _corrupt("not JSON") from exc
    return validate_review(obj)


def review_url_warning(url: str) -> Optional[str]:
    """Set when a review URL is still longer than browsers and chat apps reliably keep."""
    if len(url) <= REVIEW_URL_SOFT_LIMIT:
        return None
    return (
        f"Review link is {len(url)} characters, past the {REVIEW_URL_SOFT_LIMIT} characters "
        "browsers and chat apps reliably keep. Use a decision record file instead."
    )


def _review_url(data: Any, base: str = REVIEW_BASE_URL) -> str:
    return f"{base.split('#', 1)[0]}#r={encode_review(data)}"


def _param(part: str, key: str) -> Optional[str]:
    for kv in part.split("&"):
        eq = kv.find("=")
        k = kv if eq < 0 else kv[:eq]
        if k == key and eq >= 0:
            v = kv[eq + 1:]
            try:
                decoded = unquote(v)
            except Exception:
                decoded = v
            return decoded or None
    return None


def review_token_from_url(url: str) -> Optional[str]:
    """Read the review token from a URL fragment (``#r=``) or query (``?r=``)."""
    hash_at = url.find("#")
    frag = url[hash_at + 1:] if hash_at >= 0 else ""
    before = url[:hash_at] if hash_at >= 0 else url
    q = before.find("?")
    return _param(frag, "r") or (_param(before[q + 1:], "r") if q >= 0 else None)


def _molecules_from_rows(rows: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    molecules: list[dict[str, Any]] = []
    for row in rows:
        name = row.get("name")
        smiles = row.get("smiles")
        if not isinstance(smiles, str) or not smiles.strip():
            raise ValueError("each molecule needs a non-empty smiles string")
        item: dict[str, Any] = {"smiles": smiles}
        if isinstance(name, str):
            item["name"] = name
        if "customProps" in row and isinstance(row["customProps"], dict):
            item["customProps"] = dict(row["customProps"])
        else:
            custom: dict[str, Any] = {}
            for key, value in row.items():
                if key in _RESERVED:
                    continue
                num = _finite_prop(value)
                if num is not None:
                    custom[str(key)] = num
            if custom:
                item["customProps"] = custom
        molecules.append(item)
    return molecules


def _molecules_from_frame(frame: Any) -> list[dict[str, Any]]:
    smiles_col = None
    name_col = None
    for col in frame.columns:
        folded = str(col).casefold()
        if smiles_col is None and folded in {"smiles", "smi"}:
            smiles_col = col
        elif name_col is None and folded == "name":
            name_col = col
    if smiles_col is None:
        raise ValueError("DataFrame needs a smiles column")
    molecules: list[dict[str, Any]] = []
    for i in range(len(frame)):
        row = frame.iloc[i]
        smiles = row[smiles_col]
        if smiles is None or str(smiles).strip() == "":
            raise ValueError(f"row {i} needs a non-empty smiles string")
        item: dict[str, Any] = {"smiles": str(smiles).strip()}
        if name_col is not None and row[name_col] is not None and str(row[name_col]).strip() not in ("", "nan"):
            item["name"] = str(row[name_col]).strip()
        custom: dict[str, Any] = {}
        for col in frame.columns:
            if col == smiles_col or col == name_col or str(col) in _RESERVED:
                continue
            num = _finite_prop(row[col])
            if num is not None:
                custom[str(col)] = num
        if custom:
            item["customProps"] = custom
        molecules.append(item)
    return molecules


def review_url(
    molecules: Any,
    objectives: Optional[Sequence[Any]] = None,
    profile: Optional[str] = None,
    title: Optional[str] = None,
    source: Optional[str] = None,
    note: Optional[str] = None,
    suggested: Optional[Sequence[str]] = None,
    base: str = REVIEW_BASE_URL,
) -> str:
    """``https://paretomol.com/#r=...`` for a DataFrame, a list of molecules, or a payload dict.

    Numeric columns other than ``name`` and ``smiles`` are sent as ``customProps``.
    ``pareto_rank`` is left out: the review page recomputes ranks.
    """
    if isinstance(molecules, dict) and "molecules" in molecules and "smiles" not in molecules:
        payload = dict(molecules)
    elif _is_frame(molecules):
        payload = {"molecules": _molecules_from_frame(molecules)}
    elif isinstance(molecules, list):
        payload = {"molecules": _molecules_from_rows(molecules)}
    else:
        raise TypeError("review_url expects a DataFrame, a list of molecules, or a review payload")
    if objectives is not None:
        payload["objectives"] = normalize_objectives(objectives)
    if profile is not None:
        payload["profile"] = profile
    if title is not None:
        payload["title"] = title
    if source is not None:
        payload["source"] = source
    if note is not None:
        payload["note"] = note
    if suggested is not None:
        payload["suggested"] = list(suggested)
    return _review_url(payload, base)
