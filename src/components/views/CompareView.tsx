import React, { useRef, useEffect } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { Bar } from 'react-chartjs-2';
import type { Molecule } from '../../utils/types';
import { DRUG_FILTERS } from '../../utils/types';
import { getMolSvg } from '../../utils/chem';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
);

interface CompareProps {
  molecules: Molecule[];
  compareIndices: number[];
  setCompareIndices?: React.Dispatch<React.SetStateAction<number[]>>;
}

// ---------------------------------------------------------------------------
// Property Delta canvas bar chart
// ---------------------------------------------------------------------------

interface DeltaRow {
  label: string;
  /** raw values for A and B */
  valA: number;
  valB: number;
  /** 'min' = lower is better, 'max' = higher is better, null = neutral */
  direction: 'min' | 'max' | null;
  unit: string;
}

interface PropertyDeltaChartProps {
  rows: DeltaRow[];
  nameA: string;
  nameB: string;
}

const ROW_H = 22;
const LABEL_W = 110;
const BAR_AREA = 200; // px for each side (A and B)
const VALUE_W = 64;
const PADDING_V = 6;

const PropertyDeltaChart = React.memo(function PropertyDeltaChart({ rows, nameA, nameB }: PropertyDeltaChartProps) {
  const { themeVersion } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const totalH = rows.length * ROW_H + 24 + PADDING_V * 2; // 24 for header
  const totalW = LABEL_W + BAR_AREA * 2 + VALUE_W * 2 + 4;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = totalW * dpr;
    canvas.height = totalH * dpr;
    canvas.style.width = `${totalW}px`;
    canvas.style.height = `${totalH}px`;
    ctx.scale(dpr, dpr);
    const isDark = document.documentElement.classList.contains('dark');

    ctx.clearRect(0, 0, totalW, totalH);

    // Header
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(20,184,166,0.9)';
    ctx.fillText(nameA, LABEL_W + BAR_AREA - 2, 14);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(6,182,212,0.9)';
    ctx.fillText(nameB, LABEL_W + BAR_AREA + 4, 14);
    // centre label header
    ctx.textAlign = 'center';
    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)';
    ctx.fillText('Property', LABEL_W / 2, 14);

    // Centre divider
    const divX = LABEL_W + BAR_AREA;

    rows.forEach((row, i) => {
      const y = 24 + PADDING_V + i * ROW_H;
      const midY = y + ROW_H / 2;

      // Row bg
      if (i % 2 === 0) {
        ctx.fillStyle = isDark ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.03)';
        ctx.fillRect(0, y, totalW, ROW_H);
      }

      // Property label
      ctx.textAlign = 'center';
      ctx.font = '10px sans-serif';
      ctx.fillStyle = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)';
      ctx.fillText(row.label, LABEL_W / 2, midY + 3.5);

      const absA = Math.abs(row.valA);
      const absB = Math.abs(row.valB);
      const maxVal = Math.max(absA, absB, 1e-6);

      const pctA = Math.min(absA / maxVal, 1);
      const pctB = Math.min(absB / maxVal, 1);
      const barH = ROW_H * 0.45;

      // Determine winner
      let winnerA = false;
      let winnerB = false;
      if (row.direction === 'min') {
        winnerA = row.valA < row.valB;
        winnerB = row.valB < row.valA;
      } else if (row.direction === 'max') {
        winnerA = row.valA > row.valB;
        winnerB = row.valB > row.valA;
      }

      const colorA = winnerA ? '#22c55e' : winnerB ? '#ef4444' : 'rgba(20,184,166,0.6)';
      const colorB = winnerB ? '#22c55e' : winnerA ? '#ef4444' : 'rgba(6,182,212,0.6)';

      // Bar A: draws right-to-left from divX
      const barAW = pctA * (BAR_AREA - 4);
      ctx.fillStyle = colorA + (winnerA ? '' : '99');
      ctx.beginPath();
      ctx.roundRect
        ? ctx.roundRect(divX - barAW - 2, midY - barH / 2, barAW, barH, 2)
        : ctx.rect(divX - barAW - 2, midY - barH / 2, barAW, barH);
      ctx.fill();

      // Bar B: draws left-to-right from divX
      const barBW = pctB * (BAR_AREA - 4);
      ctx.fillStyle = colorB + (winnerB ? '' : '99');
      ctx.beginPath();
      ctx.roundRect
        ? ctx.roundRect(divX + 2, midY - barH / 2, barBW, barH, 2)
        : ctx.rect(divX + 2, midY - barH / 2, barBW, barH);
      ctx.fill();

      // Value labels
      const fmt = (v: number) => {
        if (Math.abs(v) >= 1000) return v.toFixed(0);
        if (Math.abs(v) >= 10) return v.toFixed(1);
        return v.toFixed(2);
      };
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.fillStyle = winnerA ? '#22c55e' : (isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)');
      ctx.fillText(fmt(row.valA) + (row.unit ? ' ' + row.unit : ''), divX - barAW - 6, midY + 3.5);

      ctx.textAlign = 'left';
      ctx.fillStyle = winnerB ? '#22c55e' : (isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)');
      ctx.fillText(fmt(row.valB) + (row.unit ? ' ' + row.unit : ''), divX + barBW + 6, midY + 3.5);
    });

    // Centre line
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(divX, 20);
    ctx.lineTo(divX, totalH);
    ctx.stroke();
  }, [rows, nameA, nameB, totalH, totalW, themeVersion]);

  return (
    <canvas
      ref={canvasRef}
      style={{ display: 'block', width: '100%', maxWidth: totalW }}
    />
  );
});

