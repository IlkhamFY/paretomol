import { ArrowRight } from 'lucide-react';

interface LandingPageProps {
  onLoadExample?: (key: string) => void;
}

export default function LandingPage({ onLoadExample }: LandingPageProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full overflow-y-auto px-5 py-8">
      <div className="max-w-[420px] w-full text-center">
        <h2 className="text-[22px] sm:text-[26px] font-semibold tracking-tight text-[var(--text)] mb-3">
          Multi-objective molecule analysis
        </h2>
        <p className="text-[13px] text-[var(--text2)] leading-relaxed mb-8">
          Paste SMILES in the sidebar, or start with a small set of kinase inhibitors.
        </p>
        <button
          type="button"
          onClick={() => onLoadExample?.('kinase')}
          className="group inline-flex items-center gap-2 px-5 py-2.5 bg-[var(--accent)] text-white text-[13px] font-medium rounded-md hover:bg-[var(--accent2)] transition-colors"
        >
          Try kinase inhibitors
          <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>
    </div>
  );
}
