import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { UMAP } from 'umap-js';
import type { Molecule } from '../../utils/types';
import { PROPERTIES } from '../../utils/types';

interface ChemSpaceViewProps {
  molecules: Molecule[];
  selectedMolIdx?: number | null;
  setSelectedMolIdx?: (idx: number | null) => void;
}

type ColorBy =
  | 'pareto'
  | 'lipinski'
  | 'MW'
  | 'LogP'
  | 'HBD'
  | 'HBA'
  | 'TPSA'
  | 'RotBonds'
  | 'FrCSP3'
  | 'HeavyAtoms'
  | 'MR';

type ProjectionMethod = 'umap' | 'pca' | 'tsne';

const COLOR_OPTIONS: { value: ColorBy; label: string }[] = [
  { value: 'pareto', label: 'Pareto Rank' },
  { value: 'lipinski', label: 'Lipinski Pass/Fail' },
  ...PROPERTIES.map(p => ({ value: p.key as ColorBy, label: p.label })),
];

const PROJECTION_OPTIONS: { value: ProjectionMethod; label: string }[] = [
  { value: 'umap', label: 'UMAP' },
  { value: 'pca', label: 'PCA' },
  { value: 'tsne', label: 't-SNE' },
];

/** Convert bit-string fingerprint → Float32Array for UMAP */
function fpToVector(fp: string): number[] {
  const out = new Array(fp.length);
  for (let i = 0; i < fp.length; i++) {
    out[i] = fp.charCodeAt(i) === 49 ? 1 : 0; // '1' = 49
  }
  return out;
}

/** PCA: project data to top 2 principal components */
function computePCA(data: number[][]): number[][] {
  const n = data.length;
  const d = data[0].length;

  // Center the data (subtract mean per feature)
  const mean = new Float64Array(d);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < d; j++) mean[j] += data[i][j];
  for (let j = 0; j < d; j++) mean[j] /= n;

  const centered: number[][] = data.map(row =>
    row.map((v, j) => v - mean[j])
  );

  // Compute covariance matrix (n×n Gram matrix since d >> n)
  // Use dual PCA: eigenvectors of (X Xᵀ)/n instead of (Xᵀ X)/n
  const gram = new Array(n).fill(null).map(() => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let dot = 0;
      for (let k = 0; k < d; k++) dot += centered[i][k] * centered[j][k];
      gram[i][j] = dot;
      gram[j][i] = dot;
    }
  }

  // Power iteration for top 2 eigenvectors of the gram matrix
  function powerIteration(mat: Float64Array[], size: number, deflate?: Float64Array): { vec: Float64Array; val: number } {
    let v = new Float64Array(size);
    for (let i = 0; i < size; i++) v[i] = Math.random() - 0.5;

    for (let iter = 0; iter < 200; iter++) {
      const next = new Float64Array(size);
      for (let i = 0; i < size; i++) {
        let s = 0;
        for (let j = 0; j < size; j++) s += mat[i][j] * v[j];
        next[i] = s;
      }
      // Deflate if needed
      if (deflate) {
        let proj = 0;
        for (let i = 0; i < size; i++) proj += next[i] * deflate[i];
        for (let i = 0; i < size; i++) next[i] -= proj * deflate[i];
      }
      // Normalize
      let norm = 0;
      for (let i = 0; i < size; i++) norm += next[i] * next[i];
      norm = Math.sqrt(norm) || 1;
      for (let i = 0; i < size; i++) next[i] /= norm;
      v = next;
    }
    // Compute eigenvalue
    const Av = new Float64Array(size);
    for (let i = 0; i < size; i++) {
      let s = 0;
      for (let j = 0; j < size; j++) s += mat[i][j] * v[j];
      Av[i] = s;
    }
    let val = 0;
    for (let i = 0; i < size; i++) val += v[i] * Av[i];
    return { vec: v, val };
  }

  const { vec: e1 } = powerIteration(gram, n);
  const { vec: e2 } = powerIteration(gram, n, e1);

  // Project: component_k[i] = e_k[i] (the gram eigenvectors ARE the projections, up to scale)
  const result: number[][] = [];
  for (let i = 0; i < n; i++) {
    result.push([e1[i], e2[i]]);
  }
  return result;
}

