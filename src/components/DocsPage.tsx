import { useState, useEffect, useRef } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { Sun, Moon, X } from 'lucide-react';

interface Section {
  id: string;
  title: string;
  questions: { id: string; q: string; a: React.ReactNode }[];
}

const sections: Section[] = [
  {
    id: 'overview',
    title: 'Overview',
    questions: [
      {
        id: 'what-is',
        q: 'What is ParetoMol?',
        a: (
          <>
            <p>ParetoMol is a free, open-source web tool for multi-objective analysis of drug-like molecules. You paste SMILES (or upload a file), and the tool instantly computes molecular properties, identifies Pareto-optimal candidates, predicts ADMET profiles, and lets you explore the chemical space — all in your browser, with no server, no account, and no data leaving your machine.</p>
            <p className="mt-2">It is designed for medicinal chemists, computational chemists, and drug discovery scientists who need to quickly triage compound sets against multiple competing objectives (potency, safety, permeability, metabolic stability, etc.).</p>
          </>
        ),
      },
      {
        id: 'who-for',
        q: 'Who is it for?',
        a: (
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Medicinal chemists</strong> — evaluate and rank compound series during lead optimization</li>
            <li><strong>Computational chemists</strong> — explore Pareto fronts across many descriptors and predicted endpoints</li>
            <li><strong>Drug discovery teams</strong> — make multi-objective go/no-go decisions with visual evidence</li>
            <li><strong>Researchers</strong> — analyze published compound sets or benchmarks quickly without writing code</li>
          </ul>
        ),
      },
      {
        id: 'privacy',
        q: 'Is my data private?',
        a: <p>Yes. ParetoMol runs entirely in your browser using WebAssembly (RDKit.js). Your SMILES, structures, and properties never leave your machine. No backend, no database, no tracking beyond standard analytics. The only external calls are optional PubChem name lookups and ADMET-AI predictions (which you control).</p>,
      },
      {
        id: 'open-source',
        q: 'Is it open source?',
        a: <p>Yes. The full source code is available on <a href="https://github.com/IlkhamFY/molparetolab" target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">GitHub</a> under the MIT license. Contributions, bug reports, and feature requests are welcome.</p>,
      },
      {
        id: 'free',
        q: 'Is it free to use?',
        a: <p>Yes, completely free. The app runs client-side on GitHub Pages. ADMET predictions use a free Chemprop D-MPNN endpoint — no API key required. The only optional paid component is the AI Copilot (via your own API key using Gemini, OpenAI, or Anthropic) — you control your own costs.</p>,
      },
    ],
  },
  {
    id: 'loading',
    title: 'Loading molecules',
    questions: [
      {
        id: 'input-formats',
        q: 'What input formats are supported?',
        a: (
          <>
            <p>ParetoMol accepts molecules in several ways:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li><strong>SMILES (paste)</strong> — one molecule per line. Format: <code className="bg-[var(--surface2)] px-1 rounded text-[12px]">SMILES name</code> or just <code className="bg-[var(--surface2)] px-1 rounded text-[12px]">SMILES</code></li>
              <li><strong>CSV / TSV</strong> — must have a SMILES column (header: <code className="bg-[var(--surface2)] px-1 rounded text-[12px]">SMILES</code>, <code className="bg-[var(--surface2)] px-1 rounded text-[12px]">smiles</code>, or <code className="bg-[var(--surface2)] px-1 rounded text-[12px]">Smiles</code>). Any numeric columns are imported as custom properties. Use the <strong>Paste</strong> button to paste tab-separated data directly from the clipboard (auto-detects CSV/TSV and triggers analysis immediately).</li>
              <li><strong>SDF / SD files</strong> — standard structure-data files. Properties embedded in the SDF are imported automatically.</li>
              <li><strong>ChEMBL IDs</strong> — paste one or more <code className="bg-[var(--surface2)] px-1 rounded text-[12px]">CHEMBL123</code> identifiers; the tool fetches SMILES from ChEMBL.</li>
              <li><strong>ChEMBL target</strong> — enter a target ID (e.g. CHEMBL203 for EGFR) to fetch all active compounds (pChEMBL ≥ 5).</li>
              <li><strong>IUPAC / common names</strong> — names are resolved to SMILES via PubChem (requires internet).</li>
            </ul>
          </>
        ),
      },
      {
        id: 'smiles-names',
        q: 'What if I only have SMILES, no names?',
        a: <p>If no name is provided, ParetoMol automatically queries PubChem in the background to resolve common names (e.g. <em>BrCBr → dibromomethane</em>). While names are being fetched, molecules appear as <code className="bg-[var(--surface2)] px-1 rounded text-[12px]">mol_1</code>, <code className="bg-[var(--surface2)] px-1 rounded text-[12px]">mol_2</code>, etc., and update in real time as lookups complete.</p>,
      },
      {
        id: 'custom-props',
        q: 'Can I bring in my own experimental data (IC50, Ki, selectivity)?',
        a: (
          <>
            <p>Yes. Include numeric columns in your CSV alongside SMILES — they are imported as custom properties and automatically added to the Pareto objectives panel. For example:</p>
            <pre className="mt-2 bg-[var(--surface2)] p-2 rounded text-[11px] font-mono overflow-x-auto">{`SMILES,Name,IC50_nM,selectivity
CC(=O)Oc1ccccc1C(=O)O,aspirin,45.2,12.1`}</pre>
            <p className="mt-2">You can also merge assay data into an already-loaded set using the <strong>Merge assay data</strong> button in the sidebar — useful when your SMILES and IC50 data are in separate files.</p>
          </>
        ),
      },
      {
        id: 'size-limit',
        q: 'How many molecules can I load?',
        a: <p>ParetoMol handles up to ~2,000 molecules comfortably. Beyond that, scatter plots become dense and parsing slows down — you will be warned before proceeding. For large-scale virtual screening, consider pre-filtering your dataset before loading.</p>,
      },
    ],
  },
  {
    id: 'properties',
    title: 'Molecular properties',
    questions: [
      {
        id: 'what-props',
        q: 'What properties are computed?',
        a: (
          <>
            <p>RDKit computes the following descriptors for every molecule, client-side:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li><strong>MW</strong> — molecular weight (Da)</li>
              <li><strong>LogP</strong> — Wildman-Crippen partition coefficient</li>
              <li><strong>HBD</strong> — hydrogen bond donors</li>
              <li><strong>HBA</strong> — hydrogen bond acceptors</li>
              <li><strong>TPSA</strong> — topological polar surface area (Å²)</li>
              <li><strong>RotBonds</strong> — rotatable bonds</li>
              <li><strong>FrCSP3</strong> — fraction of sp³ carbons</li>
              <li><strong>Rings</strong> — ring count</li>
              <li><strong>QED*</strong> — Quantitative Estimate of Drug-likeness (Bickerton et al., Nature Chemistry 2012) — composite score 0–1, higher is more drug-like. The asterisk indicates an approximation: structural alert penalties (PAINS/Brenk count) are set to 0 for performance; values for alert-flagged compounds may be slightly inflated.</li>
            </ul>
            <p className="mt-2">Drug-likeness filters are automatically evaluated: Lipinski Ro5, Veber, Ghose, and Lead-like rules. QED is also available as a Pareto objective (maximize it to select the most drug-like compounds).</p>
          </>
        ),
      },
      {
        id: 'pareto',
        q: 'What does "Pareto-optimal" mean?',
        a: (
          <>
            <p>A molecule is Pareto-optimal (Pareto rank 1) if no other molecule in the set is strictly better on <em>all</em> selected objectives simultaneously. Pareto-optimal molecules represent the best available trade-offs — you cannot improve one objective without sacrificing another.</p>
            <p className="mt-2">Example: if you optimize for low MW and low TPSA, a molecule on the Pareto front might have the lowest MW but slightly higher TPSA than another Pareto molecule — neither dominates the other.</p>
          </>
        ),
      },
      {
        id: 'objectives',
        q: 'How do I select Pareto objectives?',
        a: <p>Open the <strong>Properties</strong> panel in the sidebar. Check any property to include it as a Pareto objective. Toggle the direction button (<strong>min</strong> / <strong>max</strong>) next to each property. Click <strong>Recompute Pareto</strong> to update the analysis. Green-bordered molecules in the list are on the Pareto front.</p>,
      },
      {
        id: 'fda-ref',
        q: 'What is the FDA reference comparison?',
        a: <p>When you expand a molecule card, ParetoMol shows percentile ranks for MW, LogP, HBD, HBA, TPSA, and RotBonds against a reference set of 1,949 FDA-approved oral drugs. A 70th percentile means your molecule has a higher MW than 70% of approved drugs — useful for quickly assessing how drug-like a candidate is.</p>,
      },
    ],
  },
  {
    id: 'tabs',
    title: 'Analysis tabs',
    questions: [
      {
        id: 'tab-pareto',
        q: 'Pareto — what does this tab show?',
        a: <p>Scatter plots of all possible pairs of your selected Pareto objectives. Pareto-optimal molecules are highlighted in green. Click any point to select that molecule and see its full property card. Use the objective dropdowns to focus on specific pairs.</p>,
      },
      {
        id: 'tab-admet',
        q: 'ADMET — how do the predictions work?',
        a: (
          <>
            <p>ADMET predictions are powered by <strong>ADMET-AI</strong> (Swanson et al., <em>Bioinformatics</em> 2024) — Chemprop D-MPNN graph neural network models trained on TDC benchmark datasets, ranked #1 on the Therapeutics Data Commons leaderboard.</p>
            <p className="mt-2">The models run on a <strong>self-hosted FastAPI service deployed on HuggingFace Spaces</strong> (<code className="bg-[var(--surface2)] px-1 rounded text-[11px]">ilkhamfy-admet-ai-api.hf.space</code>). Your SMILES are sent to this endpoint; no data is stored. On first use the Space may need ~30 seconds to cold-start.</p>
            <p className="mt-2"><strong>41 endpoints are predicted</strong> across 5 ADMET categories:</p>
            <ul className="list-disc pl-5 mt-2 space-y-0.5 text-[12px]">
              <li><strong>Absorption</strong> — Caco-2, HIA, Pgp inhibitor, bioavailability, aqueous solubility, lipophilicity, PAMPA, hydration ΔG</li>
              <li><strong>Distribution</strong> — BBB penetration, plasma protein binding (PPBR), volume of distribution (VDss)</li>
              <li><strong>Metabolism</strong> — CYP1A2/2C9/2C19/2D6/3A4 inhibition and substrate classification</li>
              <li><strong>Excretion</strong> — half-life, hepatocyte clearance, microsome clearance</li>
              <li><strong>Toxicity</strong> — hERG, DILI, Ames, LD50, ClinTox, carcinogenicity, skin sensitization, full Tox21 nuclear receptor panel (12 endpoints)</li>
            </ul>
            <p className="mt-2">Classification endpoints output <strong>predicted probability (0–1)</strong>; regression endpoints output the raw value in the given unit. Color-coding: green = safe direction, amber = borderline, red = concern.</p>
            <p className="mt-2">After prediction, all 41 values are available as Pareto objectives, filter ranges, and Scoring weights throughout the app.</p>
          </>
        ),
      },
      {
        id: 'tab-egg',
        q: 'BOILED-Egg — what is this?',
        a: (
          <>
            <p>The BOILED-Egg plot (Brain Or IntestinaL EstimateD, Daina & Zoete 2016) visualizes predicted passive permeability on a 2D plot of <strong>TPSA (x-axis)</strong> vs <strong>WLogP (y-axis)</strong>.</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li><strong>Yolk (yellow)</strong> — predicted to cross the blood-brain barrier (CNS-penetrant)</li>
              <li><strong>White (outer ellipse)</strong> — predicted to be absorbed via the gastrointestinal tract (HIA), but not CNS-penetrant</li>
              <li><strong>Outside</strong> — predicted to have poor passive permeability</li>
            </ul>
            <p className="mt-2">The two ellipses are derived from discriminant analysis of 1,000+ known CNS/non-CNS and absorbed/non-absorbed compounds. The boundaries are fixed reference regions, not computed per session.</p>
          </>
        ),
      },
      {
        id: 'tab-scaffold',
        q: 'Scaffolds — how are scaffolds grouped?',
        a: <p>The Scaffolds tab uses Bemis-Murcko scaffold decomposition (via RDKit) to group your molecules by core scaffold. Each scaffold shows the member count, average properties, and the fraction of Pareto-optimal members. Useful for quickly identifying which chemotypes dominate your Pareto front.</p>,
      },
      {
        id: 'tab-chemspace',
        q: 'Chem Space — what is the dimensionality reduction?',
        a: <p>The Chem Space tab embeds molecules into 2D using <strong>Morgan fingerprints (radius 2, 2048 bits)</strong> as input to UMAP, PCA, or t-SNE. All three projections run entirely in the browser (umap-js, custom PCA, tsne-js). Points are colored by Pareto rank, property value, or drug-likeness. Scroll to zoom, drag to pan. Structurally similar molecules cluster together — two molecules close on the plot share more structural features than two that are far apart.</p>,
      },
      {
        id: 'tab-mpo',
        q: 'MPO — what is multi-parameter optimization scoring?',
        a: (
          <>
            <p>The MPO tab computes a composite desirability score using a <strong>geometric mean of per-property desirability functions</strong> (each 0–1). Four built-in profiles are provided:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li><strong>Balanced</strong> — equal emphasis across all properties</li>
              <li><strong>CNS</strong> — favors brain-penetrant molecules (low MW, low TPSA, moderate LogP)</li>
              <li><strong>Oral</strong> — optimized for oral bioavailability (Lipinski-aligned)</li>
              <li><strong>Custom</strong> — manually adjust weights for each property</li>
            </ul>
            <p className="mt-2">The final score is the geometric mean across all weighted desirabilities — a single zero-desirability property can significantly drag down the overall score. Higher is better; 1.0 is ideal.</p>
          </>
        ),
      },
      {
        id: 'tab-cliffs',
        q: 'Activity Cliffs — what does this show?',
        a: <p>Activity Cliffs identifies pairs of structurally similar molecules (default Tanimoto ≥ 0.3, adjustable via slider) that have large differences in a selected property (e.g. LogP, TPSA, or any custom property). These pairs represent SAR leverage points — small structural changes with large property consequences. Pairs are visualized as a network: nodes are molecules, edges connect similar pairs, edge thickness encodes the property difference.</p>,
      },
      {
        id: 'tab-compare',
        q: 'Compare — how do I compare two molecules?',
        a: <p>Select up to two molecules using the checkbox on their cards, then switch to the Compare tab. The view shows both molecules side by side with their 2D structures, full property profiles, ADMET predictions, and drug-likeness scores. Use this to justify lead selection decisions or document why one candidate is preferred over another.</p>,
      },
      {
        id: 'tab-similarity',
        q: 'Similarity Matrix — what does it show?',
        a: <p>A heatmap of pairwise Tanimoto similarity (Morgan fingerprints) between all loaded molecules. High values (orange/red) indicate structurally similar pairs. Useful for identifying redundant compounds or clusters before selecting a diverse screening set.</p>,
      },
      {
        id: 'tab-scoring',
        q: 'Scoring — can I define my own scoring function?',
        a: <p>The Scoring tab computes a <strong>weighted sum score</strong> across MW, LogP, HBD, HBA, TPSA, RotBonds, FrCSP3, and QED using one of four pre-set profiles (Balanced, CNS, Oral, Custom). In Custom mode you set each property's weight directly. The score is normalized 0–1. Use this when your program has hard targets for specific properties and you want a single ranked list rather than a Pareto front.</p>,
      },
      {
        id: 'tab-radar',
        q: 'Radar — what does the radar chart show?',
        a: <p>A radar chart overlaying normalized MW, LogP, HBD, HBA, TPSA, and RotBonds for each selected molecule. Useful for quickly visualizing how a molecule's property profile compares to Lipinski / Veber space visually. Select up to 5 molecules for comparison.</p>,
      },
      {
        id: 'tab-parallel',
        q: 'Parallel coordinates — how do I use it?',
        a: <p>The Parallel Coordinates view plots every molecule as a line across all property axes simultaneously. Pareto-optimal molecules are highlighted. Brush any axis to filter molecules to a specific range — useful for finding molecules that satisfy multiple hard constraints at once.</p>,
      },
      {
        id: 'tab-statistics',
        q: 'Statistics — what summary data is shown?',
        a: <p>Histograms, box plots, and correlation heatmaps across all properties. Quickly see the distribution of your dataset — e.g. is your compound set biased toward high MW? The correlation heatmap shows which properties co-vary, useful for understanding redundancy in your objectives.</p>,
      },
    ],
  },
  {
    id: 'export',
    title: 'Exporting results',
    questions: [
      {
        id: 'export-formats',
        q: 'What can I export?',
        a: (
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>CSV</strong> — all molecules with all computed properties, ADMET predictions, Pareto rank, and filter results</li>
            <li><strong>SDF</strong> — structure-data file with all properties embedded (all molecules or Pareto-optimal only)</li>
            <li><strong>JSON</strong> — full molecule data in machine-readable format</li>
            <li><strong>PNG ↓</strong> (toolbar button) — exports the active chart view as PNG; also available via <em>Export → Figure (PNG)</em> in the header menu, which stitches multi-panel views (e.g. Pareto 2×3 grid) into a single image</li>
          </ul>
        ),
      },
      {
        id: 'shortlist',
        q: 'What is the shortlist?',
        a: <p>Click the star (☆) icon on any molecule card to add it to your shortlist. The shortlist tab collects your hand-picked candidates. You can export the shortlist separately as CSV or SDF — useful for sending a focused set to a synthesis team.</p>,
      },
    ],
  },
  {
    id: 'keyboard',
    title: 'Keyboard shortcuts',
    questions: [
      {
        id: 'shortcuts-list',
        q: 'What keyboard shortcuts are available?',
        a: (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] border-collapse">
              <thead>
                <tr className="border-b border-[var(--border-10)]">
                  <th className="text-left py-1.5 pr-4 text-[var(--text2)] font-medium">Key</th>
                  <th className="text-left py-1.5 text-[var(--text2)] font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-5)]">
                {[
                  ['↑ / ↓', 'Navigate molecules up / down'],
                  ['← / →', 'Same as ↑ / ↓'],
                  ['1–9', 'Switch to tab 1–9'],
                  ['0', 'Switch to last tab'],
                  ['[ / ]', 'Previous / next tab'],
                  ['s', 'Focus substructure search input'],
                  ['d', 'Toggle dark / light mode'],
                  ['f', 'Toggle FDA reference overlay'],
                  ['r', 'Reset (clear all molecules)'],
                  ['/', 'Open AI Copilot'],
                  ['Escape', 'Close panel / clear filter / deselect'],
                  ['?', 'Show / hide keyboard shortcuts'],
                ].map(([key, desc]) => (
                  <tr key={key}>
                    <td className="py-1.5 pr-4">
                      <kbd className="px-1.5 py-0.5 bg-[var(--surface2)] border border-[var(--border-10)] rounded text-[11px] font-mono">{key}</kbd>
                    </td>
                    <td className="py-1.5 text-[var(--text2)]">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ),
      },
    ],
  },
  {
    id: 'technical',
    title: 'Technical details',
    questions: [
      {
        id: 'how-works',
        q: 'How does client-side chemistry work?',
        a: <p>ParetoMol uses <strong>RDKit.js</strong> — a WebAssembly build of the RDKit cheminformatics library — to compute all molecular descriptors, generate 2D depictions, perform substructure searches, and compute fingerprints entirely in the browser. No chemistry is computed on any server.</p>,
      },
      {
        id: 'browser-support',
        q: 'Which browsers are supported?',
        a: <p>All modern browsers with WebAssembly support: Chrome 90+, Firefox 88+, Safari 15+, Edge 90+. For best performance, Chrome or Edge on desktop is recommended. Mobile browsers work but the experience is optimized for desktop screens.</p>,
      },
      {
        id: 'admet-models',
        q: 'How accurate are the ADMET predictions?',
        a: (
          <>
            <p>Predictions use the <strong>ADMET-AI</strong> Chemprop D-MPNN models (Swanson et al., <em>Bioinformatics</em> 2024), which are <strong>ranked #1 on the Therapeutics Data Commons (TDC) ADMET benchmark</strong> at time of publication. Each model is trained on a specific TDC dataset (e.g. hERG on the hERG dataset, ClinTox on the ClinTox dataset).</p>
            <p className="mt-2">Accuracy varies by endpoint. Well-studied endpoints (hERG, Caco-2, AMES) have strong models; less common endpoints (some Tox21 panels) are noisier. Always check the applicability domain warning shown on each molecule — predictions outside the training distribution are flagged.</p>
            <p className="mt-2">These are <strong>computational predictions, not experimental measurements</strong>. For regulatory submissions or publication-grade data, validate experimentally.</p>
          </>
        ),
      },
      {
        id: 'cite',
        q: 'How do I cite ParetoMol?',
        a: (
          <>
            <p>A manuscript is in preparation. In the meantime, please cite the tool as:</p>
            <pre className="mt-2 bg-[var(--surface2)] p-3 rounded text-[11px] font-mono overflow-x-auto whitespace-pre-wrap">{`Yabbarov, I. ParetoMol: Multi-Objective Pareto Analysis of Drug-Like Molecules.
https://paretomol.com (2026).`}</pre>
            <p className="mt-2">Use the <strong>Cite</strong> button in the header to copy a BibTeX entry.</p>
          </>
        ),
      },
      {
        id: 'copilot',
        q: 'What is the AI Copilot and how is it different from ADMET predictions?',
        a: (
          <>
            <p>These are two separate systems:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li><strong>ADMET predictions</strong> — Chemprop D-MPNN models (ADMET-AI, HuggingFace Space). No API key required. Structured numerical predictions on 41 validated endpoints.</li>
              <li><strong>AI Copilot</strong> — conversational LLM assistant (Gemini, OpenAI, or Anthropic). Requires your own API key stored in your browser. Used for interpretation, hypothesis generation, and natural-language questions about your dataset.</li>
            </ul>
            <p className="mt-2">The Copilot is aware of your loaded molecules and their computed properties. It does not make ADMET predictions — it interprets and explains the data you already have. Open it with the <strong>AI</strong> button (bottom right) or press <kbd className="bg-[var(--surface2)] px-1 rounded text-[11px] font-mono">/</kbd>.</p>
          </>
        ),
      },
      {
        id: 'contribute',
        q: 'How can I contribute or report a bug?',
        a: <p>Open an issue or pull request on <a href="https://github.com/IlkhamFY/molparetolab" target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">GitHub</a>. Feature requests, bug reports, and documentation improvements are all welcome. If you use ParetoMol in your research and want to collaborate, reach out at <a href="mailto:ilkhamfy@gmail.com" className="text-[var(--accent)] hover:underline">ilkhamfy@gmail.com</a>.</p>,
      },
    ],
  },
];

interface DocsPageProps {
  onClose: () => void;
}

export default function DocsPage({ onClose }: DocsPageProps) {
  const { theme, toggleTheme } = useTheme();
  const [activeSection, setActiveSection] = useState('overview');
  const [activeQ, setActiveQ] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Scroll spy
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const handler = () => {
      const scrollTop = el.scrollTop;
      for (const section of sections) {
        const sectionEl = document.getElementById(`section-${section.id}`);
        if (!sectionEl) continue;
        if (sectionEl.offsetTop - 120 <= scrollTop) {
          setActiveSection(section.id);
        }
      }
    };
    el.addEventListener('scroll', handler);
    return () => el.removeEventListener('scroll', handler);
  }, []);

  const scrollTo = (sectionId: string, qId?: string) => {
    const id = qId ? `q-${qId}` : `section-${sectionId}`;
    const el = document.getElementById(id);
    if (el && contentRef.current) {
      contentRef.current.scrollTo({ top: el.offsetTop - 80, behavior: 'smooth' });
    }
    setActiveSection(sectionId);
    if (qId) setActiveQ(qId);
  };

  return (
    <div className="fixed inset-0 z-[100] bg-[var(--bg)] flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-5)] shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="text-[var(--text2)] hover:text-[var(--text)] transition-colors">
            <X size={20} />
          </button>
          <span className="text-[var(--text-heading)] font-semibold text-[15px]">
            <span className="bg-gradient-to-r from-[#5F7367] to-[#7E9A89] bg-clip-text text-transparent">Pareto</span><span className="text-[var(--logo-mol)]">Mol</span> <span className="font-normal text-[var(--text2)]">/ Docs</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="https://paretomol.com"
            onClick={onClose}
            className="text-[12px] text-[var(--accent)] hover:underline"
          >
            ← Back to app
          </a>
          <button
            onClick={toggleTheme}
            className="flex items-center justify-center w-8 h-8 text-[var(--text2)] bg-[var(--surface2)] border border-[var(--border-5)] rounded-md hover:border-[var(--border-20)] transition-colors"
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar TOC */}
        <nav className="hidden md:flex flex-col w-56 shrink-0 border-r border-[var(--border-5)] overflow-y-auto py-6 px-3 custom-scrollbar">
          {sections.map((section) => (
            <div key={section.id} className="mb-4">
              <button
                onClick={() => scrollTo(section.id)}
                className={`w-full text-left px-3 py-1.5 text-[12px] font-semibold rounded transition-colors ${
                  activeSection === section.id
                    ? 'bg-[var(--accent)]/10 text-[var(--accent)]'
                    : 'text-[var(--text)] hover:text-[var(--text-heading)]'
                }`}
              >
                {section.title}
              </button>
              {activeSection === section.id && (
                <div className="mt-1 pl-2">
                  {section.questions.map((q) => (
                    <button
                      key={q.id}
                      onClick={() => scrollTo(section.id, q.id)}
                      className={`w-full text-left px-2 py-1 text-[11px] rounded transition-colors leading-snug ${
                        activeQ === q.id
                          ? 'text-[var(--accent)]'
                          : 'text-[var(--text2)] hover:text-[var(--text)]'
                      }`}
                    >
                      {q.q}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        {/* Main content */}
        <div
          ref={contentRef}
          className="flex-1 overflow-y-auto custom-scrollbar"
        >
          <div className="max-w-2xl mx-auto px-6 md:px-10 py-10">
            {sections.map((section) => (
              <div key={section.id} id={`section-${section.id}`} className="mb-14">
                <h2 className="text-[22px] font-semibold text-[var(--text-heading)] mb-6 pb-3 border-b border-[var(--border-10)]">
                  {section.title}
                </h2>
                {section.questions.map((q) => (
                  <div key={q.id} id={`q-${q.id}`} className="mb-8">
                    <h3 className="text-[15px] font-semibold text-[var(--text-heading)] mb-2">
                      {q.q}
                    </h3>
                    <div className="text-[13px] text-[var(--text2)] leading-relaxed space-y-1">
                      {q.a}
                    </div>
                  </div>
                ))}
              </div>
            ))}

            {/* Footer */}
            <div className="border-t border-[var(--border-5)] pt-8 mt-4 text-[12px] text-[var(--text2)]/50 text-center space-x-2">
              <span>ParetoMol</span>
              <span>·</span>
              <a href="https://github.com/IlkhamFY/molparetolab" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--text2)] transition-colors">GitHub</a>
              <span>·</span>
              <a href="https://ilkham.com" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--text2)] transition-colors">ilkham.com</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
