import React, { useEffect, useRef, useMemo } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import type { Molecule } from '../../utils/types';

interface CorrelationViewProps {
  molecules: Molecule[];
  customPropNames?: string[];
}

const COMPUTED_PROPS = ['MW', 'LogP', 'HBD', 'HBA', 'TPSA', 'RotBonds', 'FrCSP3', 'Rings', 'AromaticRings', 'HeavyAtoms', 'MR'] as const;

/** Pearson correlation between two numeric arrays */
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += ys[i];
    sumXY += xs[i] * ys[i];
    sumX2 += xs[i] * xs[i];
    sumY2 += ys[i] * ys[i];
  }
  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  return den === 0 ? 0 : num / den;
}

/** Map r ∈ [-1, 1] → RGB color (blue → white → red) */
function correlationColor(r: number): string {
  // clamp
  r = Math.max(-1, Math.min(1, r));
  if (r >= 0) {
    // white → red
    const t = r;
    const red = 220;
    const g = Math.round(255 - t * (255 - 80));
    const b = Math.round(255 - t * (255 - 80));
    return `rgb(${red},${g},${b})`;
  } else {
    // white → blue
    const t = -r;
    const r2 = Math.round(255 - t * (255 - 59));
    const g = Math.round(255 - t * (255 - 130));
    const blue = 246;
    return `rgb(${r2},${g},${blue})`;
  }
}

