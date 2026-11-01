# Decision record (`paretomol.decision/1`)

A decision record is one JSON file that says what you ranked, how, with which
software, what you picked and why. ParetoMol exports it from **Export > Decision
record (JSON)** and opens it with **Open record**; the CLI writes the same
format (`paretomol rank in.csv --profile oral@1 --out record.json`). Opening a
record restores the view it was exported from.

New records use `paretomol.decision/1`. Readers still open `paretomol.decision/0`.

Code: `packages/core/src/decision.ts` (`buildDecisionRecord`,
`stringifyDecisionRecord`, `parseDecisionRecord`, `selectedIndices`) and
`packages/core/src/decisionVerify.ts` (`verifyDecision`).

## Example

```json
{
  "input": {
    "count": 2,
    "molecules": [
      { "id": "aspirin", "name": "aspirin", "smiles": "CC(=O)Oc1ccccc1C(=O)O" },
      { "id": "caffeine", "name": "caffeine", "smiles": "CN1C=NC2=C1C(=O)N(C(=O)N2C)C", "customProps": { "pIC50": 6.1 } }
    ],
    "sha256": "sha256:..."
  },
  "models": {
    "admet": null,
    "core": "0.1.0",
    "rdkitjs": { "sha256": "sha256:...", "version": "2025.03.4" }
  },
  "objectives": [ { "direction": "min", "key": "MW" }, { "direction": "max", "key": "LogP" } ],
  "profile": {
    "curve": "linear",
    "hash": "sha256:...",
    "ref": "oral@1",
    "windows": { "MW": { "acceptMax": 500, "acceptMin": 100, "idealMax": 400, "idealMin": 150 } }
  },
  "rationale": "lowest MW pair",
  "recordHash": "sha256:...",
  "results": [ { "id": "aspirin", "mpo": 0.912345, "paretoRank": 1 } ],
  "schema": "paretomol.decision/1",
  "selected": [ "aspirin" ],
  "timestamp": "2026-10-30T06:00:00.000Z",
  "view": { "activeTab": "pareto", "customPropNames": ["pIC50"], "propertyFilters": {}, "substructureFilter": "" }
}
```

## Fields

| Field | Meaning |
|---|---|
| `schema` | `paretomol.decision/1` for a new record. Readers also accept `paretomol.decision/0`. |
| `input.molecules[]` | Ordered input: `id`, `name`, `smiles`, and `customProps` (imported, measured or ADMET-predicted numbers). RDKit descriptors are not stored; they are recomputed. Ids are unique. |
| `input.count` | Number of molecules. |
| `input.sha256` | `sha256:<hex>` of the canonical JSON of the molecules (id, name, smiles, finite customProps). |
| `profile.ref` / `profile.hash` | Scoring profile as `id@version` and the content hash of that profile document. |
| `profile.curve` | MPO curve, `linear` or `sigmoid`. Required on v1. Absent on older v0 records, which means linear. |
| `profile.windows` | Desirability windows that were applied (`idealMin`, `idealMax`, `acceptMin`, `acceptMax` per property). Required on v1, so a custom profile can be scored again from the file. v0 records omit it. |
| `models.core` | `@paretomol/core` version, read from that package's `package.json`. |
| `models.rdkitjs` | On v1, `{version, sha256}`. `version` is `RDKit.version()`. `sha256` is the hash of the pinned `RDKit_minimal.wasm`. v0 stored only the version string. |
| `models.admet` | `{endpoint, model}` when any column came from ADMET-AI, else `null`. |
| `objectives[]` | Pareto objectives, `{key, direction: "min" or "max"}`. |
| `results[]` | Per molecule: `id`, `paretoRank` (1 = front), `mpo` (MPO under `profile.windows` and `profile.curve`, 6 decimals). Core computes both when it builds the record. It does not copy a rank the caller already stored. |
| `selected[]` | Picked molecule ids, sorted. Every id must exist in the input. On v1, when `review` is present, this list is exactly the ids whose verdict is `accept`. |
| `rationale` | Free text: why these picks. |
| `view` | Optional UI state: active tab, formula columns, custom/ADMET column names, property filters, substructure filter. The CLI omits it. |
| `review` | Optional, from an open review link ([review-url.md](review-url.md)): `source`, `decisions` (`{id: "accept" or "reject"}`), `suggested`. |
| `timestamp` | ISO 8601 UTC. |
| `recordHash` | `sha256:<hex>` of the canonical JSON of the whole record without `recordHash`. |

## Ids

`id` is the molecule name. The first use of a name keeps that name. A repeat gets `~2`, `~3`, ... in input order, skipping any id that is already taken. That includes a later molecule whose own name is `a~2`: the names `a`, `a`, `a~2` become `a`, `a~3`, `a~2`. A blank name becomes `mol`.

## Hashing

Canonical JSON: object keys sorted by code point at every level, no
whitespace, arrays in order, numbers as `JSON.stringify` prints them. SHA-256
over the UTF-8 bytes, written as `sha256:` plus lowercase hex. Profile hashes
use the same scheme. The file itself is written with sorted keys and a
2-space indent, so the same decision always produces the same bytes except for
`timestamp` and `recordHash`.

## Verification on open

`parseDecisionRecord` throws when:

- `schema` is not `paretomol.decision/0` or `paretomol.decision/1`;
- `input.sha256` does not match the molecules, or `input.count` is wrong;
- `recordHash` does not match (the file was edited after export);
- `profile.ref` is a built-in profile whose hash differs from this version;
- `profile.curve` is present and is not `linear` or `sigmoid`;
- a `selected` id is not in the input;
- a `review.decisions` key is not in the input, or a verdict is not `accept` or `reject`.

On v1 it also throws when:

- an input id is repeated;
- `profile.windows` is missing or not a set of desirability windows;
- a built-in profile's windows differ from this version;
- `models.rdkitjs.sha256` is not the WASM hash of this build;
- `review` is present and `selected` is not the accepted ids.

v0 records are not held to the v1 rules, so an older file still opens.

## Round trip

Opening a record checks it with `verifyDecision`, re-parses each `smiles` with
RDKit.js, restores names and custom columns, objectives, filters, formula
columns and the shortlist, then recomputes the Pareto ranks. A record whose
ranks or MPO do not match the recompute still opens, and the page says what
differed. A record that fails the hash or schema check does not open.

Exporting again gives the same record except for `timestamp` and `recordHash`.
`e2e/decision.spec.ts` checks this.

## Recompute

`verifyDecision(record, RDKit)` in `@paretomol/core` is the checker the CLI,
the MCP tool `verify_decision`, and the import dialog all call. It checks the
schema and the hashes (the same rules as `parseDecisionRecord`) and recomputes
Pareto rank and MPO with RDKit, using the embedded windows and curve on v1.
The CLI is `paretomol verify-decision record.json` (exit 2 when `ok` is false).

`issues[].code` is `schema`, `hash`, `count`, `selection`, `profile`,
`invalid_smiles`, `rank` or `mpo`. A hash failure still includes the
recomputed rows when the molecules parse, so the diff is visible next to
the hash error. `rank` and `mpo` issues carry `claimed` and `actual`.

## Versioning

`paretomol.decision/0` stays readable. v1 changes the meaning of the record:
results are computed inside core, the profile's windows travel with the file,
ids cannot collide, and `selected` is checked against the review. Further
changes in meaning or in hashing bump the schema again.
