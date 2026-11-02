import React, { useState, useMemo, useEffect, useRef } from 'react';
import type { Molecule } from '../../utils/types';
import { getMolSvg, getMolSvgHighlighted, getDifficultyHighlight } from '../../utils/chem';
import { useTheme } from '../../contexts/ThemeContext';

/* ─── Make-ability & cost ──────────────────────────────────────────
   One home for the "can I make or buy this, and how cheaply?" decision.
   Make-ability: the instant client-side synthetic-complexity estimate
   (props.SC, 1 easy–10 hard), upgraded to the exact Ertl SA score
   (customProps.SA_Score) when the compute tier has run.
   Cost/availability: PubChem commercial vendor count (customProps.Vendors),
   fetched via "Check buyability" in this tab. SA / RA / SC auto-compute on open.
   ──────────────────────────────────────────────────────────────── */

// Make-ability at or above this (1–10) is treated as "hard" for the make/buy call.
const HARD = 7;

type Sort = 'make' | 'available' | 'source';

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

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function MakeabilityView({ molecules, selectedMolIdx, setSelectedMolIdx, onComputeScores, onCheckBuyability, onCheckAvailability, onExportScores }: {
  molecules: Molecule[];
  selectedMolIdx?: number | null;
  setSelectedMolIdx?: (idx: number | null) => void;
  onComputeScores?: () => Promise<{ sa: number; ra: number; sc: number; total: number }>;
  onCheckBuyability?: () => Promise<{ resolved: number; buyable: number; total: number }>;
  onCheckAvailability?: () => Promise<{ inZinc: number; total: number }>;
  onExportScores?: () => void;
}) {
  useTheme(); // re-render SVGs on theme change
  const [sort, setSort] = useState<Sort>('make');
  const [computing, setComputing] = useState(false);
  const [checkingBuy, setCheckingBuy] = useState(false);
  const [checkingZinc, setCheckingZinc] = useState(false);
  const autoComputed = useRef(false);

  const runCompute = async () => {
    if (!onComputeScores || computing) return;
    setComputing(true);
    try { await onComputeScores(); } finally { setComputing(false); }
  };
  const runBuyability = async () => {
    if (!onCheckBuyability || checkingBuy) return;
    setCheckingBuy(true);
    try { await onCheckBuyability(); } finally { setCheckingBuy(false); }
  };
  const runAvailability = async () => {
    if (!onCheckAvailability || checkingZinc) return;
    setCheckingZinc(true);
    try { await onCheckAvailability(); } finally { setCheckingZinc(false); }
  };


  // Per-score distribution stats across the loaded set — used to put the three
  // synthesizability scores on a common z-scale so we flag genuine per-molecule
  // disagreement, not their different baselines (e.g. SCScore systematically rates
  // drug-like molecules more "complex" than SA rates them "hard").
  const scoreStats = useMemo(() => {
    const stat = (key: string) => {
      const vals = molecules.map(m => m.customProps?.[key]).filter((v): v is number => typeof v === 'number');
      if (vals.length < 3) return null;
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
      return std > 1e-9 ? { mean, std } : null;
    };
    return { sa: stat('SA_Score'), ra: stat('RAScore'), sc: stat('SCScore') };
  }, [molecules]);

  const rows = useMemo(() => {
    const out = molecules.map((m, idx) => {
      const sa = m.customProps?.SA_Score;
      const exact = typeof sa === 'number';
      const make = exact ? (sa as number) : m.props.SC;        // 1 easy – 10 hard
      const vendorsRaw = m.customProps?.Vendors;
      const vendorsKnown = typeof vendorsRaw === 'number';
      const vendors = vendorsKnown ? (vendorsRaw as number) : null;
      const buyable = vendors != null && vendors > 0;
      const cid = m.customProps?.PubChemCID;
      const inZinc = m.cost?.purchasable ?? false;
      const availKnown = vendorsKnown || m.cost != null;
      const isBuyable = buyable || inZinc;
      // Make-vs-buy call: once availability is known from PubChem and/or ZINC.
      const call: 'buy' | 'make' | 'hard' | null =
        !availKnown ? null : isBuyable ? 'buy' : make < HARD ? 'make' : 'hard';
      // Consensus across the three synthesizability scores: put each on a z-scale
      // (oriented so higher z = easier than peers) and flag when they place this
      // molecule far apart — the cases worth a second look. z-scaling removes the
      // scores' different baselines, so a systematic offset doesn't flag everything.
      const raV = m.customProps?.RAScore;
      const scV = m.customProps?.SCScore;
      let disagree = false, disagreeReason = '';
      const sSA = scoreStats.sa, sRA = scoreStats.ra, sSC = scoreStats.sc;
      if (exact && typeof raV === 'number' && typeof scV === 'number' && sSA && sRA && sSC) {
        const zs = [
          -((sa as number) - sSA.mean) / sSA.std,  // SA: lower = easier
          (raV - sRA.mean) / sRA.std,               // RA: higher = easier
          -(scV - sSC.mean) / sSC.std,              // SC: lower = easier
        ];
        const spread = Math.max(...zs) - Math.min(...zs);
        if (spread >= 2.2) {
          disagree = true;
          const labels = ['SA score', 'RAScore', 'SCScore'];
          const hi = zs.indexOf(Math.max(...zs));
          const lo = zs.indexOf(Math.min(...zs));
          disagreeReason = `Synthesizability scores disagree for this set — ${labels[hi]} rates it easier while ${labels[lo]} rates it harder (SA ${(sa as number).toFixed(1)}, RA ${raV.toFixed(2)}, SC ${scV.toFixed(1)}). Inspect before deciding.`;
        }
      }
      return { idx, mol: m, make, exact, vendors, vendorsKnown, buyable, cid, call, disagree, disagreeReason };
    });
    out.sort((a, b) => {
      if (sort === 'make') return a.make - b.make;                       // easiest to make first
      if (sort === 'available') return (b.vendors ?? -1) - (a.vendors ?? -1); // most vendors first
      // hardest to source: buyable last; among the rest, hardest to make first
      const sa = a.buyable ? -1 : a.make;
      const sb = b.buyable ? -1 : b.make;
      return sb - sa;
    });
    return out;
  }, [molecules, sort, scoreStats]);

  const anyVendors = rows.some(r => r.vendorsKnown);
  const withData = rows.filter(r => r.vendorsKnown).length;
  const buyableCount = rows.filter(r => r.buyable).length;
  const medMake = median(rows.map(r => r.make));
  const allExact = rows.length > 0 && rows.every(r => r.exact);
  // Have any of the three exact make-ability scores been computed yet? Drives the
  // in-tab Compute vs Refresh affordance (the scores otherwise need the sidebar).
  const anyScored = molecules.some(m =>
    typeof m.customProps?.SA_Score === 'number' ||
    typeof m.customProps?.RAScore === 'number' ||
    typeof m.customProps?.SCScore === 'number');

  // Auto-compute the exact SA / RA / SC the first time the tab is opened with
  // un-scored molecules — no extra click. (Buyability/ZINC stay one click since
  // they are per-molecule rate-limited external lookups.)
  useEffect(() => {
    if (autoComputed.current || anyScored || computing || !onComputeScores || molecules.length === 0) return;
    autoComputed.current = true;
    runCompute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyScored, molecules.length]);

  // "What makes it hard" — highlight the synthetic-difficulty drivers (stereocentres
  // and saturated/fused ring systems) on the selected molecule's structure.
  const selMol = selectedMolIdx != null ? molecules[selectedMolIdx] : null;
  const diffMap = useMemo(() => {
    if (!selMol) return null;
    const h = getDifficultyHighlight(selMol.smiles);
    const saRaw = typeof selMol.customProps?.SA_Score === 'number' ? selMol.customProps.SA_Score : selMol.props.SC;
    const saVal = Number.isFinite(saRaw) ? (saRaw as number) : null;
    const saText = saVal != null ? `SA ${saVal.toFixed(1)}` : null;
    const heavy = selMol.props.HeavyAtoms || 0;
    // Honest framing, two guards. (1) The Ertl SA score is calibrated on drug-like
    // molecules and mis-scores very small / unusual ones — a tiny molecule with a high SA
    // (e.g. water at 5.9, above morphine's 5.3) is a score artifact, not a hard target, so
    // we say the number is out of range rather than inventing a reason it's "hard".
    // (2) Otherwise the verdict follows the SA score, not the mere presence of a ring or
    // stereocentre; we only say "hard" — and only paint the amber drivers — when the score
    // is genuinely elevated, so amber always means "this is real difficulty".
    const saUnreliable = heavy > 0 && heavy < 6 && saVal != null && saVal >= 4;
    const easy = saVal == null || saVal < 4;
    const tier: 'tiny' | 'hard' | 'simple' | 'nonstructural' =
      saUnreliable ? 'tiny' : easy ? 'simple' : h.atoms.length > 0 ? 'hard' : 'nonstructural';
    const driverParts = [
      h.nStereo > 0 ? `${h.nStereo} stereocentre${h.nStereo === 1 ? '' : 's'}` : null,
      h.nRingAtoms > 0 ? `${h.nRingAtoms} saturated/fused ring atom${h.nRingAtoms === 1 ? '' : 's'}` : null,
    ].filter(Boolean) as string[];
    const svg = getMolSvgHighlighted(
      selMol.smiles,
      tier === 'hard' ? h.atoms : [],
      tier === 'hard' ? h.bonds : [],
      { width: 220, height: 130 },
    );
    return { svg, tier, name: selMol.name.replace(/_/g, ' '), saText, driverParts, heavy };
  }, [selMol]);

  const SORTS: { id: Sort; label: string }[] = [
    { id: 'make', label: 'Easiest to make' },
    { id: 'available', label: 'Most available' },
    { id: 'source', label: 'Hardest to source' },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-medium text-[var(--text-heading)]">Make-ability &amp; cost</h3>
          <p className="text-[12px] text-[var(--text2)] mt-0.5">
            How hard is each compound to make, and can you buy it?
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {onComputeScores && (
            <button
              onClick={runCompute}
              disabled={computing}
              title="The exact Ertl SA score, RAScore (retrosynthetic accessibility), and SCScore (synthetic complexity) — computed automatically when you open this tab, added as Pareto objectives. Click to recompute. Free, no API key."
              className="px-3 py-1.5 rounded text-[11px] font-medium transition-colors border border-[var(--accent)] text-[var(--text)] hover:bg-[#5F7367]/20 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              {computing ? 'Computing…' : anyScored ? 'Refresh SA / RA / SC' : 'Compute SA / RA / SC'}
            </button>
          )}
          {onExportScores && (
            <button
              onClick={onExportScores}
              disabled={computing}
              title="Download these molecules as a CSV with SA / RA / SC added — your imported columns kept, in original order. Pandas-ready (no header comment). Same numbers shown here; computed in your browser."
              className="px-3 py-1.5 rounded text-[11px] font-medium transition-colors border border-[var(--border-10)] text-[var(--text2)] hover:text-[var(--text)] hover:border-[var(--accent)] disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              Export scored CSV
            </button>
          )}
          {onCheckBuyability && (
            <button
              onClick={runBuyability}
              disabled={checkingBuy}
              title="Commercial availability (vendor count) per molecule via PubChem; adds 'Vendors' as a Pareto objective. Free, no API key."
              className="px-3 py-1.5 rounded text-[11px] font-medium transition-colors border border-[var(--border-10)] text-[var(--text2)] hover:text-[var(--text)] hover:border-[var(--accent)] disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              {checkingBuy ? 'Checking buyability…' : anyVendors ? 'Refresh buyability' : 'Check buyability'}
            </button>
          )}
          {onCheckAvailability && (
            <button
              onClick={runAvailability}
              disabled={checkingZinc}
              title="ZINC-22 catalog availability (in-stock + make-on-demand, e.g. Enamine REAL); adds 'ZINC catalogs' as a plottable axis. Free, no API key. Can take 1–3 min."
              className="px-3 py-1.5 rounded text-[11px] font-medium transition-colors border border-[var(--border-10)] text-[var(--text2)] hover:text-[var(--text)] hover:border-[var(--accent)] disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              {checkingZinc ? 'Searching ZINC…' : 'Check availability (ZINC)'}
            </button>
          )}
          <div className="flex items-center gap-1 text-[11px]">
            {SORTS.map(s => (
              <button
                key={s.id}
                onClick={() => setSort(s.id)}
                disabled={s.id === 'available' && !anyVendors}
                className={`px-2.5 py-1 rounded transition-colors disabled:opacity-30 ${
                  sort === s.id
                    ? 'bg-[var(--surface2)] text-[var(--text-heading)]'
                    : 'text-[var(--text2)] hover:text-[var(--text)]'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="text-[11px] text-[var(--text2)] -mt-2">
        {rows.length} compound{rows.length === 1 ? '' : 's'}
        {anyVendors && <> · {buyableCount}/{withData} purchasable</>}
        {' '}· median make-ability {medMake.toFixed(1)} <span className="opacity-60">(1 easy – 10 hard)</span>
      </div>

      {/* Buyability prompt when not yet fetched */}
      {!anyVendors && (
        <div className="text-[11px] text-[var(--text2)] bg-[var(--surface2)] border border-[var(--border-5)] rounded-md px-3 py-2">
          Use <span className="text-[var(--text)]">Check buyability</span> above to add commercial availability (PubChem vendor counts).
        </div>
      )}

      {/* Make-ability map — where the difficulty is, for the selected compound */}
      {selMol && diffMap && (
        <div className="flex flex-wrap items-center gap-4 p-3 bg-[var(--surface)] border border-[var(--border-5)] rounded-md">
          <div className="shrink-0 w-[220px] h-[130px] flex items-center justify-center" dangerouslySetInnerHTML={{ __html: diffMap.svg }} />
          <div className="min-w-0 flex-1">
            {diffMap.tier === 'tiny' ? (
              <>
                <div className="text-[12px] font-medium text-[var(--text-heading)]">{diffMap.name} is too small to score</div>
                <div className="text-[11px] text-[var(--text2)] mt-1 leading-relaxed">
                  At {diffMap.heavy} heavy atom{diffMap.heavy === 1 ? '' : 's'}, {diffMap.name} is below where the Ertl SA score is reliable — it's calibrated on drug-like molecules and mis-scores very small or unusual ones{diffMap.saText ? ` (hence ${diffMap.saText})` : ''}. Read it as a basic building block, not a synthesis target.
                </div>
              </>
            ) : diffMap.tier === 'hard' ? (
              <>
                <div className="text-[12px] font-medium text-[var(--text-heading)]">What makes {diffMap.name} hard to make</div>
                <div className="text-[11px] text-[var(--text2)] mt-1 leading-relaxed">
                  The amber regions drive synthetic difficulty{diffMap.saText ? ` (${diffMap.saText})` : ''}: {diffMap.driverParts.join(' · ')}.
                </div>
                <div className="text-[10px] text-[var(--text2)]/60 mt-1.5 leading-snug">
                  Amber marks the make-ability drivers: stereocentres (exact CIP atoms) and non-aromatic (saturated/fused) ring systems. Simplifying these is usually what lowers the SA score.
                </div>
              </>
            ) : diffMap.tier === 'simple' ? (
              <>
                <div className="text-[12px] font-medium text-[var(--text-heading)]">{diffMap.name} is simple to make</div>
                <div className="text-[11px] text-[var(--text2)] mt-1 leading-relaxed">
                  {diffMap.driverParts.length > 0
                    ? <>It has {diffMap.driverParts.join(' and ')}{diffMap.saText ? `, but at ${diffMap.saText} it's a routine target` : ' — a routine target'}.</>
                    : <>No stereocentres or saturated rings{diffMap.saText ? ` — at ${diffMap.saText} there's nothing structural to simplify` : ''}.</>}
                </div>
              </>
            ) : (
              <>
                <div className="text-[12px] font-medium text-[var(--text-heading)]">{diffMap.name}'s difficulty isn't structural</div>
                <div className="text-[11px] text-[var(--text2)] mt-1 leading-relaxed">
                  No stereocentres or saturated rings — at {diffMap.saText} the complexity comes from size or unusual fragments rather than 3D shape, so there's no single region to simplify.
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Ranked list */}
      <div className="space-y-1.5 max-h-[calc(100vh-320px)] overflow-y-auto custom-scrollbar">
        {rows.map(r => {
          const isSelected = selectedMolIdx === r.idx;
          const ease = Math.min(1, Math.max(0, (10 - r.make) / 9)); // 1 = trivially easy
          const easy = r.make <= 3;
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
              {/* Structure */}
              <div className="shrink-0 w-[48px] h-[36px] rounded overflow-hidden flex items-center justify-center">
                {svg
                  ? <span className="block w-full h-full" dangerouslySetInnerHTML={{ __html: themedSvg(svg) }} style={{ lineHeight: 0 }} />
                  : <span className="text-[8px] text-[var(--text2)]">?</span>}
              </div>

              {/* Name + call + make-ability bar + why */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[12px] font-medium text-[var(--text-heading)] truncate">{r.mol.name.replace(/_/g, ' ')}</span>
                  {r.mol.paretoRank === 1 && (
                    <span className="shrink-0 text-[8px] font-medium text-[#22c55e] bg-[#22c55e]/10 px-1 py-0.5 rounded">P</span>
                  )}
                  {r.call === 'buy' && (
                    <span className="shrink-0 text-[9px] font-medium text-[#3b82f6] bg-[#3b82f6]/12 px-1.5 py-0.5 rounded" title="Readily purchasable — buy rather than synthesize">buy</span>
                  )}
                  {r.call === 'make' && (
                    <span className="shrink-0 text-[9px] font-medium text-[var(--text2)] bg-[var(--surface2)] px-1.5 py-0.5 rounded" title="No commercial vendors found, but tractable to synthesize">make</span>
                  )}
                  {r.call === 'hard' && (
                    <span className="shrink-0 text-[9px] font-medium text-[#b45309] bg-[#b45309]/12 px-1.5 py-0.5 rounded" title="No commercial vendors found and high predicted synthetic difficulty">hard to source</span>
                  )}
                  {r.disagree && (
                    <span className="shrink-0 text-[9px] font-medium text-[#b45309] bg-[#b45309]/12 px-1.5 py-0.5 rounded" title={r.disagreeReason}>scores disagree</span>
                  )}
                </div>
                {/* Make-ability bar (fuller = easier) */}
                <div className="w-full h-[3px] bg-[var(--border-5)] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.max(ease * 100, 2)}%`,
                      backgroundColor: easy ? '#22c55e' : `color-mix(in srgb, var(--accent) ${Math.max(ease * 100, 20)}%, var(--border-10))`,
                    }}
                  />
                </div>
                {/* Why (drivers of the estimate) */}
                {r.mol.scFactors && r.mol.scFactors.length > 0 && (
                  <div className="mt-1 text-[10px] text-[var(--text2)] truncate" title={r.mol.scFactors.join(', ')}>
                    {r.mol.scFactors.slice(0, 3).join(' · ')}
                  </div>
                )}
              </div>

              {/* Make-ability value — SA / RA / SC read uniformly (label + number) once
                  computed; the estimate keeps the prominent headline number + "est." */}
              <div className="shrink-0 text-right w-[60px]">
                {r.exact ? (
                  <div className="text-[12px] font-mono text-[var(--text)]" title="Ertl SA score (1 easy – 10 hard)">SA {r.make.toFixed(1)}</div>
                ) : (
                  <>
                    <div className="text-[13px] font-mono text-[var(--text)]">{r.make.toFixed(1)}</div>
                    <div className="text-[9px] text-[var(--text2)]/70" title="Fast client-side estimate">est.</div>
                  </>
                )}
                {typeof r.mol.customProps.RAScore === 'number' && (
                  <div className="text-[10px] font-mono text-[var(--text2)]/70" title="Retrosynthetic accessibility (RAScore): 0 hard – 1 easy">RA {r.mol.customProps.RAScore.toFixed(2)}</div>
                )}
                {typeof r.mol.customProps.SCScore === 'number' && (
                  <div className="text-[10px] font-mono text-[var(--text2)]/70" title="Synthetic complexity (SCScore): 1 simple – 5 complex">SC {r.mol.customProps.SCScore.toFixed(1)}</div>
                )}
              </div>

              {/* Buyability + price */}
              <div className="shrink-0 text-right w-[96px]">
                {!r.vendorsKnown ? (
                  <span className="text-[11px] text-[var(--text2)]/40" title="Use Check buyability above">—</span>
                ) : r.buyable ? (
                  <a
                    href={`https://pubchem.ncbi.nlm.nih.gov/compound/${r.cid ?? ''}#section=Chemical-Vendors`}
                    target="_blank" rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    title={`${r.vendors} commercial vendors on PubChem — click for suppliers & prices`}
                    className="text-[11px] text-[#3b82f6] hover:underline"
                  >
                    {r.vendors} vendors
                  </a>
                ) : (
                  <span className="text-[11px] text-[var(--text2)]" title="No commercial vendors found on PubChem — likely must be synthesized">not buyable</span>
                )}
                {r.mol.cost?.purchasable && (
                  <a
                    href={`https://cartblanche22.docking.org/substance/${r.mol.cost.zincId ?? ''}`}
                    target="_blank" rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    title={`Found in ${r.mol.cost.catalogs} ZINC vendor catalog${r.mol.cost.catalogs === 1 ? '' : 's'} (Enamine, eMolecules, …), in-stock + make-on-demand. ZINC list prices are nominal placeholders — request a vendor quote for real pricing.`}
                    className="block mt-0.5 text-[10px] text-[#3b82f6]/90 hover:underline"
                  >
                    ZINC{r.mol.cost.catalogs > 0 ? ` · ${r.mol.cost.catalogs}` : ''}
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Methodology footnote */}
      <div className="flex items-start gap-2 pt-2 border-t border-[var(--border-5)] text-[10px] text-[var(--text2)] leading-relaxed">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 opacity-50 mt-0.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        <span>
          Make-ability is the instant client-side synthetic-complexity estimate{allExact ? ', shown here as the exact Ertl SA score from the compute tier' : ' (named “est.”), replaced in place by the exact Ertl SA score once the compute tier runs'} (1 easy – 10 hard).
          Availability is the PubChem commercial vendor count; the make-vs-buy call treats make-ability ≥ {HARD} with no vendors as “hard to source”. Vendor links open the PubChem supplier list, where per-quantity prices are listed.
        </span>
      </div>
    </div>
  );
}

export default React.memo(MakeabilityView);
