import React, { useState, useMemo } from 'react';
import type { Molecule } from '../../utils/types';
import { getMolSvg } from '../../utils/chem';
import { useTheme } from '../../contexts/ThemeContext';

/* ─── ADMET safety scoring ─────────────────────────────────────── */

const ADMET_SCORE_DEFS = [
  { key: 'hERG',    label: 'hERG',    desc: 'Cardiac toxicity (lower = safer)',    invert: false },
  { key: 'AMES',    label: 'AMES',    desc: 'Mutagenicity (lower = safer)',        invert: false },
  { key: 'DILI',    label: 'DILI',    desc: 'Liver injury (lower = safer)',        invert: false },
  { key: 'ClinTox', label: 'ClinTox', desc: 'Clinical toxicity (lower = safer)',   invert: false },
  { key: 'QED',     label: 'QED',     desc: 'Drug-likeness (higher = better)',     invert: true  },
] as const;

/* ─── Profiles ─────────────────────────────────────────────────── */

const PROFILES = {
  balanced:  { label: 'Balanced',           desc: 'Equal emphasis on all properties',        weights: { MW: 0.2, LogP: 0.2, HBD: 0.15, HBA: 0.15, TPSA: 0.2, RotBonds: 0.1 } },
  cns:       { label: 'CNS',                desc: 'Favors brain-penetrant molecules',        weights: { MW: 0.25, LogP: 0.3, HBD: 0.2, HBA: 0.1, TPSA: 0.1, RotBonds: 0.05 } },
  oral:      { label: 'Oral',               desc: 'Optimized for oral bioavailability',      weights: { MW: 0.1, LogP: 0.2, HBD: 0.2, HBA: 0.2, TPSA: 0.2, RotBonds: 0.1 } },
  custom:    { label: 'Custom',             desc: 'Manually adjust all weights',             weights: { MW: 0, LogP: 0, HBD: 0, HBA: 0, TPSA: 0, RotBonds: 0 } },
} as const;

type ProfileKey = keyof typeof PROFILES;
type Weights = Record<keyof typeof PROFILES['balanced']['weights'], number>;

const PROP_SHORT: Record<string, string> = {
  MW: 'MW', LogP: 'LogP', HBD: 'HBD', HBA: 'HBA', TPSA: 'TPSA', RotBonds: 'Rot',
};

const PROP_UNIT: Record<string, string> = {
  MW: 'Da', LogP: '', HBD: '', HBA: '', TPSA: 'A\u00B2', RotBonds: '',
};

/* ─── SVG helpers ──────────────────────────────────────────────── */

function themedSvg(svg: string): string {
  const wMatch = svg.match(/width='(\d+)px'/);
  const hMatch = svg.match(/height='(\d+)px'/);
  const w = wMatch ? wMatch[1] : '200';
  const h = hMatch ? hMatch[1] : '150';
  return svg
    .replace(/width='[^']*'/, `width='100%'`)
    .replace(/height='[^']*'/, `height='100%'`)
    .replace(/<svg /, `<svg viewBox='0 0 ${w} ${h}' `);
}

/* ─── Component ────────────────────────────────────────────────── */