/** Simple Barnes-Hut-free t-SNE (exact, fine for n < 200 molecules). Async to keep UI responsive. */
async function computeTSNE(data: number[][], perplexity = 30, nIter = 300, lr = 100): Promise<number[][]> {
  const n = data.length;
  const dim = 2;
  const perp = Math.min(perplexity, Math.floor((n - 1) / 3));

  // Pairwise squared Euclidean distances
  const dist2 = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let d = 0;
      for (let k = 0; k < data[i].length; k++) {
        const diff = data[i][k] - data[j][k];
        d += diff * diff;
      }
      dist2[i * n + j] = d;
      dist2[j * n + i] = d;
    }
  }

  // Compute conditional probabilities P(j|i) with binary search for sigma
  const P = new Float64Array(n * n);
  const logPerp = Math.log(perp);

  for (let i = 0; i < n; i++) {
    let lo = 1e-20, hi = 1e4, mid = 1.0;
    for (let iter = 0; iter < 50; iter++) {
      mid = (lo + hi) / 2;
      let sumP = 0, H = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const pj = Math.exp(-dist2[i * n + j] * mid);
        sumP += pj;
      }
      sumP = Math.max(sumP, 1e-100);
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const pj = Math.exp(-dist2[i * n + j] * mid) / sumP;
        if (pj > 1e-7) H -= pj * Math.log(pj);
      }
      if (H > logPerp) lo = mid; else hi = mid;
    }
    let sumP = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const pj = Math.exp(-dist2[i * n + j] * mid);
      P[i * n + j] = pj;
      sumP += pj;
    }
    for (let j = 0; j < n; j++) P[i * n + j] /= Math.max(sumP, 1e-100);
  }

  // Symmetrize: P_ij = (P(j|i) + P(i|j)) / (2n)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sym = (P[i * n + j] + P[j * n + i]) / (2 * n);
      P[i * n + j] = sym;
      P[j * n + i] = sym;
    }
  }

  // Initialize Y randomly (small values)
  const Y = new Float64Array(n * dim);
  for (let i = 0; i < Y.length; i++) Y[i] = (Math.random() - 0.5) * 0.01;

  const gains = new Float64Array(n * dim).fill(1);
  const yMean = new Float64Array(dim);
  const prevDY = new Float64Array(n * dim);
  const momentum0 = 0.5, momentum1 = 0.8;
  const earlyExag = 4.0, earlyExagEnd = 100;

  for (let iter = 0; iter < nIter; iter++) {
    const exag = iter < earlyExagEnd ? earlyExag : 1.0;
    const mom = iter < 250 ? momentum0 : momentum1;

    // Compute Q distribution (Student-t with df=1)
    const qNum = new Float64Array(n * n);
    let qSum = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let d2 = 0;
        for (let d = 0; d < dim; d++) {
          const diff = Y[i * dim + d] - Y[j * dim + d];
          d2 += diff * diff;
        }
        const q = 1 / (1 + d2);
        qNum[i * n + j] = q;
        qNum[j * n + i] = q;
        qSum += 2 * q;
      }
    }
    qSum = Math.max(qSum, 1e-100);

    // Gradient
    const dY = new Float64Array(n * dim);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const mult = 4 * (exag * P[i * n + j] - qNum[i * n + j] / qSum) * qNum[i * n + j];
        for (let d = 0; d < dim; d++) {
          dY[i * dim + d] += mult * (Y[i * dim + d] - Y[j * dim + d]);
        }
      }
    }

    // Update with adaptive gains + momentum
    for (let i = 0; i < n * dim; i++) {
      const sameSign = (dY[i] > 0) === (prevDY[i] > 0);
      gains[i] = sameSign ? gains[i] * 0.8 : gains[i] + 0.2;
      if (gains[i] < 0.01) gains[i] = 0.01;
      prevDY[i] = mom * prevDY[i] - lr * gains[i] * dY[i];
      Y[i] += prevDY[i];
    }

    // Center
    yMean.fill(0);
    for (let i = 0; i < n; i++)
      for (let d = 0; d < dim; d++) yMean[d] += Y[i * dim + d];
    for (let d = 0; d < dim; d++) yMean[d] /= n;
    for (let i = 0; i < n; i++)
      for (let d = 0; d < dim; d++) Y[i * dim + d] -= yMean[d];

    // Yield to browser every 64 iterations so the UI stays responsive
    if ((iter & 63) === 63) {
      await new Promise<void>(r => setTimeout(r, 0));
    }
  }

  // Convert to array of [x, y]
  const result: number[][] = [];
  for (let i = 0; i < n; i++) result.push([Y[i * dim], Y[i * dim + 1]]);
  return result;
}

