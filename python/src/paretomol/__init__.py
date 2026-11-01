"""ParetoMol for Python: ranking, scoring profiles, decision records, review links.

Results match ``@paretomol/core`` for the same inputs: the same Pareto ranks,
the same MPO scores, and the same ``sha256:`` profile and record hashes.
Descriptor calculation needs the optional RDKit extra (``paretomol[rdkit]``).
"""

from __future__ import annotations

from .canonical import canonical_json, js_stringify, round6, sha256_hex
from .decision import (
    ADMET_MODEL,
    CORE_VERSION,
    DECISION_RECORD_SCHEMA,
    build_decision_record,
    input_hash,
    molecule_ids,
    parse_decision_record,
    record_hash,
    selected_indices,
    stringify_decision_record,
)
from .descriptors import molecule_descriptors, rdkit_version
from .mpo import desirability, geometric_mean, linear_desirability, mpo_score
from .objectives import infer_objective_direction, infer_objectives
from .pareto import (
    DEFAULT_OBJECTIVES,
    Molecule,
    compute_pareto,
    contract_objectives,
    get_mol_value,
    rank,
)
from .profiles import get_profile, list_profiles, load_profile, profile_hash
from .review import (
    REVIEW_BASE_URL,
    REVIEW_SCHEMA,
    REVIEW_TOKEN_PREFIX,
    REVIEW_URL_SOFT_LIMIT,
    decode_review,
    encode_review,
    review_token_from_url,
    review_url,
    review_url_warning,
    validate_review,
)
from .verify import canonical_property, expected_direction, verify_claims

__version__ = "0.1.0"

__all__ = [
    "ADMET_MODEL",
    "CORE_VERSION",
    "DECISION_RECORD_SCHEMA",
    "DEFAULT_OBJECTIVES",
    "Molecule",
    "REVIEW_BASE_URL",
    "REVIEW_SCHEMA",
    "REVIEW_TOKEN_PREFIX",
    "REVIEW_URL_SOFT_LIMIT",
    "build_decision_record",
    "canonical_json",
    "canonical_property",
    "compute_pareto",
    "contract_objectives",
    "decode_review",
    "desirability",
    "encode_review",
    "expected_direction",
    "geometric_mean",
    "get_mol_value",
    "get_profile",
    "infer_objective_direction",
    "infer_objectives",
    "input_hash",
    "js_stringify",
    "linear_desirability",
    "list_profiles",
    "load_profile",
    "molecule_descriptors",
    "molecule_ids",
    "mpo_score",
    "parse_decision_record",
    "profile_hash",
    "rank",
    "rdkit_version",
    "record_hash",
    "review_token_from_url",
    "review_url",
    "review_url_warning",
    "round6",
    "selected_indices",
    "sha256_hex",
    "stringify_decision_record",
    "validate_review",
    "verify_claims",
]
