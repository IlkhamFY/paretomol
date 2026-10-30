# ParetoMol agent benchmark (paretomol.agentbench/0)

20 multi-objective chemistry tasks for LLM agents: Pareto fronts and ranks, missing-value handling, scoring profiles (MPO, Rule-of-5 filter), RDKit descriptors, dominance between two molecules, the sharpest trade-off, and catching wrong claims from another agent.

- `tasks.ts`: task definitions (molecules, objectives, prompts).
- `tasks.json`: tasks with ground truth, computed by `@paretomol/core` through the MCP tool functions. Never edited by hand. Regenerate with `UPDATE_BENCH=1 npx vitest run benchmarks`; the test fails if core and the file disagree.
- `score.mjs`: dependency-free scorer. `node benchmarks/agents/score.mjs answers.json` where answers are `{ "t01": ["aspirin", ...], "t07": "aspirin", "t11": 280.4 }`.

Scoring: sets by Jaccard similarity, names and strings exact (case-insensitive), numbers within the task tolerance. Max 20.

Run an agent twice: once without tools, once with the ParetoMol MCP server (`docs/mcp.md`). The gap is the point of the benchmark.
