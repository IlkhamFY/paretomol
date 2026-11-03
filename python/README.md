# paretomol

Python port of the headless ParetoMol core: Pareto ranks, objective directions, versioned scoring profiles, `paretomol.decision/1` records (readers still open `/0`), claim checks, and `paretomol.com/#r=` review links.

The same inputs produce the same ranks, the same MPO scores, and the same `sha256:` hashes as [`@paretomol/core`](../packages/core). Profile JSON lives in `src/paretomol/profiles/` and is hashed with the same canonical JSON.

This package is not published to PyPI. Install it from a checkout of the repository:

```bash
pip install -e "python/[rdkit]"
```

RDKit is optional. Without it, ranking, profiles, records and review links still work. `verify_claims` and `molecule_descriptors` need `paretomol[rdkit]`.

## Ten lines with pandas

```python
import pandas as pd
from paretomol import get_profile, rank, review_url
df = pd.DataFrame([
    {"name": "aspirin", "smiles": "CC(=O)Oc1ccccc1C(=O)O", "MW": 180.16, "LogP": 1.31, "pIC50": 4.5},
    {"name": "caffeine", "smiles": "Cn1cnc2c1c(=O)n(C)c(=O)n2C", "MW": 194.19, "LogP": -1.03, "pIC50": 5.1},
])
ranked = rank(df, [("MW", "min"), ("pIC50", "max")])
print(ranked[["name", "pareto_rank"]].to_string(index=False))
print(get_profile("oral@1").hash)
print(review_url(ranked, profile="oral@1", source="notebook"))
```

`rank` adds `pareto_rank` (1 is the front, None means a value was missing). `review_url` packs `name`, `smiles` and the other numeric columns into a fragment link (`v1.` plus deflate). Older lz-string links still open. The page recomputes descriptors and ranks.

## Profiles

`oral@1`, `cns@1`, `leadlike@1`, `lipinski@1`, and the `custom@1` template. `get_profile("oral")` is the latest `oral` version. `load_profile` checks a dict and returns its hash. Cite `profile.hash` in a decision record.

## Decision records

`build_decision_record` writes `paretomol.decision/1`. `parse_decision_record` also opens `paretomol.decision/0`. A v1 profile block includes `curve` (`linear` or `sigmoid`) and `windows` (the desirability that scored the MPO). Ranks are computed in `build_decision_record`, not copied from the caller. `models.rdkitjs` is `{version, sha256}` of the pinned WASM. `models.core` stays `0.1.0`, the `@paretomol/core` version, so a record built here verifies in the app. When a review is present, `selected` must be the accepted ids.

## Claims

`verify_claims` recomputes MW, Crippen LogP, HBD, HBA, TPSA, rotatable bonds, Fsp3, rings, heavy atoms, MR and QED with RDKit, and checks objective directions (`pIC50` max, `IC50` min, `hERG` min). Anything it cannot recompute is listed under `unchecked`.

## Parity fixtures

`packages/core/test/python-golden.test.ts` rebuilds `python/tests/fixtures/golden.json` from `@paretomol/core`. `pytest` requires the Python package to reproduce that file. Regenerate with:

```bash
WRITE_GOLDEN=1 npx vitest run packages/core/test/python-golden.test.ts
```
