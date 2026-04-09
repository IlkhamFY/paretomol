import React, { useState, lazy, Suspense } from 'react';
import type { Molecule } from '../../utils/types';

const HistogramView = lazy(() => import('./HistogramView'));
const BoxPlotView = lazy(() => import('./BoxPlotView'));
const CorrelationView = lazy(() => import('./CorrelationView'));

interface StatisticsViewProps {
  molecules: Molecule[];
  customPropNames?: string[];
}

const SUB_TABS = [
  { id: 'distributions', label: 'Distributions' },
  { id: 'boxplots', label: 'Box Plots' },
  { id: 'correlations', label: 'Correlations' },
] as const;

type SubTab = typeof SUB_TABS[number]['id'];

const StatisticsView = React.memo(function StatisticsView({ molecules, customPropNames = [] }: StatisticsViewProps) {
  const [subTab, setSubTab] = useState<SubTab>('distributions');

  return (
    <div>
      {/* Sub-tab selector */}
      <div className="flex items-center gap-1 mb-5 border-b border-[var(--border-5)]">
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={`px-3 py-1.5 text-[12px] font-medium transition-colors border-b-2 ${
              subTab === t.id
                ? 'border-[var(--accent)] text-[var(--text-heading)]'
                : 'border-transparent text-[var(--text2)] hover:text-[var(--text)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Suspense fallback={<div className="h-64 flex items-center justify-center text-[var(--text2)] text-[13px]">Loading...</div>}>
        {subTab === 'distributions' && <HistogramView molecules={molecules} customPropNames={customPropNames} />}
        {subTab === 'boxplots' && <BoxPlotView molecules={molecules} customPropNames={customPropNames} />}
        {subTab === 'correlations' && <CorrelationView molecules={molecules} customPropNames={customPropNames} />}
      </Suspense>
    </div>
  );
});

export default StatisticsView;
