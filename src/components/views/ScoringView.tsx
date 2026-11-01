import React, { useMemo } from 'react';
import type { Molecule, ObjectiveWindow, ScoringPreset } from '@paretomol/core';
import { getProfile, mpoScore, presetBlurb } from '@paretomol/core';
import { getMolSvg } from '../../utils/chem';
import { useTheme } from '../../contexts/ThemeContext';

const PRESETS = [
  ['oral@1', 'Oral'],
  ['cns@1', 'CNS'],
  ['leadlike@1', 'Lead-like'],
  ['paper', 'Paper reproduction'],
] as const;

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

function ScoringView({ molecules, selectedMolIdx, setSelectedMolIdx, scoringPreset = 'oral@1', onScoringPreset }: {
  molecules: Molecule[];
  selectedMolIdx?: number | null;
  setSelectedMolIdx?: (idx: number | null) => void;
  scoringPreset?: ScoringPreset;
  onScoringPreset?: (preset: ScoringPreset, windows?: Record<string, ObjectiveWindow> | null) => void;
}) {
  useTheme();
  const profileRef = scoringPreset === 'paper' || scoringPreset === 'custom' ? 'oral@1' : scoringPreset;
  const profile = getProfile(profileRef);

  const ranked = useMemo(() => {
    const rows = molecules.map((mol, idx) => {
      const { score } = mpoScore(
        { ...(mol.props as unknown as Record<string, number>), ...mol.customProps },
        profile.desirability,
        'linear',
      );
      return { idx, mol, score };
    });
    if (scoringPreset === 'paper') rows.sort((a, b) => (a.mol.paretoRank ?? 99) - (b.mol.paretoRank ?? 99));
    else rows.sort((a, b) => b.score - a.score);
    return rows;
  }, [molecules, profile, scoringPreset]);

  const best = ranked.length > 0 ? Math.max(...ranked.map((r) => r.score)) : 1;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[14px] font-medium text-[var(--text-heading)]">Scoring</h3>
        <p className="text-[12px] text-[var(--text2)] mt-0.5 leading-relaxed">{presetBlurb(scoringPreset)}</p>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] border-b border-[var(--border-5)] pb-2" role="group" aria-label="Scoring profile">
        {PRESETS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={scoringPreset === id}
            onClick={() => onScoringPreset?.(id)}
            className={`py-1 border-b-2 ${scoringPreset === id ? 'border-[var(--accent)] text-[var(--text)] font-medium' : 'border-transparent text-[var(--text2)] hover:text-[var(--text)]'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-[var(--text2)] leading-relaxed">
        {scoringPreset === 'paper'
          ? 'Sorted by the paper front. The number beside each name is the oral MPO score, which is a different question.'
          : 'Sorted by the geometric mean of the same windows as the Pareto front. A missing property drops out of the mean. A value outside its window still counts as 0.01.'}
      </p>
      <div className="space-y-1.5 max-h-[calc(100vh-320px)] overflow-y-auto custom-scrollbar">
        {ranked.map((r, ri) => {
          const svg = getMolSvg(r.mol.smiles);
          const pct = best > 0 ? (r.score / best) * 100 : 0;
          const selected = selectedMolIdx === r.idx;
          return (
            <button
              key={r.idx}
              type="button"
              onClick={() => setSelectedMolIdx?.(selected ? null : r.idx)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--text)] ${
                selected ? 'bg-[var(--accent)]/10 border-[var(--accent)]' : 'bg-[var(--surface)] border-[var(--border-5)] hover:border-[var(--border-20)]'
              }`}
            >
              <span className="text-[11px] font-mono w-5 shrink-0 text-center text-[var(--text2)]">{ri + 1}</span>
              <span className="shrink-0 w-[48px] h-[36px] flex items-center justify-center">
                {svg ? <span className="block w-full h-full" dangerouslySetInnerHTML={{ __html: themedSvg(svg) }} /> : null}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[12px] font-medium text-[var(--text-heading)] truncate">{r.mol.name.replace(/_/g, ' ')}</span>
                <span className="mt-1 block h-[3px] bg-[var(--border-5)] rounded-full overflow-hidden">
                  <span className="block h-full bg-[var(--accent)]" style={{ width: `${Math.max(pct, 2)}%` }} />
                </span>
              </span>
              <span className="shrink-0 text-right text-[12px] font-mono text-[var(--text)]">
                {scoringPreset === 'paper' ? `rank ${r.mol.paretoRank ?? '-'}` : r.score.toFixed(3)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default React.memo(ScoringView);
