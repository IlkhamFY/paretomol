"""Versioned scoring profiles.

The JSON files next to this module are the same documents as
``@paretomol/core`` ``profiles/``. Each profile is identified by ``id@version``
and by the SHA-256 of its canonical JSON. A change to the contents has to bump
``version`` or the hash, and every decision record that cited the old hash,
will no longer match.
"""

from __future__ import annotations

import copy
import json
import re
from pathlib import Path
from typing import Any, Optional

from .canonical import canonical_json, sha256_hex

_PROFILE_DIR = Path(__file__).resolve().parent / "profiles"
_ORDER = ("oral@1.json", "cns@1.json", "leadlike@1.json", "lipinski@1.json", "custom@1.json")
_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")


class ResolvedProfile:
    """A scoring profile plus ``ref`` (``id@version``) and ``hash`` (``sha256:``)."""

    def __init__(self, body: dict[str, Any], ref: str, digest: str) -> None:
        self.body = body
        self.ref = ref
        self.hash = digest

    def __getattr__(self, name: str) -> Any:
        try:
            return self.body[name]
        except KeyError as exc:
            raise AttributeError(name) from exc

    def __repr__(self) -> str:
        return f"ResolvedProfile({self.ref})"


def profile_hash(profile: dict[str, Any]) -> str:
    """``sha256:<hex>`` of the canonical JSON of a profile object."""
    return "sha256:" + sha256_hex(canonical_json(profile))


def _resolve(data: dict[str, Any]) -> ResolvedProfile:
    body = copy.deepcopy(data)
    ref = f"{body['id']}@{body['version']}"
    return ResolvedProfile(body, ref, profile_hash(body))


def _load_builtin() -> list[ResolvedProfile]:
    out: list[ResolvedProfile] = []
    for name in _ORDER:
        path = _PROFILE_DIR / name
        with path.open(encoding="utf-8") as fh:
            out.append(_resolve(json.load(fh)))
    return out


_BUILTIN = _load_builtin()


def _expose(profile: ResolvedProfile) -> ResolvedProfile:
    # Callers get their own copy. The cached body stays the hashed original.
    return ResolvedProfile(copy.deepcopy(profile.body), profile.ref, profile.hash)


def list_profiles() -> list[ResolvedProfile]:
    """All built-in profiles, in ship order."""
    return [_expose(p) for p in _BUILTIN]


def get_profile(ref: str) -> ResolvedProfile:
    """Look up ``id@version``, or a bare ``id`` for the latest version.

    Unknown references raise rather than falling back to another profile.
    """
    parts = ref.split("@")
    ident = parts[0]
    if len(parts) == 1:
        matches = [p for p in _BUILTIN if p.id == ident]
    else:
        ver_s = parts[1]
        try:
            ver = float(ver_s) if ver_s.strip() != "" else 0.0
        except ValueError:
            ver = float("nan")
        matches = [p for p in _BUILTIN if p.id == ident and p.version == ver]
    if not matches:
        raise ValueError(f"Unknown scoring profile: {ref}")
    best = matches[0]
    for cand in matches[1:]:
        if cand.version > best.version:
            best = cand
    return _expose(best)


def load_profile(data: Any) -> ResolvedProfile:
    """Validate a profile object and return it with its content hash."""
    if not isinstance(data, dict):
        raise ValueError("Profile must be an object")
    if data.get("schema") != "paretomol.profile/1":
        raise ValueError("Unsupported profile schema")
    ident = data.get("id")
    if not isinstance(ident, str) or _ID_RE.fullmatch(ident) is None:
        raise ValueError("Invalid profile id")
    version = data.get("version")
    if isinstance(version, bool) or not isinstance(version, int) or version < 1:
        raise ValueError("Invalid profile version")
    objectives = data.get("objectives")
    if not isinstance(objectives, list) or any(
        not isinstance(o, dict) or o.get("direction") not in ("min", "max") for o in objectives
    ):
        raise ValueError("Invalid objectives")
    desirability = data.get("desirability") or {}
    if not isinstance(desirability, dict):
        raise ValueError("Invalid desirability")
    for key, window in desirability.items():
        if not isinstance(window, dict):
            raise ValueError(f"Desirability window for {key} must satisfy acceptMin <= idealMin <= idealMax <= acceptMax")
        try:
            ok = window["acceptMin"] <= window["idealMin"] <= window["idealMax"] <= window["acceptMax"]
        except (KeyError, TypeError):
            ok = False
        if not ok:
            raise ValueError(f"Desirability window for {key} must satisfy acceptMin <= idealMin <= idealMax <= acceptMax")
    return _resolve(data)
