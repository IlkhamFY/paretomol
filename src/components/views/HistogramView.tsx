import React, { useMemo } from 'react';
import type { Molecule } from '../../utils/types';

const CORE_PROPS = ['MW', 'LogP', 'HBD', 'HBA', 'TPSA', 'RotBonds'] as const;

function getMolValue(m: Molecule, key: string): number | null {
  const v = (m.props as unknown as Record<string, number | undefined>)[key] ?? m.customProps?.[key];
  return typeof v === 'number' && isFinite(v) ? v : null;
}

function computeStats(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  return { mean, median, std, min: sorted[0], max: sorted[n - 1], n };
}

function buildBins(values: number[], binCount: number = 20) {
  if (values.length === 0) return { bins: [], min: 0, max: 0, maxCount: 0 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const binWidth = range / binCount;
  const bins = new Array(binCount).fill(0);
  for (const v of values) {
    const idx = Math.min(Math.floor((v - min) / binWidth), binCount - 1);
    bins[idx]++;
  }
  return { bins, min, max, maxCount: Math.max(...bins), binWidth };
}

function Histogram({ label, values, color }: { label: string; values: number[]; color: string }) {
  const stats = useMemo(() => computeStats(values), [values]);
  const { bins, min, max, maxCount } = useMemo(() => buildBins(values, 24), [values]);

  if (!stats || bins.length === 0) return null;

  return (
    <div className="bg-[var(--surface)] border border-[var(--border-5)] rounded-lg p-4">
      <div className="flex items-baseline justify-between mb-3">
        <span className="text-[13px] font-medium text-[var(--text)]">{label}</span>
        <span className="text-[10px] text-[var(--text2)]">n={stats.n}</span>
      </div>

      {/* Histogram bars */}
      <div className="relative h-[80px] flex items-end gap-[1px] mb-1">
        {bins.map((count, i) => {
          const height = maxCount > 0 ? (count / maxCount) * 100 : 0;
          return (
            <div
              key={i}
              className="flex-1 rounded-t-sm transition-all hover:opacity-80"
              style={{
                height: `${height}%`,
                backgroundColor: count > 0 ? color : 'transparent',
                minHeight: count > 0 ? '2px' : '0px',
              }}
              title={`${(min + i * ((max - min) / bins.length)).toFixed(1)}–${(min + (i + 1) * ((max - min) / bins.length)).toFixed(1)}: ${count}`}
            />
          );
        })}
      </div>

      {/* Axis labels */}
      <div className="flex justify-between text-[9px] text-[var(--text2)]/60 mb-3">
        <span>{min.toFixed(1)}</span>
        <span>{max.toFixed(1)}</span>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-2 text-[10px]">
        <div>
          <div className="text-[var(--text2)]/60">mean</div>
          <div className="text-[var(--text)] font-medium">{stats.mean.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-[var(--text2)]/60">median</div>
          <div className="text-[var(--text)] font-medium">{stats.median.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-[var(--text2)]/60">std</div>
          <div className="text-[var(--text)] font-medium">{stats.std.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-[var(--text2)]/60">range</div>
          <div className="text-[var(--text)] font-medium">{(stats.max - stats.min).toFixed(1)}</div>
        </div>
      </div>
    </div>
  );
}

interface HistogramViewProps {
  molecules: Molecule[];
  customPropNames?: string[];
}

const HistogramView = React.memo(function HistogramView({ molecules, customPropNames = [] }: HistogramViewProps) {
  const propData = useMemo(() => {
    const allKeys = [...CORE_PROPS, ...customPropNames];
    return allKeys.map(key => {
      const values = molecules.map(m => getMolValue(m, key)).filter((v): v is number => v !== null);
      return { key, values };
    }).filter(d => d.values.length > 0);
  }, [molecules, customPropNames]);

  const coreColors = ['#5F7367', '#14b8a6', '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b'];

  return (
    <div>
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="text-[15px] font-semibold text-[var(--text)]">Property Distributions</h3>
        <span className="text-[11px] text-[var(--text2)]">{molecules.length} molecules</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {propData.map((d, i) => (
          <Histogram
            key={d.key}
            label={d.key}
            values={d.values}
            color={i < coreColors.length ? coreColors[i] : 'var(--text2)'}
          />
        ))}
      </div>
    </div>
  );
});

export default HistogramView;