function CorrelationView({ molecules, customPropNames = [] }: CorrelationViewProps) {
  const { themeVersion } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Build property keys: computed + custom (deduplicated)
  const propKeys = useMemo<string[]>(() => {
    const keys: string[] = [...COMPUTED_PROPS];
    for (const k of customPropNames) {
      if (!keys.includes(k)) keys.push(k);
    }
    return keys;
  }, [customPropNames]);

  // Extract numeric series per property
  const series = useMemo<Map<string, number[]>>(() => {
    const map = new Map<string, number[]>();
    for (const key of propKeys) {
      const vals: number[] = [];
      for (const m of molecules) {
        const v = (m.props as unknown as Record<string, number>)[key] ?? m.customProps?.[key];
        if (typeof v === 'number' && isFinite(v)) vals.push(v);
        else vals.push(NaN);
      }
      map.set(key, vals);
    }
    return map;
  }, [molecules, propKeys]);

  // Compute full correlation matrix
  const corrMatrix = useMemo<number[][]>(() => {
    const n = propKeys.length;
    const mat: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      const xs = series.get(propKeys[i])!;
      for (let j = i; j < n; j++) {
        const ys = series.get(propKeys[j])!;
        // Filter out NaN pairs
        const filtered: [number, number][] = [];
        for (let k = 0; k < xs.length; k++) {
          if (!isNaN(xs[k]) && !isNaN(ys[k])) filtered.push([xs[k], ys[k]]);
        }
        const r = i === j ? 1 : pearson(filtered.map(p => p[0]), filtered.map(p => p[1]));
        mat[i][j] = r;
        mat[j][i] = r;
      }
    }
    return mat;
  }, [propKeys, series]);

  // Top correlations and anti-correlations
  const topPairs = useMemo(() => {
    const pairs: { i: number; j: number; r: number }[] = [];
    for (let i = 0; i < propKeys.length; i++) {
      for (let j = i + 1; j < propKeys.length; j++) {
        pairs.push({ i, j, r: corrMatrix[i][j] });
      }
    }
    pairs.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
    const top5Pos = pairs.filter(p => p.r > 0).slice(0, 5);
    const top5Neg = pairs.filter(p => p.r < 0).slice(0, 5);
    return { top5Pos, top5Neg };
  }, [corrMatrix, propKeys]);

  // Draw heatmap
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;
    const n = propKeys.length;
    if (n === 0) return;

    const canvas = canvasRef.current;
    const rect = containerRef.current.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(rect.width, 200);
    const PAD_LEFT = Math.min(80, W * 0.18);
    const PAD_TOP = 8;
    const PAD_RIGHT = 8;
    const cellSize = Math.max(20, Math.min(52, (W - PAD_LEFT - PAD_RIGHT) / n));
    const H = n * cellSize + PAD_TOP + 4;

    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const cs = getComputedStyle(document.documentElement);
    const bgColor = cs.getPropertyValue('--bg').trim() || '#1a1a1a';
    const textColor = cs.getPropertyValue('--text').trim() || '#e8e6e3';
    const text2Color = cs.getPropertyValue('--text2').trim() || '#999';

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, W, H);

    const labelFontSize = Math.max(8, Math.min(11, cellSize * 0.28));

    // Row labels (left side)
    ctx.fillStyle = text2Color;
    ctx.font = `${labelFontSize}px sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < n; i++) {
      ctx.fillText(
        propKeys[i],
        PAD_LEFT - 4,
        PAD_TOP + i * cellSize + cellSize / 2
      );
    }

    // Draw cells
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const r = corrMatrix[i][j];
        ctx.fillStyle = correlationColor(r);
        ctx.fillRect(
          PAD_LEFT + j * cellSize,
          PAD_TOP + i * cellSize,
          cellSize - 1,
          cellSize - 1
        );

        // Value text inside cell if big enough
        if (cellSize >= 28) {
          const fontSize = Math.max(7, cellSize * 0.20);
          ctx.font = `${fontSize}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          // Use dark text on light cells, light on dark cells
          const absR = Math.abs(r);
          ctx.fillStyle = absR > 0.5 ? 'rgba(0,0,0,0.75)' : textColor;
          ctx.fillText(
            r === 1 ? '1.0' : r.toFixed(2),
            PAD_LEFT + j * cellSize + cellSize / 2,
            PAD_TOP + i * cellSize + cellSize / 2
          );
          // Reset for labels
          ctx.font = `${labelFontSize}px sans-serif`;
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
        }
      }
    }

    // Column labels (top, rotated)
    if (cellSize >= 24) {
      const colLabelFontSize = Math.max(8, Math.min(11, cellSize * 0.28));
      ctx.save();
      ctx.font = `${colLabelFontSize}px sans-serif`;
      ctx.fillStyle = text2Color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (let j = 0; j < n; j++) {
        const cx = PAD_LEFT + j * cellSize + cellSize / 2;
        ctx.save();
        ctx.translate(cx, PAD_TOP - 2);
        ctx.rotate(-Math.PI / 4);
        ctx.fillText(propKeys[j], 0, 0);
        ctx.restore();
      }
      ctx.restore();
    }
  }, [propKeys, corrMatrix, themeVersion]);

  if (molecules.length < 2) {
    return (
      <div className="flex items-center justify-center h-40 text-[13px] text-[var(--text2)]">
        Load at least 2 molecules to compute correlations.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Heatmap card */}
      <div className="bg-[var(--surface)] border border-[var(--border-5)] rounded-lg p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[14px] font-medium text-[var(--text-heading)]">Property Correlation Matrix</h3>
          <span className="text-[12px] text-[var(--text2)]">
            {molecules.length} molecules · {propKeys.length} properties
          </span>
        </div>

        {/* Color legend */}
        <div className="flex items-center gap-3 mb-4 text-[11px] text-[var(--text2)]">
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded-sm" style={{ background: correlationColor(-1) }} />
            <span>−1 (anti-corr.)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded-sm" style={{ background: 'rgb(255,255,255)', border: '1px solid var(--border-10)' }} />
            <span>0 (independent)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded-sm" style={{ background: correlationColor(1) }} />
            <span>+1 (correlated)</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div
            ref={containerRef}
            style={{ width: '100%', minWidth: `${propKeys.length * 20 + 100}px` }}
          >
            <canvas ref={canvasRef} className="block" />
          </div>
        </div>
      </div>

      {/* Top correlations */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Strongest positive correlations */}
        <div className="bg-[var(--surface)] border border-[var(--border-5)] rounded-lg p-4">
          <h4 className="text-[13px] font-medium text-[var(--text-heading)] mb-3">
            Top 5 Correlations
          </h4>
          {topPairs.top5Pos.length === 0 ? (
            <p className="text-[12px] text-[var(--text2)]">No positive correlations found.</p>
          ) : (
            <div className="space-y-2">
              {topPairs.top5Pos.map((p, idx) => (
                <div key={idx} className="flex items-center justify-between">
                  <span className="text-[12px] text-[var(--text2)]">
                    <span className="text-[var(--text)]">{propKeys[p.i]}</span>
                    {' × '}
                    <span className="text-[var(--text)]">{propKeys[p.j]}</span>
                  </span>
                  <span
                    className="text-[12px] font-mono font-medium px-2 py-0.5 rounded"
                    style={{
                      background: correlationColor(p.r) + '30',
                      color: p.r > 0.3 ? 'rgb(220,80,80)' : 'var(--text2)',
                    }}
                  >
                    +{p.r.toFixed(3)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Strongest negative correlations */}
        <div className="bg-[var(--surface)] border border-[var(--border-5)] rounded-lg p-4">
          <h4 className="text-[13px] font-medium text-[var(--text-heading)] mb-3">
            Top 5 Anti-Correlations
          </h4>
          {topPairs.top5Neg.length === 0 ? (
            <p className="text-[12px] text-[var(--text2)]">No negative correlations found.</p>
          ) : (
            <div className="space-y-2">
              {topPairs.top5Neg.map((p, idx) => (
                <div key={idx} className="flex items-center justify-between">
                  <span className="text-[12px] text-[var(--text2)]">
                    <span className="text-[var(--text)]">{propKeys[p.i]}</span>
                    {' × '}
                    <span className="text-[var(--text)]">{propKeys[p.j]}</span>
                  </span>
                  <span
                    className="text-[12px] font-mono font-medium px-2 py-0.5 rounded"
                    style={{
                      background: correlationColor(p.r) + '30',
                      color: p.r < -0.3 ? 'rgb(59,130,246)' : 'var(--text2)',
                    }}
                  >
                    {p.r.toFixed(3)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Interpretation guide */}
      <div className="bg-[var(--surface)] border border-[var(--border-5)] rounded-lg p-4">
        <h4 className="text-[13px] font-medium text-[var(--text-heading)] mb-2">How to read this</h4>
        <ul className="space-y-1 text-[12px] text-[var(--text2)]">
          <li className="flex items-start gap-2">
            <span className="text-[#ef4444] mt-0.5 shrink-0">›</span>
            <span><strong className="text-[var(--text)]">r &gt; 0.7 (strong red)</strong> — redundant objectives. Including both in Pareto adds little extra information.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-[#3b82f6] mt-0.5 shrink-0">›</span>
            <span><strong className="text-[var(--text)]">r &lt; −0.7 (strong blue)</strong> — trade-off objectives. Optimizing one inherently penalizes the other.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-[var(--text2)] mt-0.5 shrink-0">›</span>
            <span><strong className="text-[var(--text)]">|r| &lt; 0.3 (white)</strong> — independent. Both objectives capture distinct molecular features; keep both in multi-objective optimization.</span>
          </li>
        </ul>
      </div>
    </div>
  );
}

export default React.memo(CorrelationView);