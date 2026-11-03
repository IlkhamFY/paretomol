# ParetoMol agent benchmark (paretomol.agentbench/1)

27 tasks for an LLM agent: Pareto fronts and ranks, missing measurements, scoring profiles, RDKit descriptors, dominance, the sharpest trade-off, quoted CSV, duplicate ids, a tampered decision record, and wrong claims from another agent.

Reference client, no model, every task through the stdio MCP server:

```
TOTAL 27/27 (100%)
```

## What it measures

Whether an agent will use the tools instead of inventing MW, LogP, pChEMBL or a Pareto front. Run the same tasks twice: once with no tools, once with the ParetoMol MCP server (`docs/mcp.md`). The gap is the point.

Twenty tasks take their expected value from `@paretomol/core`. Seven do not, so the suite is not only grading the tools against themselves:

| Tasks | Expected value |
|---|---|
| t01 to t20 | `@paretomol/core` (regenerated, not typed in) |
| t21 to t23 | RDKit Python 2026.03.4 `MolWt`, `Crippen.MolLogP`, `Descriptors.TPSA` |
| t24 | Hand-checked front on four ChEMBL pChEMBL pairs |
| t25 | Quoted CSV. The front is read off the potency and bulk cells |
| t26 | Duplicate name. Ids follow the decision-record rule `name`, then `name~2` |
| t27 | A decision record whose `results[0].mpo` was increased by 1 with `recordHash` left stale. Verification fails |

## Data

ChEMBL release **ChEMBL_37** (1 May 2026, [DOI 10.6019/CHEMBL.database.37](https://doi.org/10.6019/CHEMBL.database.37)).

Twelve molecules, eighteen cited activity rows. Targets: EGFR (CHEMBL203), ERBB2 (CHEMBL1824), PTGS1 (CHEMBL221), PTGS2 (CHEMBL230), HMGCR (CHEMBL402), PPIA (CHEMBL1949). Each row is the lower median of qualifying IC50 pChEMBL values (ties broken by the smaller activity id). Filters, assay ids and activity ids are in `data/manifest.json`. Osimertinib and vandetanib have no qualifying wild-type ERBB2 row under those filters, which is why t06 is a missing-value task.

ChEMBL is licensed [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). Attribute it as ChEMBL, EMBL-EBI, release ChEMBL_37. Primary citation: Mendez et al., Nucleic Acids Res. 2019, 47(D1):D930-D940, DOI 10.1093/nar/gky1075. ChEMBL ids are kept on every molecule.

The canonical API is `https://www.ebi.ac.uk/chembl/api/data`. This freeze was read from the EBI dev host because the canonical data calls were returning HTTP 500. Both reported ChEMBL_37.

Files, all small:

- `data/manifest.json` release, targets, assay ids, activity ids, license
- `data/activities.json` and `data/molecules.csv` the cited rows
- `data/molecules.json` one record per molecule
- `data/rdkit_python.json` descriptor reference
- `data/hand_front.json`, `data/quoted.csv`, `data/duplicate.csv`
- `data/decision_ok.json`, `data/decision_tampered.json`

`potency` and `bulk` in `quoted.csv` are a four-row hand example so the front can be checked by eye. The SMILES and ChEMBL ids in that file are the real structures. Activity tasks use the measured pChEMBL values.

## Reproduce

```bash
node benchmarks/agents/build/fetch-chembl.mjs --check      # re-read each activity id
node benchmarks/agents/build/fetch-chembl.mjs --reselect   # re-run the median query
pip install -r benchmarks/agents/build/requirements.txt
python3 benchmarks/agents/build/rdkit_descriptors.py --check
node benchmarks/agents/build/make-decision-fixtures.mjs
UPDATE_BENCH=1 npx vitest run benchmarks/agents
```

`--write` replaces the ChEMBL files. Do that only when you intend to move the freeze.

## Run and score

`tasks.json` is the form an agent sees. `tasks.ts` is the source. Do not edit `tasks.json` by hand.

```bash
npm run build
node benchmarks/agents/mcp-client.mjs
node benchmarks/agents/score.mjs answers.json
```

`answers.json` is `{ "t01": ["aspirin", ...], "t07": "aspirin", "t11": 1202.6, "t27": "fail" }`.

Scoring: sets by Jaccard similarity, names and strings exact (case-insensitive), numbers within the task tolerance. Maximum is the number of tasks.

The reference client is scripted. It calls `pareto_front`, `apply_profile`, `score_molecules`, `explain_tradeoff`, `verify_claims`, `rank_input` and `verify_decision` on the stdio server. It does not call a model.
