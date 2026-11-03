"""Behaviour that the golden file does not spell out: missing values, tampering, frames."""

from __future__ import annotations

import math

import pytest

from paretomol import (
    Molecule,
    build_decision_record,
    compute_pareto,
    decode_review,
    get_profile,
    load_profile,
    molecule_ids,
    mpo_score,
    parse_decision_record,
    rank,
    review_token_from_url,
    review_url,
    validate_review,
)


def test_nan_and_infinity_are_unranked():
    mols = [
        Molecule("ok", "C", {}, {"a": 5, "b": 5}),
        Molecule("nan", "C", {}, {"a": float("nan"), "b": 1}),
        Molecule("inf", "C", {}, {"a": float("-inf"), "b": 1}),
    ]
    compute_pareto(mols, [("a", "min"), ("b", "min")])
    assert [m.pareto_rank for m in mols] == [1, None, None]
    assert mols[1].missing_objectives == ["a"]


def test_rank_is_idempotent_and_clears_edges():
    mols = [
        Molecule("a", "C", {}, {"a": 1, "b": 3}),
        Molecule("b", "C", {}, {"a": 3, "b": 1}),
        Molecule("c", "C", {}, {"a": 4, "b": 4}),
    ]
    compute_pareto(mols, [("a", "min"), ("b", "min")])
    first = [m.pareto_rank for m in mols]
    edges = [list(m.dominates) for m in mols]
    compute_pareto(mols, [("a", "min"), ("b", "min")])
    assert [m.pareto_rank for m in mols] == first
    assert [m.dominates for m in mols] == edges


def test_molecule_ids_and_zero_width_window():
    assert molecule_ids(["a", "b", "a", "  ", "a"]) == ["a", "b", "a~2", "mol", "a~3"]
    assert molecule_ids(["a", "a", "a~2"]) == ["a", "a~3", "a~2"]
    assert molecule_ids(["", "mol"]) == ["mol", "mol~2"]
    window = {"acceptMin": 0, "idealMin": 0, "idealMax": 3, "acceptMax": 3}
    for curve in ("linear", "sigmoid"):
        assert mpo_score({"HBD": 0}, {"HBD": window}, curve)["per_prop"]["HBD"] == 1
        assert mpo_score({"HBD": 3}, {"HBD": window}, curve)["per_prop"]["HBD"] == 1
        assert mpo_score({"HBD": -0.5}, {"HBD": window}, curve)["per_prop"]["HBD"] == 0
    oral = get_profile("oral@1")
    assert math.isfinite(mpo_score({"HBD": 0}, oral.desirability, "sigmoid")["score"])


def test_load_profile_rejects_a_bad_window():
    raw = dict(get_profile("custom@1").body)
    raw["id"] = "my-target"
    assert load_profile(raw).ref == "my-target@1"
    bad = dict(raw)
    bad["version"] = 0
    with pytest.raises(ValueError):
        load_profile(bad)
    with pytest.raises(ValueError, match="Unknown"):
        get_profile("oral@2")


def test_parse_rejects_tampering():
    mols = [Molecule("a", "CCO", {"MW": 46, "LogP": 0}, {}), Molecule("b", "CCN", {"MW": 45, "LogP": 1}, {})]
    compute_pareto(mols, [("MW", "min")])
    rec = build_decision_record(mols, [("MW", "min")], rdkit_version="x", timestamp="2026-01-01T00:00:00.000Z", selected=[1])
    text = parse_decision_record(rec)
    tampered = json_copy(text)
    tampered["input"]["molecules"][0]["smiles"] = "CCCO"
    with pytest.raises(ValueError, match="input"):
        parse_decision_record(tampered)
    tampered = json_copy(text)
    tampered["rationale"] = "edited"
    with pytest.raises(ValueError, match="hash"):
        parse_decision_record(tampered)
    tampered = json_copy(text)
    tampered["schema"] = "paretomol.decision/9"
    with pytest.raises(ValueError, match="schema"):
        parse_decision_record(tampered)


def json_copy(value):
    import json
    return json.loads(json.dumps(value))


def test_review_defaults_and_query_token():
    payload = validate_review({"molecules": [{"smiles": "CCO"}]})
    assert payload["profile"] == "oral@1"
    assert payload["molecules"][0]["name"] == "mol1"
    url = review_url([{"smiles": "CCO", "pIC50": 6.2}])
    token = review_token_from_url(url)
    assert token is not None
    assert review_token_from_url(f"https://paretomol.com/?tab=table&r={token}") == token
    assert review_token_from_url("https://paretomol.com/?m=abc") is None
    decoded = decode_review(token)
    assert decoded["molecules"][0]["customProps"]["pIC50"] == 6.2
    with pytest.raises(ValueError, match="non-empty"):
        validate_review({"molecules": []})
    with pytest.raises(ValueError, match="corrupt"):
        decode_review("garbage!!")
    import lzstring
    legacy = lzstring.LZString().compressToEncodedURIComponent(
        '{"schema":"paretomol.review/0","molecules":[{"name":"mol1","smiles":"CCO"}],"profile":"oral@1"}'
    )
    assert not legacy.startswith("v1.")
    assert decode_review(legacy)["molecules"][0]["smiles"] == "CCO"


