# ParetoMol MCP server

`@paretomol/mcp` exposes ParetoMol to chemistry agents over the Model Context Protocol. Transport is stdio, newline-delimited JSON-RPC, implemented by the official TypeScript SDK (`@modelcontextprotocol/sdk`). The server runs offline on RDKit.js 2025.3.4 and `@paretomol/core`, so numbers match the app and the CLI.

The SDK negotiates the protocol version. A version the server implements (`2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`, `2024-10-07`, whichever of those the installed SDK still lists) is accepted. Any other client version comes back as the latest version the server implements, not as an echo of the client's string.

The package is not on npm. `packages/mcp/server.json` is the manifest for the official MCP registry (`io.github.IlkhamFY/paretomol`). Do not publish it from this tree.

## Run

```bash
git clone https://github.com/IlkhamFY/paretomol && cd paretomol
npm install && npm run build
npx paretomol-mcp
```

Claude Desktop (`claude_desktop_config.json`) and Cursor (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "paretomol": {
      "command": "npx",
      "args": ["paretomol-mcp"],
      "cwd": "/absolute/path/to/paretomol"
    }
  }
}
```

`cwd` is the clone, after `npm run build`. Install notes: [packages/mcp/README.md](../packages/mcp/README.md).

## Tools

Molecules are SMILES strings or `{smiles, name?, props?}`. `props` are numeric columns such as `pIC50`. Objectives are `[{key, direction: "min"|"max"}]`, default MW, LogP and TPSA min.

Every call that takes molecules is capped at 2,000 molecules, the same cap the web app warns on, and at 10,000 characters per SMILES. Pass `maxMolecules` or `maxSmilesLength` to raise the cap for that call. Absolute ceilings are 20,000 molecules and 100,000 characters. Failures return `isError: true` and `structuredContent` of `{ code, message }`.

| Code | When |
|---|---|
| `too_many_molecules` | The list is over the cap. |
| `smiles_too_long` | One SMILES is over the length cap. |
| `limit_too_high` | The requested cap is not a positive integer, or it is over the absolute ceiling. |
| `invalid_input` | The arguments are the wrong shape. |
| `unknown_profile` | The profile ref is not built in. |
| `review_url_too_long` | The review link would be over ~32,000 characters. No URL is returned. |
| `not_found` | A name passed to `compare` is not in the set. |

| Tool | Does |
|---|---|
| `score_molecules` | RDKit descriptors (MW, LogP, TPSA, HBD, HBA, RotBonds, FrCSP3, rings, QED, SC estimate). Invalid SMILES listed by index. |
| `pareto_front` | Fronts and a count per rank. Molecules missing an objective stay unranked (`null`), never imputed. `edges: true` adds `dominatedBy` and `dominates`. The edge list is off by default. |
| `apply_profile` | Versioned profile (`oral@1`, `cns@1`, `leadlike@1`, `lipinski@1`): MPO score, per-property desirability, filter violations, profile objectives. Returns ref and sha256 hash. |
| `list_profiles` | Every built-in profile: ref, label, description, objectives, hash. |
| `explain_tradeoff` | Front size, the most anti-correlated objective pair, and an optional head-to-head of two named molecules. |
| `open_review_url` | A `https://paretomol.com/#r=` link (see review-url.md). Over the size limit the tool errors with `review_url_too_long` and tells the agent to write a decision record file. |
| `verify_claims` | Claimed descriptor values and objective directions (see verify.md). |
| `verify_decision` | A `paretomol.decision/0` record: hashes, then a recomputed front and MPO (see decision-record.md). Same function as `paretomol verify-decision`. |
| `review_shortlist` | Experimental MCP App. See below. |

Successful results are JSON text plus `structuredContent`.

## Experimental review UI

`review_shortlist` is an MCP App. The tool's `_meta.ui.resourceUri` is `ui://paretomol/review.html`, and `resources/read` returns that document as `text/html;profile=mcp-app`. A host that implements the MCP Apps extension (`io.modelcontextprotocol/ui`) renders the page.

The page lists each molecule with its structure, Pareto rank, MPO and objective values. Accept and Reject are per molecule. Nothing starts accepted. Export asks the server for `export_review_decision` (hidden from the model, `visibility: ["app"]`) and shows the `paretomol.decision/0` file. That file matches the web app's review export: `selected` is the accepted ids, and `review` holds `source`, `decisions` and `suggested`. `view` is the fresh review session (Pareto tab, the custom columns, no filters).

The tool result always includes a text fallback. When the review link fits, `fallbackUrl` is the `#r=` link. When it does not, `fallbackError.code` is `review_url_too_long` and there is no URL. Hosts that cannot render `ui://` resources should give the person the link, or the decision record, and ignore the HTML.

This UI is experimental. The extension is new enough that many hosts still show only the text result.
