import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { Molecule } from '../../utils/types';
import { initRDKitCache, getMolSvg } from '../../utils/chem';
import { useTheme } from '../../contexts/ThemeContext';
import { mannWhitneyU, sigStars } from '../../utils/stats';
import { PRIMARY_ADMET_KEYS, ADMET_AI_PROPERTY_META, formatAdmetAIValue, getAdmetAICategoryColor } from '../../utils/admetAI';

/* ═══════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════ */

interface ScaffoldInfo {
  smiles: string;
  svg: string;
  count: number;
  molIndices: number[];
  avgMW: number;
  avgLogP: number;
  avgTPSA: number;
  paretoFraction: number;
}

interface EndpointResult {
  endpoint: string;
  scaffoldMean: number;
  restMean: number;
  delta: number;
  p: number;
  stars: string;
  fracAbove: number;
  isLiability: boolean;
  category: string;
}

interface ScaffoldReport {
  scaffold: ScaffoldInfo;
  endpoints: EndpointResult[];
  liabilityCount: number;
  topLiabilities: EndpointResult[];
}

interface Props {
  molecules: Molecule[];
  selectedMolIdx?: number | null;
  setSelectedMolIdx?: (idx: number | null) => void;
}

type SubTab = 'structure' | 'safety' | 'detail';

/* ═══════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════ */

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'structure', label: 'Structure' },
  { id: 'safety', label: 'Safety' },
  { id: 'detail', label: 'Detail' },
];

const HEATMAP_KEYS = [
  'hERG', 'AMES', 'DILI', 'ClinTox', 'NR-AhR',
  'BBB_Martins', 'CYP3A4_Veith', 'CYP1A2_Veith',
  'Pgp_Broccatelli', 'HIA_Hou',
];

const HEATMAP_SHORT: Record<string, string> = {
  hERG: 'hERG', AMES: 'Ames', DILI: 'DILI', ClinTox: 'ClinTox',
  'NR-AhR': 'AhR', 'BBB_Martins': 'BBB', 'CYP3A4_Veith': 'CYP3A4',
  'CYP1A2_Veith': 'CYP1A2', 'Pgp_Broccatelli': 'Pgp', 'HIA_Hou': 'HIA',
};

/* ═══════════════════════════════════════════════════════
   SVG helpers
   ═══════════════════════════════════════════════════════ */

