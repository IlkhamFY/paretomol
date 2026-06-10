import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { Scatter } from 'react-chartjs-2';
import annotationPlugin from 'chartjs-plugin-annotation';
import zoomPlugin from 'chartjs-plugin-zoom';
import {
  Chart as ChartJS,
  LinearScale,
  PointElement,
  LineElement,
  LineController,
  Tooltip,
  Legend,
  ScatterController,
  Title
} from 'chart.js';
import type { Molecule, ParetoObjective } from '../../utils/types';
import { DRUG_FILTERS } from '../../utils/types';
import { findBestCompromise } from '../../utils/paretoKnee';
import { readFront } from '../../utils/paretoNarrative';
import { nearestBetterAnalog } from '../../utils/designHint';
import type { FDADrug } from '../../utils/fda_reference';
import { PROP_TO_FDA } from '../../utils/fda_reference';
import { getMolSvg } from '../../utils/chem';
import { useTheme } from '../../contexts/ThemeContext';

ChartJS.register(
  LinearScale,
  PointElement,
  LineElement,
  LineController,
  Tooltip,
  Legend,
  ScatterController,
  Title,
  annotationPlugin,
  zoomPlugin
);

const LIPINSKI_THRESHOLDS: Record<string, { value: number; label: string }> = {
  MW: { value: 500, label: 'MW ≤ 500' },
  LogP: { value: 5, label: 'LogP ≤ 5' },
  HBD: { value: 5, label: 'HBD ≤ 5' },
  HBA: { value: 10, label: 'HBA ≤ 10' },
  TPSA: { value: 140, label: 'TPSA ≤ 140' },
  RotBonds: { value: 10, label: 'RotB ≤ 10' },
};

interface ScatterAxes {
  x: string;
  y: string;
}

const DEFAULT_AXES: ScatterAxes[] = [
  { x: 'SC', y: 'LogP' },
  { x: 'SC', y: 'MW' },
  { x: 'MW', y: 'LogP' },
  { x: 'LogP', y: 'TPSA' },
  { x: 'HBD', y: 'HBA' },
  { x: 'LogP', y: 'FrCSP3' },
];

// Plottable axes, labelled like the rest of the app. The make-ability / cost
// metrics (synth.-complexity estimate, Ertl SA score, vendor count) are grouped
// first so they read as first-class objectives, not raw keys buried in a list.
const PHYS_KEYS = ['MW', 'LogP', 'TPSA', 'HBD', 'HBA', 'RotBonds', 'FrCSP3', 'QED'];
const AXIS_LABELS: Record<string, string> = {
  SC: 'Synth. (est.)', SA_Score: 'SA score', RAScore: 'RAScore', SCScore: 'SCScore', Vendors: 'Vendors', ZincCatalogs: 'ZINC catalogs', Price: 'Price ($/g)',
  MW: 'MW', LogP: 'LogP', TPSA: 'TPSA', HBD: 'HBD', HBA: 'HBA', RotBonds: 'RotB', FrCSP3: 'Fsp³', QED: 'QED',
};
const labelFor = (k: string) => AXIS_LABELS[k] ?? k;

const FILTER_COLORS: Record<string, string> = {
  lipinski: '#22c55e',
  veber: '#22c55e',
  ghose: '#22c55e',
  leadlike: '#22c55e',
};

