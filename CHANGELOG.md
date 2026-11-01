# Changelog

All notable changes to ParetoMol. Dates are release dates; unreleased work is listed first.

## Unreleased

### Fixed
- **Review links stayed readable past the old size limit, and survived a reload.** `#r=` tokens are now raw DEFLATE plus unpadded base64url, prefixed with `1.` so a 500-molecule shortlist stays under the 32 000 character soft limit. Older lz-string tokens and raw JSON still open. The fragment is kept in the address bar while review mode is active, so a reload or a copied link opens the same review. Analytics still strip `r` before a hit is sent.
- **Decision record export followed the MPO profile.** Export > Decision record wrote `oral@1` no matter which scoring profile was selected. It now writes the profile selected on the MPO tab (still `oral@1` until you pick another). Opening a record restores that profile.
- **CSV ranking ignored inferred objectives.** After loading a CSV or pasted table with assay columns (for example pIC50 or IC50_nM), the app showed the inferred objectives but ranked the Pareto front on the default MW/LogP/TPSA only. The front is now recomputed with the inferred objectives on both the paste and upload paths. Ranks for such files can differ from earlier versions.
- MPO scores were NaN when a value sat exactly on a zero-width window edge (for example HBD = 0 under oral@1). Such values now score as inside the window.
- Privacy wording in the page metadata and docs no longer says "no data leaves your browser". It now matches the README's "What leaves the browser" list (ADMET predictions, name lookups, features you invoke).

### Added
- `tsc -b` also typechecks `benchmarks/` and `packages/mcp/test` (project references).
- `@paretomol/core`: headless TypeScript core (Pareto ranking, objective inference, MPO, QED, filters, similarity, SHA-256) shared by the app, CLI and MCP server.
- Versioned scoring profiles `oral@1`, `cns@1`, `leadlike@1`, `lipinski@1`, `custom@1`, each with a pinned `sha256:` hash.
- Decision record (`paretomol.decision/0`): Export > Decision record (JSON) and Open record. See docs/decision-record.md.
- CLI `@paretomol/cli` (`paretomol rank`, `paretomol verify`), producing the same decision record as the app for the same input.
- Claim verifier (`verifyClaims`): recomputes claimed descriptors and checks objective directions. See docs/verify.md.
- Open review URL (`#r=`, schema `paretomol.review/0`): an agent's shortlist opens in review mode with Accept/Reject per molecule and exports as a decision record with a `review` block. Analytics strip `r` as they already did `m`. See docs/review-url.md.
- `/llms.txt` for AI agents, linked from the page head and the sitemap; Docs section "Agents and automation" with Claude and Cursor prompts.
- Citation panel, BibTeX/RIS export and citation footers on exports.
- Anonymous, cookie-free usage counts (GoatCounter); molecule data is never sent.
- ADMET Space warm-up request on page load to cut cold-start time.

## 0.22.0
- Previous release. See the git history for earlier changes.
