import React, { useMemo, useState, useEffect } from 'react';
import type { Molecule } from '../../utils/types';
import { computeSimilarityMatrix, getDiversityScore, type SimilarityMetric } from '../../utils/chem';
import { computeSelfiesTEDMatrix } from '../../utils/selfies';

const MATRIX_LIMIT = 50;

function lerpColor(t: number): string {
  // Blue (low) → purple (mid) → amber (high)
  if (t <= 0) return '#3b82f6';
  if (t >= 1) return '#eab308';
  const r = Math.round(59 + (234 - 59) * t);
  const g = Math.round(130 + (179 - 130) * t);
  const b = Math.round(246 + (8 - 246) * t);
  return `rgb(${r},${g},${b})`;
}

function contrastText(t: number): string {
  return t > 0.55 ? 'var(--bg)' : 'var(--text)';
}

/** Top similar pairs list for large datasets */
function TopPairsList({ molecules, matrix, onComparePair }: { molecules: Molecule[]; matrix: number[][]; onComparePair?: (i: number, j: number) => void }) {
  const pairs = useMemo(() => {
    const n = molecules.length;
    const all: { i: number; j: number; sim: number }[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        all.push({ i, j, sim: matrix[i][j] });
      }
    }
    all.sort((a, b) => b.sim - a.sim);
    return all.slice(0, 50);
  }, [molecules.length, matrix]);

  return (
    <div className="space-y-1">
      <div className="text-[11px] text-[var(--text2)] mb-3">
        Showing top 50 most similar pairs out of {(molecules.length * (molecules.length - 1) / 2).toLocaleString()} total
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {pairs.map((p, idx) => (
          <button
            key={idx}
            onClick={() => onComparePair?.(p.i, p.j)}
            className="flex items-center justify-between p-2.5 bg-[var(--bg)] border border-[var(--border-5)] rounded-md hover:border-[#5F7367]/40 transition-colors text-left"
          >
            <div className="flex-1 min-w-0">
              <div className="text-[12px] text-[var(--text)] truncate">{molecules[p.i].name}</div>
              <div className="text-[10px] text-[var(--text2)] truncate">vs {molecules[p.j].name}</div>
            </div>
            <div className="ml-3 shrink-0">
              <span
                className="text-[13px] font-mono font-medium px-2 py-0.5 rounded"
                style={{ backgroundColor: lerpColor(p.sim) + '20', color: lerpColor(p.sim) }}
              >
                {(p.sim * 100).toFixed(0)}%
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/** HTML table-based heatmap — scales to any screen, any molecule count ≤50 */
function MatrixTable({ molecules, matrix, onComparePair }: { molecules: Molecule[]; matrix: number[][]; onComparePair?: (i: number, j: number) => void }) {
  const n = molecules.length;
  const [hover, setHover] = useState<{ i: number; j: number } | null>(null);

  // Responsive cell size: smaller for many molecules
  const cellSize = n <= 8 ? 44 : n <= 15 ? 36 : n <= 25 ? 30 : 26;
  const fontSize = n <= 8 ? 11 : n <= 15 ? 10 : 9;
  const labelWidth = n <= 8 ? 100 : n <= 15 ? 80 : 65;

  return (
    <>
      <div className="overflow-auto" style={{ maxHeight: 560 }}>
        <table className="border-collapse" style={{ borderSpacing: 0 }}>
          <thead>
            <tr>
              <th style={{ width: labelWidth, minWidth: labelWidth }} />
              {molecules.map((m, j) => (
                <th
                  key={j}
                  className="text-[var(--text2)] font-normal truncate"
                  style={{
                    width: cellSize, minWidth: cellSize, maxWidth: cellSize,
                    fontSize: fontSize - 1, padding: '2px 1px 4px',
                    textAlign: 'center', verticalAlign: 'bottom',
                  }}
                  title={m.name}
                >
                  <div className="truncate" style={{ maxWidth: cellSize }}>{m.name.replace(/_/g, ' ')}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {molecules.map((rowMol, i) => (
              <tr key={i}>
                <td
                  className="text-[var(--text2)] truncate text-right pr-2"
                  style={{ fontSize, width: labelWidth, maxWidth: labelWidth }}
                  title={rowMol.name}
                >
                  {rowMol.name.replace(/_/g, ' ')}
                </td>
                {molecules.map((_colMol, j) => {
                  const t = matrix[i][j];
                  const isDiag = i === j;
                  const isHover = hover?.i === i && hover?.j === j;
                  return (
                    <td
                      key={j}
                      className={`text-center font-mono select-none ${!isDiag && i !== j ? 'cursor-pointer' : ''}`}
                      style={{
                        width: cellSize, height: cellSize,
                        minWidth: cellSize, maxWidth: cellSize,
                        fontSize: fontSize,
                        backgroundColor: isDiag ? 'rgb(168, 85, 247)' : lerpColor(t),
                        color: isDiag ? '#fff' : contrastText(t),
                        opacity: isHover ? 1 : 0.88,
                        outline: isHover ? '2px solid var(--text)' : 'none',
                        outlineOffset: -1,
                        padding: 0,
                      }}
                      onMouseEnter={() => setHover({ i, j })}
                      onMouseLeave={() => setHover(null)}
                      onClick={() => { if (i !== j) onComparePair?.(i, j); }}
                      title={`${rowMol.name} vs ${molecules[j].name}: ${(t * 100).toFixed(1)}%`}
                    >
                      {(t * 100).toFixed(0)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hover && (
        <div className="mt-3 text-[12px] text-[var(--text2)]">
          <span className="text-[var(--text)]">{molecules[hover.i].name}</span>{' '}vs{' '}
          <span className="text-[var(--text)]">{molecules[hover.j].name}</span>:{' '}
          <span className="font-mono text-[#798F81]">{(matrix[hover.i][hover.j] * 100).toFixed(1)}%</span>
          {hover.i !== hover.j && <span className="ml-2 opacity-50">click to compare</span>}
        </div>
      )}
    </>
  );
}

const METRIC_LABELS: Record<SimilarityMetric, string> = {
  'tanimoto-r2': 'Tanimoto (ECFP4, r=2)',
  'tanimoto-r3': 'Tanimoto (ECFP6, r=3)',
  'selfies-ted': 'SELFIES-TED (IBM)',
};

const METRIC_DESCRIPTIONS: Record<SimilarityMetric, string> = {
  'tanimoto-r2': 'Morgan fingerprints (radius 2, 2048 bits) with Tanimoto coefficient',
  'tanimoto-r3': 'Morgan fingerprints (radius 3, 2048 bits) with Tanimoto coefficient',
  'selfies-ted': 'SELFIES Transformer Encoder (IBM Research, arXiv:2410.12348)',
};

function SimilarityMatrixView({ molecules, onComparePair }: { molecules: Molecule[]; onComparePair?: (i: number, j: number) => void }) {
  const n = molecules.length;
  const [metric, setMetric] = useState<SimilarityMetric>('tanimoto-r2');
  const [tedMatrix, setTedMatrix] = useState<number[][] | null>(null);
  const [tedLoading, setTedLoading] = useState(false);
  const [tedError, setTedError] = useState<string | null>(null);
  useEffect(() => {
    if (metric !== 'selfies-ted') return;
    setTedMatrix(null); setTedLoading(true); setTedError(null);
    computeSelfiesTEDMatrix(molecules).then(result => {
      setTedLoading(false);
      if ('error' in result) setTedError(result.error);
      else setTedMatrix(result.matrix);
    });
  }, [molecules, metric]);

  const syncResult = useMemo(() => {
    if (metric === 'selfies-ted') return null;
    const mat = computeSimilarityMatrix(molecules, metric);
    return { matrix: mat, diversity: getDiversityScore(mat) };
  }, [molecules, metric]);

  const matrix = metric === 'selfies-ted' ? tedMatrix : (syncResult?.matrix ?? []);
  const diversity = metric === 'selfies-ted'
    ? (tedMatrix ? getDiversityScore(tedMatrix) : 0)
    : (syncResult?.diversity ?? 0);

  function retryTED() {
    setTedMatrix(null); setTedLoading(true); setTedError(null);
    computeSelfiesTEDMatrix(molecules).then(result => {
      setTedLoading(false);
      if ('error' in result) setTedError(result.error);
      else setTedMatrix(result.matrix);
    });
  }

  return (
    <div className="bg-[var(--surface)] border border-[var(--border-5)] rounded-lg p-5">
      <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <h3 className="text-[14px] font-medium text-[var(--text-heading)]">Similarity</h3>
          <select
            value={metric}
            onChange={e => setMetric(e.target.value as SimilarityMetric)}
            className="text-[12px] px-2 py-1 rounded border border-[var(--border-5)] bg-[var(--bg)] text-[var(--text)] cursor-pointer"
            title={METRIC_DESCRIPTIONS[metric]}
          >
            {(Object.keys(METRIC_LABELS) as SimilarityMetric[]).map(m => (
              <option key={m} value={m}>{METRIC_LABELS[m]}</option>
            ))}
          </select>
        </div>
        <span className="text-[12px] text-[var(--text2)]">
          Diversity: <span className="font-mono text-[var(--text)]">{(diversity * 100).toFixed(1)}%</span>
          <span className="ml-1 opacity-50">({n} molecules)</span>
        </span>
      </div>

      {metric === 'selfies-ted' && tedLoading && (
        <div className="py-8 text-center text-[13px] text-[var(--text2)]">
          Computing SELFIES-TED embeddings…
        </div>
      )}

      {metric === 'selfies-ted' && tedError && (
        <div className="py-4 flex items-center gap-3">
          <span className="text-[12px] text-red-500 flex-1">{tedError}</span>
          <button
            onClick={retryTED}
            className="text-[12px] px-3 py-1 rounded bg-[#5F7367] text-white shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {matrix && matrix.length > 0 && (
        n <= MATRIX_LIMIT ? (
          <MatrixTable molecules={molecules} matrix={matrix} onComparePair={onComparePair} />
        ) : (
          <TopPairsList molecules={molecules} matrix={matrix} onComparePair={onComparePair} />
        )
      )}
    </div>
  );
}

export default React.memo(SimilarityMatrixView);