def test_dataframe_rank_and_review_link():
    pd = pytest.importorskip("pandas")
    df = pd.DataFrame([
        {"name": "aspirin", "smiles": "CC(=O)Oc1ccccc1C(=O)O", "MW": 180.16, "LogP": 1.31, "pIC50": 4.5},
        {"name": "caffeine", "smiles": "Cn1cnc2c1c(=O)n(C)c(=O)n2C", "MW": 194.19, "LogP": -1.03, "pIC50": 5.1},
    ])
    ranked = rank(df, [("MW", "min"), ("pIC50", "max")])
    assert list(ranked["pareto_rank"]) == [1, 1]
    via_frame = review_url(ranked, profile="oral@1", source="notebook", suggested=["aspirin"])
    via_list = review_url(
        [
            {"name": "aspirin", "smiles": "CC(=O)Oc1ccccc1C(=O)O", "customProps": {"MW": 180.16, "LogP": 1.31, "pIC50": 4.5}},
            {"name": "caffeine", "smiles": "Cn1cnc2c1c(=O)n(C)c(=O)n2C", "customProps": {"MW": 194.19, "LogP": -1.03, "pIC50": 5.1}},
        ],
        profile="oral@1",
        source="notebook",
        suggested=["aspirin"],
    )
    assert via_frame == via_list
    assert "pareto_rank" not in decode_review(via_frame.split("#r=", 1)[1])["molecules"][0].get("customProps", {})


def test_constraints_prune_before_the_front():
    from paretomol import Molecule, build_decision_record, compute_pareto, parse_decision_record
    from paretomol.constraints import explain_constraints

    big = Molecule("big", "C", {"MW": 600, "LogP": 1})
    small = Molecule("small", "CC", {"MW": 200, "LogP": 1})
    gates = [{"key": "MW", "op": "<=", "value": 500}]
    assert explain_constraints([big, small], gates) == [False, True]
    compute_pareto([big, small], [{"key": "MW", "direction": "min"}, {"key": "LogP", "direction": "min"}], [False, True])
    assert big.pareto_rank is None
    assert small.pareto_rank == 1
    rec = build_decision_record(
        [big, small],
        [{"key": "MW", "direction": "min"}],
        timestamp="2026-11-01T00:00:00.000Z",
        rdkit_version="2025.03.4",
        constraints=[{"key": "MW", "op": "<=", "value": 500, "predicted": True}],
    )
    assert rec["constraints"] == [{"key": "MW", "op": "<=", "value": 500, "predicted": True}]
    assert [row["paretoRank"] for row in rec["results"]] == [None, 1]
    assert parse_decision_record(rec)["recordHash"] == rec["recordHash"]


def test_verify_claims_with_rdkit():
    pytest.importorskip("rdkit")
    from paretomol import verify_claims

    aspirin = "CC(=O)Oc1ccccc1C(=O)O"
    report = verify_claims([{
        "id": "aspirin",
        "smiles": aspirin,
        "properties": {"MW": 180.16, "cLogP": 1.31, "HBD": 1, "pIC50": 6.2},
        "objectives": [{"key": "IC50_nM", "direction": "min"}, {"key": "QED", "direction": "max"}, {"key": "MW", "direction": "min"}],
    }])
    assert report["flags"] == []
    assert "pIC50" in report["unchecked"]["aspirin"]
    assert "objective:MW" in report["unchecked"]["aspirin"]
    bad = verify_claims([{
        "id": "aspirin",
        "smiles": aspirin,
        "properties": {"MW": 400},
        "objectives": [{"key": "pIC50", "direction": "min"}],
    }])
    kinds = sorted(f["kind"] for f in bad["flags"])
    assert kinds == ["direction_flipped", "value_mismatch"]
    loose = verify_claims(
        [{"id": "aspirin", "smiles": aspirin, "properties": {"MW": 181.0}}],
        tolerances={"MW": {"abs": 1}},
    )
    assert loose["flags"] == []
    invalid = verify_claims([{"id": "nope", "smiles": "not-a-molecule"}])
    assert invalid["flags"][0]["kind"] == "invalid_smiles"