function ParetoView({ molecules, onSelectMolecule, selectedMolIdx, fdaData, customPropNames = [], paretoObjectives = [] }: { molecules: Molecule[]; onSelectMolecule?: (idx: number) => void; selectedMolIdx?: number | null; fdaData?: FDADrug[]; customPropNames?: string[]; paretoObjectives?: ParetoObjective[] }) {
  // Best-compromise ("knee") molecule across the active objectives — the one to pick.
  const knee = useMemo(() => findBestCompromise(molecules, paretoObjectives), [molecules, paretoObjectives]);
  // Deterministic "reading" of the front: size, objectives, sharpest trade-off.
  const reading = useMemo(() => readFront(molecules, paretoObjectives), [molecules, paretoObjectives]);
  // Analysis -> design: nearest structural analog that dominates the selected molecule.
  const designHint = useMemo(
    () => (selectedMolIdx != null ? nearestBetterAnalog(molecules, selectedMolIdx, paretoObjectives) : null),
    [molecules, selectedMolIdx, paretoObjectives],
  );
  const [axes, setAxes] = useState<ScatterAxes[]>(DEFAULT_AXES);
  const [showAll, setShowAll] = useState(true);
  const [activeFilter, setActiveFilter] = useState<string | null>('lipinski');
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const visibleAxes = showAll ? axes : axes.slice(0, 2);

  // Grouped, human-labelled axis options — make-ability & cost surfaced first,
  // then physicochemical, then any ADMET / imported columns that are present.
  const axisGroups = useMemo(() => {
    const has = (k: string) => customPropNames.includes(k);
    const makeCost = ['SC', ...(has('SA_Score') ? ['SA_Score'] : []), ...(has('RAScore') ? ['RAScore'] : []), ...(has('SCScore') ? ['SCScore'] : []), ...(has('Price') ? ['Price'] : []), ...(has('Vendors') ? ['Vendors'] : []), ...(has('ZincCatalogs') ? ['ZincCatalogs'] : [])];
    const other = customPropNames.filter(k => k !== 'SA_Score' && k !== 'RAScore' && k !== 'SCScore' && k !== 'Vendors' && k !== 'ZincCatalogs' && k !== 'Price');
    return [
      { label: 'Make-ability & cost', keys: makeCost },
      { label: 'Physicochemical', keys: PHYS_KEYS },
      ...(other.length ? [{ label: 'ADMET & data', keys: other }] : []),
    ];
  }, [customPropNames]);
  const renderAxisOptions = () => axisGroups.map(g => (
    <optgroup key={g.label} label={g.label}>
      {g.keys.map(k => <option key={k} value={k}>{labelFor(k)}</option>)}
    </optgroup>
  ));

  const handleAxisChange = (idx: number, xy: 'x' | 'y', val: string) => {
    setAxes(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [xy]: val };
      return next;
    });
  };

  const activeColor = activeFilter ? FILTER_COLORS[activeFilter] ?? '#22c55e' : '#22c55e';
  const activeLabel = activeFilter
    ? (DRUG_FILTERS[activeFilter as keyof typeof DRUG_FILTERS] as { label: string }).label
    : 'Filter';
  const allPass = activeFilter
    ? molecules.every(m => m.filters[activeFilter]?.pass ?? false)
    : false;

  return (
    <div className="space-y-4">
      {/* Filters — segmented control style (not action buttons) */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] text-[var(--text2)] py-1">Overlay:</span>
        <div className="flex items-center flex-wrap bg-[var(--surface2)] border border-[var(--border-5)] rounded-md overflow-hidden">
          <button
            onClick={() => setActiveFilter(null)}
            className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
              activeFilter === null
                ? 'bg-[var(--accent)]/15 text-[var(--accent)]'
                : 'text-[var(--text2)] hover:text-[var(--text)]'
            }`}
          >
            None
          </button>
          {Object.entries(DRUG_FILTERS).map(([fname, fdef]) => {
            const isActive = activeFilter === fname;
            const color = FILTER_COLORS[fname] ?? '#22c55e';
            return (
              <button
                key={fname}
                onClick={() => setActiveFilter(isActive ? null : fname)}
                title={(fdef as any).desc}
                className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  isActive
                    ? 'text-white'
                    : 'text-[var(--text2)] hover:text-[var(--text)]'
                }`}
                style={isActive ? { backgroundColor: color, color: '#fff' } : undefined}
              >
                {fdef.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-[12px] text-[var(--text2)] mb-4">
        {activeFilter && (
          <>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: activeColor }} /> {activeLabel} Pass
            </div>
            <div className="flex items-center gap-2">
              <span className="w-0 h-0 border-l-[6px] border-r-[6px] border-b-[10px] border-l-transparent border-r-transparent border-b-[#ef4444]" /> {activeLabel} Fail
            </div>
          </>
        )}
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full border-2 border-[#fbbf24] bg-transparent" /> Pareto-optimal
        </div>
        {fdaData && (
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#6b7280]" /> FDA reference ({fdaData.length})
          </div>
        )}
        {activeFilter && allPass && (
          <span className="text-[11px] text-[var(--text2)]/70 italic">All molecules pass {activeLabel}</span>
        )}
      </div>

      {/* Reading — a deterministic narration of the front */}
      {reading && (
        <p className="text-[12px] text-[var(--text2)] leading-relaxed">
          <span className="text-[var(--text-heading)] font-medium">{reading.paretoCount}</span> of {reading.total} compounds are Pareto-optimal across {reading.objectiveKeys.length} objective{reading.objectiveKeys.length === 1 ? '' : 's'} ({reading.objectiveKeys.map(labelFor).join(', ')}).
          {reading.tradeoff && <> Sharpest trade-off: <span className="text-[var(--text)]">{labelFor(reading.tradeoff.a)}</span> vs <span className="text-[var(--text)]">{labelFor(reading.tradeoff.b)}</span> <span className="text-[var(--text2)]/60">(r&nbsp;=&nbsp;{reading.tradeoff.r.toFixed(2)})</span>.</>}
        </p>
      )}

      {/* Best compromise (knee) — the Pareto-optimal molecule nearest the ideal */}
      {knee && molecules[knee.index] && (
        <button
          onClick={() => onSelectMolecule?.(knee.index)}
          title="The Pareto-optimal molecule closest to the ideal across all active objectives — click to select and locate it on the plots"
          className={`w-full flex items-center justify-between gap-3 text-left px-3 py-2 rounded-md border transition-colors ${
            selectedMolIdx === knee.index
              ? 'bg-[#5F7367]/10 border-[#5F7367]/40'
              : 'bg-[var(--surface)] border-[var(--border-5)] hover:border-[var(--accent)]'
          }`}
        >
          <span className="text-[12px] min-w-0 truncate">
            <span className="uppercase tracking-[1px] text-[10px] text-[var(--text2)]/70 mr-2">Best compromise</span>
            <span className="text-[var(--text-heading)] font-medium">{molecules[knee.index].name.replace(/_/g, ' ')}</span>
            <span className="text-[var(--text2)]"> — nearest the ideal across {knee.nObjectives} objective{knee.nObjectives === 1 ? '' : 's'}</span>
          </span>
          <span className="text-[11px] text-[var(--accent)] shrink-0">{selectedMolIdx === knee.index ? 'selected' : 'select'}</span>
        </button>
      )}

      {/* Analysis -> design: nearest better analog for a dominated selection */}
      {selectedMolIdx != null && molecules[selectedMolIdx] && designHint && molecules[designHint.index] && (
        <p className="text-[12px] text-[var(--text2)] leading-relaxed">
          To improve <span className="text-[var(--text-heading)] font-medium">{molecules[selectedMolIdx].name.replace(/_/g, ' ')}</span>: its nearest better analog is{' '}
          <button
            onClick={() => onSelectMolecule?.(designHint.index)}
            className="text-[var(--accent)] hover:underline font-medium"
          >
            {molecules[designHint.index].name.replace(/_/g, ' ')}
          </button>{' '}
          <span className="text-[var(--text2)]/70">(Tanimoto {designHint.tanimoto.toFixed(2)})</span> — it dominates the selection{designHint.betterOn.length > 0 && <>, better on <span className="text-[var(--text)]">{designHint.betterOn.map(labelFor).join(', ')}</span></>}.
        </p>
      )}

      {/* Grid */}
      <div className={`grid gap-4 ${expandedIdx !== null ? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-2'}`}>
        {visibleAxes.map((axis, i) => {
          if (expandedIdx !== null && expandedIdx !== i) return null;
          return (
          <div key={`${axis.x}-${axis.y}-${i}`} className={`bg-[var(--surface)] border border-[var(--border-5)] rounded-lg p-4 flex flex-col min-w-0 ${expandedIdx === i ? 'h-[560px]' : 'h-[380px]'}`}>
            <div className="flex justify-between items-center gap-2 mb-4 min-w-0">
              <div className="text-[13px] font-medium min-w-0 truncate shrink" title={`${labelFor(axis.x)} vs ${labelFor(axis.y)}`}>{labelFor(axis.x)} vs {labelFor(axis.y)}</div>
              <div className="flex gap-2 items-center text-[11px] shrink-0">
                <label className="flex items-center gap-1 text-[var(--text2)]">
                  X:
                  <select
                    value={axis.x as string}
                    onChange={e => handleAxisChange(i, 'x', e.target.value as any)}
                    className="bg-[var(--bg)] border border-[var(--border-10)] rounded px-1.5 py-0.5 outline-none text-[var(--text)] max-w-[120px] truncate"
                  >
                    {renderAxisOptions()}
                  </select>
                </label>
                <label className="flex items-center gap-1 text-[var(--text2)]">
                  Y:
                  <select
                    value={axis.y as string}
                    onChange={e => handleAxisChange(i, 'y', e.target.value as any)}
                    className="bg-[var(--bg)] border border-[var(--border-10)] rounded px-1.5 py-0.5 outline-none text-[var(--text)] max-w-[120px] truncate"
                  >
                    {renderAxisOptions()}
                  </select>
                </label>
                <button
                  onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                  className="ml-1 p-1 text-[var(--text2)] hover:text-[var(--text)] rounded hover:bg-[var(--border-5)] transition-colors"
                  title={expandedIdx === i ? 'Collapse' : 'Expand'}
                >
                  {expandedIdx === i ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                </button>
              </div>
            </div>
            <div className="flex-1 relative min-w-0 min-h-0">
               <ScatterChart key={`scatter-${axis.x}-${axis.y}-${i}-${expandedIdx}`} molecules={molecules} xKey={axis.x as string} yKey={axis.y as string} activeFilter={activeFilter} onSelectMolecule={onSelectMolecule} selectedMolIdx={selectedMolIdx} fdaData={fdaData} />
            </div>
          </div>
          );
        })}
      </div>

      <button
        onClick={() => setShowAll(!showAll)}
        className="text-[var(--text2)] text-[12px] underline hover:text-[var(--text)] mt-2 block mx-auto py-2"
      >
        {showAll ? 'Show fewer' : 'Show all 6 plots'}
      </button>
    </div>
  );
}

