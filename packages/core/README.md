# @paretomol/core

The framework-free logic behind [ParetoMol](https://paretomol.com): no DOM, no React, no network.
The web app imports everything below from this package, so results match the app exactly.

- `computeParetoAndDominance(molecules, objectives)`: non-dominated fronts (NSGA-II sorting) with dominance edges; complete-case handling of missing values.
- `findKnee`-style knee point (`paretoKnee`), plain-language front summary (`paretoNarrative`).
- `inferObjectiveDirection`, `inferObjectives`: min/max direction from column names (pIC50 max, IC50 min, unknown left out).
- MPO: `linearDesirability`, `doubleSigmoidDesirability`, `geometricMean`, `mpoScore`.
- `computeQED` (Bickerton 2012), `QED_ALERT_SMARTS`, `DRUG_FILTERS` + `checkFilter`.
- Fingerprint similarity, activity cliffs, synthetic-complexity heuristic, assay value parsing, stats, safe formula parser, citation.

Descriptor calculation (RDKit) is not included; pass in `props` computed by RDKit or any other toolkit.

## Scoring profiles

Versioned JSON in `profiles/`: `oral@1`, `cns@1`, `leadlike@1`, `lipinski@1`, and `custom@1` as a template.

```ts
import { getProfile, mpoScore } from '@paretomol/core';
const oral = getProfile('oral@1');
oral.hash; // 'sha256:…' of the canonical JSON; cite it in a decision record
mpoScore({ MW: 320, LogP: 2.1, HBD: 1, HBA: 5, TPSA: 70, RotBonds: 4 }, oral.desirability).score;
```

Any change to a profile's content must bump its `version`; the tests pin every hash.
