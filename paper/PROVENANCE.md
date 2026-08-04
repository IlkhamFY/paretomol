# Data provenance

Provenance, construction and known limitations of the datasets deposited with
the manuscript. Checksums for every file are in `SHA256SUMS`; verify with
`sha256sum -c SHA256SUMS` from this directory.

## `fda_approved_1949.csv` — Demonstration 1

**1,949 approved small-molecule drugs.**

| | |
|---|---|
| Source | ChEMBL, `max_phase = 4` (approved) |
| ChEMBL release | 34 |
| Accessed | 2025-11 |
| Retrieved by | `paper/scripts/` (see the ChEMBL query recorded below) |

**Columns.** Three distinct kinds of value, which the manuscript reports
separately and which should not be conflated:

- *Calculated descriptors* — `MW`, `LogP`, `HBD`, `HBA`, `TPSA`, `RotBonds`.
  Computed with RDKit. `MW` is the **average** molecular weight
  (`Descriptors.MolWt`), not the monoisotopic exact mass; Lipinski's rule of
  five is defined on average MW, and the application computes the same
  quantity.
- *Predicted endpoints* — `admet_hERG`, `admet_DILI`, `admet_ClinTox`.
  Predictions from ADMET-AI (Swanson et al., *Bioinformatics* 2024), a
  Chemprop-RDKit model. These are **estimates, not measurements**.
- *Identifiers* — `name`, `chembl_id`, `smiles`.

**Cleaning.** Records lacking any of the nine objective columns were excluded.
The deposited file contains no missing or non-numeric values in any of those
columns, which `paper/scripts/run_all.py --check` asserts on every CI run.

**Known biases.** The set is the approved small-molecule pharmacopoeia, which
is not a neutral sample of chemical space: it is enriched in orally
bioavailable, rule-of-five-compliant chemistry, and it under-represents
peptides, macrocycles, and biologics. Conclusions drawn on it describe
approved drug-like chemistry and should not be read as describing chemical
space at large. Survivorship is inherent — these are compounds that succeeded,
so their property distributions are narrower than those of candidates entering
development.

## `egfr_top50.csv` — Demonstration 2

**50 EGFR inhibitors with measured activity.**

| | |
|---|---|
| Source | ChEMBL, target CHEMBL203 (EGFR) |
| ChEMBL release | 34 |
| Accessed | 2025-11 |

Activity records were restricted to single-protein assays with `assay_type =
B` (binding) and a `pchembl_value`, and aggregated per compound. Assay
composition is reported in `paper/scripts/egfr_assay_composition_table.tex`.

**Known biases.** Public activity data are reported preferentially for active
compounds, so the distribution is truncated from below; and values aggregated
across laboratories and assay formats carry between-assay variance that a
single number does not express.

## Reference set used for the applicability domain

The curated approved-drug reference bundled with the application
(`src/data/fda_oral_drugs.json`) is a hand-assembled list, not a systematic
sample. It is used only as a coarse "how approved-drug-like is this" cue and
is described as such in the interface. It contains no peptides or macrocycles,
so compounds of those classes will read as out-of-domain regardless of their
merit.

## Software versions

Pinned in `paper/requirements.txt`. The application's own descriptor
calculations use RDKit.js (version pinned in `index.html`); the analysis
scripts use the RDKit Python distribution. The two were verified to agree:
average molecular weight reproduces `Descriptors.MolWt` exactly, and the QED
structural-alert counts are identical across 500 reference compounds.

## Reproduction

```sh
pip install -r paper/requirements.txt
python3 paper/scripts/run_all.py            # regenerate everything
python3 paper/scripts/run_all.py --check    # verify reported values only
```

`--check` re-derives the reported front sizes and the QED alert catalogue from
the deposited data and fails if any reported number has moved. It writes
nothing. It runs in CI on every pull request.

Figures regenerate into a scratch directory rather than over the committed
ones; set `PARETOMOL_FIGURE_OUT` to choose the destination.