function ScoringView({ molecules, selectedMolIdx, setSelectedMolIdx }: {
  molecules: Molecule[];
  selectedMolIdx?: number | null;
  setSelectedMolIdx?: (idx: number | null) => void;
}) {
  useTheme(); // subscribe to theme changes for SVG re-render
  const [profile, setProfile] = useState<ProfileKey>('balanced');
  const [weights, setWeights] = useState<Weights>({ ...PROFILES.balanced.weights });
  const [showWeights, setShowWeights] = useState(false);
  const [admetWeights, setAdmetWeights] = useState<Record<string, number>>(
    Object.fromEntries(ADMET_SCORE_DEFS.map(d => [d.key, 0]))
  );

  const admetPresent = useMemo(
    () => molecules.some(m => m.customProps && ADMET_SCORE_DEFS.some(d => m.customProps![d.key] != null)),
    [molecules]
  );

  const selectProfile = (key: ProfileKey) => {
    setProfile(key);
    if (key !== 'custom') setWeights({ ...PROFILES[key].weights });
  };

  const updateWeight = (key: keyof Weights, val: number) => {
    setWeights(prev => ({ ...prev, [key]: val }));
    setProfile('custom');
  };

  /* ─── Scoring logic ──────────────────────────────────────────── */

  const ranked = useMemo(() => {
    const keys = Object.keys(weights) as (keyof Weights)[];
    const utopia: Record<string, number> = {};
    const nadir: Record<string, number> = {};
    keys.forEach(k => {
      const vals = molecules.map(m => m.props[k]);
      utopia[k] = Math.min(...vals);
      nadir[k] = Math.max(...vals);
    });

    // Active ADMET keys (non-zero weight, data present in at least one molecule)
    const activeAdmet = ADMET_SCORE_DEFS.filter(
      d => admetWeights[d.key] > 0 && molecules.some(m => m.customProps?.[d.key] != null)
    );

    return molecules.map((m, i) => {
      let maxTerm = 0;
      let worstKey = '';
      let bestTerm = Infinity;
      const terms: Record<string, number> = {};

      keys.forEach(k => {
        const range = nadir[k] - utopia[k] || 1;
        const term = weights[k] * Math.abs(m.props[k] - utopia[k]) / range;
        terms[k] = term;
        if (term > maxTerm) { maxTerm = term; worstKey = k; }
        if (term < bestTerm) { bestTerm = term; }
      });

      // ADMET Chebyshev terms: fixed [0,1] scale; invert=true means higher raw val = better = inverted to lower
      activeAdmet.forEach(d => {
        const raw = (m.customProps?.[d.key] ?? 0) as number;
        const val = d.invert ? 1 - raw : raw;
        const term = admetWeights[d.key] * val; // utopia=0, nadir=1, range=1
        terms[d.key] = term;
        if (term > maxTerm) { maxTerm = term; worstKey = d.key; }
        if (term < bestTerm) { bestTerm = term; }
      });

      return { idx: i, mol: m, score: maxTerm, terms, worstKey, bestKey: '' };
    }).sort((a, b) => a.score - b.score);
  }, [molecules, weights, admetWeights]);

  const maxScore = ranked.length > 0 ? ranked[ranked.length - 1].score : 1;

  /* ─── Render ─────────────────────────────────────────────────── */

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-medium text-[var(--text-heading)]">Scoring</h3>
          <p className="text-[12px] text-[var(--text2)] mt-0.5">
            Rank molecules by weighted distance to the best values in your set
          </p>
        </div>
        <button
          onClick={() => setShowWeights(v => !v)}
          className="text-[11px] text-[var(--text2)] hover:text-[var(--text)] transition-colors flex items-center gap-1"
        >
          Weights
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            className={`transition-transform ${showWeights ? 'rotate-180' : ''}`}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      {/* Profile tabs */}
      <div className="flex items-center gap-1 border-b border-[var(--border-5)]">
        {(Object.entries(PROFILES) as [ProfileKey, typeof PROFILES[ProfileKey]][]).map(([key, p]) => (
          <button
            key={key}
            onClick={() => selectProfile(key)}
            title={p.desc}
            className={`px-3 py-1.5 text-[12px] font-medium transition-colors border-b-2 ${
              profile === key
                ? 'border-[var(--accent)] text-[var(--text-heading)]'
                : 'border-transparent text-[var(--text2)] hover:text-[var(--text)]'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Weight sliders (collapsible) */}
      {showWeights && (
        <div className="py-3 border-b border-[var(--border-5)] space-y-4">
          {/* Physicochemical weights */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
            {(Object.entries(weights) as [keyof Weights, number][]).map(([k, w]) => (
              <div key={k} className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-[var(--text2)]">{k}</span>
                  <span className="font-mono text-[var(--text-heading)]">{w.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0" max="1" step="0.05"
                  value={w}
                  onChange={e => updateWeight(k, parseFloat(e.target.value))}
                  className="w-full h-1 appearance-none rounded-full bg-[var(--border-10)] cursor-pointer
                    [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
                    [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent)]
                    [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:cursor-pointer
                    [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full
                    [&::-moz-range-thumb]:bg-[var(--accent)] [&::-moz-range-thumb]:border-0"
                />
              </div>
            ))}
          </div>
          {/* ADMET safety weights — only shown when ADMET predictions are loaded */}
          {admetPresent && (
            <div className="space-y-2 pt-2 border-t border-[var(--border-5)]">
              <div className="text-[10px] font-medium text-[var(--text2)] uppercase tracking-wider">ADMET Safety (optional)</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
                {ADMET_SCORE_DEFS.map(d => (
                  <div key={d.key} className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-[var(--text2)]" title={d.desc}>{d.label}{d.invert ? ' ↑' : ' ↓'}</span>
                      <span className="font-mono text-[var(--text-heading)]">{admetWeights[d.key].toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min="0" max="1" step="0.05"
                      value={admetWeights[d.key]}
                      onChange={e => setAdmetWeights(prev => ({ ...prev, [d.key]: parseFloat(e.target.value) }))}
                      className="w-full h-1 appearance-none rounded-full bg-[var(--border-10)] cursor-pointer
                        [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
                        [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#5F7367]
                        [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:cursor-pointer
                        [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full
                        [&::-moz-range-thumb]:bg-[#5F7367] [&::-moz-range-thumb]:border-0"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Ranked list */}
      <div className="space-y-1.5 max-h-[calc(100vh-320px)] overflow-y-auto custom-scrollbar">
        {ranked.map((r, ri) => {
          const pct = maxScore > 0 ? (1 - r.score / maxScore) * 100 : 100;
          const isSelected = selectedMolIdx === r.idx;
          const isTop = ri === 0;
          const svg = getMolSvg(r.mol.smiles);

          return (
            <div
              key={r.idx}
              onClick={() => setSelectedMolIdx?.(isSelected ? null : r.idx)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                isSelected
                  ? 'bg-[#5F7367]/10 border-[#5F7367]/40 ring-1 ring-[#5F7367]/20'
                  : 'bg-[var(--surface)] border-[var(--border-5)] hover:border-[var(--border-20)]'
              }`}
            >
              {/* Rank */}
              <span className={`text-[11px] font-mono w-5 shrink-0 text-center ${isTop ? 'text-[#22c55e] font-semibold' : 'text-[var(--text2)]'}`}>
                {ri + 1}
              </span>

              {/* Molecule SVG */}
              <div className="shrink-0 w-[48px] h-[36px] rounded overflow-hidden flex items-center justify-center">
                {svg ? (
                  <span className="block w-full h-full" dangerouslySetInnerHTML={{ __html: themedSvg(svg) }} style={{ lineHeight: 0 }} />
                ) : (
                  <span className="text-[8px] text-[var(--text2)]">?</span>
                )}
              </div>

              {/* Name + bar + properties */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[12px] font-medium text-[var(--text-heading)] truncate">{r.mol.name}</span>
                  {r.mol.paretoRank === 1 && (
                    <span className="shrink-0 text-[8px] font-medium text-[#22c55e] bg-[#22c55e]/10 px-1 py-0.5 rounded">P</span>
                  )}
                </div>
                {/* Score bar */}
                <div className="w-full h-[3px] bg-[var(--border-5)] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.max(pct, 2)}%`,
                      backgroundColor: isTop ? '#22c55e' : `color-mix(in srgb, var(--accent) ${Math.max(pct, 20)}%, var(--border-10))`,
                    }}
                  />
                </div>
                {/* Property breakdown — compact inline */}
                <div className="flex items-center gap-2 mt-1 text-[10px] text-[var(--text2)]">
                  {(Object.entries(r.terms) as [string, number][])
                    .sort((a, b) => a[1] - b[1])
                    .slice(0, 3)
                    .map(([k, _t]) => {
                      const val = r.mol.props[k as keyof Molecule['props']];
                      const unit = PROP_UNIT[k] || '';
                      return (
                        <span key={k} className={k === r.worstKey ? 'text-[var(--text2)]' : ''}>
                          {PROP_SHORT[k] || k} {typeof val === 'number' ? (Number.isInteger(val) ? val : val.toFixed(1)) : val}{unit ? ` ${unit}` : ''}
                        </span>
                      );
                    })
                  }
                </div>
              </div>

              {/* Score value */}
              <div className="shrink-0 text-right">
                <span className={`text-[13px] font-mono ${isTop ? 'text-[#22c55e] font-semibold' : 'text-[var(--text)]'}`}>
                  {r.score.toFixed(3)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Methodology footnote */}
      <div className="flex items-center gap-2 pt-2 border-t border-[var(--border-5)] text-[10px] text-[var(--text2)] leading-relaxed">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 opacity-50"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        <span>
          Weighted Chebyshev scalarization. Score = max weighted normalized distance to the best value per property. Lower is better.
          {profile !== 'custom' && ` Profile: ${PROFILES[profile].desc.toLowerCase()}.`}
          {admetPresent && ' ADMET weights use absolute [0,1] scale (↓ = lower risk better, ↑ = higher value better).'}
          {!admetPresent && ' Run ADMET predictions to unlock safety scoring dimensions.'}
        </span>
      </div>
    </div>
  );
}

export default React.memo(ScoringView);
