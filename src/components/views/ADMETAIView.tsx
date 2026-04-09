import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import type { Molecule } from '../../utils/types';
import { getMolSvg } from '../../utils/chem';
import {
  checkAdmetAIHealth,
  predictWithAdmetAI,
  formatAdmetAIValue,
  getAdmetAICategoryColor,
  ADMET_AI_PROPERTY_META,
  PRIMARY_ADMET_KEYS,
  getAdmetAIEndpoint,
  setAdmetAIEndpoint,
  clearEndpointOverride,
  checkApplicabilityDomain,
  interpretAtoms,
  getAtomHeatmapSvg,
  type AtomAttribution,
} from '../../utils/admetAI';
import AdmetTierModal from '../AdmetTierModal';
import { getTierState, clearPersonalSpace, setLocalDetected, getActiveEndpoint, type TierState } from '../../utils/admetTiers';

type Category = 'all' | 'absorption' | 'distribution' | 'metabolism' | 'excretion' | 'toxicity';
type ApiStatus = 'idle' | 'checking' | 'connected' | 'error';

// ---------------------------------------------------------------------------
// Radar chart — 8 key ADMET endpoints
// ---------------------------------------------------------------------------

const RADAR_KEYS = ['hERG', 'AMES', 'DILI', 'ClinTox', 'HIA_Hou', 'BBB_Martins', 'Lipophilicity_AstraZeneca', 'Solubility_AqSolDB'] as const;
const RADAR_LABELS = ['hERG', 'Ames', 'DILI', 'ClinTox', 'HIA', 'BBB', 'Lipo', 'Solub'];

/**
 * Normalise a radar value to [0, 1].
 * Classification endpoints are already probabilities (0–1).
 * Lipophilicity (log D, roughly –5 to +8) and Solubility (log mol/L, roughly –14 to +2)
 * are scaled into [0, 1] for display only.
 */
function normaliseRadar(key: string, value: number): number {
  if (key === 'Lipophilicity_AstraZeneca') {
    // map [-5, 8] → [0, 1]
    return Math.max(0, Math.min(1, (value + 5) / 13));
  }
  if (key === 'Solubility_AqSolDB') {
    // map [-14, 2] → [0, 1]
    return Math.max(0, Math.min(1, (value + 14) / 16));
  }
  return Math.max(0, Math.min(1, value));
}

interface RadarChartProps {
  pred: Record<string, number>;
}

const ADMETRadarChart = React.memo(function ADMETRadarChart({ pred }: RadarChartProps) {
  const { themeVersion } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const cx = W / 2;
    const cy = H / 2;
    const R = Math.min(cx, cy) - 36;
    const n = RADAR_KEYS.length;

    ctx.clearRect(0, 0, W, H);
    const isDark = document.documentElement.classList.contains('dark');

    // Grid rings
    const rings = 4;
    for (let r = 1; r <= rings; r++) {
      const rr = (R * r) / rings;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
        const x = cx + rr * Math.cos(angle);
        const y = cy + rr * Math.sin(angle);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // ring label
      if (r % 2 === 0) {
        ctx.fillStyle = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.3)';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${(r / rings * 100).toFixed(0)}%`, cx + 3, cy - rr + 10);
      }
    }

    // Spokes
    for (let i = 0; i < n; i++) {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + R * Math.cos(angle), cy + R * Math.sin(angle));
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Compute normalised values
    const vals = RADAR_KEYS.map(k => {
      const raw = pred[k];
      return raw !== undefined ? normaliseRadar(k, raw) : 0;
    });

    // Safety-aware fill: for each point, determine if it's "concerning"
    // Safety keys (safeDir === 'low'): higher value = more concern
    // HIA_Hou (safeDir === 'high'): lower value = more concern
    const safetyKeys = new Set(['hERG', 'AMES', 'DILI', 'ClinTox']);

    // Build polygon points
    const pts = vals.map((v, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      return { x: cx + R * v * Math.cos(angle), y: cy + R * v * Math.sin(angle) };
    });

    // Green fill (safe baseline)
    ctx.beginPath();
    pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.fillStyle = 'rgba(95, 115, 103, 0.30)';
    ctx.fill();
    ctx.strokeStyle = '#5F7367';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Red overlay for concerning values (safety endpoints > 0.5)
    const concernPts = vals.map((v, i) => {
      const key = RADAR_KEYS[i];
      let isConcern: boolean;
      if (safetyKeys.has(key)) {
        isConcern = v > 0.5;
      } else if (key === 'HIA_Hou') {
        isConcern = v < 0.5;
      } else {
        isConcern = false;
      }
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const r = isConcern ? R * v : 0;
      return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    });

    // Only draw red overlay if at least one concern point is non-zero
    if (concernPts.some((_p, i) => {
      const key = RADAR_KEYS[i];
      if (safetyKeys.has(key)) return vals[i] > 0.5;
      if (key === 'HIA_Hou') return vals[i] < 0.5;
      return false;
    })) {
      ctx.beginPath();
      concernPts.forEach((p, i) => {
        const key = RADAR_KEYS[i];
        const isConcern = safetyKeys.has(key) ? vals[i] > 0.5 : key === 'HIA_Hou' ? vals[i] < 0.5 : false;
        if (i === 0) {
          ctx.moveTo(isConcern ? p.x : pts[i].x, isConcern ? p.y : pts[i].y);
        } else {
          ctx.lineTo(isConcern ? p.x : pts[i].x, isConcern ? p.y : pts[i].y);
        }
      });
      ctx.closePath();
      ctx.fillStyle = 'rgba(239, 68, 68, 0.18)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Dots at each vertex
    pts.forEach((p, i) => {
      const key = RADAR_KEYS[i];
      const v = vals[i];
      const isConcern = safetyKeys.has(key) ? v > 0.5 : key === 'HIA_Hou' ? v < 0.5 : false;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = isConcern ? '#ef4444' : '#5F7367';
      ctx.fill();
    });

    // Labels
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    RADAR_LABELS.forEach((label, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const labelR = R + 22;
      const lx = cx + labelR * Math.cos(angle);
      const ly = cy + labelR * Math.sin(angle);
      ctx.fillStyle = isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.65)';
      ctx.fillText(label, lx, ly);
    });
  }, [pred, themeVersion]);

  return (
    <canvas
      ref={canvasRef}
      width={280}
      height={280}
      style={{ display: 'block', margin: '0 auto' }}
    />
  );
});

