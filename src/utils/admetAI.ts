import { getActiveEndpoint } from './admetTiers';

/**
 * ADMET-AI integration: Chemprop D-MPNN models (#1 on TDC benchmark)
 *
 * Calls a self-hosted FastAPI microservice wrapping the admet_ai Python package.
 * 41 ADMET properties from TDC + 8 physicochemical descriptors + DrugBank percentiles.
 *
 * Endpoint: https://ilkhamfy-admet-ai-api.hf.space/predict  (HuggingFace Space)
 * Fallback: http://localhost:8000/predict  (local dev)
 *
 * Reference: Swanson et al. Bioinformatics 2024. https://doi.org/10.1093/bioinformatics/btae416
 */

/** Base URL for the ADMET-AI API. Resolved via tier state (local > personal > shared). */
export function getAdmetAIEndpoint(): string {
  try {
    // Honour legacy manual override if set
    return localStorage.getItem('admetai_endpoint') || getActiveEndpoint();
  } catch {
    return getActiveEndpoint();
  }
}

export function setAdmetAIEndpoint(url: string) {
  try {
    localStorage.setItem('admetai_endpoint', url.replace(/\/$/, ''));
  } catch { /* storage unavailable */ }
}

export function clearEndpointOverride(): void {
  try {
    localStorage.removeItem('admetai_endpoint');
  } catch { /* storage unavailable */ }
}

/** 
 * Mapping from ADMET-AI column names to human-readable labels.
 * Covers the 41 primary TDC endpoints + key physicochemical descriptors.
 */
