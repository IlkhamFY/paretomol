# Claim verifier

`verifyClaims(claims, RDKit, opts?)` in `@paretomol/core` (also
`@paretomol/core/verify`, and `npx paretomol verify claims.json`) checks what an
agent says about molecules before anyone acts on it.

Input, one entry per molecule:

```json
{ "id": "aspirin", "smiles": "CC(=O)Oc1ccccc1C(=O)O",
  "properties": { "MW": 180.2, "cLogP": 1.31, "HBD": 1, "pIC50": 6.2 },
  "objectives": [ { "key": "IC50_nM", "direction": "min" }, { "key": "QED", "direction": "max" } ] }
```

What it flags:

| Kind | When |
|---|---|
| `invalid_smiles` | RDKit.js cannot parse the SMILES. |
| `value_mismatch` | A recomputable descriptor differs from RDKit.js by more than its tolerance. |
| `direction_flipped` | An objective's direction contradicts the known one. |

Recomputed descriptors and default tolerances: MW ±0.5, LogP ±0.5 (Crippen),
TPSA ±1.5, MR ±1.5, QED ±0.02, Fsp3 ±0.02; HBD, HBA, RotBonds, Rings,
AromaticRings and HeavyAtoms exact. Aliases such as `cLogP`, `Fsp3`, `RotB`,
`NumHDonors` are accepted. Override with `{ tolerances: { MW: { abs: 1 } } }`.

Known directions: QED, RAScore, Vendors max; SA_Score, SCScore, SC min; then
the app's column inference (pIC50/pKi max, IC50/Ki/Kd min, hERG/DILI/toxicity
min, solubility/permeability max). MW, LogP and TPSA have no universal direction.

Anything it cannot check is listed under `unchecked`, never flagged. The
50-row fixture in `packages/core/test/fixtures/verify-claims.json` (regenerate
with `make-verify-fixture.mjs`) has 17 seeded errors; the test requires all 17
caught and nothing else flagged.