export default React.memo(ParetoView);

interface PointData {
  x: number;
  y: number;
  label: string;
  molIndex: number;
  paretoRank: number | null;
}

function buildAnnotations(xKey: string, yKey: string): Record<string, any> {
  const annotations: Record<string, any> = {};
  const xThresh = LIPINSKI_THRESHOLDS[xKey];
  const yThresh = LIPINSKI_THRESHOLDS[yKey];
  const isDark = document.documentElement.classList.contains('dark');
  const labelBg = isDark ? 'rgba(26,25,24,0.8)' : 'rgba(255,255,255,0.85)';
  const labelColor = isDark ? 'rgba(234, 179, 8, 0.5)' : 'rgba(180, 130, 0, 0.7)';
  if (xThresh) {
    annotations['xThreshold'] = {
      type: 'line',
      scaleID: 'x',
      value: xThresh.value,
      borderColor: isDark ? 'rgba(234, 179, 8, 0.3)' : 'rgba(180, 130, 0, 0.25)',
      borderWidth: 1,
      borderDash: [6, 4],
      label: {
        display: true,
        content: xThresh.label,
        position: 'end',
        color: labelColor,
        font: { size: 9 },
        backgroundColor: labelBg,
        padding: 3,
      },
    };
  }
  if (yThresh) {
    annotations['yThreshold'] = {
      type: 'line',
      scaleID: 'y',
      value: yThresh.value,
      borderColor: isDark ? 'rgba(234, 179, 8, 0.3)' : 'rgba(180, 130, 0, 0.25)',
      borderWidth: 1,
      borderDash: [6, 4],
      label: {
        display: true,
        content: yThresh.label,
        position: 'end',
        color: labelColor,
        font: { size: 9 },
        backgroundColor: labelBg,
        padding: 3,
      },
    };
  }
  return annotations;
}

