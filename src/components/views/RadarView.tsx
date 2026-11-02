import React, { useState, useRef, useCallback } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { Radar } from 'react-chartjs-2';
import type { Molecule } from '../../utils/types';
import { PROPERTIES } from '../../utils/types';
import {
  Chart as ChartJS,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip as ChartTooltip,
  Legend
} from 'chart.js';

// Avoid re-registering if already done globally, but we do need RadialScale for this chart
ChartJS.register(RadialLinearScale, PointElement, LineElement, Filler, ChartTooltip, Legend);

/** Accent green used for selected molecule; everything else is gray */
const ACTIVE_COLOR = '#5F7367';
const GRAY_COLOR = '#9ca3af';

/** Small download arrow icon */
function DownloadIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2v8M5 7l3 3 3-3" />
      <path d="M2 12h12" />
    </svg>
  );
}

type FilterMode = 'all' | 'pareto' | 'starred';

function RadarView({ molecules, selectedMolIdx, setSelectedMolIdx, shortlist }: { molecules: Molecule[], selectedMolIdx: number | null, setSelectedMolIdx?: (idx: number | null) => void, shortlist?: Set<number> }) {
  const { themeVersion } = useTheme();
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef = useRef<any>(null);

  const visibleMolecules = filterMode === 'pareto'
    ? molecules.filter(m => m.paretoRank === 1)
    : filterMode === 'starred'
    ? molecules.filter((_, i) => shortlist?.has(i))
    : molecules;
  // Keep original indices for color consistency
  const visibleWithIdx = visibleMolecules.map(m => ({ m, origIdx: molecules.indexOf(m) }));

  const labels = ['MW', 'LogP', 'HBD', 'HBA', 'TPSA', 'RotBonds', 'FrCSP3'];

  const maxVals: Record<string, number> = {};
  labels.forEach(k => {
    const propDef = PROPERTIES.find(p => p.key === k);
    if (propDef && propDef.lipinski) {
      maxVals[k] = propDef.lipinski.max;
    } else {
      maxVals[k] = Math.max(...molecules.map(m => m.props[k as keyof Molecule['props']] as number), 1);
    }
  });

  const hasSelection = selectedMolIdx !== null && visibleWithIdx.some(({ origIdx }) => origIdx === selectedMolIdx);

  const datasets = visibleWithIdx.map(({ m, origIdx }) => {
    const isSelected = selectedMolIdx === origIdx;
    const color = isSelected ? ACTIVE_COLOR : GRAY_COLOR;

    return {
      label: m.name,
      data: labels.map(k => Math.max(0, Math.min((m.props[k as keyof Molecule['props']] as number) / maxVals[k], 1.5))),
      borderColor: isSelected ? color : (hasSelection ? color + '20' : color + '60'),
      backgroundColor: isSelected ? color + '40' : (hasSelection ? color + '05' : color + '15'),
      borderWidth: isSelected ? 3 : 1,
      pointRadius: isSelected ? 5 : (hasSelection ? 0 : 2),
      pointBackgroundColor: color,
    };
  });

  /** Download the full combined radar chart as PNG via chart.toBase64Image() */
  const downloadFullRadar = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const url = chart.toBase64Image('image/png', 1);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'radar_all.png';
    a.click();
  }, []);

  /**
   * Download an individual molecule radar as PNG.
   * Creates an offscreen 600x600 canvas with a single-dataset Chart.js instance,
   * waits two animation frames for rendering, then downloads.
   */
  const downloadMoleculeRadar = useCallback((_origIdx: number, molName: string, datasetIndex: number) => {
    const offscreen = document.createElement('canvas');
    offscreen.width = 600;
    offscreen.height = 600;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;

    // Fill background with current theme background color
    const cs = getComputedStyle(document.documentElement);
    const bg = cs.getPropertyValue('--bg').trim() || '#ffffff';
    const textColor = cs.getPropertyValue('--text').trim() || '#000000';
    const text2Color = cs.getPropertyValue('--text2').trim() || '#666666';
    const gridColor = cs.getPropertyValue('--border-10').trim() || 'rgba(0,0,0,0.1)';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, offscreen.width, offscreen.height);

    const color = ACTIVE_COLOR;
    const singleData = datasets[datasetIndex]?.data ?? [];

    const tempChart = new ChartJS(offscreen, {
      type: 'radar',
      data: {
        labels,
        datasets: [{
          label: molName,
          data: singleData,
          borderColor: color,
          backgroundColor: color + '50',
          borderWidth: 2,
          pointRadius: 4,
          pointBackgroundColor: color,
        }],
      },
      options: {
        responsive: false,
        animation: false,
        plugins: {
          legend: {
            display: true,
            labels: { color: textColor, font: { size: 14 } },
          },
          tooltip: { enabled: false },
        },
        scales: {
          r: {
            grid: { color: gridColor },
            angleLines: { color: gridColor },
            pointLabels: { color: text2Color, font: { size: 14 } },
            ticks: { color: text2Color, backdropColor: 'transparent', stepSize: 0.25, maxTicksLimit: 5 },
            suggestedMin: 0,
            suggestedMax: 1.0,
          },
        },
      },
    });

    // Two rAF ticks to ensure Chart.js finishes rendering
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const url = offscreen.toDataURL('image/png');
        tempChart.destroy();
        const safeName = molName.replace(/[^a-zA-Z0-9_-]/g, '_');
        const a = document.createElement('a');
        a.href = url;
        a.download = `${safeName}_radar.png`;
        a.click();
      });
    });
  }, [datasets, labels, themeVersion]);

  return (
    <div className="bg-[var(--surface)] border border-[var(--border-5)] rounded-lg p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-[14px] font-medium text-[var(--text-heading)]">Property Radar</h3>
          <p className="text-[12px] text-[var(--text2)]">normalized to Lipinski limits (1.0 = threshold)</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Segmented filter: All / Pareto / Starred */}
          <div className="flex items-center bg-[var(--surface2)] border border-[var(--border-5)] rounded-md overflow-hidden">
            {([
              { id: 'all' as FilterMode, label: 'All' },
              { id: 'pareto' as FilterMode, label: 'Pareto' },
              { id: 'starred' as FilterMode, label: 'Starred' },
            ] as const).map(({ id, label }) => {
              const isActive = filterMode === id;
              const count = id === 'pareto'
                ? molecules.filter(m => m.paretoRank === 1).length
                : id === 'starred'
                ? (shortlist?.size ?? 0)
                : molecules.length;
              const disabled = count === 0 && id !== 'all';
              return (
                <button
                  key={id}
                  onClick={() => !disabled && setFilterMode(id)}
                  disabled={disabled}
                  className={`px-2.5 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-[var(--accent)]/15 text-[var(--accent)]'
                      : disabled
                      ? 'text-[var(--text2)]/25 cursor-not-allowed'
                      : 'text-[var(--text2)] hover:text-[var(--text)]'
                  }`}
                >
                  {label}{count > 0 && id !== 'all' ? ` (${count})` : ''}
                </button>
              );
            })}
          </div>
          {/* Download combined chart button */}
          <button
            onClick={downloadFullRadar}
            title="Download combined radar chart as PNG"
            className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded border border-[var(--border-5)] bg-[var(--surface2)] text-[var(--text2)] hover:border-[var(--accent)] hover:text-[var(--text)] transition-colors whitespace-nowrap"
          >
            <DownloadIcon size={11} />
            PNG
          </button>
        </div>
      </div>

      <div className="w-full h-[420px]">
        <Radar
          ref={chartRef}
          data={{ labels, datasets }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 300 },
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: (ctx) => {
                    const mol = visibleWithIdx[ctx.datasetIndex]?.m;
                    if (!mol) return '';
                    const key = labels[ctx.dataIndex];
                    const val = mol.props[key as keyof Molecule['props']];
                    return `${mol.name}: ${key} = ${typeof val === 'number' ? val.toFixed(1) : val}`;
                  }
                }
              }
            },
            scales: {
              r: {
                grid: { color: 'rgba(80,80,100,0.4)' },
                angleLines: { color: 'rgba(80,80,100,0.4)' },
                pointLabels: { color: getComputedStyle(document.documentElement).getPropertyValue('--canvas-label').trim(), font: { size: 13 } },
                ticks: { color: getComputedStyle(document.documentElement).getPropertyValue('--canvas-sublabel').trim(), backdropColor: 'transparent', stepSize: 0.25, maxTicksLimit: 5, display: true },
                suggestedMin: 0,
                suggestedMax: 1.0,
              }
            }
          }}
        />
      </div>

      {/* Legend with per-molecule download buttons (shown on group hover) */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {visibleWithIdx.map(({ m, origIdx }, datasetIndex) => {
          const isSelected = selectedMolIdx === origIdx;
          return (
          <div
            key={origIdx}
            className={`flex items-center gap-1 group cursor-pointer rounded px-1 -mx-1 transition-colors ${isSelected ? 'bg-[var(--accent)]/10' : 'hover:bg-[var(--surface)]'}`}
            onClick={() => setSelectedMolIdx?.(isSelected ? null : origIdx)}
          >
            <span
              className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
              style={{ backgroundColor: isSelected ? ACTIVE_COLOR : GRAY_COLOR }}
            />
            <span className={`text-[11px] ${isSelected ? 'text-[var(--text)] font-medium' : 'text-[var(--text2)]'}`}>{m.name}</span>
            <button
              onClick={() => downloadMoleculeRadar(origIdx, m.name, datasetIndex)}
              title={`Download ${m.name} radar as PNG`}
              aria-label={`Download ${m.name} radar chart`}
              className="ml-0.5 opacity-0 group-hover:opacity-100 flex items-center justify-center w-4 h-4 rounded text-[var(--text2)] hover:text-[var(--accent)] transition-all focus:opacity-100"
            >
              <DownloadIcon size={10} />
            </button>
          </div>
          );
        })}
      </div>
    </div>
  );
}

export default React.memo(RadarView);