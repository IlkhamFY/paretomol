# ParetoMol MCP server

`@paretomol/mcp` exposes ParetoMol to chemistry agents over the Model Context Protocol (stdio, newline-delimited JSON-RPC). It runs offline on RDKit.js 2025.3.4 and `@paretomol/core`, so numbers match the app and the CLI. No SDK dependency.

## Run

```bash
git clone https://github.com/IlkhamFY/paretomol && cd paretomol
npm install && npm run build
node packages/mcp/bin/paretomol-mcp.js
```

Claude Desktop / Cursor config:

```json
{ "mcpServers": { "paretomol": { "command": "node", "args": ["/path/to/paretomol/packages/mcp/bin/paretomol-mcp.js"] } } }
```

## Tools

Molecules are SMILES strings or `{smiles, name?, props?}`; `props` are numeric columns such as `pIC50`. Objectives are `[{key, direction: "min"|"max"}]`, default MW/LogP/TPSA min.

| Tool | Does |
|---|---|
| `score_molecules` | RDKit descriptors (MW, LogP, TPSA, HBD, HBA, RotBonds, FrCSP3, rings, QED, SC estimate). Invalid SMILES listed by index. |
| `pareto_front` | Pareto ranks, the front, and who dominates whom. Molecules missing an objective stay unranked (null), never imputed. |
| `apply_profile` | Versioned profile (`oral@1`, `cns@1`, `leadlike@1`, `lipinski@1`): MPO score, per-property desirability, filter violations, profile objectives. Returns ref and sha256 hash. |
| `explain_tradeoff` | Front size, the most anti-correlated objective pair, and an optional head-to-head of two named molecules. |
| `open_review_url` | A `https://paretomol.com/#r=` link for human Accept/Reject (see review-url.md). Warns above ~32k chars. |
| `verify_claims` | Checks claimed descriptor values and objective directions (see verify.md). |

Every result comes back as JSON text plus `structuredContent`. Tool errors return `isError: true` with a message an agent can act on.