function themeSvg(svg: string): string {
  const cs = getComputedStyle(document.documentElement);
  const stroke = cs.getPropertyValue('--mol-stroke').trim() || '#E8E6E3';
  const isDark = document.documentElement.classList.contains('dark');
  let s = svg
    .replace(/fill:#FFFFFF/g, 'fill:transparent')
    .replace(/fill:#ffffff/g, 'fill:transparent')
    .replace(/fill:white/gi, 'fill:transparent')
    .replace(/fill:#000000/g, `fill:${stroke}`)
    .replace(/stroke:#000000/g, `stroke:${stroke}`)
    .replace(/<rect[^>]*style=['"][^'"]*fill:\s*(white|#FFFFFF)[^'"]*['"][^>]*>/gi, (m) =>
      m.replace(/fill:\s*(white|#FFFFFF)/i, 'fill:transparent')
    );
  if (isDark) {
    s = s.replace(/fill:#0000FF/gi, 'fill:#809FFF')
      .replace(/fill:#FF0000/gi, 'fill:#FF8A80')
      .replace(/fill:#00CC00/gi, 'fill:#69DB7C')
      .replace(/fill:#33CCCC/gi, 'fill:#66E0E0')
      .replace(/fill:#B2B200/gi, 'fill:#E0D64A');
  }
  return s;
}

function scalableSvg(svg: string): string {
  const wMatch = svg.match(/width='(\d+)px'/);
  const hMatch = svg.match(/height='(\d+)px'/);
  const w = wMatch ? wMatch[1] : '200';
  const h = hMatch ? hMatch[1] : '150';
  return svg
    .replace(/width='[^']*'/, `width='100%'`)
    .replace(/height='[^']*'/, `height='100%'`)
    .replace(/<svg /, `<svg viewBox='0 0 ${w} ${h}' `);
}

function getThemedScaffoldSvg(smiles: string, RDKit: any): string {
  try {
    const mol = RDKit.get_mol(smiles);
    if (mol && mol.is_valid()) {
      const raw = mol.get_svg_with_highlights(
        JSON.stringify({ width: 200, height: 150, bondLineWidth: 1.5, backgroundColour: [0, 0, 0, 0] })
      );
      mol.delete();
      return scalableSvg(themeSvg(raw));
    }
  } catch { /* ignore */ }
  return '';
}

/* ═══════════════════════════════════════════════════════
   Murcko scaffold extraction
   ═══════════════════════════════════════════════════════ */

async function extractScaffolds(molecules: Molecule[]): Promise<ScaffoldInfo[]> {
  const RDKit = await initRDKitCache();
  const scaffoldMap = new Map<string, number[]>();

  for (let i = 0; i < molecules.length; i++) {
    const { smiles } = molecules[i];
    let scaffoldSmiles = '';

    try {
      const mol = RDKit.get_mol(smiles);
      if (mol && mol.is_valid()) {
        const desc = JSON.parse(mol.get_descriptors());
        const numRings = desc.NumRings || 0;

        const ringQ = RDKit.get_qmol('[R]');
        let ringAtoms = new Set<number>();
        if (ringQ) {
          try {
            const ringMatches = JSON.parse(mol.get_substruct_matches(ringQ));
            ringAtoms = new Set(ringMatches.map((m: { atoms: number[] }) => m.atoms[0]));
          } catch { /* parse failed */ }
          ringQ.delete();
        }

        if (ringAtoms.size === 0 && numRings > 0) {
          for (const pattern of ['[r]', '[R1]', '[x2]']) {
            const q = RDKit.get_qmol(pattern);
            if (q) {
              try {
                const mm = JSON.parse(mol.get_substruct_matches(q));
                q.delete();
                if (mm.length > 0) { ringAtoms = new Set(mm.map((m: { atoms: number[] }) => m.atoms[0])); break; }
              } catch { q.delete(); }
            }
          }
        }

        if (ringAtoms.size > 0) {
          const molblock = mol.get_molblock();
          const lines = molblock.split('\n');
          const countsLine = lines[3];
          const nAtoms = parseInt(countsLine.substring(0, 3).trim());
          const nBonds = parseInt(countsLine.substring(3, 6).trim());
          const bondStart = 4 + nAtoms;
          const adj: Set<number>[] = Array.from({ length: nAtoms }, () => new Set());
          for (let b = 0; b < nBonds; b++) {
            const bline = lines[bondStart + b];
            const a1 = parseInt(bline.substring(0, 3).trim()) - 1;
            const a2 = parseInt(bline.substring(3, 6).trim()) - 1;
            adj[a1].add(a2); adj[a2].add(a1);
          }

          // Iterative pruning: remove leaf non-ring atoms
          const alive = new Set<number>();
          for (let a = 0; a < nAtoms; a++) alive.add(a);
          let changed = true;
          while (changed) {
            changed = false;
            for (const a of alive) {
              if (ringAtoms.has(a)) continue;
              let deg = 0;
              for (const nb of adj[a]) { if (alive.has(nb)) deg++; }
              if (deg <= 1) { alive.delete(a); changed = true; }
            }
          }

          if (alive.size > 0 && alive.size < nAtoms) {
            const oldToNew = new Map<number, number>();
            let newIdx = 0;
            for (let a = 0; a < nAtoms; a++) { if (alive.has(a)) { oldToNew.set(a, newIdx); newIdx++; } }
            const newAtomLines = Array.from({ length: nAtoms }, (_, a) => a).filter(a => alive.has(a)).map(a => lines[4 + a]);
            const newBondLines: string[] = [];
            for (let b = 0; b < nBonds; b++) {
              const bline = lines[bondStart + b];
              const a1 = parseInt(bline.substring(0, 3).trim()) - 1;
              const a2 = parseInt(bline.substring(3, 6).trim()) - 1;
              if (alive.has(a1) && alive.has(a2)) {
                newBondLines.push(String(oldToNew.get(a1)! + 1).padStart(3) + String(oldToNew.get(a2)! + 1).padStart(3) + bline.substring(6));
              }
            }
            const newCounts = String(newIdx).padStart(3) + String(newBondLines.length).padStart(3) + countsLine.substring(6);
            const newMolblock = [lines[0], lines[1], lines[2], newCounts, ...newAtomLines, ...newBondLines, 'M  END', ''].join('\n');
            const scaffMol = RDKit.get_mol(newMolblock);
            if (scaffMol && scaffMol.is_valid()) { scaffoldSmiles = scaffMol.get_smiles(); scaffMol.delete(); }
          } else if (alive.size === nAtoms) {
            scaffoldSmiles = mol.get_smiles();
          }
        }
        mol.delete();
      }
    } catch { /* acyclic */ }

    if (!scaffoldMap.has(scaffoldSmiles)) scaffoldMap.set(scaffoldSmiles, []);
    scaffoldMap.get(scaffoldSmiles)!.push(i);
  }

  const infos: ScaffoldInfo[] = [];
  for (const [smiles, indices] of scaffoldMap) {
    const mols = indices.map(i => molecules[i]);
    const avgMW = mols.reduce((s, m) => s + m.props.MW, 0) / mols.length;
    const avgLogP = mols.reduce((s, m) => s + m.props.LogP, 0) / mols.length;
    const avgTPSA = mols.reduce((s, m) => s + m.props.TPSA, 0) / mols.length;
    const paretoFraction = mols.filter(m => m.paretoRank === 1).length / mols.length;
    const svg = smiles.length > 0 ? getThemedScaffoldSvg(smiles, RDKit) : '';
    infos.push({ smiles, svg, count: indices.length, molIndices: indices, avgMW, avgLogP, avgTPSA, paretoFraction });
  }
  infos.sort((a, b) => b.count - a.count);
  return infos.slice(0, 30);
}

/* ═══════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════ */

function getVal(mol: Molecule, ep: string): number | null {
  const v = mol.customProps[ep];
  return typeof v === 'number' ? v : null;
}

function DeltaBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(Math.abs(value) / max, 1) * 100 : 0;
  const isPositive = value > 0;
  return (
    <div className="flex-1 h-[3px] bg-[var(--border-5)] rounded-full overflow-hidden relative">
      <div
        className="absolute top-0 h-full rounded-full transition-all"
        style={{
          width: `${pct}%`,
          left: isPositive ? '50%' : `${50 - pct}%`,
          backgroundColor: isPositive ? '#ef4444' : '#22c55e',
          opacity: 0.7,
        }}
      />
      <div className="absolute top-0 left-1/2 w-px h-full bg-[var(--border-20)]" />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   MolCard — reusable compound card
   ═══════════════════════════════════════════════════════ */

function MolCard({ mol, isSelected, onClick }: {
  mol: Molecule; isSelected: boolean; onClick: () => void;
}) {
  const svg = getMolSvg(mol.smiles);
  const themed = svg ? scalableSvg(themeSvg(svg)) : null;
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-2.5 p-2 rounded-md cursor-pointer border transition-colors ${
        isSelected
          ? 'bg-[#5F7367]/10 border-[#5F7367]/30'
          : 'bg-[var(--bg)] border-[var(--border-5)] hover:border-[var(--border-10)]'
      }`}
    >
      <div className="shrink-0 w-[48px] h-[36px] rounded overflow-hidden border border-[var(--border-5)] bg-[var(--surface)] flex items-center justify-center">
        {themed
          ? <span className="block w-full h-full" dangerouslySetInnerHTML={{ __html: themed }} style={{ lineHeight: 0 }} />
          : <span className="text-[8px] text-[var(--text2)]">?</span>
        }
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-[var(--text)] truncate">{mol.name}</span>
          {mol.paretoRank === 1 && (
            <span className="shrink-0 text-[8px] font-medium text-[#22c55e] bg-[#22c55e]/10 px-1 py-0.5 rounded">P</span>
          )}
        </div>
        <div className="text-[9px] text-[var(--text2)] mt-0.5">
          MW {mol.props.MW.toFixed(0)} / LogP {mol.props.LogP.toFixed(1)} / TPSA {mol.props.TPSA.toFixed(0)}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   Main Component
   ═══════════════════════════════════════════════════════ */

function ScaffoldView({ molecules, selectedMolIdx, setSelectedMolIdx }: Props) {
  const { themeVersion } = useTheme();
  const [scaffolds, setScaffolds] = useState<ScaffoldInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedScaffold, setSelectedScaffold] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<SubTab>('structure');

  // Extract scaffolds (re-run on theme change to regenerate SVGs)
  useEffect(() => {
    if (molecules.length === 0) { setScaffolds([]); setSelectedScaffold(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    extractScaffolds(molecules).then(infos => {
      if (cancelled) return;
      setScaffolds(infos);
      if (infos.length > 0 && !selectedScaffold) setSelectedScaffold(infos[0].smiles);
      setLoading(false);
    }).catch(e => {
      if (!cancelled) { setError(e instanceof Error ? e.message : 'Failed'); setLoading(false); }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [molecules, themeVersion]);

  const activeScaffold = scaffolds.find(s => s.smiles === selectedScaffold) ?? null;

  const bestScaffold = useMemo(() => {
    if (scaffolds.length === 0) return null;
    return scaffolds.reduce((best, s) => (s.paretoFraction > best.paretoFraction || (s.paretoFraction === best.paretoFraction && s.count > best.count)) ? s : best);
  }, [scaffolds]);

  /* ─── ADMET/Safety computations ──────────────────── */

  const availableEndpoints = useMemo(() => {
    return (PRIMARY_ADMET_KEYS as unknown as string[]).filter(ep => {
      let n = 0;
      for (const mol of molecules) { if (getVal(mol, ep) !== null) n++; if (n >= 3) return true; }
      return false;
    });
  }, [molecules]);

  const heatmapKeys = useMemo(() => HEATMAP_KEYS.filter(k => availableEndpoints.includes(k)), [availableEndpoints]);
  const hasAdmet = availableEndpoints.length > 0;

  // Statistical reports (scaffolds with n>=3)
  const reports = useMemo<ScaffoldReport[]>(() => {
    if (scaffolds.length < 2 || availableEndpoints.length === 0) return [];
    const eligible = scaffolds.filter(g => g.count >= 3);
    if (eligible.length === 0) return [];
    const nTests = eligible.length * availableEndpoints.length;
    return eligible.map(scaffold => {
      const scaffoldMols = scaffold.molIndices.map(i => molecules[i]);
      const restSet = new Set(scaffold.molIndices);
      const restMols = molecules.filter((_, i) => !restSet.has(i));
      const endpoints = availableEndpoints.map(ep => {
        const sv = scaffoldMols.map(m => getVal(m, ep)).filter((v): v is number => v !== null);
        const rv = restMols.map(m => getVal(m, ep)).filter((v): v is number => v !== null);
        const sm = sv.length ? sv.reduce((a, b) => a + b) / sv.length : 0;
        const rm = rv.length ? rv.reduce((a, b) => a + b) / rv.length : 0;
        const delta = sm - rm;
        const meta = ADMET_AI_PROPERTY_META[ep];
        const cat = meta?.category || 'toxicity';
        if (sv.length < 2 || rv.length < 2) return { endpoint: ep, scaffoldMean: sm, restMean: rm, delta, p: 1, stars: '', fracAbove: 0, isLiability: false, category: cat };
        const { p } = mannWhitneyU(sv, rv);
        const cp = Math.min(p * nTests, 1);
        const frac = sv.filter(v => v > 0.5).length / sv.length;
        return { endpoint: ep, scaffoldMean: sm, restMean: rm, delta, p: cp, stars: sigStars(cp), fracAbove: frac, isLiability: frac >= 0.8 && cp < 0.05 && sm > rm, category: cat };
      });
      const liabs = endpoints.filter(e => e.isLiability);
      return { scaffold, endpoints, liabilityCount: liabs.length, topLiabilities: liabs.sort((a, b) => a.p - b.p) };
    });
  }, [scaffolds, availableEndpoints, molecules]);

  const totalAlerts = useMemo(() => reports.reduce((s, r) => s + r.liabilityCount, 0), [reports]);
  const hasStats = reports.length > 0;

  const activeReport = useMemo(() =>
    selectedScaffold ? reports.find(r => r.scaffold.smiles === selectedScaffold) : null,
    [selectedScaffold, reports]);

  const maxDelta = useMemo(() => {
    let m = 0;
    for (const r of reports) for (const e of r.endpoints) m = Math.max(m, Math.abs(e.delta));
    return m || 1;
  }, [reports]);

  const handleSelectScaffold = useCallback((smiles: string) => {
    setSelectedScaffold(smiles);
  }, []);

  // Auto-switch to safety tab when ADMET data appears and alerts detected
  useEffect(() => {
    if (totalAlerts > 0 && subTab === 'structure') {
      // Don't auto-switch if user already interacted
    }
  }, [totalAlerts, subTab]);

  /* ─── Loading / Error / Empty ────────────────────── */

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 gap-3 text-[var(--text2)] text-[13px]">
        <div className="w-4 h-4 border-2 border-[#5F7367]/30 border-t-[#5F7367] rounded-full animate-spin" />
        Computing Murcko scaffolds...
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-[var(--surface)] border border-[var(--border-5)] rounded-lg p-8 text-center text-[#ef4444] text-[13px]">
        {error}
      </div>
    );
  }

  if (scaffolds.length === 0) {
    return (
      <div className="bg-[var(--surface)] border border-[var(--border-5)] rounded-lg p-12 text-center">
        <p className="text-[var(--text2)] text-[13px]">No molecules to analyse.</p>
      </div>
    );
  }

  /* ─── Render ─────────────────────────────────────── */
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-medium text-[var(--text-heading)]">Scaffold Analysis</h3>
          <p className="text-[12px] text-[var(--text2)] mt-0.5">
            {scaffolds.length} unique scaffold{scaffolds.length !== 1 ? 's' : ''} across {molecules.length} molecules
            {scaffolds.length === 30 ? ' (top 30)' : ''}
            {hasAdmet && <> · {availableEndpoints.length} ADMET endpoints</>}
            {hasStats && <> · {reports.length} testable (n≥3)</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {bestScaffold && bestScaffold.count > 1 && (
            <button
              className="text-[11px] text-[var(--text2)] hover:text-[var(--text)] transition-colors"
              onClick={() => { handleSelectScaffold(bestScaffold.smiles); setSubTab('detail'); }}
            >
              Best: {(bestScaffold.paretoFraction * 100).toFixed(0)}% Pareto, {bestScaffold.count} mols
            </button>
          )}
          <button
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded border border-[var(--border-10)] text-[var(--text2)] hover:text-[var(--text)] hover:border-[var(--border-20)] transition-colors"
            title="Export scaffold summary as CSV"
            onClick={() => {
              const admetCols = availableEndpoints.slice(0, 10);
              const header = ['scaffold_smiles','n_compounds','pareto_fraction','avg_MW','avg_LogP','avg_TPSA',
                ...admetCols.map(k => `mean_${k}`)].join(',');
              const rows = scaffolds.map(s => {
                const rep = reports.find(r => r.scaffold.smiles === s.smiles);
                const admetVals = admetCols.map(k => {
                  const ep = rep?.endpoints.find(e => e.endpoint === k);
                  return ep ? ep.scaffoldMean.toFixed(3) : '';
                });
                return [
                  `"${s.smiles}"`,
                  s.count,
                  s.paretoFraction.toFixed(3),
                  s.avgMW.toFixed(1),
                  s.avgLogP.toFixed(2),
                  s.avgTPSA.toFixed(1),
                  ...admetVals,
                ].join(',');
              });
              const csv = [header, ...rows].join('\n');
              const blob = new Blob([csv], { type: 'text/csv' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url; a.download = 'scaffold_summary.csv'; a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            CSV
          </button>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-1 border-b border-[var(--border-5)]">
        {SUB_TABS.map(t => {
          const showBadge = t.id === 'safety' && totalAlerts > 0;
          return (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              className={`px-3 py-1.5 text-[12px] font-medium transition-colors border-b-2 flex items-center gap-1.5 ${
                subTab === t.id
                  ? 'border-[var(--accent)] text-[var(--text-heading)]'
                  : 'border-transparent text-[var(--text2)] hover:text-[var(--text)]'
              }`}
            >
              {t.label}
              {showBadge && (
                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-[#ef4444]/15 text-[#ef4444] leading-none">
                  {totalAlerts}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Alerts banner (visible on all tabs when liabilities exist) */}
      {hasStats && totalAlerts > 0 && (
        <div className="p-3 bg-[#ef4444]/5 border border-[#ef4444]/20 rounded-lg space-y-2">
          <div className="flex items-center gap-2 text-[12px]">
            <span className="w-2 h-2 rounded-full bg-[#ef4444] shrink-0" />
            <span className="font-semibold text-[#ef4444]">{totalAlerts} scaffold-level liabilit{totalAlerts === 1 ? 'y' : 'ies'}</span>
            <span className="text-[var(--text2)]">across {reports.filter(r => r.liabilityCount > 0).length} scaffold{reports.filter(r => r.liabilityCount > 0).length !== 1 ? 's' : ''}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {reports.filter(r => r.liabilityCount > 0).map(r => (
              <button
                key={r.scaffold.smiles}
                onClick={() => { handleSelectScaffold(r.scaffold.smiles); setSubTab('detail'); }}
                className={`flex items-center gap-2 px-2.5 py-1.5 bg-[var(--surface)] border rounded text-[11px] transition-colors ${
                  selectedScaffold === r.scaffold.smiles
                    ? 'border-[#ef4444]/40 ring-1 ring-[#ef4444]/20'
                    : 'border-[#ef4444]/20 hover:border-[#ef4444]/40'
                }`}
              >
                {r.scaffold.svg ? (
                  <div className="w-8 h-6 shrink-0" dangerouslySetInnerHTML={{ __html: r.scaffold.svg }} />
                ) : (
                  <span className="text-[9px] text-[var(--text2)] w-8 shrink-0">{r.scaffold.smiles === '' ? 'acyc' : '...'}</span>
                )}
                <span className="text-[var(--text)] font-medium">{r.scaffold.count} mols</span>
                <span className="text-[#ef4444] font-semibold">{r.liabilityCount}</span>
              </button>
            ))}
          </div>
          <p className="text-[10px] text-[var(--text2)]">≥80% of scaffold above 0.5 threshold, Bonferroni-corrected p &lt; 0.05</p>
        </div>
      )}

      {/* ═══════════════════════════════════════════════
           STRUCTURE tab — Pareto-focused scaffold grid
         ═══════════════════════════════════════════════ */}
      {subTab === 'structure' && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2.5">
            {scaffolds.map((s, idx) => {
              const isSelected = s.smiles === selectedScaffold;
              const report = reports.find(r => r.scaffold.smiles === s.smiles);
              const liabCount = report?.liabilityCount ?? 0;
              return (
                <button
                  key={s.smiles || '__acyclic__'}
                  onClick={() => { handleSelectScaffold(s.smiles); setSubTab('detail'); }}
                  className={`relative text-left rounded-lg border p-2.5 transition-all ${
                    isSelected
                      ? 'bg-[#5F7367]/10 border-[#5F7367]/50 ring-1 ring-[#5F7367]/30'
                      : liabCount > 0
                        ? 'bg-[var(--surface)] border-[#ef4444]/15 hover:border-[#ef4444]/30'
                        : 'bg-[var(--surface)] border-[var(--border-5)] hover:border-[var(--border-20)] hover:bg-[var(--bg)]'
                  }`}
                >
                  <span className="absolute top-1.5 left-2 text-[9px] font-mono text-[var(--text2)]">#{idx + 1}</span>
                  <span className="absolute top-1.5 right-2 text-[10px] font-semibold text-[var(--text-heading)]">{s.count}</span>

                  <div className="w-full flex items-center justify-center mt-3 mb-2" style={{ height: 70 }}>
                    {s.svg
                      ? <span className="block w-full h-full" dangerouslySetInnerHTML={{ __html: s.svg }} style={{ lineHeight: 0 }} />
                      : <span className="text-[11px] text-[var(--text2)] text-center leading-relaxed">{s.smiles === '' ? 'Acyclic' : s.smiles.slice(0, 16)}</span>
                    }
                  </div>

                  {/* Pareto bar */}
                  {s.paretoFraction > 0 && (
                    <div className="flex items-center gap-1.5 mt-1">
                      <div className="flex-1 h-1 bg-[var(--border-5)] rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-[#22c55e]/70" style={{ width: `${s.paretoFraction * 100}%` }} />
                      </div>
                      <span className="text-[9px] text-[#22c55e] shrink-0">{(s.paretoFraction * 100).toFixed(0)}%</span>
                    </div>
                  )}

                  {/* Liability indicator */}
                  {liabCount > 0 && (
                    <div className="flex items-center gap-1 mt-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#ef4444]" />
                      <span className="text-[9px] text-[#ef4444]">{liabCount} liabilit{liabCount === 1 ? 'y' : 'ies'}</span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Selected scaffold detail panel (structure mode) */}
          {activeScaffold && (
            <div className="bg-[var(--surface)] border border-[var(--border-5)] rounded-lg p-5">
              <div className="flex items-center gap-6 mb-4 flex-wrap">
                <div className="flex items-center gap-3 min-w-0">
                  {activeScaffold.svg && (
                    <div className="shrink-0 w-[80px] h-[60px] rounded border border-[var(--border-5)] overflow-hidden">
                      <span className="block w-full h-full" dangerouslySetInnerHTML={{ __html: activeScaffold.svg }} style={{ lineHeight: 0 }} />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-[var(--text-heading)]">
                      {activeScaffold.smiles ? 'Scaffold' : 'Acyclic'} ({activeScaffold.count} molecules)
                    </div>
                    {activeScaffold.smiles && (
                      <div className="text-[10px] font-mono text-[var(--text2)] truncate mt-0.5" title={activeScaffold.smiles}>
                        {activeScaffold.smiles}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4 text-[12px]">
                  {[
                    { label: 'MW', value: activeScaffold.avgMW.toFixed(0) },
                    { label: 'LogP', value: activeScaffold.avgLogP.toFixed(2) },
                    { label: 'TPSA', value: activeScaffold.avgTPSA.toFixed(0) },
                  ].map(stat => (
                    <div key={stat.label} className="text-center">
                      <div className="text-[10px] text-[var(--text2)]">{stat.label}</div>
                      <div className="font-mono text-[var(--text-heading)]">{stat.value}</div>
                    </div>
                  ))}
                  <div className="text-center">
                    <div className="text-[10px] text-[var(--text2)]">Pareto</div>
                    <div className={`font-mono font-semibold ${activeScaffold.paretoFraction > 0 ? 'text-[#22c55e]' : 'text-[var(--text2)]'}`}>
                      {(activeScaffold.paretoFraction * 100).toFixed(0)}%
                    </div>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[400px] overflow-y-auto custom-scrollbar">
                {activeScaffold.molIndices.map(molIdx => (
                  <MolCard
                    key={molIdx}
                    mol={molecules[molIdx]}
                    isSelected={selectedMolIdx === molIdx}
                    onClick={() => setSelectedMolIdx?.(selectedMolIdx === molIdx ? null : molIdx)}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ═══════════════════════════════════════════════
           SAFETY tab — ADMET heatmap + liability summary
         ═══════════════════════════════════════════════ */}
      {subTab === 'safety' && (
        <>
          {!hasAdmet && (
            <div className="p-3 bg-[#f59e0b]/5 border border-[#f59e0b]/20 rounded-lg text-[12px] text-[#f59e0b]">
              <span className="font-medium">ADMET predictions needed.</span>{' '}
              <span className="opacity-80">Go to the ADMET tab (predictions run automatically), then return here.</span>
            </div>
          )}

          {hasAdmet && heatmapKeys.length > 0 && (
            <div className="overflow-x-auto border border-[var(--border-5)] rounded-lg" style={{ maxWidth: '100%' }}>
              <table className="min-w-full border-collapse" style={{ width: 'max-content' }}>
                <thead>
                  <tr className="bg-[var(--surface)]">
                    <th className="sticky left-0 bg-[var(--surface)] z-10 px-3 py-2 text-left text-[10px] uppercase tracking-wider text-[var(--text2)] font-medium border-b border-[var(--border-5)] min-w-[130px]">Scaffold</th>
                    <th className="px-2 py-2 text-center text-[10px] uppercase tracking-wider text-[var(--text2)] font-medium border-b border-[var(--border-5)] min-w-[32px]">n</th>
                    {heatmapKeys.map(k => {
                      const meta = ADMET_AI_PROPERTY_META[k];
                      return (
                        <th
                          key={k}
                          className="px-2 py-2 text-center text-[10px] uppercase tracking-wider font-medium border-b border-[var(--border-5)] min-w-[52px]"
                          style={{ color: meta ? getAdmetAICategoryColor(meta.category) : 'var(--text2)' }}
                          title={meta?.description}
                        >
                          {HEATMAP_SHORT[k] || k}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {scaffolds.map(g => {
                    const mols = g.molIndices.map(i => molecules[i]);
                    const isSelected = selectedScaffold === g.smiles;
                    return (
                      <tr
                        key={g.smiles}
                        onClick={() => { handleSelectScaffold(g.smiles); setSubTab('detail'); }}
                        className={`cursor-pointer transition-colors border-b border-[var(--border-5)]/50 ${
                          isSelected ? 'bg-[#5F7367]/10' : 'hover:bg-white/[0.02]'
                        }`}
                      >
                        <td className="sticky left-0 bg-[var(--bg)] z-10 px-3 py-1.5 border-b border-[var(--border-5)]">
                          <div className="flex items-center gap-2">
                            <div className="shrink-0 w-10 h-8 rounded border border-[var(--border-5)] overflow-hidden flex items-center justify-center bg-[var(--surface)]">
                              {g.svg
                                ? <span className="block w-full h-full" dangerouslySetInnerHTML={{ __html: g.svg }} style={{ lineHeight: 0 }} />
                                : <span className="text-[8px] text-[var(--text2)]">{g.smiles === '' ? 'acyc' : '?'}</span>
                              }
                            </div>
                            <div className="min-w-0">
                              {g.molIndices.length === 1
                                ? <div className="text-[11px] font-medium text-[var(--text)] truncate max-w-[70px]">{molecules[g.molIndices[0]].name}</div>
                                : <div className="text-[10px] font-mono text-[var(--text2)] truncate max-w-[70px]" title={g.smiles}>{g.smiles.slice(0, 14) || 'Acyclic'}</div>
                              }
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-center text-[11px] font-medium text-[var(--text2)] border-b border-[var(--border-5)]">{g.count}</td>
                        {heatmapKeys.map(ep => {
                          const vals = mols.map(m => getVal(m, ep)).filter((v): v is number => v !== null);
                          if (!vals.length) return <td key={ep} className="px-2 py-1.5 text-center text-[11px] text-[var(--text2)]/40 border-b border-[var(--border-5)]">--</td>;
                          const mean = vals.reduce((a, b) => a + b) / vals.length;
                          const fmt = formatAdmetAIValue(ep, mean);
                          return (
                            <td key={ep} className="px-2 py-1.5 text-center text-[11px] font-mono border-b border-[var(--border-5)]" style={{ color: fmt.color }} title={`${ep}: ${vals.map(v => v.toFixed(3)).join(', ')}`}>
                              {fmt.text}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="flex items-center gap-4 px-3 py-2 border-t border-[var(--border-5)] text-[10px] text-[var(--text2)]">
                <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-[#22c55e]" /> Safe</span>
                <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-[#f59e0b]" /> Moderate</span>
                <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-[#ef4444]" /> High risk</span>
                <span className="text-[var(--text2)]/50 ml-1">Mean per scaffold. Computational (ADMET-AI D-MPNN).</span>
              </div>
            </div>
          )}

          {hasStats && totalAlerts === 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-[#22c55e]/5 border border-[#22c55e]/20 rounded text-[12px] text-[#22c55e]">
              No significant scaffold-level liabilities (Bonferroni p &lt; 0.05, n≥3 scaffolds).
            </div>
          )}
          {hasAdmet && !hasStats && (
            <div className="p-3 bg-[var(--surface)] border border-[var(--border-5)] rounded-lg text-[12px] text-[var(--text2)]">
              All scaffolds have fewer than 3 compounds. Statistical testing requires n≥3 per scaffold.
            </div>
          )}
        </>
      )}

      {/* ═══════════════════════════════════════════════
           DETAIL tab — deep-dive on selected scaffold
         ═══════════════════════════════════════════════ */}
      {subTab === 'detail' && activeScaffold && (
        <div className="bg-[var(--surface)] border border-[var(--border-5)] rounded-lg overflow-hidden">
          {/* Panel header */}
          <div className="flex items-center gap-4 p-4 border-b border-[var(--border-5)]">
            <div className="shrink-0 w-[72px] h-[54px] rounded border border-[var(--border-5)] bg-[var(--bg)] overflow-hidden flex items-center justify-center">
              {activeScaffold.svg
                ? <span className="block w-full h-full p-1" dangerouslySetInnerHTML={{ __html: activeScaffold.svg }} style={{ lineHeight: 0 }} />
                : <span className="text-[11px] text-[var(--text2)]">{activeScaffold.smiles === '' ? 'Acyclic' : '?'}</span>
              }
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13px] font-semibold text-[var(--text-heading)]">{activeScaffold.count} compounds</span>
                {/* Pareto */}
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                  activeScaffold.paretoFraction > 0
                    ? 'bg-[#22c55e]/10 border-[#22c55e]/20 text-[#22c55e]'
                    : 'bg-[var(--surface2)] border-[var(--border-10)] text-[var(--text2)]'
                }`}>
                  {(activeScaffold.paretoFraction * 100).toFixed(0)}% Pareto
                </span>
                {/* Liability badge */}
                {activeReport && activeReport.liabilityCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#ef4444]/10 border border-[#ef4444]/20 text-[#ef4444]">
                    {activeReport.liabilityCount} liabilit{activeReport.liabilityCount === 1 ? 'y' : 'ies'}
                  </span>
                )}
                {activeReport && activeReport.liabilityCount === 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#22c55e]/10 border border-[#22c55e]/20 text-[#22c55e]">
                    Safety clear
                  </span>
                )}
              </div>
              <div className="text-[10px] font-mono text-[var(--text2)] truncate mt-0.5" title={activeScaffold.smiles}>
                {activeScaffold.smiles || 'Acyclic (no ring system)'}
              </div>
            </div>
            {/* Properties summary */}
            <div className="hidden sm:flex items-center gap-4 text-[12px]">
              {[
                { label: 'MW', value: activeScaffold.avgMW.toFixed(0) },
                { label: 'LogP', value: activeScaffold.avgLogP.toFixed(2) },
                { label: 'TPSA', value: activeScaffold.avgTPSA.toFixed(0) },
              ].map(stat => (
                <div key={stat.label} className="text-center">
                  <div className="text-[10px] text-[var(--text2)]">{stat.label}</div>
                  <div className="font-mono text-[var(--text-heading)]">{stat.value}</div>
                </div>
              ))}
            </div>
            {/* Navigate between scaffolds */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  const idx = scaffolds.findIndex(s => s.smiles === selectedScaffold);
                  if (idx > 0) handleSelectScaffold(scaffolds[idx - 1].smiles);
                }}
                className="p-1.5 rounded hover:bg-[var(--bg)] text-[var(--text2)] hover:text-[var(--text)] transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
              </button>
              <span className="text-[10px] text-[var(--text2)] px-1">
                {scaffolds.findIndex(s => s.smiles === selectedScaffold) + 1}/{scaffolds.length}
              </span>
              <button
                onClick={() => {
                  const idx = scaffolds.findIndex(s => s.smiles === selectedScaffold);
                  if (idx < scaffolds.length - 1) handleSelectScaffold(scaffolds[idx + 1].smiles);
                }}
                className="p-1.5 rounded hover:bg-[var(--bg)] text-[var(--text2)] hover:text-[var(--text)] transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
              </button>
            </div>
          </div>

          {/* ADMET endpoint comparison (if stats available) */}
          {activeReport && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="bg-[var(--bg)]">
                    <th className="text-left px-4 py-2 font-medium text-[var(--text2)] text-[10px] uppercase tracking-wider">Endpoint</th>
                    <th className="text-right px-3 py-2 font-medium text-[var(--text2)] text-[10px] uppercase tracking-wider">Scaffold</th>
                    <th className="text-right px-3 py-2 font-medium text-[var(--text2)] text-[10px] uppercase tracking-wider">Rest</th>
                    <th className="text-center px-3 py-2 font-medium text-[var(--text2)] text-[10px] uppercase tracking-wider w-[100px]">Δ</th>
                    <th className="text-right px-3 py-2 font-medium text-[var(--text2)] text-[10px] uppercase tracking-wider">% &gt;0.5</th>
                    <th className="text-right px-3 py-2 font-medium text-[var(--text2)] text-[10px] uppercase tracking-wider">p (corr.)</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const cats = ['toxicity', 'absorption', 'distribution', 'metabolism', 'excretion'];
                    const sorted = [...activeReport.endpoints].sort((a, b) => {
                      const ci = cats.indexOf(a.category); const cj = cats.indexOf(b.category);
                      if (ci !== cj) return ci - cj;
                      return a.p - b.p;
                    });
                    let lastCat = '';
                    return sorted.map(ep => {
                      const showCat = ep.category !== lastCat;
                      lastCat = ep.category;
                      const meta = ADMET_AI_PROPERTY_META[ep.endpoint];
                      const catColor = meta ? getAdmetAICategoryColor(meta.category) : 'var(--text2)';
                      return (
                        <React.Fragment key={ep.endpoint}>
                          {showCat && (
                            <tr><td colSpan={6} className="px-4 pt-3 pb-1"><span className="text-[10px] uppercase tracking-wider font-medium" style={{ color: catColor }}>{ep.category}</span></td></tr>
                          )}
                          <tr className={`border-t border-[var(--border-5)]/50 ${ep.isLiability ? 'bg-[#ef4444]/[0.03]' : ''}`}>
                            <td className="px-4 py-1.5 font-medium text-[var(--text)]">
                              <span className="flex items-center gap-1.5">
                                {meta?.label ?? ep.endpoint}
                                {ep.isLiability && <span className="w-1.5 h-1.5 rounded-full bg-[#ef4444] shrink-0" />}
                                {ep.stars && <span className="text-[#f59e0b] font-bold text-[10px]">{ep.stars}</span>}
                              </span>
                            </td>
                            <td className="text-right px-3 py-1.5 font-mono">{ep.scaffoldMean.toFixed(3)}</td>
                            <td className="text-right px-3 py-1.5 font-mono text-[var(--text2)]">{ep.restMean.toFixed(3)}</td>
                            <td className="px-3 py-1.5">
                              <div className="flex items-center gap-1">
                                <span className={`text-right font-mono text-[10px] w-12 shrink-0 ${ep.delta > 0 ? 'text-[#ef4444]' : ep.delta < -0.01 ? 'text-[#22c55e]' : 'text-[var(--text2)]'}`}>
                                  {ep.delta > 0 ? '+' : ''}{ep.delta.toFixed(3)}
                                </span>
                                <DeltaBar value={ep.delta} max={maxDelta} />
                              </div>
                            </td>
                            <td className="text-right px-3 py-1.5 font-mono">{(ep.fracAbove * 100).toFixed(0)}%</td>
                            <td className="text-right px-3 py-1.5 font-mono text-[var(--text2)]">{ep.p < 0.001 ? '<0.001' : ep.p.toFixed(3)}</td>
                          </tr>
                        </React.Fragment>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          )}

          {/* No ADMET data notice */}
          {!activeReport && hasAdmet && activeScaffold.count < 3 && (
            <div className="p-4 text-[12px] text-[var(--text2)]">
              Statistical testing requires n≥3 compounds per scaffold. This scaffold has {activeScaffold.count}.
            </div>
          )}
          {!activeReport && !hasAdmet && (
            <div className="p-4 text-[12px] text-[var(--text2)]">
              Run ADMET predictions (ADMET tab) to see safety analysis for this scaffold.
            </div>
          )}

          {/* Members list */}
          <div className="border-t border-[var(--border-5)] p-4">
            <div className="text-[10px] uppercase tracking-wider text-[var(--text2)] font-medium mb-2">
              Compounds ({activeScaffold.count})
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[300px] overflow-y-auto custom-scrollbar">
              {activeScaffold.molIndices.map(idx => (
                <MolCard
                  key={idx}
                  mol={molecules[idx]}
                  isSelected={selectedMolIdx === idx}
                  onClick={() => setSelectedMolIdx?.(selectedMolIdx === idx ? null : idx)}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {subTab === 'detail' && !activeScaffold && (
        <div className="text-center py-8 text-[var(--text2)] text-[13px]">
          Select a scaffold from the grid to see details.
        </div>
      )}

      {/* Methodology footnote */}
      <div className="flex items-center gap-2 pt-2 border-t border-[var(--border-5)] text-[10px] text-[var(--text2)] leading-relaxed">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 opacity-50"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        <span>
          Murcko scaffold decomposition (RDKit.js).{' '}
          {hasStats
            ? `Two-tailed Mann-Whitney U, Bonferroni correction (${reports.length * availableEndpoints.length} tests). Liability: ≥80% above 0.5 AND corrected p < 0.05 (n≥3 only).`
            : hasAdmet ? 'Statistical tests require n≥3 per scaffold.' : ''
          }{' '}
          {hasAdmet && 'All predictions computational (ADMET-AI D-MPNN).'}
        </span>
      </div>
    </div>
  );
}

export default React.memo(ScaffoldView);