/** Linear interpolation between two hex colours (RRGGBB) at t ∈ [0,1] */
function lerpColor(hex1: string, hex2: string, t: number): string {
  const r1 = parseInt(hex1.slice(1, 3), 16);
  const g1 = parseInt(hex1.slice(3, 5), 16);
  const b1 = parseInt(hex1.slice(5, 7), 16);
  const r2 = parseInt(hex2.slice(1, 3), 16);
  const g2 = parseInt(hex2.slice(3, 5), 16);
  const b2 = parseInt(hex2.slice(5, 7), 16);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r},${g},${b})`;
}

function ChemSpaceView({
  molecules,
  selectedMolIdx,
  setSelectedMolIdx,
}: ChemSpaceViewProps) {
  const { themeVersion } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const molPositionsRef = useRef<{ x: number; y: number; idx: number }[]>([]);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const [colorBy, setColorBy] = useState<ColorBy>('pareto');
  const [projection, setProjection] = useState<ProjectionMethod>('umap');
  const [embedding, setEmbedding] = useState<number[][] | null>(null);
  const [isComputing, setIsComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  // ── Zoom / Pan state ────────────────────────────────────────────────────────
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  // Store base positions (before transform) to apply transform on hit-test
  const basePositionsRef = useRef<{ x: number; y: number; idx: number }[]>([]);

  const resetView = useCallback(() => { setZoom(1); setOffset({ x: 0, y: 0 }); }, []);

  // ── Compute embedding whenever molecules or projection method change ────────
  useEffect(() => {
    if (molecules.length < 3) {
      setEmbedding(null);
      return;
    }

    setIsComputing(true);
    setError(null);
    setEmbedding(null);

    // Defer to next tick so the spinner renders first
    const timer = setTimeout(async () => {
      try {
        const fps = molecules.map(m => fpToVector(m.fingerprint));

        // Check for degenerate case: all identical fingerprints
        const first = fps[0];
        const allSame = fps.every(fp => fp.every((v, i) => v === first[i]));
        if (allSame) {
          // Fall back to jittered grid layout
          const fake: number[][] = molecules.map((_, i) => [
            Math.cos((2 * Math.PI * i) / molecules.length),
            Math.sin((2 * Math.PI * i) / molecules.length),
          ]);
          setEmbedding(fake);
          setIsComputing(false);
          return;
        }

        let result: number[][];

        if (projection === 'umap') {
          const nNeighbors = Math.min(15, molecules.length - 1);
          const umap = new UMAP({
            nComponents: 2,
            nNeighbors,
            minDist: 0.1,
            nEpochs: 200,
          });
          result = umap.fit(fps);
        } else if (projection === 'pca') {
          result = computePCA(fps);
        } else {
          // t-SNE (pure JS, no Node.js dependencies)
          result = await computeTSNE(fps, 30, 300, 100);
        }

        setEmbedding(result);
        resetView();
      } catch (e: any) {
        const label = projection.toUpperCase();
        setError(`${label} failed: ${e?.message ?? String(e)}`);
      } finally {
        setIsComputing(false);
      }
    }, 0);

    return () => clearTimeout(timer);
  }, [molecules, projection]);

  // ── Get point color ─────────────────────────────────────────────────────────
  const getColor = useCallback(
    (mol: Molecule, _idx: number) => {
      if (colorBy === 'pareto') {
        if (mol.paretoRank === 1) return 'rgba(95,195,135,0.92)';  // green: rank-1
        return 'rgba(120,115,110,0.70)';                            // gray: dominated
      }
      if (colorBy === 'lipinski') {
        return mol.filters.lipinski?.pass
          ? 'rgba(95,195,135,0.92)'   // green pass
          : 'rgba(239,100,80,0.85)';  // red fail
      }
      // Property gradient: purple → gold
      const propKey = colorBy as keyof typeof mol.props;
      const vals = molecules.map(m => m.props[propKey as keyof typeof m.props] as number);
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      const t = max === min ? 0.5 : ((mol.props[propKey as keyof typeof mol.props] as number) - min) / (max - min);
      return lerpColor('#7b5ea7', '#e8b84b', t);
    },
    [colorBy, molecules]
  );

  // ── Draw canvas ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current || !embedding) return;

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

    const W = rect.width;
    const H = rect.height;
    const pad = 40;

    // Background
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    ctx.fillRect(0, 0, W, H);

    // Map embedding to canvas (base coordinates, no zoom/pan)
    const xs = embedding.map(p => p[0]);
    const ys = embedding.map(p => p[1]);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    const xRange = xMax - xMin || 1;
    const yRange = yMax - yMin || 1;

    function toBaseX(v: number) {
      return pad + ((v - xMin) / xRange) * (W - 2 * pad);
    }
    function toBaseY(v: number) {
      return pad + ((yMax - v) / yRange) * (H - 2 * pad); // flip Y
    }

    // Apply zoom/pan transform
    ctx.save();
    ctx.translate(offset.x, offset.y);
    ctx.scale(zoom, zoom);

    const isDark = document.documentElement.classList.contains('dark');
    const basePositions: { x: number; y: number; idx: number }[] = [];

    // Draw points in base space (transform is on ctx)
    embedding.forEach((pt, i) => {
      const px = toBaseX(pt[0]);
      const py = toBaseY(pt[1]);
      const mol = molecules[i];
      basePositions.push({ x: px, y: py, idx: i });

      const color = getColor(mol, i);
      const r = 7;

      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 0.8;
      ctx.stroke();

      if (selectedMolIdx === i) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(px, py, r + 5, 0, Math.PI * 2);
        ctx.strokeStyle = '#14b8a6';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      if (hoveredIdx === i) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(px, py, r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      }
    });

    ctx.restore();

    // Store base positions (hit-test converts mouse coords to base space)
    basePositionsRef.current = basePositions;
    molPositionsRef.current = basePositions; // kept for backwards compat
  }, [embedding, molecules, selectedMolIdx, hoveredIdx, getColor, themeVersion, zoom, offset]);

  // ── Mouse handlers ──────────────────────────────────────────────────────────
  // Convert screen coords → base (pre-transform) coords
  function screenToBase(clientX: number, clientY: number) {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return { x: (sx - offset.x) / zoom, y: (sy - offset.y) / zoom };
  }

  function getHitMol(e: React.MouseEvent<HTMLCanvasElement>) {
    const { x, y } = screenToBase(e.clientX, e.clientY);
    // Hit radius in base space (12px screen → 12/zoom base)
    const hitR = 12 / zoom;
    return basePositionsRef.current.find(p => Math.hypot(p.x - x, p.y - y) < hitR) ?? null;
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (isPanning.current) {
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      setOffset({ x: panStart.current.ox + dx, y: panStart.current.oy + dy });
      return;
    }

    const hit = getHitMol(e);
    setHoveredIdx(hit ? hit.idx : null);

    if (tooltipRef.current) {
      if (hit) {
        const rect = containerRef.current!.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        tooltipRef.current.style.display = 'block';
        tooltipRef.current.style.left = `${Math.min(x + 12, rect.width - 140)}px`;
        tooltipRef.current.style.top = `${Math.max(y - 36, 4)}px`;
        tooltipRef.current.textContent = molecules[hit.idx].name;
      } else {
        tooltipRef.current.style.display = 'none';
      }
    }
  }

  function handleMouseLeave() {
    isPanning.current = false;
    setHoveredIdx(null);
    if (tooltipRef.current) tooltipRef.current.style.display = 'none';
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    isPanning.current = true;
    panStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  }

  function handleMouseUp(e: React.MouseEvent<HTMLCanvasElement>) {
    const moved = Math.hypot(e.clientX - panStart.current.x, e.clientY - panStart.current.y);
    isPanning.current = false;
    // Only fire click if barely moved (not a drag)
    if (moved < 4) {
      const hit = getHitMol(e);
      setSelectedMolIdx?.(hit ? hit.idx : null);
    }
  }

  function handleClick(_e: React.MouseEvent<HTMLCanvasElement>) {
    // Handled in mouseUp to distinguish drag from click
  }

  // Wheel zoom: zoom toward cursor position
  function handleWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    e.preventDefault();
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const delta = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setZoom(prev => {
      const next = Math.min(Math.max(prev * delta, 0.5), 12);
      // Adjust offset so zoom is centered on cursor
      setOffset(prevOff => ({
        x: mx - (mx - prevOff.x) * (next / prev),
        y: my - (my - prevOff.y) * (next / prev),
      }));
      return next;
    });
  }

  // ── Legend items for pareto / lipinski ──────────────────────────────────────
  const legendItems =
    colorBy === 'pareto'
      ? [
          { color: 'rgba(95,195,135,0.92)', label: 'Pareto rank 1 (non-dominated)' },
          { color: 'rgba(120,115,110,0.70)', label: 'Dominated' },
        ]
      : colorBy === 'lipinski'
      ? [
          { color: 'rgba(95,195,135,0.92)', label: 'Lipinski pass' },
          { color: 'rgba(239,100,80,0.85)', label: 'Lipinski fail' },
        ]
      : null;  // gradient — handled separately

  const propMeta = PROPERTIES.find(p => p.key === colorBy);

  const projectionLabel = projection === 'umap' ? 'UMAP' : projection === 'pca' ? 'PCA' : 't-SNE';
  const spinnerLabel = projection === 'pca' ? 'Computing PCA projection…' : `Computing ${projectionLabel} projection…`;

  // ── Edge cases ───────────────────────────────────────────────────────────────
  if (molecules.length < 3) {
    return (
      <div className="bg-[var(--surface)] border border-[var(--border-5)] rounded-lg p-12 text-center">
        <h3 className="text-[17px] font-medium text-[var(--text-heading)] mb-2">Need at least 3 molecules</h3>
        <p className="text-[var(--text2)] text-[13px] max-w-sm mx-auto">
          UMAP requires ≥ 3 molecules to compute a meaningful 2D projection. Add more molecules and the chemical space map will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-[var(--surface)] border border-[var(--border-5)] rounded-lg p-5">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-[14px] font-medium text-[var(--text-heading)]">Chemical Space Explorer</h3>
          <p className="text-[12px] text-[var(--text2)] mt-0.5">
            2D {projectionLabel} projection of Morgan fingerprints (radius 2, 2048 bits) — points closer together = more structurally similar
          </p>
        </div>

        {/* Dropdowns */}
        <div className="flex items-center gap-4 shrink-0">
          {/* Projection selector */}
          <div className="flex items-center gap-2 text-[12px] text-[var(--text2)]">
            <label htmlFor="projection-method" className="whitespace-nowrap">Projection</label>
            <select
              id="projection-method"
              value={projection}
              onChange={e => setProjection(e.target.value as ProjectionMethod)}
              className="bg-[var(--bg)] border border-[var(--border-10)] text-[var(--text)] text-[12px] rounded px-2 py-1 focus:outline-none focus:border-[var(--accent)]"
            >
              {PROJECTION_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Color-by selector */}
          <div className="flex items-center gap-2 text-[12px] text-[var(--text2)]">
            <label htmlFor="color-by" className="whitespace-nowrap">Color by</label>
            <select
              id="color-by"
              value={colorBy}
              onChange={e => setColorBy(e.target.value as ColorBy)}
              className="bg-[var(--bg)] border border-[var(--border-10)] text-[var(--text)] text-[12px] rounded px-2 py-1 focus:outline-none focus:border-[var(--accent)]"
            >
              {COLOR_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[12px] text-[var(--text2)] mb-4 flex-wrap">
        {legendItems ? (
          legendItems.map(item => (
            <div key={item.label} className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-full inline-block shrink-0"
                style={{ background: item.color, border: '1px solid var(--border-5)' }}
              />
              {item.label}
            </div>
          ))
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-[var(--text2)]">Low</span>
            <span
              className="inline-block w-24 h-2 rounded"
              style={{ background: 'linear-gradient(to right, #7b5ea7, #e8b84b)' }}
            />
            <span className="text-[var(--text2)]">High</span>
            {propMeta && <span className="text-[var(--text)] ml-1">{propMeta.label}</span>}
          </div>
        )}
      </div>

      {/* Canvas area */}
      <div
        ref={containerRef}
        className="w-full h-[500px] relative rounded-md overflow-hidden bg-[var(--bg)]"
      >
        {/* Spinner */}
        {isComputing && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 bg-[var(--bg)]/80 backdrop-blur-sm">
            <div className="w-6 h-6 border-2 border-[#5F7367]/30 border-t-[#5F7367] rounded-full animate-spin" />
            <p className="text-[13px] text-[var(--text2)]">{spinnerLabel}</p>
            {projection !== 'pca' && (
              <p className="text-[11px] text-[var(--text2)]/60">This takes 2–5 seconds for large sets</p>
            )}
          </div>
        )}

        {/* Error */}
        {error && !isComputing && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <p className="text-[13px] text-red-400">{error}</p>
          </div>
        )}

        <canvas
          ref={canvasRef}
          className="block w-full h-full"
          style={{ cursor: isPanning.current ? 'grabbing' : hoveredIdx !== null ? 'pointer' : 'grab' }}
          onClick={handleClick}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
        />

        {/* Zoom controls */}
        <div className="absolute bottom-3 right-3 flex flex-col gap-1 z-10">
          <button
            onClick={() => setZoom(z => Math.min(z * 1.3, 12))}
            className="w-7 h-7 flex items-center justify-center bg-[var(--surface2)] border border-[var(--border-10)] rounded text-[var(--text)] text-[14px] font-bold hover:border-[var(--accent)] transition-colors"
            title="Zoom in"
          >+</button>
          <button
            onClick={() => setZoom(z => Math.max(z / 1.3, 0.5))}
            className="w-7 h-7 flex items-center justify-center bg-[var(--surface2)] border border-[var(--border-10)] rounded text-[var(--text)] text-[14px] font-bold hover:border-[var(--accent)] transition-colors"
            title="Zoom out"
          >−</button>
          <button
            onClick={resetView}
            className="w-7 h-7 flex items-center justify-center bg-[var(--surface2)] border border-[var(--border-10)] rounded text-[var(--text)] text-[11px] hover:border-[var(--accent)] transition-colors"
            title="Reset zoom"
          >⊙</button>
        </div>

        {/* Zoom level badge */}
        {zoom !== 1 && (
          <div className="absolute bottom-3 left-3 px-2 py-1 bg-[var(--surface2)] border border-[var(--border-10)] rounded text-[10px] text-[var(--text2)] z-10 font-mono">
            {zoom.toFixed(1)}×
          </div>
        )}

        {/* Tooltip */}
        <div
          ref={tooltipRef}
          className="absolute pointer-events-none hidden px-2 py-1 rounded text-[11px] font-medium text-[var(--text)] bg-[#2a2826] border border-[var(--border-10)] max-w-[160px] truncate z-20"
        />
      </div>

      {/* Footer explanation */}
      <div className="mt-4 text-[11px] text-[var(--text2)] leading-relaxed">
        <strong>How to read:</strong> Each point is one molecule. Distance reflects structural similarity via Morgan fingerprints — clusters indicate scaffold families.
        Click a point to select that molecule. Hover to see its name. <strong>Scroll to zoom</strong>, <strong>drag to pan</strong>. Use the "Projection" dropdown to switch between UMAP, PCA, and t-SNE. Use "Color by" to highlight different properties.
      </div>
    </div>
  );
}

export default React.memo(ChemSpaceView);
