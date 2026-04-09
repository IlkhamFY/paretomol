import React, { useMemo, useRef, useEffect, useState } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import type { Molecule } from '../../utils/types';

interface BoxPlotViewProps {
  molecules: Molecule[];
  customPropNames?: string[];
}

const CORE_PROPS = ['MW', 'LogP', 'HBD', 'HBA', 'TPSA', 'RotBonds'];

function getMolValue(m: Molecule, key: string): number | null {
  const v = (m.props as unknown as Record<string, number | undefined>)[key] ?? m.customProps?.[key];
  return typeof v === 'number' && isFinite(v) ? v : null;
}

interface Stats {
  min: number;
  q1: number;
  median: number;
  mean: number;
  q3: number;
  max: number;
  std: number;
  wLow: number; // lower whisker (1.5×IQR clamped)
  wHigh: number; // upper whisker (1.5×IQR clamped)
  n: number;
}

function computeStats(values: number[]): Stats | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);

  const q1 = percentile(sorted, 25);
  const median = percentile(sorted, 50);
  const q3 = percentile(sorted, 75);
  const iqr = q3 - q1;
  const wLow = Math.max(sorted[0], q1 - 1.5 * iqr);
  const wHigh = Math.min(sorted[n - 1], q3 + 1.5 * iqr);

  return { min: sorted[0], q1, median, mean, q3, max: sorted[n - 1], std, wLow, wHigh, n };
}

function percentile(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
}

function fmt(v: number): string {
  if (!isFinite(v)) return '—';
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

interface BoxRowProps {
  label: string;
  allStats: Stats | null;
  paretoStats: Stats | null;
  globalMin: number;
  globalMax: number;
  showMode: 'both' | 'all' | 'pareto';
}

function BoxRow({ label, allStats, paretoStats, globalMin, globalMax, showMode }: BoxRowProps) {
  const { themeVersion } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const range = globalMax - globalMin || 1;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const toX = (v: number) => ((v - globalMin) / range) * (W - 20) + 10;

    const drawBox = (stats: Stats, y: number, h: number, color: string, alpha: number) => {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;

      // Whisker lines
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(toX(stats.wLow), y + h / 2);
      ctx.lineTo(toX(stats.q1), y + h / 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(toX(stats.q3), y + h / 2);
      ctx.lineTo(toX(stats.wHigh), y + h / 2);
      ctx.stroke();

      // Whisker caps
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(toX(stats.wLow), y + h * 0.2);
      ctx.lineTo(toX(stats.wLow), y + h * 0.8);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(toX(stats.wHigh), y + h * 0.2);
      ctx.lineTo(toX(stats.wHigh), y + h * 0.8);
      ctx.stroke();

      // IQR box
      ctx.globalAlpha = alpha * 0.25;
      ctx.fillStyle = color;
      ctx.fillRect(toX(stats.q1), y + 2, toX(stats.q3) - toX(stats.q1), h - 4);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(toX(stats.q1), y + 2, toX(stats.q3) - toX(stats.q1), h - 4);

      // Median line
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(toX(stats.median), y + 1);
      ctx.lineTo(toX(stats.median), y + h - 1);
      ctx.stroke();

      // Mean dot
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(toX(stats.mean), y + h / 2, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 1;
    };

    const showAll = showMode === 'both' || showMode === 'all';

    if (showMode === 'both') {
      // Two rows stacked
      const rowH = Math.floor(H / 2) - 2;
      if (allStats) drawBox(allStats, 2, rowH, '#5F7367', 1);
      if (paretoStats) drawBox(paretoStats, rowH + 4, rowH, '#14b8a6', 1);
    } else {
      const stats = showAll ? allStats : paretoStats;
      const color = showAll ? '#5F7367' : '#14b8a6';
      if (stats) drawBox(stats, 2, H - 4, color, 1);
    }
  }, [allStats, paretoStats, globalMin, globalMax, range, showMode, themeVersion]);

  const displayStats = showMode === 'pareto' ? paretoStats : allStats;

  return (
    <tr className="border-b border-[var(--border-5)] hover:bg-[var(--surface2)]/30 transition-colors">
      <td className="py-2 pr-3 text-[12px] font-medium text-[var(--text)] whitespace-nowrap w-[90px]">{label}</td>
      <td className="py-1 w-full min-w-[200px]">
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: showMode === 'both' ? '44px' : '24px', display: 'block' }}
        />
      </td>
      <td className="py-2 pl-3 text-[11px] font-mono text-[var(--text2)] whitespace-nowrap text-right">
        {displayStats ? fmt(displayStats.min) : '—'}
      </td>
      <td className="py-2 pl-2 text-[11px] font-mono text-[var(--text2)] whitespace-nowrap text-right">
        {displayStats ? fmt(displayStats.q1) : '—'}
      </td>
      <td className="py-2 pl-2 text-[11px] font-mono text-[var(--text)] whitespace-nowrap text-right font-semibold">
        {displayStats ? fmt(displayStats.median) : '—'}
      </td>
      <td className="py-2 pl-2 text-[11px] font-mono text-[var(--text2)] whitespace-nowrap text-right">
        {displayStats ? fmt(displayStats.mean) : '—'}
      </td>
      <td className="py-2 pl-2 text-[11px] font-mono text-[var(--text2)] whitespace-nowrap text-right">
        {displayStats ? fmt(displayStats.q3) : '—'}
      </td>
      <td className="py-2 pl-2 text-[11px] font-mono text-[var(--text2)] whitespace-nowrap text-right">
        {displayStats ? fmt(displayStats.max) : '—'}
      </td>
      <td className="py-2 pl-2 text-[11px] font-mono text-[var(--text2)] whitespace-nowrap text-right">
        {displayStats ? fmt(displayStats.std) : '—'}
      </td>
    </tr>
  );
}