export const ADMET_AI_PROPERTY_META: Record<string, {
  label: string;
  category: 'absorption' | 'distribution' | 'metabolism' | 'excretion' | 'toxicity' | 'physicochemical';
  type: 'classification' | 'regression';
  unit: string;
  description: string;
  safeDir: 'low' | 'high' | null; // which direction is "safer" for drug candidates
}> = {
  // Absorption
  Caco2_Wang:          { label: 'Caco-2', category: 'absorption', type: 'regression', unit: 'log cm/s', description: 'Intestinal permeability (Caco-2 cell assay)', safeDir: 'high' },
  HIA_Hou:             { label: 'HIA', category: 'absorption', type: 'classification', unit: '', description: 'Human intestinal absorption (>0.5 = absorbed)', safeDir: 'high' },
  Pgp_Broccatelli:     { label: 'Pgp Inhibitor', category: 'absorption', type: 'classification', unit: '', description: 'P-glycoprotein inhibitor (efflux transporter)', safeDir: 'low' },
  Bioavailability_Ma:  { label: 'Bioavailability', category: 'absorption', type: 'classification', unit: '', description: 'Oral bioavailability >20%', safeDir: 'high' },
  Solubility_AqSolDB:  { label: 'Solubility', category: 'absorption', type: 'regression', unit: 'log mol/L', description: 'Aqueous solubility (AqSolDB)', safeDir: 'high' },
  Lipophilicity_AstraZeneca: { label: 'Lipophilicity', category: 'absorption', type: 'regression', unit: 'log D', description: 'Lipophilicity (AstraZeneca assay)', safeDir: null },
  PAMPA_NCATS:         { label: 'PAMPA', category: 'absorption', type: 'classification', unit: '', description: 'Parallel artificial membrane permeability (PAMPA)', safeDir: 'high' },
  HydrationFreeEnergy_FreeSolv: { label: 'Hydration ΔG', category: 'absorption', type: 'regression', unit: 'kcal/mol', description: 'Hydration free energy (FreeSolv)', safeDir: null },
  // Distribution
  BBB_Martins:         { label: 'BBB', category: 'distribution', type: 'classification', unit: '', description: 'Blood-brain barrier penetration', safeDir: null },
  PPBR_AZ:             { label: 'PPBR', category: 'distribution', type: 'regression', unit: '%', description: 'Plasma protein binding rate (AstraZeneca)', safeDir: 'low' },
  VDss_Lombardo:       { label: 'VDss', category: 'distribution', type: 'regression', unit: 'log L/kg', description: 'Volume of distribution at steady-state', safeDir: null },
  // Metabolism
  CYP1A2_Veith:        { label: 'CYP1A2 Inh', category: 'metabolism', type: 'classification', unit: '', description: 'CYP1A2 inhibitor', safeDir: 'low' },
  CYP2C19_Veith:       { label: 'CYP2C19 Inh', category: 'metabolism', type: 'classification', unit: '', description: 'CYP2C19 inhibitor', safeDir: 'low' },
  CYP2C9_Veith:        { label: 'CYP2C9 Inh', category: 'metabolism', type: 'classification', unit: '', description: 'CYP2C9 inhibitor', safeDir: 'low' },
  CYP2D6_Veith:        { label: 'CYP2D6 Inh', category: 'metabolism', type: 'classification', unit: '', description: 'CYP2D6 inhibitor', safeDir: 'low' },
  CYP3A4_Veith:        { label: 'CYP3A4 Inh', category: 'metabolism', type: 'classification', unit: '', description: 'CYP3A4 inhibitor', safeDir: 'low' },
  CYP2C9_Substrate_CarbonMangels: { label: 'CYP2C9 Sub', category: 'metabolism', type: 'classification', unit: '', description: 'CYP2C9 substrate', safeDir: null },
  CYP2D6_Substrate_CarbonMangels: { label: 'CYP2D6 Sub', category: 'metabolism', type: 'classification', unit: '', description: 'CYP2D6 substrate', safeDir: null },
  CYP3A4_Substrate_CarbonMangels: { label: 'CYP3A4 Sub', category: 'metabolism', type: 'classification', unit: '', description: 'CYP3A4 substrate', safeDir: null },
  // Excretion
  Half_Life_Obach:     { label: 'Half-life', category: 'excretion', type: 'regression', unit: 'hr', description: 'Elimination half-life (Obach)', safeDir: null },
  Clearance_Hepatocyte_AZ: { label: 'CL Hepatocyte', category: 'excretion', type: 'regression', unit: 'µL/min/10⁶', description: 'Hepatocyte clearance (AstraZeneca)', safeDir: 'low' },
  Clearance_Microsome_AZ: { label: 'CL Microsome', category: 'excretion', type: 'regression', unit: 'mL/min/g', description: 'Microsome clearance (AstraZeneca)', safeDir: 'low' },
  // Toxicity
  hERG:                { label: 'hERG', category: 'toxicity', type: 'classification', unit: '', description: 'hERG potassium channel blocker (cardiotoxicity)', safeDir: 'low' },
  AMES:                { label: 'Ames', category: 'toxicity', type: 'classification', unit: '', description: 'Ames mutagenicity', safeDir: 'low' },
  DILI:                { label: 'DILI', category: 'toxicity', type: 'classification', unit: '', description: 'Drug-induced liver injury', safeDir: 'low' },
  LD50_Zhu:            { label: 'LD50', category: 'toxicity', type: 'regression', unit: 'log(1/mol/kg)', description: 'Acute toxicity LD50 (Zhu)', safeDir: 'low' },
  ClinTox:             { label: 'ClinTox', category: 'toxicity', type: 'classification', unit: '', description: 'Clinical trial toxicity failure', safeDir: 'low' },
  Carcinogens_Lagunin:  { label: 'Carcinogen', category: 'toxicity', type: 'classification', unit: '', description: 'Carcinogenicity', safeDir: 'low' },
  Skin_Reaction:       { label: 'Skin Reaction', category: 'toxicity', type: 'classification', unit: '', description: 'Skin sensitization', safeDir: 'low' },
  // Tox21 nuclear receptor panel
  'NR-AR':             { label: 'NR-AR', category: 'toxicity', type: 'classification', unit: '', description: 'Androgen receptor agonist (Tox21)', safeDir: 'low' },
  'NR-AR-LBD':         { label: 'NR-AR-LBD', category: 'toxicity', type: 'classification', unit: '', description: 'AR ligand-binding domain (Tox21)', safeDir: 'low' },
  'NR-AhR':            { label: 'NR-AhR', category: 'toxicity', type: 'classification', unit: '', description: 'Aryl hydrocarbon receptor (Tox21)', safeDir: 'low' },
  'NR-Aromatase':      { label: 'NR-Aromatase', category: 'toxicity', type: 'classification', unit: '', description: 'Aromatase inhibition (Tox21)', safeDir: 'low' },
  'NR-ER':             { label: 'NR-ER', category: 'toxicity', type: 'classification', unit: '', description: 'Estrogen receptor agonist (Tox21)', safeDir: 'low' },
  'NR-ER-LBD':         { label: 'NR-ER-LBD', category: 'toxicity', type: 'classification', unit: '', description: 'ER ligand-binding domain (Tox21)', safeDir: 'low' },
  'NR-PPAR-gamma':     { label: 'NR-PPARg', category: 'toxicity', type: 'classification', unit: '', description: 'PPAR-gamma agonist (Tox21)', safeDir: 'low' },
  'SR-ARE':            { label: 'SR-ARE', category: 'toxicity', type: 'classification', unit: '', description: 'Antioxidant response element (Tox21)', safeDir: 'low' },
  'SR-ATAD5':          { label: 'SR-ATAD5', category: 'toxicity', type: 'classification', unit: '', description: 'Genotoxicity (Tox21)', safeDir: 'low' },
  'SR-HSE':            { label: 'SR-HSE', category: 'toxicity', type: 'classification', unit: '', description: 'Heat shock response (Tox21)', safeDir: 'low' },
  'SR-MMP':            { label: 'SR-MMP', category: 'toxicity', type: 'classification', unit: '', description: 'Mitochondrial membrane potential (Tox21)', safeDir: 'low' },
  'SR-p53':            { label: 'SR-p53', category: 'toxicity', type: 'classification', unit: '', description: 'p53 pathway activation (Tox21)', safeDir: 'low' },
  // Physicochemical (from ADMET-AI API; QED is excluded here — computed client-side instead)
  molecular_weight:    { label: 'MW', category: 'physicochemical', type: 'regression', unit: 'Da', description: 'Molecular weight', safeDir: null },
  logP:                { label: 'logP', category: 'physicochemical', type: 'regression', unit: '', description: 'Calculated logP', safeDir: null },
  hydrogen_bond_acceptors: { label: 'HBA', category: 'physicochemical', type: 'regression', unit: '', description: 'H-bond acceptors', safeDir: null },
  hydrogen_bond_donors: { label: 'HBD', category: 'physicochemical', type: 'regression', unit: '', description: 'H-bond donors', safeDir: null },
  tpsa:                { label: 'TPSA', category: 'physicochemical', type: 'regression', unit: 'Å²', description: 'Topological polar surface area', safeDir: null },
};

