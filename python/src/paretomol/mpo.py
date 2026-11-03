"""Desirability and multi-parameter optimisation scores.

The geometric mean uses a 0.01 floor so one property sitting outside its
window does not zero the whole score. A zero-width window edge (ideal equal
to accept) is a hard step: a value exactly on the edge counts as inside.
"""

from __future__ import annotations

import math
from typing import Any, Mapping, Optional

GOOD_Y = 0.9


def get_rate(good: float, bad: float) -> float:
    logit = math.log(GOOD_Y / (1 - GOOD_Y))
    return (2 * logit) / (good - bad)


def get_center(good: float, bad: float) -> float:
    return (good + bad) / 2


def sigmoid(x: float, center: float, rate: float) -> float:
    return 1 / (1 + math.exp(-rate * (x - center)))


def double_sigmoid_desirability(
    x: float,
    accept_min: float,
    ideal_min: float,
    ideal_max: float,
    accept_max: float,
) -> float:
    if ideal_min == accept_min:
        left = 1.0 if x >= ideal_min else 0.0
    else:
        left = sigmoid(x, get_center(ideal_min, accept_min), get_rate(ideal_min, accept_min))
    if ideal_max == accept_max:
        right = 1.0 if x <= ideal_max else 0.0
    else:
        right = sigmoid(x, get_center(ideal_max, accept_max), get_rate(ideal_max, accept_max))
    return left * right


def linear_desirability(value: float, window: Mapping[str, float]) -> float:
    accept_min = window["acceptMin"]
    ideal_min = window["idealMin"]
    ideal_max = window["idealMax"]
    accept_max = window["acceptMax"]
    if value < accept_min or value > accept_max:
        return 0.0
    if ideal_min <= value <= ideal_max:
        return 1.0
    if value < ideal_min:
        span = ideal_min - accept_min
        return 1.0 if span <= 0 else (value - accept_min) / span
    span = accept_max - ideal_max
    return 1.0 if span <= 0 else (accept_max - value) / span


def desirability(value: float, window: Mapping[str, float], curve: str = "linear") -> float:
    if curve == "sigmoid":
        return double_sigmoid_desirability(
            value, window["acceptMin"], window["idealMin"], window["idealMax"], window["acceptMax"]
        )
    if curve != "linear":
        raise ValueError('curve must be "linear" or "sigmoid"')
    return linear_desirability(value, window)


def geometric_mean(values: list[float]) -> float:
    if not values:
        return 0.0
    product = 1.0
    for v in values:
        product *= max(v, 0.01)
    return product ** (1 / len(values))


def _finite(value: Any) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(float(value)):
        return None
    return float(value)


def mpo_score(
    props: Mapping[str, Any],
    profile: Mapping[str, Mapping[str, float]],
    curve: str = "linear",
) -> dict[str, Any]:
    """Geometric mean of desirabilities for profile keys that have a finite value.

    Keys are visited in ``profile`` insertion order. That order is part of the
    floating-point product, so it matches the JSON order of the scoring profile.
    """
    per_prop: dict[str, float] = {}
    ds: list[float] = []
    for key, window in profile.items():
        if key not in props:
            continue
        value = _finite(props[key])
        if value is None:
            continue
        dv = desirability(value, window, curve)
        per_prop[key] = dv
        ds.append(dv)
    return {"score": geometric_mean(ds), "per_prop": per_prop}
