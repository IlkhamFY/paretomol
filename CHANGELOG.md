# Changelog

All notable changes to ParetoMol. Dates are release dates; unreleased work is listed first.

## Unreleased

### Added
- Decision records are `paretomol.decision/1`. The file embeds the desirability windows and curve, unique molecule ids, and Pareto ranks and MPO computed inside core. `verifyDecision` recomputes and returns a diff. `paretomol.decision/0` still opens. `models.rdkitjs` on a v1 record is the RDKit.js version plus the sha256 of the pinned WASM.
- The page loads the pinned `@rdkit/rdkit` WASM from this origin. 3Dmol loads only when a 3D view opens. A Content-Security-Policy allows this origin, the ADMET Space, the opt-in services listed in llms.txt, and GoatCounter.
- `@paretomol/core`, `@paretomol/cli` and `@paretomol/mcp` share one version, read from `packages/core/package.json` (`CORE_VERSION`). Package entry points are `dist/index.js` (and `dist/rank.js`, `dist/server.js`). A manual Release workflow can publish them to npm with provenance using the `NPM_TOKEN` secret. Nothing is published by this change.
- Scoring profiles ship as JSON data files (`@paretomol/core/profiles/*.json`) and load through `loadProfile`.
- A descriptor tier skips Morgan fingerprints and QED structural alerts unless the caller needs QED or similarity. CI fails the unit timing check and the browser load check on a large slowdown.
- Python package `paretomol` (`python/`, not published to PyPI): Pareto ranking, objective directions, scoring profiles `oral@1`, `cns@1`, `leadlike@1`, `lipinski@1` and `custom@1` with the same `sha256:` hashes as `@paretomol/core`, `paretomol.decision/1` records, `verify_claims`, and a `paretomol.com/#r=` review link from a DataFrame or list. RDKit descriptors are the optional extra `paretomol[rdkit]`.
- MCP server `@paretomol/mcp` now uses the official TypeScript SDK (`@modelcontextprotocol/sdk`). `packages/mcp/server.json` is the official-registry manifest. The package is not published.
- Experimental MCP App `review_shortlist` (`ui://paretomol/review.html`): structures, objectives, Pareto rank, Accept or Reject per molecule, and an export of the same `paretomol.decision/0` review record as the web app. Hosts without the UI get the `#r=` review link. A link over the size limit is an error, not a URL.
- `list_profiles` and `verify_decision` on the MCP server. `verifyDecision` in `@paretomol/core`, and `paretomol verify-decision`, recompute a decision record's front and MPO.
- Molecule calls are capped at 2,000 molecules (the web app's cap) and 10,000 characters of SMILES, with `maxMolecules` / `maxSmilesLength` overrides and stable error codes.
- `loadRDKit` lives at `@paretomol/core/node`. The MCP server no longer depends on the CLI.
- Agent benchmark (`benchmarks/agents`, schema `paretomol.agentbench/1`): 27 tasks on a 12-molecule ChEMBL_37 extract (CC BY-SA 3.0). Twenty answers are regenerated from `@paretomol/core`. Seven are independent: RDKit Python 2026.03.4 descriptors, a hand-checked Pareto front, quoted CSV, duplicate ids, and a tampered decision record that must fail verification. `node benchmarks/agents/mcp-client.mjs` runs every task through the stdio server.
- MCP tool `rank_input` (CSV or SMILES text, quoted fields kept).
- CSV parsing keeps quoted fields, including commas inside a name. The app and the CLI use the same parser.
- Review link tokens are deflate-compressed with a `v1.` prefix. Unprefixed lz-string tokens still open. A link that is still over about 32 000 characters says to use a decision record file instead.
- `@paretomol/core`: headless TypeScript core (Pareto ranking, objective inference, MPO, QED, filters, similarity, SHA-256) shared by the app, CLI and MCP server.
- Versioned scoring profiles `oral@1`, `cns@1`, `leadlike@1`, `lipinski@1`, `custom@1`, each with a pinned `sha256:` hash.
- Decision record (`paretomol.decision/0`): Export > Decision record (JSON) and Open record. See docs/decision-record.md.
- CLI `@paretomol/cli` (`paretomol rank`, `paretomol verify`, `paretomol verify-decision`), producing the same decision record as the app for the same input.
- Claim verifier (`verifyClaims`): recomputes claimed descriptors and checks objective directions. See docs/verify.md.
- Open review URL (`#r=`, schema `paretomol.review/0`): an agent's shortlist opens in review mode with Accept/Reject per molecule and exports as a decision record with a `review` block. Analytics strip `r` as they already did `m`. See docs/review-url.md.
- `/llms.txt` for AI agents, linked from the page head and the sitemap; Docs section "Agents and automation" with Claude and Cursor prompts.
- Citation panel, BibTeX/RIS export and citation footers on exports.
- Anonymous, cookie-free usage counts (GoatCounter); molecule data is never sent.
- ADMET Space warm-up request on page load to cut cold-start time.

### Changed
- Constraints are separate from objectives. A gate removes a compound before the front is ranked, including when the value is missing. The plot says how many were pruned and why. ADMET cutoffs are editable and labelled as predictions. The list is stored on `paretomol.decision/1` when it is not empty.
- The empty screen has one act, Try kinase inhibitors. Paste stays in the sidebar. The plot names the front and the knee, starts on one chart, and leaves the Lipinski overlay off. Objective changes update the front immediately. Review is a list (suggested first, with structures) beside the plot on a desktop and the whole screen on a phone. The view bar is Pareto, Table, ADMET, Compare, and More. ADMET waits on a skeleton, and a bad review link stays on screen until it is dismissed.
- The default Pareto front ranks desirability windows from the Oral profile (MW, LogP, HBD, HBA, TPSA, rotatable bonds). It no longer minimizes LogP and TPSA. MPO and Scoring use the same windows. Plain minimize or maximize is what you get when you pick that direction. A p-scaled potency column is added when the file has one. **Paper reproduction** minimizes MW, LogP, HBD, HBA, TPSA and rotatable bonds, the directions in the Digital Discovery FDA figures (50 compounds on the front, mean LogP -2.57).
- `pareto_front` returns fronts and counts. The dominance edge list is included only when `edges` is true.
- `open_review_url` refuses a link over ~32,000 characters and tells the agent to write a decision record file.

### Fixed
- Review links (`#r=`) stay in the address bar after load and when you change tabs, so reload and copy-link keep working. Analytics still strip `r` and `m`.
- Share links carry molecules in the fragment (`#m=`). Older `?m=` and `?r=` links still open, then the address bar is rewritten to the fragment so the payload is not left in the query.
- CSV and TSV import follows RFC 4180 quoting. A comma inside a quoted name no longer shifts later columns. The app and the CLI use the same parser.
- Export > Decision record writes the MPO profile and curve you selected (for example `cns@1` and sigmoid), not always `oral@1` with a linear curve.
- A review export records the ADMET endpoint when ADMET columns are present.
- The MCP server negotiates a protocol version it implements. An unknown client version is no longer echoed back.
- **CSV ranking ignored inferred objectives.** After loading a CSV or pasted table with assay columns (for example pIC50 or IC50_nM), the app showed the inferred objectives but ranked the Pareto front on the default MW/LogP/TPSA only. The front is now recomputed with the inferred objectives on both the paste and upload paths. Ranks for such files can differ from earlier versions.
- MPO scores were NaN when a value sat exactly on a zero-width window edge (for example HBD = 0 under oral@1). Such values now score as inside the window.
- Privacy wording in the page metadata and docs no longer says "no data leaves your browser". It now matches the README's "What leaves the browser" list (ADMET predictions, name lookups, features you invoke).

## 0.22.0
- Previous release. See the git history for earlier changes.
