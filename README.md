<p align="center">
  <img src="docs/logo-light.svg#gh-light-mode-only" alt="ParetoMol" height="68">
  <img src="docs/logo-dark.svg#gh-dark-mode-only" alt="ParetoMol" height="68">
</p>

<p align="center"><strong>Multi-objective Pareto analysis of drug-like molecules. Entirely in your browser.</strong></p>

<p align="center"><a href="https://paretomol.com"><img src="https://img.shields.io/badge/Live-paretomol.com-798F81?style=flat-square" alt="Live"></a>&nbsp;&nbsp;<a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-7E9A89?style=flat-square" alt="MIT"></a></p>

---

Paste SMILES, upload SDF/CSV, fetch from ChEMBL, or drag-and-drop a file. All computation runs client-side via [RDKit.js](https://github.com/rdkit/rdkit-js) WebAssembly. No backend, no data upload, no install.

Your molecules are never exposed.

---

## What it does

Load a set of molecules. ParetoMol computes physicochemical properties, identifies the Pareto-optimal subset across your chosen objectives, and provides 14 interactive analysis views. Optionally run ADMET-AI predictions (41 endpoints via Chemprop D-MPNN) and fold safety properties into the Pareto analysis.

The workflow no other tool provides: **load > analyze > predict > re-Pareto > filter > export**.

---

## Views

| View | What you see |
|------|-------------|
| Pareto | Scatter plots with Pareto fronts, configurable axes, scroll-to-zoom |
| BOILED-Egg | WLogP vs TPSA permeation model (GI absorption + BBB penetration) |
| Radar | Normalized property profiles overlaid across molecules |
| Scoring | Weighted Chebyshev ranking (Balanced, CNS, Oral, Custom) |
| MPO | Multi-parameter optimization with desirability curves |
| Chem Space | UMAP / PCA / t-SNE of Morgan fingerprints |
| Parallel | Parallel coordinates with per-axis brushing and Lipinski limits |
| Similarity | Tanimoto heatmap (matrix up to 50 molecules, top-pairs list beyond) |
| Activity Cliffs | Structurally similar but property-divergent pairs |
| Compare | Head-to-head structures with property diff overlay |
| Table & Dominance | Sortable table + pairwise dominance matrix + summary |
| Scaffolds | Murcko decomposition with member browsing |
| Statistics | Property distributions, box plots, and correlation heatmaps |
| ADMET | 41 endpoints via Chemprop D-MPNN (free, no API key) |

---

## Key Features

**Pareto Analysis**: Non-dominated sorting across any combination of properties. Add/remove objectives, toggle min/max, see the Pareto front update instantly.

**Three-Tier ADMET**: Tier 1 (instant, private) computes physicochemical descriptors via RDKit.js. Tier 2 (shared HF Space) predicts 41 ADMET endpoints via Chemprop D-MPNN — free, no API key. One-click personal Space deploy for unlimited predictions. Tier 3 (local) routes to a self-hosted server for full privacy. PAINS, Brenk, and NIH structural alerts included.

**Substructure Filter**: SMARTS pattern search filters molecules across all views in real-time.

**Property Range Sliders**: Interactive dual-thumb sliders with mini histograms for each Pareto objective. DataWarrior-style filtering in the browser.

**Correlation Heatmap**: Pearson correlation matrix reveals redundant objectives and trade-offs. Top correlations and anti-correlations highlighted.

**AI Copilot**: BYOK (Gemini, OpenAI, Anthropic). Context-aware streaming chat with full molecular data. Keys stored in localStorage only.

**Assay Data Merge**: Upload IC50, Ki, selectivity ratios, or any custom measurements as CSV. Automatically joined by SMILES or compound name and incorporated as Pareto objectives.

**ChEMBL Integration**: Fetch compounds by ChEMBL ID or by target ID (e.g., CHEMBL203 for EGFR). Activity data (pChEMBL, IC50) imported as Pareto objectives.

**Export**: SDF (Pareto-optimal subset or all), CSV, JSON, per-tab PNG, Share URL (LZ-compressed), BibTeX citation. Molecule cards include a PubChem link-out.

**Privacy**: 100% client-side except opt-in ADMET predictions (HuggingFace Space). No cookies, no tracking, no accounts.

**Performance**: ~330 KB initial bundle (~100 KB gzipped). React.lazy code-splitting, virtual scrolling, deferred rendering. Tested to 2000 molecules.

**Responsive**: Full mobile layout with slide-over sidebar, adaptive views, touch support.

---

## Keyboard Shortcuts

`?` help | `[` `]` cycle tabs | `1`-`9`, `0` jump to tab | `/` AI Copilot | `s` sidebar | `f` FDA overlay | `d` dark/light mode | `r` reset

---

## Development

```bash
git clone https://github.com/IlkhamFY/molparetolab.git
cd molparetolab && npm install && npm run dev
```

TypeScript strict mode. `npx tsc -b && npx vite build` must pass.

---

## Paper

A manuscript describing the methodology and case studies is in preparation.

---

## Citation

Citation information will be added upon publication. In the meantime, you can reference the tool as:

```
Yabbarov, I.; Vargas-Hernández, R. A. ParetoMol: A Free Web Application for
Multi-Objective Pareto Analysis of Molecular Safety and Pharmacokinetics.
https://paretomol.com (2026).
```