function BoxPlotView({ molecules, customPropNames = [] }: BoxPlotViewProps) {
  useTheme(); // subscribe to theme changes
  const [showMode, setShowMode] = useState<'both' | 'all' | 'pareto'>('both');

  const allProps = useMemo(() => [...CORE_PROPS, ...customPropNames], [customPropNames]);

  const paretoMols = useMemo(() => molecules.filter(m => m.paretoRank === 1), [molecules]);

  const propData = useMemo(() => {
    return allProps.map(key => {
      const allVals = molecules.map(m => getMolValue(m, key)).filter((v): v is number => v !== null);
      const paretoVals = paretoMols.map(m => getMolValue(m, key)).filter((v): v is number => v !== null);
      const allStats = computeStats(allVals);
      const paretoStats = computeStats(paretoVals);
      const globalMin = allStats ? allStats.min : 0;
      const globalMax = allStats ? allStats.max : 1;
      return { key, allStats, paretoStats, globalMin, globalMax };
    });
  }, [allProps, molecules, paretoMols]);

  if (molecules.length === 0) {
    return (
      <div className="bg-[var(--surface)] border border-[var(--border-5)] rounded-lg p-12 text-center">
        <p className="text-[var(--text2)] text-[13px]">No molecules loaded.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header controls */}
      <div className="bg-[var(--surface)] border border-[var(--border-5)] rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-medium text-[var(--text-heading)]">Property Distributions — Box Plots</h3>
          <p className="text-[11px] text-[var(--text2)] mt-0.5">
            Whiskers = 1.5×IQR · Box = Q1–Q3 · Line = median · Dot = mean
          </p>
        </div>
        <div className="flex items-center gap-1 bg-[var(--bg)] rounded-md border border-[var(--border-10)] p-0.5">
          {([
            { val: 'both', label: 'Both' },
            { val: 'all', label: 'All' },
            { val: 'pareto', label: 'Pareto only' },
          ] as const).map(opt => (
            <button
              key={opt.val}
              onClick={() => setShowMode(opt.val)}
              className={`px-3 py-1.5 text-[11px] font-medium rounded transition-colors ${
                showMode === opt.val
                  ? 'bg-[var(--surface2)] text-[var(--text-heading)] shadow-sm'
                  : 'text-[var(--text2)] hover:text-[var(--text)]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      {showMode === 'both' && (
        <div className="flex items-center gap-4 px-1 text-[11px] text-[var(--text2)]">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-8 h-2 rounded" style={{ background: '#5F7367' }} />
            All molecules ({molecules.length})
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-8 h-2 rounded" style={{ background: '#14b8a6' }} />
            Pareto-optimal ({paretoMols.length})
          </span>
        </div>
      )}

      {/* Box plots table */}
      <div className="bg-[var(--surface)] border border-[var(--border-5)] rounded-lg overflow-hidden">
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full min-w-[700px]">
            <thead>
              <tr className="border-b border-[var(--border-10)] bg-[var(--surface2)]/50">
                <th className="py-2 pr-3 text-left text-[11px] font-medium text-[var(--text2)] w-[90px]">Property</th>
                <th className="py-2 text-left text-[11px] font-medium text-[var(--text2)]">Distribution</th>
                <th className="py-2 pl-3 text-right text-[11px] font-medium text-[var(--text2)]">Min</th>
                <th className="py-2 pl-2 text-right text-[11px] font-medium text-[var(--text2)]">Q1</th>
                <th className="py-2 pl-2 text-right text-[11px] font-medium text-[var(--text)]">Median</th>
                <th className="py-2 pl-2 text-right text-[11px] font-medium text-[var(--text2)]">Mean</th>
                <th className="py-2 pl-2 text-right text-[11px] font-medium text-[var(--text2)]">Q3</th>
                <th className="py-2 pl-2 text-right text-[11px] font-medium text-[var(--text2)]">Max</th>
                <th className="py-2 pl-2 text-right text-[11px] font-medium text-[var(--text2)]">Std Dev</th>
              </tr>
            </thead>
            <tbody className="px-4">
              {propData.map(({ key, allStats, paretoStats, globalMin, globalMax }) => (
                <BoxRow
                  key={key}
                  label={key}
                  allStats={allStats}
                  paretoStats={paretoStats}
                  globalMin={globalMin}
                  globalMax={globalMax}
                  showMode={showMode}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Compact stats comparison (Pareto vs All) */}
      {showMode === 'both' && paretoMols.length > 0 && (
        <div className="bg-[var(--surface)] border border-[var(--border-5)] rounded-lg p-4">
          <h4 className="text-[13px] font-medium text-[var(--text-heading)] mb-3">Pareto-optimal vs. Full Dataset — Median comparison</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-[var(--border-5)]">
                  <th className="text-left py-1.5 pr-4 text-[var(--text2)] font-medium">Property</th>
                  <th className="text-right py-1.5 px-3 text-[var(--text2)] font-medium">All (median)</th>
                  <th className="text-right py-1.5 px-3 text-[var(--text2)] font-medium">Pareto (median)</th>
                  <th className="text-right py-1.5 pl-3 text-[var(--text2)] font-medium">Δ</th>
                </tr>
              </thead>
              <tbody>
                {propData.map(({ key, allStats, paretoStats }) => {
                  if (!allStats || !paretoStats) return null;
                  const delta = paretoStats.median - allStats.median;
                  const pct = allStats.median !== 0 ? (delta / Math.abs(allStats.median)) * 100 : 0;
                  return (
                    <tr key={key} className="border-b border-[var(--border-5)]/50 hover:bg-[var(--surface2)]/20">
                      <td className="py-1.5 pr-4 font-medium text-[var(--text)]">{key}</td>
                      <td className="py-1.5 px-3 text-right font-mono text-[var(--text2)]">{fmt(allStats.median)}</td>
                      <td className="py-1.5 px-3 text-right font-mono text-[#14b8a6]">{fmt(paretoStats.median)}</td>
                      <td className={`py-1.5 pl-3 text-right font-mono ${delta < 0 ? 'text-[#22c55e]' : delta > 0 ? 'text-[#f97316]' : 'text-[var(--text2)]'}`}>
                        {delta >= 0 ? '+' : ''}{fmt(delta)} ({pct >= 0 ? '+' : ''}{pct.toFixed(1)}%)
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default React.memo(BoxPlotView);