/** The 41 TDC endpoints returned by ADMET-AI (excludes physicochemical and percentile columns).
 *  Note: ADMET-AI also returns 'QED' but we compute it client-side (see qed.ts), so it is
 *  excluded here to avoid shadowing the built-in props.QED value. */
export const PRIMARY_ADMET_KEYS = [
  'Caco2_Wang', 'HIA_Hou', 'Pgp_Broccatelli', 'Bioavailability_Ma',
  'Solubility_AqSolDB', 'Lipophilicity_AstraZeneca', 'PAMPA_NCATS',
  'BBB_Martins', 'PPBR_AZ', 'VDss_Lombardo',
  'CYP1A2_Veith', 'CYP2C19_Veith', 'CYP2C9_Veith', 'CYP2D6_Veith', 'CYP3A4_Veith',
  'CYP2C9_Substrate_CarbonMangels', 'CYP2D6_Substrate_CarbonMangels', 'CYP3A4_Substrate_CarbonMangels',
  'Half_Life_Obach', 'Clearance_Hepatocyte_AZ', 'Clearance_Microsome_AZ',
  'hERG', 'AMES', 'DILI', 'LD50_Zhu', 'ClinTox', 'Carcinogens_Lagunin', 'Skin_Reaction',
  'NR-AR', 'NR-AR-LBD', 'NR-AhR', 'NR-Aromatase', 'NR-ER', 'NR-ER-LBD', 'NR-PPAR-gamma',
  'SR-ARE', 'SR-ATAD5', 'SR-HSE', 'SR-MMP', 'SR-p53',
  'HydrationFreeEnergy_FreeSolv',
] as const;

export interface AdmetAIResult {
  name: string;
  smiles: string;
  [key: string]: number | string;
}

export interface AdmetAIResponse {
  results: AdmetAIResult[];
  properties: string[];
  version: string;
}

/** Check if the ADMET-AI API is reachable. */
export async function checkAdmetAIHealth(): Promise<boolean> {
  try {
    const url = `${getAdmetAIEndpoint()}/health`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return false;
    const data = await res.json() as { status: string };
    return data.status === 'ok';
  } catch {
    return false;
  }
}