const COMPARE_PROPS = [
  { key: 'MW', label: 'Molecular Weight', unit: 'Da', ideal: 'lower', idealRange: [0, 500] },
  { key: 'LogP', label: 'cLogP', unit: '', ideal: 'range', idealRange: [0, 5] },
  { key: 'HBD', label: 'H-Bond Donors', unit: '', ideal: 'lower', idealRange: [0, 5] },
  { key: 'HBA', label: 'H-Bond Acceptors', unit: '', ideal: 'lower', idealRange: [0, 10] },
  { key: 'TPSA', label: 'TPSA', unit: 'Å²', ideal: 'range', idealRange: [20, 140] },
  { key: 'RotBonds', label: 'Rotatable Bonds', unit: '', ideal: 'lower', idealRange: [0, 10] },
  { key: 'FrCSP3', label: 'Fraction Csp3', unit: '', ideal: 'higher', idealRange: [0, 1] },
  { key: 'HeavyAtoms', label: 'Heavy Atoms', unit: '', ideal: 'lower', idealRange: [0, 50] },
  { key: 'MR', label: 'Molar Refractivity', unit: '', ideal: 'range', idealRange: [40, 130] },
];

function getWinner(prop: typeof COMPARE_PROPS[0], v1: number, v2: number) {
  if (prop.ideal === 'lower') return v1 < v2 ? 1 : v1 > v2 ? 2 : 0;
  if (prop.ideal === 'higher') return v1 > v2 ? 1 : v1 < v2 ? 2 : 0;
  if (prop.ideal === 'range') {
    const [lo, hi] = prop.idealRange;
    const d1 = (v1 >= lo && v1 <= hi) ? 0 : Math.min(Math.abs(v1 - lo), Math.abs(v1 - hi));
    const d2 = (v2 >= lo && v2 <= hi) ? 0 : Math.min(Math.abs(v2 - lo), Math.abs(v2 - hi));
    return d1 < d2 ? 1 : d1 > d2 ? 2 : 0;
  }
  return 0;
}