interface Props {
  molecules: Molecule[];
  selectedMolIdx: number | null;
  setSelectedMolIdx?: (idx: number | null) => void;
  onPredictionsReady?: (predictions: Map<string, Record<string, number>>) => void;
}

const RISK_KEYS = ['hERG', 'AMES', 'DILI', 'ClinTox'] as const;
const RISK_THRESHOLD = 0.5;

/** Structural alert flag keys returned by the ADMET-AI API (boolean 0/1) */
const ALERT_KEYS = ['PAINS_alert', 'BRENK_alert', 'NIH_alert'] as const;
type AlertKey = typeof ALERT_KEYS[number];
const ALERT_LABELS: Record<AlertKey, string> = {
  PAINS_alert: 'PAINS',
  BRENK_alert: 'Brenk',
  NIH_alert: 'NIH',
};

const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'absorption', label: 'Absorption' },
  { id: 'distribution', label: 'Distribution' },
  { id: 'metabolism', label: 'Metabolism' },
  { id: 'excretion', label: 'Excretion' },
  { id: 'toxicity', label: 'Toxicity' },
];

/* ─── Structural Alerts (collapsible) ──────────────────────────────────────── */

// ---------------------------------------------------------------------------
// Atom Attribution Heatmap Panel
// ---------------------------------------------------------------------------

const HEATMAP_ENDPOINTS = [
  { key: 'hERG', label: 'hERG (Cardiac)' },
  { key: 'AMES', label: 'Ames (Mutagen)' },
  { key: 'DILI', label: 'DILI (Liver)' },
  { key: 'ClinTox', label: 'ClinTox' },
  { key: 'BBB_Martins', label: 'BBB Penetration' },
  { key: 'HIA_Hou', label: 'HIA Absorption' },
  { key: 'CYP3A4_Veith', label: 'CYP3A4 Inhibitor' },
  { key: 'CYP2D6_Veith', label: 'CYP2D6 Inhibitor' },
  { key: 'Pgp_Broccatelli', label: 'Pgp Inhibitor' },
] as const;

