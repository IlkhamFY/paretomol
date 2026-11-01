# Open review URL (paretomol.review/0)

An agent (or any script) packs a shortlist into a link. Opening the link loads
the molecules in ParetoMol in **review mode**: a panel lists each molecule with
its Pareto rank, MPO score and objective values, and the reviewer clicks
**Accept** or **Reject** per molecule. **Export decision record** writes a
[decision record](decision-record.md) with the verdicts in `review` and the
accepted molecules in `selected`.

```
https://paretomol.com/#r=<token>
https://paretomol.com/?r=<token>      (also accepted)
```

Use the fragment form. Browsers do not send the fragment to the server, so the
molecules stay in the reviewer's browser; analytics also strip `r` from any
path or referrer.

## Token

New links use a versioned token:

`token = "1." + base64url(deflate(JSON.stringify(payload)))`

`deflate` is raw DEFLATE (RFC 1951). `base64url` is unpadded. The `1.` prefix is the version, so a reader can tell this apart from older tokens.

Older links still open:

- lz-string 1.5 `compressToEncodedURIComponent` of the same JSON, with no prefix (the original scheme, also used by share links);
- the raw JSON payload itself, when the token starts with `{`.

```json
{
  "schema": "paretomol.review/0",
  "title": "Kinase shortlist",
  "source": "my-agent",
  "note": "Two candidates look best; check caffeine.",
  "profile": "cns@1",
  "objectives": [{ "key": "MW", "direction": "min" }, { "key": "pIC50", "direction": "max" }],
  "suggested": ["aspirin"],
  "molecules": [
    { "name": "aspirin", "smiles": "CC(=O)Oc1ccccc1C(=O)O", "customProps": { "pIC50": 6.2 } },
    { "name": "caffeine", "smiles": "Cn1cnc2c1c(=O)n(C)c(=O)n2C" }
  ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `schema` | no | `paretomol.review/0` (filled in when absent). |
| `molecules[]` | yes | `smiles` (required), `name` (default `molN`), `customProps` (finite numbers only; others dropped). |
| `profile` | no | Built-in profile ref; default `oral@1`. Unknown refs are rejected. |
| `objectives[]` | no | `{key, direction}`; default: the profile's objectives. |
| `title`, `source`, `note` | no | Shown in the review panel. |
| `suggested[]` | no | Molecule names the agent proposes; shown as "suggested", never pre-accepted. |

## API

`@paretomol/core`: `validateReview`, `encodeReview`, `decodeReview`,
`reviewUrl(payload, base?)`, `reviewTokenFromUrl(url)`. The MCP tool
`open_review_url` returns the same link.

## Limits

Links above about 32 000 characters (`REVIEW_URL_SOFT_LIMIT`) may be cut by
chat apps or browsers. Deflate keeps a 500-molecule shortlist under that line;
how many fit depends on SMILES length and custom columns. For larger sets use a
decision record file or the CLI.

The fragment stays in the address bar while review mode is open, so a reload or
a copied link opens the same review. Leaving review removes `r`. Analytics
strip `r` from any path or referrer before a hit is sent.

The link is a request for review, not a decision: nothing is accepted until the
reviewer clicks. The structures are re-parsed with RDKit.js in the browser and
all descriptors and ranks are recomputed; the link cannot carry precomputed
scores.