function CompareView({ molecules, compareIndices, setCompareIndices }: CompareProps) {
  useTheme(); // subscribe to theme changes for child canvas redraws
  const cs = getComputedStyle(document.documentElement);
  const chartText2 = cs.getPropertyValue('--text2').trim() || '#888888';
  const chartGrid = cs.getPropertyValue('--border-10').trim() || 'rgba(0,0,0,0.1)';
  const needsSelection = !compareIndices || compareIndices.length < 2 || !molecules[compareIndices[0]] || !molecules[compareIndices[1]];

  if (needsSelection) {
    const idx0 = compareIndices?.[0] ?? -1;
    const idx1 = compareIndices?.[1] ?? -1;
    return (
      <div className="bg-[var(--surface)] border border-[var(--border-5)] rounded-lg p-8">
        <h3 className="text-[17px] font-medium text-[var(--text-heading)] mb-2">Select 2 molecules to compare</h3>
        <p className="text-[var(--text2)] text-[13px] mb-6">
          Pick from dropdowns below, or right-click two molecule cards in the sidebar.
        </p>
        <div className="flex gap-4 items-end">
          <label className="flex-1">
            <span className="text-[11px] text-[var(--text2)] uppercase tracking-wider">Molecule A</span>
            <select
              value={idx0}
              onChange={e => setCompareIndices?.(prev => [parseInt(e.target.value), prev[1] ?? -1])}
              className="w-full mt-1 bg-[var(--bg)] border border-[var(--border-10)] rounded px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
            >
              <option value={-1}>Select...</option>
              {molecules.map((m, i) => <option key={i} value={i}>{m.name}</option>)}
            </select>
          </label>
          <span className="text-[var(--text2)] text-[16px] pb-2">vs</span>
          <label className="flex-1">
            <span className="text-[11px] text-[var(--text2)] uppercase tracking-wider">Molecule B</span>
            <select
              value={idx1}
              onChange={e => setCompareIndices?.(prev => [prev[0] ?? -1, parseInt(e.target.value)])}
              className="w-full mt-1 bg-[var(--bg)] border border-[var(--border-10)] rounded px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
            >
              <option value={-1}>Select...</option>
              {molecules.map((m, i) => <option key={i} value={i}>{m.name}</option>)}
            </select>
          </label>
        </div>
      </div>
    );
  }

  const m1 = molecules[compareIndices[0]];
  const m2 = molecules[compareIndices[1]];
  let m1Wins = 0, m2Wins = 0, ties = 0;
  COMPARE_PROPS.forEach(p => {
    const w = getWinner(p, m1.props[p.key as keyof Molecule['props']] as number, m2.props[p.key as keyof Molecule['props']] as number);
    if (w === 1) m1Wins++;
    else if (w === 2) m2Wins++;
    else ties++;
  });

  // Build delta rows: standard props + ADMET custom props
  const deltaRows: DeltaRow[] = COMPARE_PROPS.map(p => ({
    label: p.label,
    valA: m1.props[p.key as keyof Molecule['props']] as number,
    valB: m2.props[p.key as keyof Molecule['props']] as number,
    direction: p.ideal === 'lower' ? 'min' : p.ideal === 'higher' ? 'max' : null,
    unit: p.unit,
  }));

  // ADMET custom props — include if both molecules have them
  const customKeys = Object.keys(m1.customProps ?? {}).filter(k => {
    const v1 = m1.customProps?.[k];
    const v2 = m2.customProps?.[k];
    return typeof v1 === 'number' && typeof v2 === 'number' && isFinite(v1) && isFinite(v2);
  });
  for (const key of customKeys) {
    deltaRows.push({
      label: key.length > 14 ? key.slice(0, 12) + '…' : key,
      valA: m1.customProps[key],
      valB: m2.customProps[key],
      direction: null,
      unit: '',
    });
  }

  const chartData = {
    labels: COMPARE_PROPS.map(p => p.label),
    datasets: [
      {
        label: m1.name,
        data: COMPARE_PROPS.map(p => m1.props[p.key as keyof Molecule['props']] as number),
        backgroundColor: 'rgba(20, 184, 166, 0.7)', // #14b8a6
        borderColor: '#14b8a6',
        borderWidth: 1,
      },
      {
        label: m2.name,
        data: COMPARE_PROPS.map(p => m2.props[p.key as keyof Molecule['props']] as number),
        backgroundColor: 'rgba(6, 182, 212, 0.7)', // #06b6d4
        borderColor: '#06b6d4',
        borderWidth: 1,
      },
    ]
  };

  return (
    <div className="bg-[var(--surface)] border border-[var(--border-5)] rounded-lg p-5">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h3 className="text-[14px] font-medium text-[var(--text-heading)]">Molecule Comparison</h3>
          <p className="text-[12px] text-[var(--text2)]">{m1.name} vs {m2.name}</p>
        </div>
        {setCompareIndices && (
          <button
            type="button"
            onClick={() => setCompareIndices(prev => [prev[1], prev[0]])}
            className="px-3 py-1.5 text-[11px] bg-[var(--surface2)] border border-[var(--border-5)] rounded text-[var(--text2)] hover:text-[var(--text)] hover:border-[var(--accent)] transition-colors"
            title="Swap A and B"
          >
            ⇄ Swap
          </button>
        )}
      </div>

      {/* Score summary */}
      <div className="flex justify-center gap-12 mb-8 p-4 bg-[var(--bg)] rounded-md border border-[var(--border-5)]">
        <div className="text-center">
          <div className="text-3xl font-bold text-[#14b8a6]">{m1Wins}</div>
          <div className="text-[11px] text-[var(--text2)] mt-1">{m1.name} wins</div>
        </div>
        <div className="text-center">
          <div className="text-3xl font-bold text-[var(--text2)]">{ties}</div>
          <div className="text-[11px] text-[var(--text2)] mt-1">ties</div>
        </div>
        <div className="text-center">
          <div className="text-3xl font-bold text-[#06b6d4]">{m2Wins}</div>
          <div className="text-[11px] text-[var(--text2)] mt-1">{m2.name} wins</div>
        </div>
      </div>

      {/* Structures */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="text-center p-3 bg-[var(--bg)] rounded-lg border-2 border-[#14b8a6]/30">
          <div className="flex justify-center h-[120px] items-center [&>svg]:max-h-full" dangerouslySetInnerHTML={{ __html: getMolSvg(m1.smiles) }} />
          <div className="font-semibold text-[var(--text-heading)] mt-2 text-[13px]">{m1.name}</div>
          <div className="text-[10px] text-[var(--text2)] font-mono mt-1 break-all px-2">{m1.smiles}</div>
        </div>
        <div className="text-center p-3 bg-[var(--bg)] rounded-lg border-2 border-[#06b6d4]/30">
          <div className="flex justify-center h-[120px] items-center [&>svg]:max-h-full" dangerouslySetInnerHTML={{ __html: getMolSvg(m2.smiles) }} />
          <div className="font-semibold text-[var(--text-heading)] mt-2 text-[13px]">{m2.name}</div>
          <div className="text-[10px] text-[var(--text2)] font-mono mt-1 break-all px-2">{m2.smiles}</div>
        </div>
      </div>

      {/* Property comparison bars */}
      <div className="mb-8 overflow-hidden">
        <div className="grid grid-cols-[80px_1fr_120px_1fr_80px] gap-1 mb-2 text-[10px] text-[var(--text2)] uppercase tracking-wide">
          <div className="text-right truncate pr-2">{m1.name}</div>
          <div></div>
          <div className="text-center">Property</div>
          <div></div>
          <div className="truncate pl-2">{m2.name}</div>
        </div>
        
        <div className="space-y-1">
          {COMPARE_PROPS.map(p => {
            const v1 = m1.props[p.key as keyof Molecule['props']] as number;
            const v2 = m2.props[p.key as keyof Molecule['props']] as number;
            const maxVal = Math.max(Math.abs(v1), Math.abs(v2), p.idealRange[1]) || 1;
            const pct1 = Math.min(Math.abs(v1) / maxVal * 100, 100);
            const pct2 = Math.min(Math.abs(v2) / maxVal * 100, 100);
            const winner = getWinner(p, v1, v2);
            const fmt = p.key === 'FrCSP3' ? 3 : 1;

            return (
              <div key={p.key} className="grid grid-cols-[80px_1fr_120px_1fr_80px] gap-1 items-center bg-[var(--bg)]/50 py-1 hover:bg-[var(--bg)]">
                <div className={`text-right font-mono text-[12px] pr-2 ${winner === 1 ? 'text-[#22c55e] font-semibold' : 'text-[var(--text)]'}`}>
                  {v1.toFixed(fmt)}
                </div>
                <div className="relative h-4 flex justify-end items-center mr-2">
                  <div className={`h-2 rounded-l-sm transition-all ${winner === 1 ? 'bg-[#22c55e]' : 'bg-[#14b8a6]/80'}`} style={{ width: `${pct1}%` }} />
                </div>
                <div className="text-center text-[12px] text-[var(--text2)] truncate px-1">{p.label}</div>
                <div className="relative h-4 flex justify-start items-center ml-2">
                  <div className={`h-2 rounded-r-sm transition-all ${winner === 2 ? 'bg-[#22c55e]' : 'bg-[#06b6d4]/80'}`} style={{ width: `${pct2}%` }} />
                </div>
                <div className={`text-left font-mono text-[12px] pl-2 ${winner === 2 ? 'text-[#22c55e] font-semibold' : 'text-[var(--text)]'}`}>
                  {v2.toFixed(fmt)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Property Delta Chart */}
      <div className="mb-8">
        <div className="text-[13px] font-semibold text-[var(--text-heading)] mb-3">Property Delta</div>
        <div className="bg-[var(--bg)] border border-[var(--border-5)] rounded-lg p-3 overflow-x-auto">
          <PropertyDeltaChart rows={deltaRows} nameA={m1.name} nameB={m2.name} />
          <div className="mt-2 flex gap-4 text-[10px] text-[var(--text2)] justify-center">
            <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#22c55e]" />wins this property</span>
            <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#ef4444]" />loses this property</span>
          </div>
        </div>
      </div>

      {/* Bar chart comparison */}
      <div className="h-[300px] mb-8">
        <Bar 
          data={chartData} 
          options={{
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { labels: { color: chartText2, font: { size: 11 } } },
            },
            scales: {
              x: {
                ticks: { color: chartText2, font: { size: 10 }, maxRotation: 45 },
                grid: { color: chartGrid },
              },
              y: {
                ticks: { color: chartText2 },
                grid: { color: chartGrid },
              },
            },
          }}
        />
      </div>

      {/* Verdict */}
      <div className="mb-8 p-3 bg-[var(--bg)] border border-[var(--border-5)] rounded-lg flex items-center justify-between text-[13px]">
        <span className="text-[#14b8a6] font-medium">{m1.name}: {m1Wins} win{m1Wins !== 1 ? 's' : ''}</span>
        <span className="text-[var(--text2)]">{ties > 0 ? `${ties} tie${ties > 1 ? 's' : ''}` : ''}</span>
        <span className="text-[#06b6d4] font-medium">{m2.name}: {m2Wins} win{m2Wins !== 1 ? 's' : ''}</span>
      </div>

      {/* Filter comparison */}
      <div>
        <div className="text-[13px] font-semibold text-[var(--text-heading)] mb-3">Drug-likeness Filters</div>
        <div className="bg-[var(--bg)] rounded border border-[var(--border-5)] divide-y divide-white/5">
          {Object.entries(DRUG_FILTERS).map(([fname, fdef]) => {
            const r1 = m1.filters[fname];
            const r2 = m2.filters[fname];
            return (
              <div key={fname} className="flex justify-between items-center px-4 py-2.5 text-[12px]">
                <span className={`w-24 text-right ${r1?.pass ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
                  {r1?.pass ? 'Pass' : `Fail (${r1?.violations})`}
                </span>
                <span className="text-[var(--text2)] truncate px-4">{(fdef as any).label}</span>
                <span className={`w-24 text-left ${r2?.pass ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
                  {r2?.pass ? 'Pass' : `Fail (${r2?.violations})`}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default React.memo(CompareView);
