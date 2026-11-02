import React, { useEffect, useRef } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import type { Molecule } from '../../utils/types';
import { getMolSvg } from '../../utils/chem';

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1e-6;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (len * len)));
  const nx = x1 + t * dx, ny = y1 + t * dy;
  return Math.hypot(px - nx, py - ny);
}

function ParallelView({ molecules, selectedMolIdx, setSelectedMolIdx }: { molecules: Molecule[]; selectedMolIdx?: number | null; setSelectedMolIdx?: (idx: number | null) => void }) {
  const { themeVersion } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pcBrushesRef = useRef<Record<string, [number, number]>>({});
  const apiRef = useRef<{ axisX: (i: number) => number; valToY: (key: string, val: number) => number; axes: string[] } | null>(null);

  // Clear brushes when a new molecule set is loaded
  useEffect(() => { pcBrushesRef.current = {}; }, [molecules]);

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;
    const canvas = canvasRef.current;
    const rect = containerRef.current.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const pcBrushes = pcBrushesRef.current;

    function drawParallelCoords() {
      if (!ctx || !canvas) return;
      const W = rect.width;
      const H = rect.height;

      const axes = ['MW', 'LogP', 'HBD', 'HBA', 'TPSA', 'RotBonds'];
      const padLeft = 40, padRight = 40, padTop = 40, padBottom = 40;
      const plotW = W - padLeft - padRight;
      const plotH = H - padTop - padBottom;
      const axisSpacing = plotW / Math.max(1, axes.length - 1);

      const ranges: Record<string, { min: number, max: number }> = {};
      axes.forEach(k => {
        const vals = molecules.map(m => m.props[k as keyof Molecule['props']] as number);
        const mn = Math.min(...vals);
        const mx = Math.max(...vals);
        const pad = (mx - mn) * 0.05 || 1;
        ranges[k] = { min: mn - pad, max: mx + pad };
      });

      const lipinskiLimits: Record<string, number> = { MW: 500, LogP: 5, HBD: 5, HBA: 10, TPSA: 140, RotBonds: 10 };

      function axisX(i: number) { return padLeft + i * axisSpacing; }
      function valToY(key: string, val: number) {
        const r = ranges[key];
        return padTop + plotH - ((val - r.min) / (r.max - r.min)) * plotH;
      }
      function yToVal(key: string, y: number) {
        const r = ranges[key];
        return r.min + ((padTop + plotH - y) / plotH) * (r.max - r.min);
      }

      function passesBrushes(m: Molecule) {
        for (const [key, br] of Object.entries(pcBrushes)) {
          const v = m.props[key as keyof Molecule['props']] as number;
          if (v < br[0] || v > br[1]) return false;
        }
        return true;
      }

      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      ctx.fillRect(0, 0, W, H);

      axes.forEach((k, i) => {
        const x = axisX(i);
        ctx.strokeStyle = '#3a3a4a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, padTop);
        ctx.lineTo(x, padTop + plotH);
        ctx.stroke();

        ctx.font = '12px Inter, sans-serif';
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--canvas-label').trim();
        ctx.textAlign = 'center';
        ctx.fillText(k, x, padTop - 14);

        ctx.font = '10px JetBrains Mono, monospace';
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--canvas-sublabel').trim();
        ctx.fillText(ranges[k].max.toFixed(1), x, padTop - 2);
        ctx.fillText(ranges[k].min.toFixed(1), x, padTop + plotH + 14);

        if (lipinskiLimits[k] !== undefined) {
          const ly = valToY(k, lipinskiLimits[k]);
          if (ly >= padTop && ly <= padTop + plotH) {
            ctx.strokeStyle = 'rgba(234, 179, 8, 0.4)'; // #eab30866
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(x - 12, ly);
            ctx.lineTo(x + 12, ly);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }

        if (pcBrushes[k]) {
          const by1 = valToY(k, pcBrushes[k][1]);
          const by2 = valToY(k, pcBrushes[k][0]);
          ctx.fillStyle = 'rgba(20,184,166,0.15)';
          ctx.fillRect(x - 10, by1, 20, by2 - by1);
          ctx.strokeStyle = '#14b8a6';
          ctx.lineWidth = 2;
          ctx.strokeRect(x - 10, by1, 20, by2 - by1);
        }
      });

      const sorted = molecules.map((m, i) => ({ m, i, passes: passesBrushes(m) }));
      
      // Faded lines (fail brush)
      sorted.filter(s => !s.passes).forEach(({ m }) => {
        ctx.strokeStyle = 'rgba(100,100,120,0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        axes.forEach((k, ai) => {
          const x = axisX(ai);
          const y = valToY(k, m.props[k as keyof Molecule['props']] as number);
          if (ai === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
      });

      // Passing lines
      sorted.filter(s => s.passes).forEach(({ m }) => {
        const isPareto = m.paretoRank === 1;
        ctx.strokeStyle = isPareto ? 'rgba(34,197,94,0.6)' : 'rgba(239,68,68,0.35)';
        ctx.lineWidth = 1.5;
        
        ctx.beginPath();
        axes.forEach((k, ai) => {
          const x = axisX(ai);
          const y = valToY(k, m.props[k as keyof Molecule['props']] as number);
          if (ai === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
      });

      // Selected molecule highlight
      if (selectedMolIdx != null && selectedMolIdx >= 0 && selectedMolIdx < molecules.length) {
        const sm = molecules[selectedMolIdx];
        ctx.save();
        ctx.setLineDash([5, 3]);
        ctx.strokeStyle = '#14b8a6';
        ctx.lineWidth = 3;
        ctx.beginPath();
        axes.forEach((k, ai) => {
          const x = axisX(ai);
          const y = valToY(k, sm.props[k as keyof Molecule['props']] as number);
          if (ai === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      apiRef.current = { axisX, valToY, axes };
      return { yToVal, axisX, axes };
    }

    const API = drawParallelCoords();
    if (!API) return;

    let isDragging = false;
    let dragAxisIdx = -1;
    let dragStartY = 0;

    canvas.onmousedown = (e) => {
      const cr = canvas.getBoundingClientRect();
      const mx = e.clientX - cr.left;
      const my = e.clientY - cr.top;
      
      for (let ai = 0; ai < API.axes.length; ai++) {
        if (Math.abs(mx - API.axisX(ai)) < 20) {
          isDragging = true;
          dragAxisIdx = ai;
          dragStartY = my;
          break;
        }
      }
    };

    canvas.onmouseup = (e) => {
      if (!isDragging) return;
      const cr = canvas.getBoundingClientRect();
      const my = e.clientY - cr.top;
      const key = API.axes[dragAxisIdx];
      
      if (Math.abs(my - dragStartY) < 5) {
        // Click -> clear
        delete pcBrushes[key];
      } else {
        // Drag -> brush
        const v1 = API.yToVal(key, dragStartY);
        const v2 = API.yToVal(key, my);
        pcBrushes[key] = [Math.min(v1, v2), Math.max(v1, v2)];
      }
      isDragging = false;
      dragAxisIdx = -1;
      drawParallelCoords();
    };

    let tooltipEl: HTMLDivElement | null = null;
    const getTooltip = () => {
      if (!containerRef.current) return null;
      if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.className = 'absolute z-10 pointer-events-none px-3 py-2 bg-[var(--bg)] border border-[var(--border-10)] rounded-lg shadow-xl text-left max-w-[200px]';
        tooltipEl.style.visibility = 'hidden';
        containerRef.current.appendChild(tooltipEl);
      }
      return tooltipEl;
    };

    canvas.onmousemove = (e: MouseEvent) => {
      if (isDragging) return;
      canvas.style.cursor = 'crosshair';
      const api = apiRef.current;
      const cr = canvas.getBoundingClientRect();
      const mx = e.clientX - cr.left;
      const my = e.clientY - cr.top;
      if (!api || molecules.length === 0) {
        const el = getTooltip();
        if (el) el.style.visibility = 'hidden';
        return;
      }
      let bestIdx = -1;
      let bestD = 25;
      for (let i = 0; i < molecules.length; i++) {
        const m = molecules[i];
        const pts: [number, number][] = api.axes.map((k, ai) => [api.axisX(ai), api.valToY(k, m.props[k as keyof Molecule['props']] as number)]);
        let d = 1e9;
        for (let s = 0; s < pts.length - 1; s++) {
          d = Math.min(d, distToSegment(mx, my, pts[s][0], pts[s][1], pts[s + 1][0], pts[s + 1][1]));
        }
        if (d < bestD) {
          bestD = d;
          bestIdx = i;
        }
      }
      const el = getTooltip();
      if (el) {
        if (bestIdx >= 0) {
          const mol = molecules[bestIdx];
          const svgDataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(getMolSvg(mol.smiles))));
          el.innerHTML = `<div class="text-[12px]"><div class="font-semibold text-[var(--text-heading)] mb-1">${(mol.name || '').replace(/</g, '&lt;')}</div><div class="text-[var(--text2)] mb-2">MW: ${mol.props.MW.toFixed(0)} · LogP: ${mol.props.LogP.toFixed(2)}</div><img src="${svgDataUrl}" alt="" style="width:96px;height:72px;object-fit:contain;background:var(--bg-deep);border-radius:4px" /></div>`;
          el.style.left = Math.min(mx + 12, cr.width - 220) + 'px';
          el.style.top = Math.min(my + 12, cr.height - 120) + 'px';
          el.style.visibility = 'visible';
        } else {
          el.style.visibility = 'hidden';
        }
      }
    };

    canvas.onmouseleave = () => {
      isDragging = false;
      const el = getTooltip();
      if (el) el.style.visibility = 'hidden';
    };

    canvas.onclick = (e) => {
      const a = apiRef.current;
      if (!setSelectedMolIdx || !a) return;
      const cr = canvas.getBoundingClientRect();
      const mx = e.clientX - cr.left;
      const my = e.clientY - cr.top;
      // Don't select if clicking near an axis (brush zone)
      for (let ai = 0; ai < a.axes.length; ai++) {
        if (Math.abs(mx - a.axisX(ai)) < 10) return;
      }
      let bestIdx = -1;
      let bestD = 20;
      for (let i = 0; i < molecules.length; i++) {
        const m = molecules[i];
        const pts: [number, number][] = a.axes.map((k: string, ai: number) => [a.axisX(ai), a.valToY(k, m.props[k as keyof Molecule['props']] as number)]);
        let d = 1e9;
        for (let s = 0; s < pts.length - 1; s++) {
          d = Math.min(d, distToSegment(mx, my, pts[s][0], pts[s][1], pts[s + 1][0], pts[s + 1][1]));
        }
        if (d < bestD) { bestD = d; bestIdx = i; }
      }
      setSelectedMolIdx(bestIdx >= 0 ? bestIdx : null);
    };

    return () => { tooltipEl?.remove(); };
  }, [molecules, selectedMolIdx, themeVersion]);

  return (
    <div className="bg-[var(--surface)] border border-[var(--border-5)] rounded-lg p-5">
      <div className="mb-4">
        <h3 className="text-[14px] font-medium text-[var(--text-heading)]">Parallel Coordinates</h3>
        <p className="text-[12px] text-[var(--text2)]">drag on axes to brush-filter molecules · click axis to clear</p>
      </div>

      <div className="flex items-center gap-4 text-[12px] text-[var(--text2)] mb-6">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[#22c55e]"></span> Pareto-optimal
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[#ef4444]"></span> Dominated
        </div>
        <div className="flex items-center gap-2">
          <span className="w-4 h-0 border-t-2 border-dashed border-[#eab308]"></span> Lipinski limit
        </div>
      </div>

      <div ref={containerRef} className="w-full h-[500px] relative rounded-md overflow-hidden bg-[var(--bg)]">
        <canvas ref={canvasRef} className="block w-full h-full" />
      </div>
    </div>
  );
}

export default React.memo(ParallelView);