/**
 * Predict ADMET properties for a list of molecules using ADMET-AI (Chemprop).
 * Processes in batches of 50 molecules per API call.
 */
export async function predictWithAdmetAI(
  molecules: { name: string; smiles: string }[],
  onProgress?: (done: number, total: number) => void,
): Promise<AdmetAIResult[]> {
  const BATCH_SIZE = 50;
  const all: AdmetAIResult[] = [];
  const endpoint = `${getAdmetAIEndpoint()}/predict`;

  for (let i = 0; i < molecules.length; i += BATCH_SIZE) {
    const batch = molecules.slice(i, i + BATCH_SIZE);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        smiles: batch.map(m => m.smiles),
        names: batch.map(m => m.name),
      }),
      signal: AbortSignal.timeout(120000), // 2 min timeout for cold start
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`ADMET-AI API error ${res.status}: ${err.slice(0, 200)}`);
    }

    const data = await res.json() as AdmetAIResponse;
    all.push(...data.results);
    onProgress?.(Math.min(i + BATCH_SIZE, molecules.length), molecules.length);

    // Brief pause between batches
    if (i + BATCH_SIZE < molecules.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  return all;
}

/** Format an ADMET-AI value for display (color-coded). */
export function formatAdmetAIValue(
  key: string,
  value: number,
): { text: string; color: string; riskLevel: 'ok' | 'warn' | 'bad' | 'neutral' } {
  const meta = ADMET_AI_PROPERTY_META[key];
  if (!meta) return { text: value.toFixed(3), color: 'var(--text2)', riskLevel: 'neutral' };

  if (meta.type === 'classification') {
    const pct = (value * 100).toFixed(0);
    if (meta.safeDir === 'low') {
      // High probability = bad (toxicity, inhibition)
      if (value >= 0.7) return { text: `${pct}%`, color: '#ef4444', riskLevel: 'bad' };
      if (value >= 0.4) return { text: `${pct}%`, color: '#f59e0b', riskLevel: 'warn' };
      return { text: `${pct}%`, color: '#22c55e', riskLevel: 'ok' };
    } else if (meta.safeDir === 'high') {
      // High probability = good (absorption, bioavailability)
      if (value >= 0.7) return { text: `${pct}%`, color: '#22c55e', riskLevel: 'ok' };
      if (value >= 0.4) return { text: `${pct}%`, color: '#f59e0b', riskLevel: 'warn' };
      return { text: `${pct}%`, color: '#ef4444', riskLevel: 'bad' };
    }
    return { text: `${pct}%`, color: 'var(--text2)', riskLevel: 'neutral' };
  }

  // Regression
  return { text: value.toFixed(2), color: 'var(--text2)', riskLevel: 'neutral' };
}

/**
 * Check whether a molecule's physicochemical descriptors fall within the
 * applicability domain of the ADMET-AI training set.
 *
 * Uses RDKit-derived properties stored in mol.props.  Properties outside
 * typical drug-like ranges are flagged so users know predictions may be
 * less reliable.
 */
export interface ApplicabilityDomainResult {
  inDomain: boolean;
  warnings: string[];
}

const ADMET_AD_RANGES: Array<{
  key: string;
  label: string;
  min: number;
  max: number;
}> = [
  { key: 'MW',       label: 'MW',       min: 100,  max: 900  },
  { key: 'LogP',     label: 'LogP',     min: -3,   max: 8    },
  { key: 'HBD',      label: 'HBD',      min: 0,    max: 8    },
  { key: 'HBA',      label: 'HBA',      min: 0,    max: 16   },
  { key: 'TPSA',     label: 'TPSA',     min: 0,    max: 250  },
  { key: 'RotBonds', label: 'RotBonds', min: 0,    max: 15   },
];

export function checkApplicabilityDomain(
  mol: import('./types').Molecule,
): ApplicabilityDomainResult {
  const warnings: string[] = [];
  for (const { key, label, min, max } of ADMET_AD_RANGES) {
    const v = mol.props[key as keyof import('./types').MolProps] as number | undefined;
    if (v === undefined) continue;
    if (v < min || v > max) {
      warnings.push(`${label}=${v.toFixed(1)} outside typical range (${min}–${max})`);
    }
  }
  return { inDomain: warnings.length === 0, warnings };
}

// ---------------------------------------------------------------------------
// Atom-level interpretation
// ---------------------------------------------------------------------------

