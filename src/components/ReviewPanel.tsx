import { useMemo, useState } from 'react';
import { getProfile, mpoScore, getMolValue } from '@paretomol/core';
import type { Molecule, ParetoObjective, ReviewPayload, ReviewVerdict } from '@paretomol/core';

export interface ReviewState {
  payload: ReviewPayload;
  decisions: Record<number, ReviewVerdict>;
}

const fmt = (v: number | null | undefined): string => (typeof v !== 'number' || !Number.isFinite(v) ? '-' : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));

/** Review mode for an agent-produced link: Accept/Reject per molecule, export as a decision record. */
export default function ReviewPanel({ review, molecules, objectives, onDecide, onExport, onExit, onSelect }: {
  review: ReviewState;
  molecules: Molecule[];
  objectives: ParetoObjective[];
  onDecide: (idx: number, v: ReviewVerdict | null) => void;
  onExport: (note: string) => void;
  onExit: () => void;
  onSelect?: (idx: number) => void;
}) {
  const { payload, decisions } = review;
  const [note, setNote] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const profile = useMemo(() => getProfile(payload.profile ?? 'oral@1'), [payload.profile]);
  const suggested = useMemo(() => new Set(payload.suggested ?? []), [payload.suggested]);
  const rows = useMemo(() => molecules.map((m, i) => ({
    i, m,
    mpo: mpoScore({ ...(m.props as unknown as Record<string, number>), ...m.customProps }, profile.desirability, 'linear').score,
  })).sort((a, b) => (a.m.paretoRank ?? 99) - (b.m.paretoRank ?? 99) || b.mpo - a.mpo), [molecules, profile]);
  const nAcc = Object.values(decisions).filter(v => v === 'accept').length;
  const nRej = Object.values(decisions).filter(v => v === 'reject').length;
  const btn = 'px-2 py-0.5 rounded text-[11px] border transition-colors';

  return (
    <div data-testid="review-panel" className="fixed right-4 top-16 bottom-20 z-[45] w-[min(440px,calc(100vw-2rem))] flex flex-col bg-[var(--bg)] border border-[var(--border-10)] rounded-lg shadow-2xl text-[12px] text-[var(--text)]">
      <div className="px-3 py-2 border-b border-[var(--border-5)] flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[13px]">Review{payload.title ? `: ${payload.title}` : ''}</div>
          <div className="text-[11px] text-[var(--text2)]">
            {payload.source ? <>From <strong>{payload.source}</strong> · </> : null}
            profile {profile.ref} · ranked on {objectives.map(o => `${o.key} ${o.direction}`).join(', ')}
          </div>
        </div>
        <button type="button" className="text-[11px] text-[var(--text2)] hover:text-[var(--text)]" onClick={() => setCollapsed(c => !c)}>{collapsed ? 'Expand' : 'Collapse'}</button>
        <button type="button" className="text-[11px] text-[var(--text2)] hover:text-[var(--text)]" onClick={onExit} title="Leave review mode; the molecules stay loaded">Exit</button>
      </div>
      {!collapsed && (
        <>
          {payload.note && <div className="px-3 py-2 border-b border-[var(--border-5)] text-[11px] text-[var(--text2)] whitespace-pre-wrap" data-testid="review-note">{payload.note}</div>}
          <div className="flex-1 overflow-y-auto">
            {rows.map(({ i, m, mpo }) => {
              const v = decisions[i];
              return (
                <div key={i} data-testid="review-row" data-name={m.name} data-verdict={v ?? ''} className={`px-3 py-1.5 border-b border-[var(--border-5)] flex items-center gap-2 ${v === 'accept' ? 'bg-[#5F7367]/15' : v === 'reject' ? 'opacity-50' : ''}`}>
                  <button type="button" className="flex-1 min-w-0 text-left" onClick={() => onSelect?.(i)}>
                    <div className="truncate font-medium">{m.name}{suggested.has(m.name) && <span className="ml-1 text-[10px] text-[var(--accent)]" title="Suggested by the agent">suggested</span>}</div>
                    <div className="text-[10px] text-[var(--text2)] truncate">
                      rank {m.paretoRank ?? '-'} · MPO {mpo.toFixed(2)} · {objectives.map(o => `${o.key} ${fmt(getMolValue(m, o.key))}`).join(' · ')}
                    </div>
                  </button>
                  <button type="button" aria-pressed={v === 'accept'} aria-label={`Accept ${m.name}`} className={`${btn} ${v === 'accept' ? 'bg-[var(--accent)] text-white border-transparent' : 'border-[var(--border-10)] hover:border-[var(--accent)]'}`} onClick={() => onDecide(i, v === 'accept' ? null : 'accept')}>Accept</button>
                  <button type="button" aria-pressed={v === 'reject'} aria-label={`Reject ${m.name}`} className={`${btn} ${v === 'reject' ? 'bg-[var(--surface2)] border-[var(--text2)]' : 'border-[var(--border-10)] hover:border-[var(--text2)]'}`} onClick={() => onDecide(i, v === 'reject' ? null : 'reject')}>Reject</button>
                </div>
              );
            })}
          </div>
          <div className="px-3 py-2 border-t border-[var(--border-5)] space-y-2">
            <div className="text-[11px] text-[var(--text2)]" data-testid="review-counts">{nAcc} accepted · {nRej} rejected · {molecules.length - nAcc - nRej} undecided</div>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Why? (saved as the record's rationale)" className="w-full bg-[var(--surface2)] border border-[var(--border-10)] rounded p-1.5 text-[11px]" aria-label="Review rationale" />
            <button type="button" data-testid="review-export" className="w-full px-3 py-1.5 bg-[var(--accent)] text-white rounded text-[12px] font-medium hover:opacity-90" onClick={() => onExport(note)}>Export decision record</button>
          </div>
        </>
      )}
    </div>
  );
}
