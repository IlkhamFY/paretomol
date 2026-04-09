# Seed issues — create these manually on GitHub

## Issue 1: Add SDF v3000 (MOL V3000) import support
**Labels:** good first issue, enhancement
**Body:**
Currently we parse SDF V2000 files via RDKit.js. Some tools (Schrödinger, ChemDraw) export V3000 format by default. We should detect V3000 headers and parse them correctly.

**Acceptance criteria:**
- V3000 SDF files load without errors
- Properties embedded in V3000 data blocks are imported
- V2000 files continue to work as before

---

## Issue 2: Add CSV column auto-detection for common SMILES header variants
**Labels:** good first issue, enhancement
**Body:**
We currently look for columns named `SMILES`, `smiles`, or `Smiles`. Many CSV files use variants like `canonical_smiles`, `CANONICAL_SMILES`, `Molecule`, `structure`, `mol`, `compound_smiles`. We should recognize these automatically.

**Acceptance criteria:**
- Common SMILES column variants are auto-detected
- If multiple candidates exist, use the first match
- Add a test case

---

## Issue 3: Show molecule count badge on each scaffold card
**Labels:** good first issue, enhancement
**Body:**
In the Scaffolds tab, each scaffold card shows the member molecules but the count isn't immediately visible in the collapsed view. Add a small badge (e.g. "12 molecules") on the scaffold card header.

**Acceptance criteria:**
- Badge visible on collapsed scaffold card
- Styled consistently with existing UI