function AtomHeatmapPanel({ smiles, pred }: { smiles: string; pred: Record<string, number> }) {
  const [selectedEndpoint, setSelectedEndpoint] = useState<string>('hERG');
  const [attribution, setAttribution] = useState<AtomAttribution | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Reset when molecule changes
  useEffect(() => {
    setAttribution(null);
    setError(null);
    setLoading(false);
  }, [smiles]);

  const handleFetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await interpretAtoms(smiles, selectedEndpoint);
      setAttribution(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [smiles, selectedEndpoint]);

  const heatmapSvg = useMemo(() => {
    if (!attribution) return '';
    return getAtomHeatmapSvg(smiles, attribution.atom_scores, 280, 220);
  }, [smiles, attribution]);

  const endpointMeta = ADMET_AI_PROPERTY_META[selectedEndpoint];
  const predVal = pred[selectedEndpoint];

  return (
    <div className="border border-[var(--border-5)] rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-[var(--surface)] transition-colors text-left"
      >
        <span className="text-[11px] font-medium text-[var(--text2)]">
          Atom Attribution Heatmap
        </span>
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`text-[var(--text2)]/40 transition-transform ${expanded ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 py-3 border-t border-[var(--border-5)] space-y-3">
          {/* Endpoint selector + fetch button */}
          <div className="flex items-center gap-2">
            <select
              value={selectedEndpoint}
              onChange={e => { setSelectedEndpoint(e.target.value); setAttribution(null); }}
              className="flex-1 bg-[var(--bg)] border border-[var(--border-10)] rounded px-2 py-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
            >
              {HEATMAP_ENDPOINTS.map(ep => (
                <option key={ep.key} value={ep.key}>{ep.label}</option>
              ))}
            </select>
            <button
              onClick={handleFetch}
              disabled={loading}
              className="px-3 py-1.5 rounded text-[11px] font-medium transition-colors border border-[var(--accent)] text-[var(--text)] hover:bg-[#5F7367]/20 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {loading && <span className="w-3 h-3 border border-[var(--text2)]/30 border-t-[var(--text2)] rounded-full animate-spin" />}
              {loading ? 'Computing...' : attribution ? 'Refresh' : 'Compute'}
            </button>
          </div>

          {/* Current prediction value for selected endpoint */}
          {predVal !== undefined && endpointMeta && (
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-[var(--text2)]">{endpointMeta.label} prediction:</span>
              <span className="font-mono font-semibold" style={{ color: formatAdmetAIValue(selectedEndpoint, predVal).color }}>
                {formatAdmetAIValue(selectedEndpoint, predVal).text}
              </span>
            </div>
          )}

          {error && (
            <div className="p-2 bg-[#ef4444]/10 border border-[#ef4444]/20 rounded text-[11px] text-[#ef4444]">
              {error}
            </div>
          )}

          {/* Heatmap SVG */}
          {attribution && heatmapSvg && (
            <div className="space-y-2">
              <div
                className="mx-auto border border-[var(--border-5)] rounded-lg overflow-hidden [&>svg]:max-h-full [&>svg]:max-w-full flex items-center justify-center"
                style={{ width: 280, height: 220 }}
                dangerouslySetInnerHTML={{ __html: heatmapSvg }}
              />
              {/* Legend */}
              <div className="flex items-center justify-center gap-4 text-[10px] text-[var(--text2)]">
                <div className="flex items-center gap-1">
                  <span className="inline-block w-3 h-3 rounded" style={{ backgroundColor: 'rgba(100,149,237,0.6)' }} />
                  Reduces
                </div>
                <div className="flex items-center gap-1">
                  <span className="inline-block w-3 h-3 rounded" style={{ backgroundColor: 'rgba(200,200,200,0.3)' }} />
                  Neutral
                </div>
                <div className="flex items-center gap-1">
                  <span className="inline-block w-3 h-3 rounded" style={{ backgroundColor: 'rgba(239,68,68,0.6)' }} />
                  Increases
                </div>
              </div>
              <p className="text-[10px] text-[var(--text2)]/60 text-center">
                Atom masking perturbation. Shows which atoms drive the {endpointMeta?.label ?? selectedEndpoint} prediction.
              </p>
            </div>
          )}

          {/* Empty state */}
          {!attribution && !loading && !error && (
            <p className="text-[11px] text-[var(--text2)] text-center py-2">
              Select an endpoint and click Compute to see which atoms drive the prediction.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function StructuralAlertsPanel({ molecules, structuralAlerts }: {
  molecules: Molecule[];
  structuralAlerts: Map<string, Record<AlertKey, boolean>>;
}) {
  const [expanded, setExpanded] = useState(false); // collapsed by default
  const flagged = useMemo(() =>
    molecules.filter(mol => {
      const a = structuralAlerts.get(mol.smiles);
      return a && (a.PAINS_alert || a.BRENK_alert || a.NIH_alert);
    }),
    [molecules, structuralAlerts]
  );

  if (flagged.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-[#22c55e]/5 border border-[#22c55e]/20 rounded text-[12px] text-[#22c55e]">
        No structural alerts (PAINS / Brenk / NIH) detected.
      </div>
    );
  }

  return (
    <div className="border border-[var(--border-5)] rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-[var(--surface)] transition-colors text-left"
      >
        <span className="text-[11px] font-medium text-[var(--text2)]">
          Structural alerts · {flagged.length} molecule{flagged.length !== 1 ? 's' : ''} flagged
        </span>
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`text-[var(--text2)]/40 transition-transform ${expanded ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {expanded && (
        <div className="px-3 py-2.5 border-t border-[var(--border-5)] space-y-2">
          <div className="flex flex-wrap gap-2">
            {flagged.map(mol => {
              const a = structuralAlerts.get(mol.smiles)!;
              return (
                <div key={mol.smiles} className="flex items-center gap-1.5 px-2.5 py-1 bg-[var(--surface)] border border-[var(--border-5)] rounded text-[11px]">
                  <span className="text-[var(--text)] font-medium truncate max-w-[100px]" title={mol.name}>{mol.name}</span>
                  {ALERT_KEYS.filter(ak => a[ak]).map(ak => (
                    <span key={ak} className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--border-10)] text-[var(--text2)]">
                      {ALERT_LABELS[ak]}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-[var(--text2)]/50 leading-relaxed">
            PAINS: pan-assay interference. Brenk: reactive substructures. NIH: assay interference.
          </p>
        </div>
      )}
    </div>
  );
}

function ADMETAIView({ molecules, selectedMolIdx, setSelectedMolIdx, onPredictionsReady }: Props) {
  useTheme(); // subscribe to theme changes
  const [apiStatus, setApiStatus] = useState<ApiStatus>('idle');
  const [tierState, setTierState] = useState<TierState>(getTierState);
  const [showTierModal, setShowTierModal] = useState(false);
  const [endpoint, setEndpoint] = useState(getAdmetAIEndpoint);
  const [showConfig, setShowConfig] = useState(false);
  const [category, setCategory] = useState<Category>('all');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);

  // Restore predictions from customProps if they already exist (survives tab switches)
  const [predictions, setPredictions] = useState<Map<string, Record<string, number>>>(() => {
    const restored = new Map<string, Record<string, number>>();
    for (const mol of molecules) {
      const vals: Record<string, number> = {};
      let hasAny = false;
      for (const key of PRIMARY_ADMET_KEYS) {
        const v = mol.customProps[key];
        if (typeof v === 'number') { vals[key] = v; hasAny = true; }
      }
      // Also restore structural alert keys
      for (const ak of ALERT_KEYS) {
        const v = mol.customProps[ak];
        if (typeof v === 'number') vals[ak] = v;
      }
      if (hasAny) restored.set(mol.smiles, vals);
    }
    return restored;
  });

  const [structuralAlerts, setStructuralAlerts] = useState<Map<string, Record<AlertKey, boolean>>>(() => {
    const restored = new Map<string, Record<AlertKey, boolean>>();
    for (const mol of molecules) {
      const alertVals = {} as Record<AlertKey, boolean>;
      let hasAny = false;
      for (const ak of ALERT_KEYS) {
        const v = mol.customProps[ak];
        if (typeof v === 'number') { alertVals[ak] = v === 1; hasAny = true; }
      }
      if (hasAny) restored.set(mol.smiles, alertVals);
    }
    return restored;
  });

  // Check health on mount; refresh tier state after to pick up detectLocalServer() result from App.tsx
  useEffect(() => {
    setApiStatus('checking');
    checkAdmetAIHealth().then(ok => {
      setApiStatus(ok ? 'connected' : 'error');
      setTierState(getTierState());
    });
  }, []);

  // Filtered property keys
  const filteredKeys = useMemo(() => {
    if (category === 'all') return PRIMARY_ADMET_KEYS as unknown as string[];
    return (PRIMARY_ADMET_KEYS as unknown as string[]).filter(k => {
      const meta = ADMET_AI_PROPERTY_META[k];
      return meta && meta.category === category;
    });
  }, [category]);

  // Auto-predict when API is connected and molecules are loaded
  // If predictions were restored from customProps, mark fingerprint as done
  const predictedForRef = React.useRef<string | null>(
    predictions.size > 0 ? molecules.map(m => m.smiles).sort().join('|') : null
  );
  useEffect(() => {
    if (apiStatus !== 'connected' || molecules.length === 0 || loading) return;
    const fingerprint = molecules.map(m => m.smiles).sort().join('|');
    if (predictions.size > 0 && predictedForRef.current === fingerprint) return;
    if (predictedForRef.current === fingerprint) return;
    predictedForRef.current = fingerprint;
    const timer = setTimeout(() => handlePredict(), 50);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiStatus, molecules]);

  const handlePredict = useCallback(async () => {
    if (molecules.length === 0) return;
    // Update fingerprint on manual re-predict too
    predictedForRef.current = molecules.map(m => m.smiles).sort().join('|');
    setLoading(true);
    setError(null);
    setProgress({ done: 0, total: molecules.length });
    try {
      const results = await predictWithAdmetAI(
        molecules.map(m => ({ name: m.name, smiles: m.smiles })),
        (done, total) => setProgress({ done, total }),
      );
      const predMap = new Map<string, Record<string, number>>();
      const alertMap = new Map<string, Record<AlertKey, boolean>>();
      for (const r of results) {
        const vals: Record<string, number> = {};
        for (const key of PRIMARY_ADMET_KEYS) {
          const v = r[key];
          if (typeof v === 'number') vals[key] = v;
        }
        // Capture structural alert flags (API returns 0/1 numbers or string "true"/"false")
        const alertVals = {} as Record<AlertKey, boolean>;
        for (const ak of ALERT_KEYS) {
          const raw = r[ak];
          const isAlert = raw === 1 || raw === '1' || raw === 'true';
          alertVals[ak] = isAlert;
          // Store in vals too so they flow to customProps via onPredictionsReady
          vals[ak] = typeof raw === 'number' ? raw : (isAlert ? 1 : 0);
        }
        predMap.set(r.smiles, vals);
        alertMap.set(r.smiles, alertVals);
      }
      setPredictions(predMap);
      setStructuralAlerts(alertMap);
      onPredictionsReady?.(predMap);
      setApiStatus('connected'); // mark as connected after successful prediction (e.g. Space woke up)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [molecules, onPredictionsReady]);

  const handleEndpointSave = useCallback((url: string) => {
    // Manual override clears tier markers — user is explicitly bypassing the tier system
    clearPersonalSpace();
    setLocalDetected(false);
    setEndpoint(url);
    setAdmetAIEndpoint(url);
    setTierState(getTierState()); // tier = 'shared' after clearing
    setApiStatus('checking');
    checkAdmetAIHealth().then(ok => setApiStatus(ok ? 'connected' : 'error'));
  }, []);

  const handleResetToShared = useCallback(() => {
    clearPersonalSpace();
    setLocalDetected(false);
    clearEndpointOverride();
    setEndpoint(getActiveEndpoint()); // returns shared URL after clearing
    setTierState(getTierState());
    setApiStatus('checking');
    checkAdmetAIHealth().then(ok => setApiStatus(ok ? 'connected' : 'error'));
  }, []);

  // Download ADMET-AI predictions as CSV
  const handleDownloadADMET = useCallback(() => {
    if (predictions.size === 0) return;
    const escape = (v: unknown) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const keys = PRIMARY_ADMET_KEYS as unknown as string[];
    const header = ['Name', 'SMILES', ...keys.map(k => {
      const meta = ADMET_AI_PROPERTY_META[k];
      return meta ? meta.label : k;
    })];
    const rows = molecules.map(m => {
      const pred = predictions.get(m.smiles);
      return [
        escape(m.name),
        escape(m.smiles),
        ...keys.map(k => pred?.[k] != null ? String(pred[k]) : ''),
      ].join(',');
    });
    const csv = [header.map(h => escape(h)).join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `paretomol_admet_${molecules.length}mol.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [predictions, molecules]);

  // Risk summary
  const riskSummary = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const rk of RISK_KEYS) counts[rk] = 0;
    for (const mol of molecules) {
      const pred = predictions.get(mol.smiles);
      if (!pred) continue;
      for (const rk of RISK_KEYS) {
        if (pred[rk] !== undefined && pred[rk] > RISK_THRESHOLD) counts[rk]++;
      }
    }
    return counts;
  }, [molecules, predictions]);

  // Selected molecule predictions
  const selectedMol = selectedMolIdx != null ? molecules[selectedMolIdx] : null;
  const selectedPred = selectedMol ? predictions.get(selectedMol.smiles) : null;

  const statusBadge = (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border border-[var(--border-10)] bg-[var(--surface2)]">
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{
          backgroundColor:
            apiStatus === 'connected' ? '#22c55e' :
            apiStatus === 'error' ? '#ef4444' : 'var(--text2)',
        }}
      />
      {apiStatus === 'connected' ? 'Connected' :
       apiStatus === 'checking' ? 'Checking...' :
       apiStatus === 'error' ? (tierState.tier === 'personal' ? 'Space sleeping' : 'Error') : 'Not started'}
      {tierState.tier === 'personal' && (
        <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-medium bg-[#5F7367]/20 text-[#5F7367] border border-[#5F7367]/30">
          Your Space
        </span>
      )}
      {tierState.tier === 'local' && (
        <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-medium bg-[#3b82f6]/20 text-[#3b82f6] border border-[#3b82f6]/30">
          Local · Private
        </span>
      )}
    </span>
  );

  return (
    <div className="space-y-5">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-3">
        {statusBadge}
        <button
          onClick={() => setShowConfig(v => !v)}
          className="text-[11px] text-[var(--text2)] hover:text-[var(--text)] transition-colors"
        >
          Configure endpoint
        </button>
        {tierState.tier === 'shared' && (
          <button
            onClick={() => setShowTierModal(true)}
            className="px-2 py-1 text-[10px] text-[#5F7367] border border-[#5F7367]/40 rounded hover:bg-[#5F7367]/10 transition-colors"
            title="Deploy your own ADMET-AI Space for unlimited predictions"
          >
            Get Unlimited ↗
          </button>
        )}
        <div className="flex-1" />
        {predictions.size > 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadADMET}
              className="px-3 py-1 rounded text-[11px] font-medium transition-colors border border-[var(--border-10)] text-[var(--text2)] hover:text-[var(--text)] hover:border-[var(--accent)]"
              title="Download ADMET predictions as CSV"
            >
              ↓ CSV
            </button>
            <button
              onClick={handlePredict}
              disabled={loading}
              className="px-3 py-1 rounded text-[11px] font-medium transition-colors border border-[var(--border-10)] text-[var(--text2)] hover:text-[var(--text)] hover:border-[var(--accent)] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {loading && <span className="w-3 h-3 border border-[var(--text2)]/30 border-t-[var(--text2)] rounded-full animate-spin" />}
              Re-predict
            </button>
          </div>
        )}
      </div>

      {/* Progress bar */}
      {loading && (
        <div className="space-y-1.5">
          <div className="h-1.5 bg-[var(--surface2)] rounded-full overflow-hidden relative">
            {progress.total > 50 && progress.done > 0 ? (
              <div
                className="h-full bg-[#5F7367] rounded-full transition-all duration-300"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            ) : (
              <div className="absolute inset-0 overflow-hidden rounded-full">
                <div
                  className="h-full w-1/3 bg-[#5F7367]/70 rounded-full"
                  style={{ animation: 'indeterminate 1.4s ease-in-out infinite' }}
                />
              </div>
            )}
          </div>
          <div className="text-[11px] text-[var(--text2)]">
            {progress.total > 50 && progress.done > 0
              ? `Predicting ${progress.done} / ${progress.total} molecules...`
              : `Predicting ${molecules.length} molecule${molecules.length !== 1 ? 's' : ''}...`}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-3 bg-[#ef4444]/10 border border-[#ef4444]/20 rounded text-[12px] text-[#ef4444]">
          {error}
        </div>
      )}

      {/* Configure endpoint */}
      {showConfig && (
        <div className="p-4 bg-[var(--surface)] border border-[var(--border-5)] rounded-lg space-y-3">
          <div className="text-[11px] text-[var(--text2)] uppercase tracking-wider font-medium">Endpoint</div>
          <div className="flex gap-2">
            <input
              type="text"
              value={endpoint}
              onChange={e => setEndpoint(e.target.value)}
              className="flex-1 px-3 py-1.5 bg-[var(--bg)] border border-[var(--border-10)] rounded text-[12px] text-[var(--text)] font-mono focus:outline-none focus:border-[var(--accent)]"
            />
            <button
              onClick={() => handleEndpointSave(endpoint)}
              className="px-3 py-1.5 bg-[#5F7367] text-white text-[11px] font-medium rounded hover:bg-[#6d8475]"
            >
              Save
            </button>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-[var(--text2)] leading-relaxed">
              Self-hosted ADMET-AI FastAPI service (Chemprop D-MPNN, TDC #1 benchmark).
            </p>
            {tierState.tier !== 'shared' && (
              <button
                onClick={handleResetToShared}
                className="ml-3 shrink-0 text-[10px] text-[var(--text2)] hover:text-[#ef4444] transition-colors whitespace-nowrap"
                title="Remove personal/local configuration and return to shared HF Space"
              >
                Reset to shared
              </button>
            )}
          </div>
          {apiStatus === 'error' && tierState.tier === 'personal' && (
            <div className="p-3 bg-[var(--surface2)] border border-[var(--border-5)] rounded text-[11px] text-[var(--text2)] space-y-1">
              <div className="font-medium text-[var(--text)]">Space is sleeping</div>
              <p>Free HF Spaces sleep after inactivity. Click <strong className="text-[var(--text)]">Re-predict</strong> to send a request — the Space will wake up in ~30 seconds.</p>
            </div>
          )}
          {apiStatus === 'error' && tierState.tier === 'local' && (
            <div className="p-3 bg-[var(--surface2)] border border-[var(--border-5)] rounded text-[11px] text-[var(--text2)] space-y-2">
              <div className="font-medium text-[var(--text)]">Setup guide</div>
              <p>Run locally:</p>
              <code className="block bg-[var(--bg)] p-2 rounded font-mono text-[10px] text-[var(--text)]">
                pip install admet-ai fastapi uvicorn && python -m admet_ai.web
              </code>
              <p>Or point to the HuggingFace Space endpoint.</p>
            </div>
          )}
        </div>
      )}

      {/* Category filter tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {CATEGORIES.map(c => (
          <button
            key={c.id}
            onClick={() => setCategory(c.id)}
            className={`px-3 py-1 rounded-full text-[11px] font-medium transition-colors border ${
              category === c.id
                ? 'bg-[#5F7367]/20 border-[var(--accent)] text-[var(--text)]'
                : 'bg-[var(--bg)] border-[var(--border-10)] text-[var(--text2)] hover:border-[var(--accent)] hover:text-[var(--text)]'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Risk summary — static badges (not clickable, purely informational) */}
      {predictions.size > 0 && (
        <div className="flex flex-wrap gap-2">
          {RISK_KEYS.map(rk => {
            const count = riskSummary[rk];
            const meta = ADMET_AI_PROPERTY_META[rk];
            const isClear = count === 0;
            return (
              <span
                key={rk}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] border ${
                  isClear
                    ? 'bg-[#22c55e]/5 border-[#22c55e]/15 text-[#22c55e]'
                    : 'bg-[#ef4444]/5 border-[#ef4444]/15 text-[#ef4444]'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${isClear ? 'bg-[#22c55e]' : 'bg-[#ef4444]'}`} />
                <span className="font-medium">{meta?.label ?? rk}</span>
                {!isClear && <span className="opacity-70">{count}</span>}
              </span>
            );
          })}
        </div>
      )}

      {/* Structural Alerts section — collapsible */}
      {structuralAlerts.size > 0 && <StructuralAlertsPanel molecules={molecules} structuralAlerts={structuralAlerts} />}

      {/* Main table */}
      {predictions.size > 0 && (
        <div>
        {/* Color legend */}
        <div className="flex items-center gap-4 mb-2 text-[10px] text-[var(--text2)]">
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-[#22c55e]" /> Safe</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-[#f59e0b]" /> Moderate risk</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-[#ef4444]" /> High risk</span>
          <span className="text-[var(--text2)]/50">Classification endpoints only. Thresholds: &gt;70% high, 40-70% moderate, &lt;40% low.</span>
        </div>
        <div className="overflow-auto border border-[var(--border-5)] rounded-lg" style={{ maxWidth: '100%', maxHeight: '50vh' }}>
          <table className="min-w-full border-collapse" style={{ width: 'max-content' }}>
            <thead>
              <tr className="bg-[var(--surface)] sticky top-0 z-20">
                <th className="sticky left-0 bg-[var(--surface)] z-30 px-3 py-2 text-left text-[10px] uppercase tracking-wider text-[var(--text2)] font-medium border-b border-[var(--border-5)]">
                  Molecule
                </th>
                {filteredKeys.map(key => {
                  const meta = ADMET_AI_PROPERTY_META[key];
                  return (
                    <th
                      key={key}
                      className="sticky top-0 bg-[var(--surface)] px-2 py-2 text-center text-[10px] uppercase tracking-wider font-medium border-b border-[var(--border-5)] whitespace-nowrap"
                      style={{ color: meta ? getAdmetAICategoryColor(meta.category) : 'var(--text2)' }}
                      title={meta?.description}
                    >
                      {meta?.label ?? key}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {molecules.map((mol, idx) => {
                const pred = predictions.get(mol.smiles);
                if (!pred) return null;
                const isSelected = selectedMolIdx === idx;
                const adDomain = checkApplicabilityDomain(mol);
                return (
                  <tr
                    key={mol.smiles}
                    onClick={() => setSelectedMolIdx?.(isSelected ? null : idx)}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? 'bg-[#5F7367]/10' : 'hover:bg-white/[0.02]'
                    }`}
                  >
                    <td className="sticky left-0 bg-[var(--bg)] z-10 px-3 py-1.5 text-[11px] text-[var(--text)] font-medium border-b border-[var(--border-5)] whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        {mol.name}
                        {!adDomain.inDomain && (
                          <span
                            className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-[#f59e0b]/20 text-[#f59e0b] cursor-help"
                            title={`Outside applicability domain:\n${adDomain.warnings.join('\n')}`}
                          >
                            OOD
                          </span>
                        )}
                      </span>
                    </td>
                    {filteredKeys.map(key => {
                      const v = pred[key];
                      if (v === undefined) {
                        return <td key={key} className="px-2 py-1.5 text-center text-[11px] text-[var(--text2)]/40 border-b border-[var(--border-5)]">--</td>;
                      }
                      const fmt = formatAdmetAIValue(key, v);
                      return (
                        <td key={key} className="px-2 py-1.5 text-center text-[11px] font-mono border-b border-[var(--border-5)]" style={{ color: fmt.color }}>
                          {fmt.text}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </div>
      )}

      {/* No predictions yet */}
      {predictions.size === 0 && !loading && (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-[var(--text2)] text-[13px]">
          {apiStatus === 'connected' ? (
            <>
              <div className="w-4 h-4 border-2 border-[#5F7367]/30 border-t-[#5F7367] rounded-full animate-spin" />
              <span>Starting predictions...</span>
            </>
          ) : apiStatus === 'checking' ? (
            <>
              <div className="w-4 h-4 border-2 border-[var(--text2)]/20 border-t-[var(--text2)]/60 rounded-full animate-spin" />
              <span>Connecting to ADMET-AI endpoint...</span>
            </>
          ) : apiStatus === 'error' && tierState.tier === 'personal' ? (
            <>
              <span>Your Space is sleeping. Click to wake it up.</span>
              <button
                onClick={handlePredict}
                className="px-4 py-1.5 rounded text-[11px] font-medium border border-[var(--border-10)] text-[var(--text2)] hover:text-[var(--text)] hover:border-[var(--accent)] transition-colors"
              >
                Wake &amp; Predict
              </button>
            </>
          ) : apiStatus === 'error' && tierState.tier === 'shared' ? (
            <>
              <span>ADMET-AI server temporarily unavailable.</span>
              <button
                onClick={handlePredict}
                className="px-4 py-1.5 rounded text-[11px] font-medium border border-[var(--border-10)] text-[var(--text2)] hover:text-[var(--text)] hover:border-[var(--accent)] transition-colors"
              >
                Retry
              </button>
            </>
          ) : apiStatus === 'error' ? (
            <span>Configure a local ADMET-AI endpoint to begin.</span>
          ) : (
            <span>Configure and connect to an ADMET-AI endpoint to begin.</span>
          )}
        </div>
      )}

      {/* Selected molecule detail — slide-over drawer from right */}
      {selectedMol && selectedPred && (() => {
        // Safety summary for radar
        const safetyEndpoints: Array<{ key: string; label: string; value: number; concern: string }> = [];
        const safetyRadarKeys = ['hERG', 'AMES', 'DILI', 'ClinTox'] as const;
        const safetyMsgs: Record<string, string> = {
          hERG: 'high cardiotoxicity risk',
          AMES: 'mutagenic',
          DILI: 'liver injury risk',
          ClinTox: 'clinical trial toxicity risk',
        };
        for (const k of safetyRadarKeys) {
          const v = selectedPred[k];
          if (v !== undefined && v > RISK_THRESHOLD) {
            safetyEndpoints.push({ key: k, label: ADMET_AI_PROPERTY_META[k]?.label ?? k, value: v, concern: safetyMsgs[k] });
          }
        }
        // HIA low absorption also a concern
        const hiaV = selectedPred['HIA_Hou'];
        if (hiaV !== undefined && hiaV < RISK_THRESHOLD) {
          safetyEndpoints.push({ key: 'HIA_Hou', label: 'HIA', value: hiaV, concern: 'poor intestinal absorption' });
        }
        const riskLevel = safetyEndpoints.length === 0 ? 'Low risk' : safetyEndpoints.length <= 2 ? 'Moderate risk' : 'High risk';
        const riskColor = safetyEndpoints.length === 0 ? '#22c55e' : safetyEndpoints.length <= 2 ? '#f59e0b' : '#ef4444';

        const adDomain = checkApplicabilityDomain(selectedMol);

        return (
          <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/30 z-40"
            onClick={() => setSelectedMolIdx?.(null)}
          />
          {/* Drawer */}
          <div className="fixed top-0 right-0 h-full w-[420px] max-w-[90vw] z-50 bg-[var(--bg)] border-l border-[var(--border-5)] shadow-2xl overflow-y-auto custom-scrollbar">
          <div className="p-5 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="text-[14px] font-semibold text-[var(--text)]">{selectedMol.name}</div>
                {!adDomain.inDomain && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#f59e0b]/15 border border-[#f59e0b]/30 text-[#f59e0b]" title={adDomain.warnings.join('\n')}>
                    Outside AD
                  </span>
                )}
              </div>
              <button
                onClick={() => setSelectedMolIdx?.(null)}
                className="text-[var(--text2)] hover:text-[var(--text)] text-[12px] px-2 py-1 rounded hover:bg-[var(--surface)] transition-colors"
              >
                Close ✕
              </button>
            </div>

            {/* OOD warnings */}
            {!adDomain.inDomain && (
              <div className="p-2.5 bg-[#f59e0b]/5 border border-[#f59e0b]/20 rounded text-[11px] text-[#f59e0b] space-y-1">
                {adDomain.warnings.map(w => (
                  <div key={w} className="flex items-center gap-1.5"><span>•</span><span>{w}</span></div>
                ))}
              </div>
            )}

            {/* Molecule SVG + Radar side by side */}
            <div className="flex flex-wrap gap-6 items-start justify-center">
              {/* Structure */}
              <div className="flex flex-col items-center gap-2">
                <div
                  className="w-[180px] h-[180px] flex items-center justify-center border border-[var(--border-5)] rounded-lg overflow-hidden [&>svg]:max-h-full [&>svg]:max-w-full"
                  dangerouslySetInnerHTML={{ __html: getMolSvg(selectedMol.smiles) }}
                />
                <div className="text-[10px] font-mono text-[var(--text2)] text-center max-w-[180px] break-all leading-tight">{selectedMol.smiles.slice(0, 60)}{selectedMol.smiles.length > 60 ? '…' : ''}</div>
              </div>

              {/* Radar chart */}
              <div className="flex flex-col items-center gap-2">
                <div className="text-[10px] uppercase tracking-wider text-[var(--text2)] font-medium">ADMET Safety Radar</div>
                <ADMETRadarChart pred={selectedPred} />
              </div>
            </div>

            {/* Atom Attribution Heatmap */}
            <AtomHeatmapPanel smiles={selectedMol.smiles} pred={selectedPred} />

            {/* Safety Summary */}
            <div className="p-3 bg-[var(--bg)] border border-[var(--border-5)] rounded-lg space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold" style={{ color: riskColor }}>{riskLevel}</span>
                <span className="text-[11px] text-[var(--text2)]">
                  {safetyEndpoints.length === 0
                    ? '— no safety concerns flagged'
                    : `— ${safetyEndpoints.length} concern${safetyEndpoints.length > 1 ? 's' : ''} flagged`}
                </span>
              </div>
              {safetyEndpoints.length > 0 && (
                <ul className="space-y-1">
                  {safetyEndpoints.map(({ key, label, value, concern }) => (
                    <li key={key} className="flex items-center gap-1.5 text-[11px]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#ef4444] flex-shrink-0" />
                      <span className="font-semibold text-[var(--text)]">{label}: {(value * 100).toFixed(1)}%</span>
                      <span className="text-[var(--text2)]">— {concern}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Grouped properties */}
            {(['absorption', 'distribution', 'metabolism', 'excretion', 'toxicity'] as const).map(cat => {
              const catKeys = (PRIMARY_ADMET_KEYS as unknown as string[]).filter(k => {
                const m = ADMET_AI_PROPERTY_META[k];
                return m && m.category === cat;
              });
              const catEntries = catKeys.filter(k => selectedPred[k] !== undefined);
              if (catEntries.length === 0) return null;
              return (
                <div key={cat}>
                  <div
                    className="text-[10px] uppercase tracking-wider font-medium mb-2"
                    style={{ color: getAdmetAICategoryColor(cat) }}
                  >
                    {cat}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {catEntries.map(key => {
                      const v = selectedPred[key];
                      const meta = ADMET_AI_PROPERTY_META[key];
                      const fmt = formatAdmetAIValue(key, v);
                      return (
                        <div key={key} className="p-2 bg-[var(--bg)] border border-[var(--border-5)] rounded">
                          <div className="text-[10px] text-[var(--text2)] mb-1" title={meta?.description}>{meta?.label ?? key}</div>
                          <div className="text-[13px] font-mono font-semibold" style={{ color: fmt.color }}>{fmt.text}</div>
                          {meta?.type === 'classification' && (
                            <div className="mt-1 h-1 bg-[var(--surface2)] rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{
                                  width: `${Math.min(v * 100, 100)}%`,
                                  backgroundColor: fmt.color,
                                }}
                              />
                            </div>
                          )}
                          {meta?.unit && <div className="text-[9px] text-[var(--text2)]/50 mt-0.5">{meta.unit}</div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          </div>
          </>
        );
      })()}
      {showTierModal && (
        <AdmetTierModal
          onClose={() => {
            setShowTierModal(false);
            // Refresh tier state when modal closes (handles both cancel and post-deploy)
            setTierState(getTierState());
            setEndpoint(getAdmetAIEndpoint());
          }}
          onDeployed={(url) => {
            // Clear any stale manual endpoint override so the personal Space takes effect
            clearEndpointOverride();
            setAdmetAIEndpoint(url); // also write to legacy key so getAdmetAIEndpoint() returns it
            setTierState(getTierState());
            setEndpoint(url);
            // Re-check health with new endpoint (modal stays open until user clicks Done)
            checkAdmetAIHealth().then(ok => setApiStatus(ok ? 'connected' : 'error'));
          }}
        />
      )}
    </div>
  );
}

export default React.memo(ADMETAIView);

