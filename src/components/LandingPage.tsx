import { Upload, ArrowRight } from 'lucide-react';

interface LandingPageProps {
  onLoadExample?: (key: string) => void;
  onOpenSidebar?: () => void;
}

export default function LandingPage({ onLoadExample, onOpenSidebar }: LandingPageProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-73px)] px-5 py-8">
      <div className="max-w-[420px] w-full text-center">
        <h2 className="text-[22px] sm:text-[26px] font-semibold tracking-tight text-[var(--text)] mb-3">
          Multi-objective molecule analysis
        </h2>
        <p className="text-[13px] text-[var(--text2)] leading-relaxed mb-8">
          Paste SMILES, drop an SDF, or fetch by ChEMBL target.
          Pareto ranking, drug-likeness filters, ADMET predictions,
          and 14 interactive views -- entirely in your browser.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-10">
          <button
            onClick={() => onLoadExample?.('kinase')}
            className="group flex items-center gap-2 px-5 py-2.5 bg-[var(--accent)] text-white text-[13px] font-medium rounded-md hover:bg-[var(--accent2)] transition-colors"
          >
            Try example set
            <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
          </button>
          <button
            onClick={onOpenSidebar}
            className="flex items-center gap-2 px-5 py-2.5 text-[var(--text2)] text-[13px] font-medium border border-[var(--border-10)] rounded-md hover:border-[var(--accent)] hover:text-[var(--text)] transition-colors"
          >
            <Upload size={14} strokeWidth={1.8} />
            Paste SMILES or drop SDF
          </button>
        </div>

        <p className="text-[11px] text-[var(--text2)] opacity-40">
          100% client-side · no data leaves your browser · <a href="https://github.com/IlkhamFY/molparetolab" target="_blank" rel="noopener noreferrer" className="underline hover:opacity-70">open source</a> · <a href="https://github.com/IlkhamFY/molparetolab/blob/main/CONTRIBUTING.md" target="_blank" rel="noopener noreferrer" className="underline hover:opacity-70">contribute</a>
        </p>

        <details className="mt-6 text-[12px] text-[var(--text2)] text-left">
          <summary className="cursor-pointer text-[var(--text)] font-medium select-none">What&apos;s new</summary>
          <ul className="mt-2 space-y-1 pl-4 list-disc">
            <li>Clipboard paste (TSV/CSV auto-detected and analyzed instantly)</li>
            <li>Per-tab PNG export (canvas capture, multi-chart stitching)</li>
            <li>One-click personal ADMET-AI Space deploy (unlimited predictions, free)</li>
            <li>ChEMBL target fetch (e.g., CHEMBL203 for EGFR)</li>
            <li>Box plots and property distribution histograms</li>
            <li>Activity cliff network visualization</li>
            <li>ADMET-AI: 41 property predictions (TDC benchmark) + radar chart</li>
            <li>Property range sliders with mini histograms</li>
            <li>PAINS / Brenk / NIH structural alert badges</li>
            <li>Substructure search (SMARTS filter)</li>
            <li>Property correlation heatmap</li>
            <li>Radar chart PNG export</li>
            <li>SDF export (Pareto-optimal subset or all)</li>
            <li>Drag-and-drop file import (SDF, CSV, TSV)</li>
            <li>Light/dark mode toggle</li>
            <li>AI Copilot with streaming chat</li>
          </ul>
        </details>
      </div>
    </div>
  );
}