/** Get value for a property key from either built-in props or customProps. */
function getMolPropValue(m: Molecule, key: string): number {
  if (key in m.props) return m.props[key as keyof Molecule['props']];
  return m.customProps?.[key] ?? 0;
}

function ScatterChart({ molecules, xKey, yKey, activeFilter, onSelectMolecule, selectedMolIdx, fdaData }: { molecules: Molecule[]; xKey: string; yKey: string; activeFilter: string | null; onSelectMolecule?: (idx: number) => void; selectedMolIdx?: number | null; fdaData?: FDADrug[] }) {
  useTheme(); // subscribe so CSS variables and annotations re-read on theme toggle
  const chartRef = useRef<any>(null);
  const selectedMolIdxRef = useRef(selectedMolIdx);
  selectedMolIdxRef.current = selectedMolIdx;
  const [isZoomed, setIsZoomed] = useState(false);
  const data = useMemo(() => {
    const passData: PointData[] = [];
    const failData: PointData[] = [];

    molecules.forEach((m, idx) => {
      const pt: PointData = {
        x: getMolPropValue(m, xKey),
        y: getMolPropValue(m, yKey),
        label: m.name,
        molIndex: idx,
        paretoRank: m.paretoRank,
      };
      if (activeFilter) {
        const pass = m.filters[activeFilter]?.pass ?? false;
        if (pass) passData.push(pt);
        else failData.push(pt);
      } else {
        passData.push(pt);
      }
    });

    // FDA reference dots
    const fdaXKey = PROP_TO_FDA[xKey as string];
    const fdaYKey = PROP_TO_FDA[yKey as string];
    const fdaPoints: { x: number; y: number; label: string; molIndex: number; paretoRank: null }[] = [];
    if (fdaData && fdaXKey && fdaYKey) {
      fdaData.forEach((drug, i) => {
        const xVal = drug[fdaXKey as keyof FDADrug] as number | undefined;
        const yVal = drug[fdaYKey as keyof FDADrug] as number | undefined;
        if (xVal != null && yVal != null) {
          fdaPoints.push({ x: xVal, y: yVal, label: drug.n, molIndex: -(i + 1), paretoRank: null });
        }
      });
    }

    return {
      datasets: [
        // FDA reference layer (drawn first = behind user molecules)
        ...(fdaPoints.length > 0
          ? [{
              label: 'FDA Reference',
              data: fdaPoints,
              backgroundColor: 'rgba(107,114,128,0.25)',
              borderColor: 'rgba(107,114,128,0.35)',
              borderWidth: 0.5,
              pointRadius: 4,
              pointHoverRadius: 5,
              pointStyle: 'circle' as const,
              order: 2,
            }]
          : []),
        {
          label: 'Pass',
          data: passData,
          backgroundColor: activeFilter ? 'rgba(34,197,94,0.7)' : 'rgba(120,143,129,0.7)',
          borderColor: 'transparent',
          pointRadius: 8,
          pointHoverRadius: 10,
          pointStyle: 'circle' as const,
          order: 1,
        },
        ...(failData.length > 0
          ? [
              {
                label: 'Fail',
                data: failData,
                backgroundColor: 'rgba(239,68,68,0.7)',
                borderColor: 'transparent',
                pointRadius: 8,
                pointHoverRadius: 10,
                pointStyle: 'triangle' as const,
                order: 1,
              },
            ]
          : []),
      ],
    };
  }, [molecules, xKey, yKey, activeFilter, fdaData]);

  const tooltipRef = useRef<HTMLDivElement>(null);

  // Force chart redraw when selection changes
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.update('none'); // 'none' = no animation
    }
  }, [selectedMolIdx]);

  // Custom plugin: gold ring for Pareto-optimal + teal pulse for selected
  // Uses ref so the plugin instance is stable but always reads latest selection
  const customPlugin = useMemo(() => ({
    id: 'paretoRing',
    afterDatasetsDraw(chart: any) {
      const ctx = chart.ctx as CanvasRenderingContext2D;
      const selIdx = selectedMolIdxRef.current;
      const { left, top, width, height } = chart.chartArea;
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, top, width, height);
      ctx.clip();

      for (let dsIdx = 0; dsIdx < chart.data.datasets.length; dsIdx++) {
        const meta = chart.getDatasetMeta(dsIdx);
        if (!meta.visible) continue;
        const dataset = chart.data.datasets[dsIdx];
        meta.data.forEach((element: any, idx: number) => {
          const raw = dataset.data[idx] as PointData | undefined;
          if (!raw) return;

          const ex = element.x as number;
          const ey = element.y as number;

          if (raw.paretoRank === 1) {
            ctx.beginPath();
            ctx.arc(ex, ey, 12, 0, Math.PI * 2);
            ctx.strokeStyle = '#fbbf24';
            ctx.lineWidth = 2.5;
            ctx.stroke();
          }

          if (selIdx != null && raw.molIndex === selIdx) {
            ctx.beginPath();
            ctx.arc(ex, ey, 15, 0, Math.PI * 2);
            ctx.strokeStyle = '#2dd4bf';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 3]);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        });
      }

      ctx.restore();
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  return (
    <div className="relative w-full h-full">
      <div
        ref={tooltipRef}
        id="pareto-tooltip"
        className="absolute z-10 pointer-events-none hidden md:block px-3 py-2 bg-[var(--bg)] border border-[var(--border-10)] rounded-lg shadow-xl text-left max-w-[220px]"
        style={{ opacity: 0 }}
      />
      {isZoomed && (
        <button
          onClick={() => { chartRef.current?.resetZoom(); setIsZoomed(false); }}
          className="absolute top-2 right-2 z-20 px-2 py-1 text-[10px] font-medium bg-[var(--surface2)] border border-[var(--border-10)] rounded text-[var(--text2)] hover:text-[var(--text)] hover:border-[var(--accent)] transition-colors"
        >
          Reset zoom
        </button>
      )}
      <Scatter
        ref={chartRef}
        key={`${xKey}-${yKey}`}
        data={data as any}
        plugins={[customPlugin]}
        options={{
          onClick: (_event: any, elements: any[]) => {
            if (elements.length > 0 && onSelectMolecule) {
              const el = elements[0];
              const raw = data.datasets[el.datasetIndex]?.data[el.index] as PointData | undefined;
              if (raw && raw.molIndex >= 0) onSelectMolecule(raw.molIndex);
            }
          },
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          resizeDelay: 0,
          onHover: (_event: any, elements: any[], chart: any) => {
            chart.canvas.style.cursor = elements.length > 0 ? 'pointer' : 'default';
          },
          plugins: {
            legend: { display: false },
            annotation: {
              annotations: buildAnnotations(xKey as string, yKey as string),
            },
            tooltip: {
              enabled: false,
              external(context: unknown) {
                const ctx = context as { tooltip: { opacity: number; caretX?: number; caretY?: number; dataPoints?: Array<{ raw?: { label?: string; molIndex?: number } }> }; chart: { canvas: HTMLCanvasElement } };
                const el = tooltipRef.current;
                if (!el) return;
                if (ctx.tooltip.opacity === 0) {
                  el.style.opacity = '0';
                  el.style.visibility = 'hidden';
                  return;
                }
                const dp = ctx.tooltip.dataPoints?.[0];
                const raw = dp?.raw as { label?: string; molIndex?: number } | undefined;
                const molIndex = raw?.molIndex ?? -1;
                const m = molIndex >= 0 && molIndex < molecules.length ? molecules[molIndex] : null;
                const { offsetLeft: posX, offsetTop: posY } = ctx.chart.canvas;
                const caretX = ctx.tooltip.caretX ?? 0;
                const caretY = ctx.tooltip.caretY ?? 0;
                if (m) {
                  const svgDataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(getMolSvg(m.smiles))));
                  el.innerHTML = `
                    <div class="text-[12px]">
                      <div class="font-semibold text-[var(--text-heading)] mb-1">${(m.name || '').replace(/</g, '&lt;')}</div>
                      <div class="text-[var(--text2)] mb-2">${xKey}: ${getMolPropValue(m, xKey).toFixed(2)} &middot; ${yKey}: ${getMolPropValue(m, yKey).toFixed(2)}</div>
                      <img src="${svgDataUrl}" alt="" class="w-24 h-[72px] object-contain bg-[var(--bg-deep)] rounded" />
                    </div>
                  `;
                  el.style.left = posX + caretX + 10 + 'px';
                  el.style.top = posY + caretY - 10 + 'px';
                } else if (raw && (raw.molIndex as number) < 0) {
                  // FDA reference dot
                  el.innerHTML = `
                    <div class="text-[12px]">
                      <div class="font-semibold text-[var(--text2)] mb-0.5">${(raw.label || '').replace(/</g, '&lt;')}</div>
                      <div class="text-[#6b7280] text-[10px]">FDA reference</div>
                    </div>
                  `;
                  el.style.left = posX + caretX + 10 + 'px';
                  el.style.top = posY + caretY - 10 + 'px';
                } else {
                  el.innerHTML = `<div class="text-[12px] text-[var(--text)]">${(raw?.label || '').replace(/</g, '&lt;')}</div>`;
                  el.style.left = posX + caretX + 10 + 'px';
                  el.style.top = posY + caretY - 10 + 'px';
                }
                el.style.visibility = 'visible';
                el.style.opacity = '1';
              },
            },
            zoom: {
              pan: {
                enabled: true,
                mode: 'xy' as const,
                onPan: () => setIsZoomed(true),
              },
              zoom: {
                wheel: { enabled: true },
                pinch: { enabled: true },
                mode: 'xy' as const,
                onZoom: () => setIsZoomed(true),
              },
            },
          },
          layout: {
            padding: { left: 5, right: 15, top: 15, bottom: 5 },
          },
          scales: {
            x: {
              title: { display: true, text: labelFor(xKey), color: getComputedStyle(document.documentElement).getPropertyValue('--canvas-sublabel').trim() },
              grid: { color: getComputedStyle(document.documentElement).getPropertyValue('--border-10').trim() },
              ticks: { color: getComputedStyle(document.documentElement).getPropertyValue('--canvas-sublabel').trim() },
              ...((() => {
                const vals = molecules.map(m => getMolPropValue(m, xKey));
                const fdaXKey = PROP_TO_FDA[xKey as string];
                if (fdaData && fdaXKey) {
                  fdaData.forEach(d => { const v = d[fdaXKey as keyof FDADrug]; if (typeof v === 'number') vals.push(v); });
                }
                if (vals.length === 0) return {};
                const min = Math.min(...vals);
                const max = Math.max(...vals);
                const pad = (max - min) * 0.15 || 1;
                return { min: min - pad, max: max + pad };
              })()),
            },
            y: {
              title: { display: true, text: labelFor(yKey), color: getComputedStyle(document.documentElement).getPropertyValue('--canvas-sublabel').trim() },
              grid: { color: getComputedStyle(document.documentElement).getPropertyValue('--border-10').trim() },
              ticks: { color: getComputedStyle(document.documentElement).getPropertyValue('--canvas-sublabel').trim() },
              ...((() => {
                const vals = molecules.map(m => getMolPropValue(m, yKey));
                const fdaYKey = PROP_TO_FDA[yKey as string];
                if (fdaData && fdaYKey) {
                  fdaData.forEach(d => { const v = d[fdaYKey as keyof FDADrug]; if (typeof v === 'number') vals.push(v); });
                }
                if (vals.length === 0) return {};
                const min = Math.min(...vals);
                const max = Math.max(...vals);
                const pad = (max - min) * 0.15 || 1;
                return { min: min - pad, max: max + pad };
              })()),
            }
          }
        }}
      />
    </div>
  );
}

