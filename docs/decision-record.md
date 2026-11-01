# Decision record v0 (`paretomol.decision/0`)

A decision record is one JSON file that says what you ranked, how, with which
software, what you picked and why. ParetoMol exports it from **Export > Decision
record (JSON)** and opens it with **Open record**; the CLI writes the same
format (`paretomol rank in.csv --profile oral@1 --out record.json`). Opening a
record restores the exact view it was exported from.

Code: `packages/core/src/decision.ts` (`buildDecisionRecord`,
`stringifyDecisionRecord`, `parseDecisionRecord`, `selectedIndices`).

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
  "models": { "admet": null, "core": "0.1.0", "rdkitjs": "2025.03.4" },
  "objectives": [ { "direction": "min", "key": "MW" }, { "direction": "max", "key": "LogP" } ],
  "profile": { "hash": "sha256:...", "ref": "oral@1" },
  "rationale": "lowest MW pair",
  "recordHash": "sha256:...",
  "results": [ { "id": "aspirin", "mpo": 0.912345, "paretoRank": 1 } ],
  "schema": "paretomol.decision/0",
  "selected": [ "aspirin" ],
  "timestamp": "2026-10-30T06:00:00.000Z",
  "view": { "activeTab": "pareto", "customPropNames": ["pIC50"], "propertyFilters": {}, "substructureFilter": "" }
}
```

## Fields

| Field | Meaning |
|---|---|
| `schema` | Always `paretomol.decision/0`. Readers reject anything else. |
| `input.molecules[]` | Ordered input: `id`, `name`, `smiles`, and `customProps` (imported, measured or ADMET-predicted numbers). RDKit descriptors are not stored; they are recomputed. |
| `input.count` | Number of molecules. |
| `input.sha256` | `sha256:<hex>` of the canonical JSON of the molecules (id, name, smiles, finite customProps). |
| `profile.ref` / `profile.hash` / `profile.curve` | Scoring profile as `id@version`, its content hash, and the MPO curve (`linear` or `sigmoid`) used for `results.mpo`. Export writes the profile and curve selected on the MPO tab (`oral@1` and linear until you change them). A review link exports the link's profile and a linear curve. Older records omit `curve`; readers treat that as linear. |
| `models.core` | `@paretomol/core` version. |
| `models.rdkitjs` | RDKit.js version that computed descriptors (`RDKit.version()`). |
| `models.admet` | `{endpoint, model}` when any column came from ADMET-AI, else `null`. |
| `objectives[]` | Pareto objectives, `{key, direction: "min" \| "max"}`. |
| `results[]` | Per molecule: `id`, `paretoRank` (1 = front), `mpo` (MPO under the profile and `profile.curve`, 6 decimals). |
| `selected[]` | Picked molecule ids (the shortlist), sorted. Every id must exist in the input. |
| `rationale` | Free text: why these picks. |
| `view` | Optional UI state: active tab, formula columns, custom/ADMET column names, property filters, substructure filter. The CLI omits it. |
| `review` | Optional, from an open review link ([review-url.md](review-url.md)): `source` (who made the link), `decisions` (`{id: "accept" \| "reject"}`, undecided molecules absent), `suggested` (ids the agent proposed). `selected` equals the accepted ids. |
| `timestamp` | ISO 8601 UTC. |
| `recordHash` | `sha256:<hex>` of the canonical JSON of the whole record without `recordHash`. |

## Ids

`id` is the molecule name. A repeated name gets `~2`, `~3`, ... in input order.
Empty names become `mol`.

## Hashing

Canonical JSON: object keys sorted by code point at every level, no
whitespace, arrays in order, numbers as `JSON.stringify` prints them. SHA-256
over the UTF-8 bytes, written as `sha256:` plus lowercase hex. Profile hashes
use the same scheme. The file itself is written with sorted keys and a
2-space indent, so the same decision always produces the same bytes except for
`timestamp` and `recordHash`.

## Verification on open

`parseDecisionRecord` throws when:

- `schema` is not `paretomol.decision/0`;
- `input.sha256` does not match the molecules, or `input.count` is wrong;
- `recordHash` does not match (the file was edited after export; recompute it
  with `recordHash()` if the edit is deliberate);
- `profile.ref` is a built-in profile whose hash differs from this version;
- a `selected` id is not in the input;
- a `review.decisions` key is not in the input, or a verdict is not `accept`/`reject`.

## Round trip

Opening a record re-parses each `smiles` with RDKit.js, restores names and
custom columns, objectives, filters, formula columns and the shortlist, then
recomputes the Pareto ranks. Exporting again gives the same record except for
`timestamp` and `recordHash`; `e2e/decision.spec.ts` checks this.

## Recompute

`verifyDecision(record, RDKit)` in `@paretomol/core` checks the schema and the
hashes (the same rules as `parseDecisionRecord`) and recomputes Pareto rank
and linear MPO with RDKit. The CLI is `paretomol verify-decision record.json`
(exit 2 when `ok` is false). The MCP tool is `verify_decision`.

`issues[].code` is `schema`, `hash`, `count`, `selection`, `profile`,
`invalid_smiles`, `rank` or `mpo`. A hash failure still includes the
recomputed rows when the molecules parse, so the diff is visible next to
the hash error. `rank` and `mpo` issues carry `claimed` and `actual`.

## Versioning

Additive optional fields keep `/0`. Any change in meaning or in hashing bumps
the schema to `paretomol.decision/1`.
