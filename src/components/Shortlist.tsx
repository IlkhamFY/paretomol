import { useMemo, useCallback } from 'react';
import type { Molecule } from '../utils/types';
import { DRUG_FILTERS } from '../utils/types';
import { getMolSvg } from '../utils/chem';

/* ═══════════════════════════════════════════════════════
   Shortlist — Persistent compound accumulator

   A compact chip that shows how many molecules the user
   has starred. Expands to show the shortlist with
   auto-generated rationale and CSV export.

   Adding/removing happens via ★ toggles on sidebar cards.
   This component is read + export only.
   ═══════════════════════════════════════════════════════ */

interface ShortlistProps {
  molecules: Molecule[];
  shortlist: Set<number>;
  toggleShortlist: (idx: number) => void;
  setSelectedMolIdx?: (idx: number | null) => void;
  onToast?: (msg: string) => void;
  /** Slot for trailing elements (e.g. FDA toggle) */
  trailing?: React.ReactNode;
  /** Whether the panel is expanded */
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

/* ─── Helpers ────────────────────────────────────────── */

function getMolRationale(m: Molecule): string {
  const parts: string[] = [];
  if (m.paretoRank === 1) parts.push('Pareto-optimal');
  const violations = Object.values(m.filters).reduce((a, f) => a + (f.pass ? 0 : 1), 0);
  if (violations === 0) {
    parts.push('all filters pass');
  } else {
    const fails = Object.entries(m.filters)
      .filter(([, r]) => !r.pass)
      .map(([k]) => DRUG_FILTERS[k as keyof typeof DRUG_FILTERS]?.label ?? k);
    parts.push(`${fails.join(', ')} fail`);
  }
  const risks: string[] = [];
  if ((m.customProps?.['hERG'] ?? 0) > 0.5) risks.push('hERG');
  if ((m.customProps?.['DILI'] ?? 0) > 0.5) risks.push('DILI');
  if (risks.length) parts.push(`⚠ ${risks.join(', ')}`);
  return parts.join(' · ');
}

function themedSvg(svg: string): string {
  const w = svg.match(/width='(\d+)px'/)?.[1] ?? '200';
  const h = svg.match(/height='(\d+)px'/)?.[1] ?? '150';
  return svg
    .replace(/width='[^']*'/, "width='100%'")
    .replace(/height='[^']*'/, "height='100%'")
    .replace(/<svg /, `<svg viewBox='0 0 ${w} ${h}' `);
}

/* ═══════════════════════════════════════════════════════
   Component
   ═══════════════════════════════════════════════════════ */

export default function Shortlist({
  molecules, shortlist, toggleShortlist, setSelectedMolIdx,
  onToast, trailing, isOpen, setIsOpen,
}: ShortlistProps) {

  const shortlistMols = useMemo(() =>
    Array.from(shortlist)
      .filter(i => molecules[i])
      .map(i => ({ molecule: molecules[i], idx: i })),
    [shortlist, molecules],
  );

  const exportShortlist = useCallback(() => {
    if (shortlistMols.length === 0) { onToast?.('Star molecules in the sidebar first'); return; }
    const lines = ['Name,SMILES,MW,LogP,HBD,HBA,TPSA,RotBonds,Pareto,Rationale'];
    shortlistMols.forEach(({ molecule: m }) => {
      const rationale = getMolRationale(m).replace(/"/g, "'");
      lines.push(
        `"${m.name}","${m.smiles}",${m.props.MW.toFixed(1)},${m.props.LogP.toFixed(2)},` +
        `${m.props.HBD},${m.props.HBA},${m.props.TPSA.toFixed(1)},${m.props.RotBonds},` +
        `${m.paretoRank === 1 ? 'yes' : 'no'},"${rationale}"`,
      );
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'paretomol_shortlist.csv'; a.click();
    URL.revokeObjectURL(url);
    onToast?.(`Exported ${shortlistMols.length} compound${shortlistMols.length !== 1 ? 's' : ''}`);
  }, [shortlistMols, onToast]);

  const count = shortlist.size;

  return (
    <div className="mb-3">
      {/* ── Toolbar row ───────────────────────────────── */}
      <div className="flex items-center gap-2">
        {count > 0 ? (
          <button
            onClick={() => setIsOpen(!isOpen)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] border transition-colors ${
              isOpen
                ? 'bg-[var(--accent)]/12 border-[var(--accent)]/30 text-[var(--text-heading)] font-medium'
                : 'bg-transparent border-[var(--border-10)] text-[var(--text2)] hover:border-[var(--accent)]/40 hover:text-[var(--text)]'
            }`}
          >
            <span>★ {count}</span>
            <span className="text-[var(--text2)]/50 hidden sm:inline">
              {shortlistMols.slice(0, 3).map(s => s.molecule.name.replace(/_/g, ' ')).join(', ')}
              {count > 3 && ` +${count - 3}`}
            </span>
            <span className={`text-[9px] ml-0.5 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}>▾</span>
          </button>
        ) : (
          <span className="text-[11px] text-[var(--text2)]/40 px-1">
            Star ★ molecules in the sidebar to build a shortlist
          </span>
        )}
        {count > 0 && (
          <button
            onClick={exportShortlist}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] text-[var(--text2)] border border-[var(--border-10)] hover:border-[var(--accent)]/40 hover:text-[var(--text)] transition-colors"
          >
            Export
          </button>
        )}
        {trailing && <><span className="flex-1" />{trailing}</>}
      </div>

      {/* ── Expanded shortlist ────────────────────────── */}
      {isOpen && count > 0 && (
        <div className="mt-2 animate-fade-in">
          <div className="max-h-[300px] overflow-y-auto custom-scrollbar -mx-1 px-1">
            {shortlistMols.map(({ molecule: m, idx }) => {
              const rationale = getMolRationale(m);
              const hasRisk = rationale.includes('⚠');
              return (
                <div
                  key={idx}
                  className="flex items-center gap-3 py-2 px-1 border-b border-[var(--border)] last:border-0"
                >
                  <button
                    className="flex items-center gap-3 flex-1 min-w-0 text-left hover:bg-[var(--surface2)] rounded-sm transition-colors"
                    onClick={() => setSelectedMolIdx?.(idx)}
                    title="Select"
                  >
                    <div
                      className="w-[48px] h-[36px] shrink-0 rounded [&>svg]:max-w-full [&>svg]:max-h-full flex items-center justify-center"
                      dangerouslySetInnerHTML={{ __html: themedSvg(getMolSvg(m.smiles)) }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-medium text-[var(--text-heading)] truncate">
                        {m.name.replace(/_/g, ' ')}
                      </div>
                      <div className={`text-[10px] truncate mt-0.5 ${
                        hasRisk ? 'text-[var(--red)]/70' : 'text-[var(--text2)]'
                      }`}>
                        {rationale}
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={() => toggleShortlist(idx)}
                    title="Remove from shortlist"
                    className="shrink-0 w-6 h-6 rounded flex items-center justify-center text-[11px] text-[var(--text2)] hover:text-[var(--red)] hover:bg-[var(--red)]/10 transition-colors"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
