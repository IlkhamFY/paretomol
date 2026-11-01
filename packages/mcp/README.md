# @paretomol/mcp

ParetoMol as a [Model Context Protocol](https://modelcontextprotocol.io) server. It speaks stdio through the official TypeScript SDK (`@modelcontextprotocol/sdk`) and runs offline on RDKit.js 2025.3.4 and `@paretomol/core`, so the numbers match the app and the CLI.

The package is not published to npm. The `server.json` manifest is ready for the official MCP registry when a release exists. This repository does not publish it.

## Install and run

From a clone:

```bash
git clone https://github.com/IlkhamFY/paretomol.git
cd paretomol
npm install
npm run build
npx paretomol-mcp
```

`npx paretomol-mcp` uses the workspace bin. It waits on stdin for JSON-RPC.

## Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows:

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

## Cursor

`.cursor/mcp.json` in the project, or Cursor Settings, MCP:

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

`cwd` must be the repository root so `npx` finds the local bin. Build first (`npm run build`).

## Tools

Molecules are SMILES strings or `{smiles, name?, props?}`. Objectives are `[{key, direction: "min"|"max"}]`, default MW, LogP and TPSA min.

Lists are capped at 2,000 molecules (the same cap as the web app) and each SMILES at 10,000 characters. Pass `maxMolecules` or `maxSmilesLength` to raise a cap. The absolute ceilings are 20,000 molecules and 100,000 characters. Over-cap calls return `{ code, message }` with `isError: true`. Codes: `too_many_molecules`, `smiles_too_long`, `limit_too_high`, `invalid_input`, `unknown_profile`, `review_url_too_long`, `not_found`.

| Tool | Does |
|---|---|
| `score_molecules` | RDKit descriptors. Invalid SMILES listed by index. |
| `pareto_front` | Fronts and counts per rank. Dominance edges only when `edges` is true. |
| `apply_profile` | MPO, filter violations and profile objectives for `oral@1`, `cns@1`, `leadlike@1`, `lipinski@1`. |
| `list_profiles` | Profile refs, labels, objectives and sha256 hashes. |
| `explain_tradeoff` | Front size, sharpest anti-correlated pair, optional head-to-head. |
| `open_review_url` | A `https://paretomol.com/#r=` link. Over ~32,000 characters the tool returns `review_url_too_long` and no URL. Write a decision record file instead. |
| `verify_claims` | Claimed descriptors and objective directions. |
| `verify_decision` | Hashes plus a recomputed Pareto and MPO diff for a `paretomol.decision/0` record. |
| `review_shortlist` | Experimental MCP App. See below. |

`export_review_decision` is visible to the review UI only (`visibility: ["app"]`).

## Experimental review UI

`review_shortlist` registers an MCP App resource at `ui://paretomol/review.html` (`text/html;profile=mcp-app`). A host that supports the MCP Apps extension renders it: each molecule shows its structure, objective values and Pareto rank, with Accept and Reject, and an export.

Export calls `export_review_decision`, which writes the same `paretomol.decision/0` record as the web app's review mode, including the `review` block. `selected` is the accepted ids.

Hosts without MCP Apps still get a normal tool result. It includes the review link when that link fits. When the link would be too long, the result says so and does not include a broken URL. The interactive panel is the part that needs a host with MCP Apps. Treat the panel as experimental.

Full notes: [docs/mcp.md](../../docs/mcp.md).
