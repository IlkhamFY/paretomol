# paretomol (CLI)

Rank molecules offline with the same core and the same RDKit.js build as the
ParetoMol web app, and write a [decision record](../../docs/decision-record.md).

```sh
npx paretomol rank in.csv --profile oral@1 --out record.json
```

Input: SMILES lines (`SMILES name`) or a CSV/TSV with a SMILES column; numeric
columns become custom properties. Objectives default to the app's (MW min,
LogP, TPSA, plus custom columns whose direction is clear from the name, such as
pIC50 max or IC50 min). Override with `--objectives "MW:min,pIC50:max"`.

Other flags: `--select id1,id2`, `--rationale "..."`, `--timestamp <iso>`
(fixed timestamp for reproducible files). Run `paretomol --help` for all.

Differences from the app: no PubChem name lookup (lines that do not parse as
SMILES are skipped and counted), no ADMET-AI calls, and no `view` block.
Everything else in the record (input hash, Pareto ranks, MPO, profile hash)
is identical; `e2e/cli-match.spec.ts` checks this.

## verify

```sh
npx paretomol verify claims.json
```

Recomputes claimed RDKit descriptors (MW, LogP, HBD, HBA, TPSA, RotBonds, Fsp3,
rings, heavy atoms, MR, QED; common aliases like cLogP or RotB accepted) and
checks objective directions (pIC50 max, IC50 min, QED max, hERG min, SA_Score
min ...). Prints a JSON report; exit code 2 when anything is flagged. Values it
cannot recompute and objectives with no universal direction (MW, LogP) are
listed as unchecked, never flagged.