export interface AtomAttribution {
  smiles: string;
  endpoint: string;
  atom_scores: number[];  // normalized to [-1, 1]
  atom_symbols: string[];
  prediction: number;
  num_atoms: number;
}

/**
 * Request per-atom attribution scores for a molecule + endpoint.
 * Calls the /interpret endpoint on the ADMET-AI API.
 */
export async function interpretAtoms(
  smiles: string,
  endpoint: string,
): Promise<AtomAttribution> {
  const url = `${getAdmetAIEndpoint()}/interpret`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ smiles, endpoint }),
    signal: AbortSignal.timeout(60000), // 60s — masking is slow per atom
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Interpret API error ${res.status}: ${err.slice(0, 200)}`);
  }

  return await res.json() as AtomAttribution;
}

/**
 * Generate an SVG of a molecule with atom-level heatmap coloring.
 * Uses RDKit.js get_svg_with_highlights with atom colors.
 * 
 * Scores: negative (blue/cool = reduces prediction) to positive (red/hot = increases prediction).
 */
export function getAtomHeatmapSvg(
  smiles: string,
  atomScores: number[],
  width = 280,
  height = 220,
): string {
  if (!window.RDKitModule) return '';
  
  try {
    const mol = window.RDKitModule.get_mol(smiles);
    if (!mol || !mol.is_valid()) return '';
    
    const nAtoms = mol.get_num_atoms();
    if (atomScores.length !== nAtoms) {
      mol.delete();
      return '';
    }
    
    // Build highlight colors: diverging blue → white → red
    const highlightAtoms: number[] = [];
    const highlightAtomColors: Record<number, number[]> = {};
    const highlightAtomRadii: Record<number, number> = {};
    
    for (let i = 0; i < nAtoms; i++) {
      const score = atomScores[i];
      if (Math.abs(score) < 0.05) continue; // skip near-zero atoms
      
      highlightAtoms.push(i);
      highlightAtomRadii[i] = 0.3 + Math.abs(score) * 0.2;
      
      if (score > 0) {
        // Positive: red (contributes to prediction)
        const intensity = Math.min(1, score);
        highlightAtomColors[i] = [1.0, 1.0 - intensity * 0.6, 1.0 - intensity * 0.6, 0.6];
      } else {
        // Negative: blue (reduces prediction)
        const intensity = Math.min(1, -score);
        highlightAtomColors[i] = [1.0 - intensity * 0.6, 1.0 - intensity * 0.6, 1.0, 0.6];
      }
    }
    
    const isDark = document.documentElement.classList.contains('dark');
    const molStroke = getComputedStyle(document.documentElement)
      .getPropertyValue('--mol-stroke').trim() || '#E8E6E3';
    
    const drawOpts = {
      width,
      height,
      bondLineWidth: isDark ? 1.8 : 1.5,
      backgroundColour: [0, 0, 0, 0],
      highlightAtoms,
      highlightAtomColors,
      highlightAtomRadii,
      highlightBonds: [] as number[],
    };
    
    let svg = mol.get_svg_with_highlights(JSON.stringify(drawOpts));
    
    // Theme-aware color replacement (same as getMolSvg)
    svg = svg
      .replace(/#000000/gi, molStroke)
      .replace(/#FFFFFF/gi, 'transparent');
    
    if (isDark) {
      svg = svg.replace(/#0000FF/gi, '#809FFF')
               .replace(/#FF0000/gi, '#FF8A80')
               .replace(/#00CC00/gi, '#69DB7C')
               .replace(/#33CCCC/gi, '#66E0E0')
               .replace(/#B2B200/gi, '#E0D64A')
               .replace(/#FF8000/gi, '#FFB366')
               .replace(/#7F7F7F/gi, '#B0B0B0');
    }
    
    mol.delete();
    return svg;
  } catch {
    return '';
  }
}

/** Get category display color */
export function getAdmetAICategoryColor(
  category: 'absorption' | 'distribution' | 'metabolism' | 'excretion' | 'toxicity' | 'physicochemical',
): string {
  switch (category) {
    case 'absorption':     return '#22c55e';
    case 'distribution':   return '#3b82f6';
    case 'metabolism':     return '#f59e0b';
    case 'excretion':      return '#8b5cf6';
    case 'toxicity':       return '#ef4444';
    case 'physicochemical': return '#9C9893';
    default:               return '#9C9893';
  }
}
