<p align="center">
  <img src=".github/logo-light.svg#gh-light-mode-only" alt="ParetoMol" height="68">
  <img src=".github/logo-dark.svg#gh-dark-mode-only" alt="ParetoMol" height="68">
</p>

<p align="center"><strong>Multi-objective Pareto analysis of drug-like molecules. Entirely in your browser.</strong></p>

<p align="center"><a href="https://paretomol.com"><img src="https://img.shields.io/badge/Live-paretomol.com-798F81?style=flat-square" alt="Live"></a>&nbsp;&nbsp;<a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-7E9A89?style=flat-square" alt="MIT"></a></p>

---

Paste SMILES, upload SDF/CSV, or fetch from ChEMBL. ParetoMol computes physicochemical properties, identifies the Pareto-optimal subset across your chosen objectives, and provides 14 interactive views — Pareto fronts, BOILED-Egg, radar, MPO, scoring, chemical space, parallel coordinates, activity cliffs, scaffolds, similarity, statistics, and more. Optionally predict 41 ADMET endpoints (Chemprop D-MPNN) and fold them back into the Pareto analysis: **load → analyze → predict → re-Pareto → filter → export**.

All computation runs client-side via [RDKit.js](https://github.com/rdkit/rdkit-js) WebAssembly. No backend, no accounts, no tracking — your molecules never leave the browser.

## Features

- **Pareto analysis** — non-dominated sorting over any property set; add/remove objectives, toggle min/max, instant updates
- **ADMET** — 41 endpoints via a free Hugging Face Space (no API key), one-click personal Space deploy, or self-hosted local server; PAINS / Brenk / NIH structural alerts included
- **Filtering** — SMARTS substructure search and property range sliders with mini histograms, applied across all views
- **Data in** — SMILES, SDF, CSV/TSV, clipboard paste, drag-and-drop, ChEMBL target fetch, assay-data merge by SMILES or name
- **Data out** — CSV, JSON, SDF (all or Pareto subset), per-tab PNG, LZ-compressed share URL, BibTeX
- **AI Copilot** — bring your own key (Gemini, OpenAI, Anthropic); context-aware streaming chat, keys stored in localStorage only

Tested to 2,000 molecules. ~100 KB gzipped initial bundle. Full mobile support. Press `?` in the app for keyboard shortcuts.

## Development

```bash
git clone https://github.com/IlkhamFY/paretomol.git
cd paretomol && npm install && npm run dev
```

TypeScript strict mode. `npm run build` must pass before committing.

## Citation

A manuscript describing the methodology and case studies is in preparation. In the meantime:

```
Yabbarov, I.; Vargas-Hernández, R. A. ParetoMol: A Free Web Application for
Multi-Objective Pareto Analysis of Molecular Safety and Pharmacokinetics.
https://paretomol.com (2026).
```
