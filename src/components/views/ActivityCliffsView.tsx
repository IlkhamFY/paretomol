import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import type { Molecule } from '../../utils/types';
import { computeSimilarityMatrix, computeActivityCliffs, getMolSvg, type SimilarityMetric } from '../../utils/chem';
import { computeSelfiesTEDMatrix } from '../../utils/selfies';

interface ActivityCliffsViewProps {
  molecules: Molecule[];
  onComparePair?: (i: number, j: number) => void;
}

// ─── Force-directed network types ───────────────────────────────────────────

interface NodePos {
  x: number;
  y: number;
  vx: number;
  vy: number;
  idx: number;
}

interface Edge {
  i: number;
  j: number;
  tanimoto: number;
}

const PROP_OPTIONS = ['MW', 'LogP', 'TPSA', 'HBD', 'HBA', 'RotBonds'];

// ─── Network canvas component ────────────────────────────────────────────────

interface NetworkCanvasProps {
  molecules: Molecule[];
  edges: Edge[];
  nodeProp: string;
  onSelectMol?: (idx: number) => void;
  selectedIdx: number | null;
}

function NetworkCanvas({ molecules, edges, nodeProp, onSelectMol, selectedIdx }: NetworkCanvasProps) {
  const { themeVersion } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<NodePos[]>([]);
  const animFrameRef = useRef<number>(0);


  // Initialize positions in a circle and run spring layout
  useEffect(() => {
    const n = molecules.length;
    if (n === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const W = canvas.offsetWidth || 600;
    const H = canvas.offsetHeight || 500;
    const cx = W / 2;
    const cy = H / 2;
    const r = Math.min(W, H) * 0.38;

    // Init positions on a circle
    nodesRef.current = molecules.map((_, i) => ({
      x: cx + r * Math.cos((2 * Math.PI * i) / n),
      y: cy + r * Math.sin((2 * Math.PI * i) / n),
      vx: 0,
      vy: 0,
      idx: i,
    }));

    const nodes = nodesRef.current;

    // Run 120 force iterations
    for (let iter = 0; iter < 120; iter++) {
      const damping = 0.85;
      const repulseK = 5000;
      const springK = 0.05;
      const springLen = 80;

      // Repulsion: all pairs
      for (let a = 0; a < n; a++) {
        for (let b = a + 1; b < n; b++) {
          const dx = nodes[a].x - nodes[b].x;
          const dy = nodes[a].y - nodes[b].y;
          const d2 = dx * dx + dy * dy + 1;
          const f = repulseK / d2;
          const nx = (dx / Math.sqrt(d2)) * f;
          const ny = (dy / Math.sqrt(d2)) * f;
          nodes[a].vx += nx;
          nodes[a].vy += ny;
          nodes[b].vx -= nx;
          nodes[b].vy -= ny;
        }
      }

      // Attraction: connected pairs
      for (const e of edges) {
        const a = nodes[e.i];
        const b = nodes[e.j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = springK * (d - springLen);
        a.vx += (dx / d) * f;
        a.vy += (dy / d) * f;
        b.vx -= (dx / d) * f;
        b.vy -= (dy / d) * f;
      }

      // Center gravity
      for (const nd of nodes) {
        nd.vx += (cx - nd.x) * 0.005;
        nd.vy += (cy - nd.y) * 0.005;
      }

      // Apply damping
      for (const nd of nodes) {
        nd.vx *= damping;
        nd.vy *= damping;
        nd.x += nd.vx;
        nd.y += nd.vy;
        // Keep in bounds
        nd.x = Math.max(20, Math.min(W - 20, nd.x));
        nd.y = Math.max(20, Math.min(H - 20, nd.y));
      }
    }
  }, [molecules, edges, themeVersion]);

  // Draw
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
      canvas.width = W * dpr;
      canvas.height = H * dpr;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const nodes = nodesRef.current;
    if (nodes.length === 0) return;

    // Compute node size from prop
    const propVals = molecules.map(m => {
      const v = (m.props as unknown as Record<string, number | undefined>)[nodeProp] ?? m.customProps?.[nodeProp];
      return typeof v === 'number' && isFinite(v) ? v : 0;
    });
    const pMin = Math.min(...propVals);
    const pMax = Math.max(...propVals) || 1;
    const nodeRadius = (i: number) => {
      const t = (propVals[i] - pMin) / (pMax - pMin + 1e-9);
      return 5 + t * 12;
    };

    // Draw edges
    ctx.lineWidth = 0.8;
    for (const e of edges) {
      const a = nodes[e.i];
      const b = nodes[e.j];
      if (!a || !b) continue;
      const alpha = 0.2 + e.tanimoto * 0.4;
      ctx.strokeStyle = `rgba(100,150,120,${alpha})`;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // Draw nodes
    for (const nd of nodes) {
      const mol = molecules[nd.idx];
      const isPareto = mol.paretoRank === 1;
      const isSelected = nd.idx === selectedIdx;
      const r = nodeRadius(nd.idx);

      // Outer glow for selected
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(nd.x, nd.y, r + 4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(20,184,166,0.3)';
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(nd.x, nd.y, r, 0, Math.PI * 2);
      ctx.fillStyle = isPareto ? '#5F7367' : '#6b7280';
      ctx.fill();
      ctx.strokeStyle = isSelected ? '#14b8a6' : isPareto ? '#9db8a5' : '#9ca3af';
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.stroke();

      // Label for selected
      if (isSelected) {
        ctx.font = '10px system-ui';
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#000000';
        ctx.textAlign = 'center';
        ctx.fillText(mol.name, nd.x, nd.y - r - 4);
      }
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, [molecules, edges, nodeProp, selectedIdx, themeVersion]);

  // Redraw when state changes
  useEffect(() => {
    cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [draw, themeVersion]);

  // Handle click to select node
  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const nodes = nodesRef.current;
    let best: number | null = null;
    let bestDist = 20;
    for (const nd of nodes) {
      const d = Math.sqrt((nd.x - mx) ** 2 + (nd.y - my) ** 2);
      if (d < bestDist) { bestDist = d; best = nd.idx; }
    }
    if (best !== null) onSelectMol?.(best);
  }, [onSelectMol, themeVersion]);

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      style={{ width: '100%', height: '500px', display: 'block', cursor: 'pointer' }}
    />
  );
}

// ─── Main view ───────────────────────────────────────────────────────────────

const CLIFF_METRIC_LABELS: Record<SimilarityMetric, string> = {
  'tanimoto-r2': 'Tanimoto (r=2)',
  'tanimoto-r3': 'Tanimoto (r=3)',
  'selfies-ted': 'SELFIES-TED (IBM)',
};

function ActivityCliffsView({ molecules, onComparePair }: ActivityCliffsViewProps) {
  useTheme(); // subscribe to theme changes
  const [minTanimoto, setMinTanimoto] = useState(0.3);
  const [viewMode, setViewMode] = useState<'list' | 'network'>('list');
  const [nodeProp, setNodeProp] = useState('MW');
  const [networkSelectedIdx, setNetworkSelectedIdx] = useState<number | null>(null);
  const [simMetric, setSimMetric] = useState<SimilarityMetric>('tanimoto-r2');
  const [tedMatrix, setTedMatrix] = useState<number[][] | null>(null);
  const [tedLoading, setTedLoading] = useState(false);
  const [tedError, setTedError] = useState<string | null>(null);

  useEffect(() => {
    if (simMetric !== 'selfies-ted') return;
    setTedMatrix(null); setTedLoading(true); setTedError(null);
    computeSelfiesTEDMatrix(molecules).then(result => {
      setTedLoading(false);
      if ('error' in result) setTedError(result.error);
      else setTedMatrix(result.matrix);
    });
  }, [molecules, simMetric]);

  const activeMatrix = useMemo(() => {
    if (simMetric === 'selfies-ted') return tedMatrix;
    return computeSimilarityMatrix(molecules, simMetric);
  }, [molecules, simMetric, tedMatrix]);

  const cliffs = useMemo(() => {
    if (!activeMatrix) return [];
    return computeActivityCliffs(molecules, activeMatrix, minTanimoto, 15);
  }, [molecules, minTanimoto, activeMatrix]);

  // Network edges: all pairs with similarity > threshold
  const networkEdges = useMemo<Edge[]>(() => {
    if (viewMode !== 'network' || molecules.length === 0 || !activeMatrix) return [];
    const edges: Edge[] = [];
    const n = molecules.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const t = activeMatrix[i][j];
        if (t >= minTanimoto) edges.push({ i, j, tanimoto: t });
      }
    }
    return edges;
  }, [molecules, minTanimoto, viewMode, activeMatrix]);

  const selectedMol = networkSelectedIdx !== null ? molecules[networkSelectedIdx] : null;

  if (simMetric === 'selfies-ted' && tedLoading) {
    return (
      <div className="bg-[var(--surface)] border border-[var(--border-5)] rounded-lg p-12 text-center text-[13px] text-[var(--text2)]">
        Computing SELFIES-TED embeddings…
      </div>
    );
  }

  if (simMetric === 'selfies-ted' && tedError) {
    return (
      <div className="bg-[var(--surface)] border border-[var(--border-5)] rounded-lg p-12 text-center">
        <p className="text-[13px] text-red-500">{tedError}</p>
        <p className="text-[12px] text-[var(--text2)] mt-2">Add your HuggingFace token in the Similarity Matrix view to authenticate.</p>
      </div>
    );
  }

  if (cliffs.length === 0 && viewMode === 'list') {
    return (
      <div className="bg-[var(--surface)] border border-[var(--border-5)] rounded-lg p-12 text-center">
        <h3 className="text-[17px] font-medium text-[var(--text-heading)] mb-2">No activity cliffs found</h3>
        <p className="text-[var(--text2)] text-[13px] max-w-sm mx-auto">
          Pairs with Tanimoto &gt; {(minTanimoto * 100).toFixed(0)}% and large property differences will appear here. Try a set with structurally similar molecules that differ in properties.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-[var(--surface)] border border-[var(--border-5)] rounded-lg p-5">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-medium text-[var(--text-heading)]">Activity cliffs (structurally similar, property-different)</h3>
          <p className="text-[12px] text-[var(--text2)] mt-1">Top pairs by cliff score = Tanimoto × normalized property distance</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* List / Network toggle */}
          <div className="flex items-center gap-0.5 bg-[var(--bg)] rounded-md border border-[var(--border-10)] p-0.5">
            {(['list', 'network'] as const).map(m => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={`px-3 py-1.5 text-[11px] font-medium rounded capitalize transition-colors ${
                  viewMode === m
                    ? 'bg-[var(--surface2)] text-[var(--text-heading)] shadow-sm'
                    : 'text-[var(--text2)] hover:text-[var(--text)]'
                }`}
              >
                {m === 'list' ? 'List' : 'Network'}
              </button>
            ))}
          </div>

          {/* Similarity metric */}
          <select
            value={simMetric}
            onChange={e => setSimMetric(e.target.value as SimilarityMetric)}
            className="text-[11px] px-2 py-1.5 rounded border border-[var(--border-10)] bg-[var(--bg)] text-[var(--text)] cursor-pointer"
          >
            {(Object.keys(CLIFF_METRIC_LABELS) as SimilarityMetric[]).map(m => (
              <option key={m} value={m}>{CLIFF_METRIC_LABELS[m]}</option>
            ))}
          </select>

          {/* Min similarity slider */}
          <div className="flex items-center gap-2 text-[11px] text-[var(--text2)]">
            <span>Min similarity</span>
            <input
              type="range" min="0.1" max="0.8" step="0.05"
              value={minTanimoto}
              onChange={e => setMinTanimoto(parseFloat(e.target.value))}
              className="w-20 accent-[#798F81]"
            />
            <span className="font-mono text-[var(--text)] w-8">{(minTanimoto * 100).toFixed(0)}%</span>
          </div>

          {/* Node size prop (network only) */}
          {viewMode === 'network' && (
            <div className="flex items-center gap-2 text-[11px] text-[var(--text2)]">
              <span>Node size:</span>
              <select
                value={nodeProp}
                onChange={e => setNodeProp(e.target.value)}
                className="bg-[var(--bg)] border border-[var(--border-10)] rounded px-2 py-1 text-[11px] text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
              >
                {PROP_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Network mode */}
      {viewMode === 'network' && (
        <div>
          {/* Legend */}
          <div className="flex flex-wrap items-center gap-4 mb-3 text-[11px] text-[var(--text2)]">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full inline-block" style={{ background: '#5F7367' }} />
              Pareto-optimal
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full inline-block" style={{ background: '#6b7280' }} />
              Dominated
            </span>
            <span className="text-[var(--text2)]/60">Node size ∝ {nodeProp} · Edge opacity ∝ similarity · Click to select</span>
          </div>
          <div className="rounded-lg overflow-hidden border border-[var(--border-5)] bg-[var(--bg)]">
            <NetworkCanvas
              molecules={molecules}
              edges={networkEdges}
              nodeProp={nodeProp}
              onSelectMol={idx => setNetworkSelectedIdx(prev => prev === idx ? null : idx)}
              selectedIdx={networkSelectedIdx}
            />
          </div>

          {/* Selected molecule info */}
          {selectedMol && (
            <div className="mt-3 p-3 bg-[var(--bg)] border border-[var(--border-5)] rounded-lg flex flex-wrap items-center gap-4">
              <div
                className="h-[80px] w-[80px] flex items-center justify-center shrink-0 [&>svg]:max-h-full"
                dangerouslySetInnerHTML={{ __html: getMolSvg(selectedMol.smiles) }}
              />
              <div>
                <div className="text-[13px] font-semibold text-[#14b8a6]">{selectedMol.name}</div>
                <div className="text-[11px] text-[var(--text2)] mt-0.5 font-mono">
                  MW {selectedMol.props.MW.toFixed(0)} · LogP {selectedMol.props.LogP.toFixed(1)} · TPSA {selectedMol.props.TPSA.toFixed(0)}
                </div>
                <div className="text-[11px] text-[var(--text2)] mt-0.5">
                  {selectedMol.paretoRank === 1
                    ? <span className="text-[#5F7367] font-medium">Pareto-optimal</span>
                    : <span>Rank {selectedMol.paretoRank}</span>}
                  {' '}· Index {networkSelectedIdx}
                </div>
              </div>
              {onComparePair && cliffs.some(c => c.i === networkSelectedIdx || c.j === networkSelectedIdx) && (
                <button
                  type="button"
                  onClick={() => {
                    const cliff = cliffs.find(c => c.i === networkSelectedIdx || c.j === networkSelectedIdx);
                    if (cliff) onComparePair(cliff.i, cliff.j);
                  }}
                  className="ml-auto px-3 py-1.5 text-[11px] font-medium bg-[#5F7367]/30 text-[var(--accent2)] rounded hover:bg-[#5F7367]/50 transition-colors"
                >
                  Compare cliff pair
                </button>
              )}
            </div>
          )}

          {/* Network stats */}
          <div className="mt-2 text-[11px] text-[var(--text2)] flex gap-4">
            <span>{molecules.length} nodes</span>
            <span>{networkEdges.length} edges</span>
            <span>{molecules.filter(m => m.paretoRank === 1).length} Pareto-optimal</span>
          </div>
        </div>
      )}

      {/* List mode */}
      {viewMode === 'list' && (
        <div className="space-y-3 max-h-[600px] overflow-y-auto custom-scrollbar">
          {cliffs.map((c, idx) => {
            const mA = molecules[c.i];
            const mB = molecules[c.j];
            return (
              <div
                key={`${c.i}-${c.j}`}
                className="p-3 bg-[var(--bg)] border border-[var(--border-5)] rounded-md"
              >
                {/* Header row */}
                <div className="flex items-center gap-3 mb-3 flex-wrap">
                  <span className="text-[11px] text-[var(--text2)] font-mono w-6">#{idx + 1}</span>
                  <div className="flex items-center gap-3 text-[12px]">
                    <span className="text-[var(--text2)]">Tanimoto: <span className="font-mono text-[var(--text-heading)]">{(c.tanimoto * 100).toFixed(0)}%</span></span>
                    <span className="text-[var(--text2)]">Cliff: <span className="font-mono text-[#f97316]">{c.cliffScore.toFixed(2)}</span></span>
                    <span className="text-[var(--text2)]">Differs in: <span className="text-[var(--text)]">{c.topDifferingProps.join(', ')}</span></span>
                  </div>
                  {onComparePair && (
                    <button
                      type="button"
                      onClick={() => onComparePair(c.i, c.j)}
                      className="ml-auto px-2 py-1 text-[11px] font-medium bg-[#5F7367]/30 text-[var(--accent2)] rounded hover:bg-[#5F7367]/50 hover:text-[var(--text-heading)] transition-colors"
                    >
                      Compare
                    </button>
                  )}
                </div>
                {/* Side-by-side structure cards */}
                <div className="grid grid-cols-2 gap-3">
                  {[{ mol: mA, color: '#14b8a6' }, { mol: mB, color: '#06b6d4' }].map(({ mol, color }) => (
                    <div key={mol.smiles} className="rounded bg-[var(--surface)] border border-[var(--border-5)] p-2 text-center">
                      <div
                        className="flex justify-center h-[100px] items-center mb-1 [&>svg]:max-h-full"
                        dangerouslySetInnerHTML={{ __html: getMolSvg(mol.smiles) }}
                      />
                      <div className="text-[12px] font-medium truncate" style={{ color }}>{mol.name}</div>
                      <div className="text-[10px] text-[var(--text2)] mt-0.5 font-mono">
                        MW {mol.props.MW.toFixed(0)} · LogP {mol.props.LogP.toFixed(1)} · TPSA {mol.props.TPSA.toFixed(0)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default React.memo(ActivityCliffsView);