"""JSON and SHA-256 that match ``JSON.stringify`` and ``@paretomol/core``.

Profile hashes and decision records are SHA-256 of canonical JSON: object keys
sorted by UTF-16 code unit, no whitespace, numbers printed the way
``JSON.stringify`` prints them. A different printer would change every hash.
"""

from __future__ import annotations

import hashlib
import math
import re

_REPR_NUM = re.compile(r"(\d+)(?:\.(\d+))?(?:e([+-]\d+))?")


class CanonicalError(ValueError):
    """A value cannot be written as canonical JSON."""


def sha256_hex(text: str) -> str:
    """Hex SHA-256 of the UTF-8 encoding of ``text``."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def js_round(value: float) -> float:
    """``Math.round``: half goes toward +infinity."""
    if not math.isfinite(value):
        return value
    if -0.5 <= value < 0.5:
        return 0.0
    return float(math.floor(value + 0.5))


def round6(value: float) -> float:
    """Six decimal places, with the same half-rounding as ``Math.round``."""
    return js_round(value * 1_000_000) / 1_000_000


def js_string(text: str) -> str:
    """A JSON string literal, escaped the way ``JSON.stringify`` escapes it."""
    out = ['"']
    for ch in text:
        o = ord(ch)
        if ch == '"':
            out.append('\\"')
        elif ch == "\\":
            out.append("\\\\")
        elif ch == "\b":
            out.append("\\b")
        elif ch == "\f":
            out.append("\\f")
        elif ch == "\n":
            out.append("\\n")
        elif ch == "\r":
            out.append("\\r")
        elif ch == "\t":
            out.append("\\t")
        elif o < 0x20:
            out.append("\\u%04x" % o)
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def js_number(value: float) -> str:
    """Print a float the way ``JSON.stringify`` prints a JavaScript number."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int) and not isinstance(value, bool):
        return str(value)
    if not isinstance(value, float):
        raise CanonicalError(f"canonicalJSON: not a number: {value!r}")
    if not math.isfinite(value):
        raise CanonicalError("canonicalJSON: non-finite number")
    if value == 0.0:
        return "0"
    sign = "-" if value < 0 else ""
    match = _REPR_NUM.fullmatch(repr(abs(value)))
    if match is None:
        raise CanonicalError(f"canonicalJSON: cannot format {value!r}")
    whole, frac, exp_s = match.group(1), match.group(2) or "", int(match.group(3) or 0)
    significand = int(whole + frac)
    lsd_exp = exp_s - len(frac)
    if significand == 0:
        return "0"
    while significand % 10 == 0:
        significand //= 10
        lsd_exp += 1
    digits = str(significand)
    k = len(digits)
    n_spec = lsd_exp + k
    if k <= n_spec <= 21:
        return sign + digits + ("0" * (n_spec - k))
    if 0 < n_spec <= 21:
        return sign + digits[:n_spec] + "." + digits[n_spec:]
    if -6 < n_spec <= 0:
        return sign + "0." + ("0" * (-n_spec)) + digits
    exp_out = n_spec - 1
    exp_sign = "+" if exp_out >= 0 else "-"
    mant = digits if k == 1 else digits[0] + "." + digits[1:]
    return sign + mant + "e" + exp_sign + str(abs(exp_out))


def _primitive(value: object) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return js_string(value)
    if isinstance(value, int) and not isinstance(value, bool):
        return str(value)
    if isinstance(value, float):
        return js_number(value)
    raise CanonicalError(f"canonicalJSON: unsupported value {type(value).__name__}")


def _key_order(key: str) -> bytes:
    # JavaScript sorts object keys by UTF-16 code unit, not Unicode code point.
    return key.encode("utf-16-be")


def js_stringify(value: object, indent: int | None = None) -> str:
    """``JSON.stringify`` with insertion order preserved.

    ``indent`` is the number of spaces, matching ``JSON.stringify(value, null, indent)``.
    """

    def compact(v: object) -> str:
        if isinstance(v, dict):
            return "{" + ",".join(js_string(str(k)) + ":" + compact(val) for k, val in v.items()) + "}"
        if isinstance(v, list):
            return "[" + ",".join(compact(item) for item in v) + "]"
        return _primitive(v)

    def pretty(v: object, level: int) -> str:
        if isinstance(v, dict):
            if not v:
                return "{}"
            pad = " " * (indent * (level + 1))
            close = " " * (indent * level)
            parts = [pad + js_string(str(k)) + ": " + pretty(val, level + 1) for k, val in v.items()]
            return "{\n" + ",\n".join(parts) + "\n" + close + "}"
        if isinstance(v, list):
            if not v:
                return "[]"
            pad = " " * (indent * (level + 1))
            close = " " * (indent * level)
            parts = [pad + pretty(item, level + 1) for item in v]
            return "[\n" + ",\n".join(parts) + "\n" + close + "]"
        return _primitive(v)

    if indent is None:
        return compact(value)
    if indent < 0:
        raise CanonicalError("indent must be >= 0")
    return pretty(value, 0)


def canonical_json(value: object) -> str:
    """Deterministic JSON: sorted keys, no whitespace. Arrays keep their order."""
    if isinstance(value, dict):
        keys = sorted((str(k) for k in value.keys()), key=_key_order)
        # Re-read through the original keys. All of our keys are str; reject others
        # so a non-string key cannot silently change a hash.
        if any(not isinstance(k, str) for k in value.keys()):
            raise CanonicalError("canonicalJSON: object keys must be strings")
        return "{" + ",".join(js_string(k) + ":" + canonical_json(value[k]) for k in keys) + "}"
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    return _primitive(value)
