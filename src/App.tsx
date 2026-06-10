import { useState, useEffect, useRef, useCallback, startTransition, useMemo } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import Content from './components/Content';
import DocsPage from './components/DocsPage';
import CopilotPanel from './components/CopilotPanel';
import KeyboardShortcuts from './components/KeyboardShortcuts';
import type { Molecule, ParetoObjective, FormulaColumn } from './utils/types';
import { DEFAULT_PARETO_OBJECTIVES, EXAMPLES } from './utils/types';
import { parseFormula } from './utils/formula';
import { autoSave, loadAutoSession, clearAutoSession, formatSessionTime } from './utils/session';
import type { SerializedMolecule } from './utils/session';
import { packFingerprint, parseAndAnalyze, filterBySubstructure } from './utils/chem';
import { useTheme } from './contexts/ThemeContext';
import { detectLocalServer } from './utils/admetTiers';
import { fetchRAScore, getRascoreUrl } from './utils/rascore';
import { fetchBuyabilityBatch } from './utils/cost';
import { fetchZincPrices } from './utils/zinc';

import { getInitialPayloadFromUrl, getInitialTabFromUrl, getShareableUrl } from './utils/share';
import { downloadCSV, downloadScoredCSV, downloadJSON, downloadSDF, downloadSDFPareto, downloadManifest } from './utils/export';
import { clearSvgCache } from './utils/chem';
import { applyPropertyFilters } from './components/PropertyFilters';

const VALID_TABS = ['pareto','admet-ai','egg','table','radar','scaffolds','chemspace','scoring','mpo','cliffs','compare','parallel','similarity','statistics'] as const;

export default function App() {
  const [molecules, setMolecules] = useState<Molecule[]>([]);
  const [selectedMolIdx, setSelectedMolIdx] = useState<number | null>(null);
  const [compareIndices, setCompareIndices] = useState<number[]>([]);
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);
  const [initialPayloadFromUrl, setInitialPayloadFromUrl] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [customPropNames, setCustomPropNames] = useState<string[]>([]);
  const [paretoObjectives, setParetoObjectives] = useState<ParetoObjective[]>(DEFAULT_PARETO_OBJECTIVES);
  const [admetPropNames, setAdmetPropNames] = useState<string[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(() => window.location.search.includes('docs'));
  const [sidebarWidth, setSidebarWidth] = useState(380);
  const isDraggingRef = useRef(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [substructureFilter, setSubstructureFilter] = useState('');
  const [propertyFilters, setPropertyFilters] = useState<Record<string, { min: number; max: number }>>({});
  const [shortlist, setShortlist] = useState<Set<number>>(new Set());
  const toggleShortlist = useCallback((idx: number) => {
    setShortlist(prev => { const next = new Set(prev); if (next.has(idx)) next.delete(idx); else next.add(idx); return next; });
  }, []);
  const [formulaColumns, setFormulaColumns] = useState<FormulaColumn[]>(() => {
    try {
      const saved = localStorage.getItem('molparetolab_formulas');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [sessionToast, setSessionToast] = useState<{ molCount: number; time: string } | null>(null);
  const sessionRestoreRef = useRef(false);

  // Auto-detect local ADMET-AI server once on startup
  useEffect(() => {
    detectLocalServer(); // fire-and-forget — updates localStorage, components re-read on next prediction
  }, []);

  // Persist formula columns
  useEffect(() => {
    try { localStorage.setItem('molparetolab_formulas', JSON.stringify(formulaColumns)); } catch { /* storage unavailable */ }
  }, [formulaColumns]);

  // Lifted tab state so keyboard shortcuts can control it
  const legacyTabMap: Record<string, string> = { histograms: 'statistics', boxplots: 'statistics', correlations: 'statistics' };
  const [activeTab, setActiveTabRaw] = useState(() => {
    const urlTab = getInitialTabFromUrl();
    const resolved = urlTab ? (legacyTabMap[urlTab] ?? urlTab) : null;
    return resolved && (VALID_TABS as readonly string[]).includes(resolved) ? resolved : 'pareto';
  });
  const setActiveTab = useCallback((tab: string) => startTransition(() => setActiveTabRaw(tab)), []);
  const [showFDARef, setShowFDARef] = useState(false);
  const { toggleTheme } = useTheme();
  const substructureInputRef = useRef<HTMLInputElement>(null);

  // Pre-parse formula columns once (not per-molecule)
  const parsedFormulas = useMemo(() =>
    formulaColumns.map(fc => {
      try {
        return { ...fc, fn: parseFormula(fc.expr) };
      } catch {
        return { ...fc, fn: null };
      }
    }),
  [formulaColumns]);

  // Apply formula columns to molecules
  const moleculesWithFormulas = useMemo(() => {
    if (parsedFormulas.length === 0) return molecules;
    return molecules.map(m => {
      const vars: Record<string, number> = { ...m.props, ...m.customProps };
      const newCustom = { ...m.customProps };
      for (const fc of parsedFormulas) {
        try {
          newCustom[fc.name] = fc.fn ? fc.fn(vars) : NaN;
        } catch {
          newCustom[fc.name] = NaN;
        }
      }
      return { ...m, customProps: newCustom };
    });
  }, [molecules, parsedFormulas]);

  // All custom prop names (including formula columns)
  const allCustomPropNames = useMemo(() => {
    const names = [...customPropNames];
    for (const fc of formulaColumns) {
      if (!names.includes(fc.name)) names.push(fc.name);
    }
    return names;
  }, [customPropNames, formulaColumns]);

  // Session auto-save (debounced 2s)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (molecules.length === 0) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      const serialized: SerializedMolecule[] = molecules.map(m => ({
        name: m.name,
        smiles: m.smiles,
        formula: m.formula,
        fingerprint: m.fingerprint,
        props: { ...m.props },
        customProps: { ...m.customProps },
        filters: m.filters,
        lipinski: m.lipinski,
        paretoRank: m.paretoRank,
        dominates: m.dominates,
        dominatedBy: m.dominatedBy,
      }));
      autoSave({
        timestamp: Date.now(),
        molecules: serialized,
        objectives: paretoObjectives,
        formulaColumns,
        customPropNames,
        activeTab,
        shortlist: Array.from(shortlist),
      });
    }, 2000);
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
  }, [molecules, paretoObjectives, formulaColumns, customPropNames, activeTab, shortlist]);

  // Session restore on load
  useEffect(() => {
    if (sessionRestoreRef.current) return;
    sessionRestoreRef.current = true;
    loadAutoSession().then(session => {
      if (session && session.molecules.length > 0) {
        setSessionToast({ molCount: session.molecules.length, time: formatSessionTime(session.timestamp) });
      }
    });
  }, []);

  const restoreSession = useCallback(async () => {
    const session = await loadAutoSession();
    if (!session) return;
    const restored: Molecule[] = session.molecules.map(sm => ({
      ...sm,
      svg: '',
      props: sm.props as unknown as import('./utils/types').MolProps,
      fpPacked: packFingerprint(sm.fingerprint),
    }));
    setMolecules(restored);
    if (session.objectives) setParetoObjectives(session.objectives);
    if (session.formulaColumns) setFormulaColumns(session.formulaColumns);
    if (session.customPropNames) setCustomPropNames(session.customPropNames);
    if (session.activeTab) setActiveTab(session.activeTab);
    if (session.shortlist) setShortlist(new Set(session.shortlist));
    setSessionToast(null);
    setToast(`Restored ${restored.length} molecules`);
  }, [setActiveTab]);

  const dismissSession = useCallback(() => {
    setSessionToast(null);
    clearAutoSession();
  }, []);

  useEffect(() => {
    const payload = getInitialPayloadFromUrl();
    if (payload) setInitialPayloadFromUrl(payload);
  }, []);

  const handleLoadExample = useCallback(async (key: string) => {
    const smiles = (EXAMPLES as Record<string, string>)[key];
    if (!smiles) return;
    try {
      const { molecules: newMols } = await parseAndAnalyze(smiles);
      if (newMols.length > 0) {
        setMolecules(newMols);
        setSelectedMolIdx(null);
        setCompareIndices([]);
        setToast(`Loaded ${newMols.length} molecules`);
      }
    } catch {
      setToast('Failed to load example');
    }
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  // Keyboard shortcuts: navigation, tab switching, actions
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when typing in input/textarea/select or when shortcuts modal handles it
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // ? — toggle keyboard shortcuts help (works always)
      if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen(v => !v);
        return;
      }

      // If shortcuts modal is open, let it handle Escape
      if (shortcutsOpen) return;

      // Escape — close modals/panels in priority order; then clear substructure filter; then deselect
      if (e.key === 'Escape') {
        if (isCopilotOpen) { setIsCopilotOpen(false); return; }
        if (sidebarOpen) { setSidebarOpen(false); return; }
        if (substructureFilter) { setSubstructureFilter(''); return; }
        setSelectedMolIdx(null);
        return;
      }

      // / — open AI Copilot
      if (e.key === '/') {
        e.preventDefault();
        setIsCopilotOpen(true);
        return;
      }

      // s — focus substructure search input (opens sidebar on mobile first)
      if (e.key === 's') {
        e.preventDefault();
        if (!sidebarOpen) setSidebarOpen(true);
        setTimeout(() => substructureInputRef.current?.focus(), 50);
        return;
      }

      // d — toggle dark/light mode
      if (e.key === 'd') {
        e.preventDefault();
        toggleTheme();
        return;
      }

      // f — toggle FDA reference overlay
      if (e.key === 'f') {
        e.preventDefault();
        setShowFDARef(v => !v);
        return;
      }

      // r — reset / clear all
      if (e.key === 'r') {
        e.preventDefault();
        if (molecules.length > 0 && window.confirm('Reset all molecules and analysis? This cannot be undone.')) {
          setMolecules([]);
          setSelectedMolIdx(null);
          setCompareIndices([]);
          setSubstructureFilter('');
          setPropertyFilters({});
          clearSvgCache();
          window.history.replaceState(null, '', window.location.pathname);
        }
        return;
      }

      // Tab switching: [ and ] for prev/next tab
      if (e.key === '[' || e.key === ']') {
        e.preventDefault();
        if (molecules.length === 0) return;
        const currentIdx = VALID_TABS.indexOf(activeTab as typeof VALID_TABS[number]);
        if (currentIdx === -1) return;
        const newIdx = e.key === ']'
          ? Math.min(currentIdx + 1, VALID_TABS.length - 1)
          : Math.max(currentIdx - 1, 0);
        setActiveTab(VALID_TABS[newIdx]);
        return;
      }

      // 1-9 — jump to tab 1-9; 0 — jump to last tab
      if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        if (molecules.length === 0) return;
        const num = parseInt(e.key);
        const idx = num === 0 ? VALID_TABS.length - 1 : num - 1;
        if (idx >= 0 && idx < VALID_TABS.length) {
          setActiveTab(VALID_TABS[idx]);
        }
        return;
      }

      // Arrow keys — molecule navigation (only when molecules loaded)
      if (molecules.length === 0) return;

      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        setSelectedMolIdx(prev => prev === null ? 0 : Math.min(prev + 1, molecules.length - 1));
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        setSelectedMolIdx(prev => prev === null ? 0 : Math.max(prev - 1, 0));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [molecules.length, shortcutsOpen, isCopilotOpen, sidebarOpen, activeTab, setActiveTab, substructureFilter, toggleTheme]);

  const handleADMETPredictions = (predictions: Map<string, Record<string, number>>) => {
    const admetKeys = new Set<string>();
    // Keys already present in MolProps (computed client-side) should not be overridden
    // by ADMET API results — e.g. the server also returns 'QED' but we compute it locally.
    const BUILTIN_PROP_KEYS = new Set(['MW','LogP','HBD','HBA','TPSA','RotBonds','FrCSP3','Rings','AromaticRings','HeavyAtoms','MR','NumAtoms','QED']);
    const updated = molecules.map(m => {
      const pred = predictions.get(m.smiles) || predictions.get(m.name);
      if (!pred) return m;
      const newCustom = { ...m.customProps };
      for (const [k, v] of Object.entries(pred)) {
        if (BUILTIN_PROP_KEYS.has(k)) continue; // don't shadow built-in computed properties
        newCustom[k] = v;
        admetKeys.add(k);
      }
      return { ...m, customProps: newCustom };
    });
    const admetArr = Array.from(admetKeys);
    setAdmetPropNames(admetArr);
    // Merge ADMET keys into customPropNames (avoid duplicates)
    setCustomPropNames(prev => {
      const merged = [...prev];
      for (const k of admetArr) {
        if (!merged.includes(k)) merged.push(k);
      }
      return merged;
    });
    setMolecules(updated);
  };

  // Compute make-ability scores (Ertl SA, RAScore, SCScore) for every molecule via the
  // micro-service. Lifted to App so it can be triggered from either the sidebar or the
  // Make-ability tab; merges results into customProps, prop names, and Pareto objectives.
  const handleComputeMakeability = useCallback(async () => {
    if (molecules.length === 0) return { sa: 0, ra: 0, sc: 0, total: 0 };
    const map = await fetchRAScore(molecules.map(m => m.smiles), getRascoreUrl());
    let sa = 0, ra = 0, sc = 0;
    for (const v of map.values()) {
      if (v.sa !== undefined) sa++;
      if (v.ra !== undefined) ra++;
      if (v.sc !== undefined) sc++;
    }
    setMolecules(prev => prev.map(m => {
      const v = map.get(m.smiles);
      if (!v) return m;
      const cp = { ...m.customProps };
      if (v.sa !== undefined) cp.SA_Score = v.sa;
      if (v.ra !== undefined) cp.RAScore = v.ra;
      if (v.sc !== undefined) cp.SCScore = v.sc;
      return { ...m, customProps: cp };
    }));
    setCustomPropNames(prev => {
      const n = [...prev];
      if (sa > 0 && !n.includes('SA_Score')) n.push('SA_Score');
      if (ra > 0 && !n.includes('RAScore')) n.push('RAScore');
      if (sc > 0 && !n.includes('SCScore')) n.push('SCScore');
      return n.length === prev.length ? prev : n;
    });
    setParetoObjectives(prev => {
      const n = [...prev];
      if (sa > 0 && !n.some(o => o.key === 'SA_Score')) n.push({ key: 'SA_Score', direction: 'min' as const });
      if (ra > 0 && !n.some(o => o.key === 'RAScore')) n.push({ key: 'RAScore', direction: 'max' as const });
      if (sc > 0 && !n.some(o => o.key === 'SCScore')) n.push({ key: 'SCScore', direction: 'min' as const });
      return n.length === prev.length ? prev : n;
    });
    const total = molecules.length;
    setToast(sa + ra + sc === 0
      ? 'Make-ability: no scores returned — check the endpoint'
      : `Make-ability: ${sa} SA, ${ra} RAScore, ${sc} SCScore (of ${total})`);
    return { sa, ra, sc, total };
  }, [molecules]);

  // Commercial availability (PubChem vendor counts) → adds 'Vendors' as a Pareto objective.
  const handleCheckBuyability = useCallback(async () => {
    if (molecules.length === 0) return { resolved: 0, buyable: 0, total: 0 };
    const map = await fetchBuyabilityBatch(molecules.map(m => m.smiles));
    let resolved = 0, buyable = 0;
    for (const b of map.values()) { resolved++; if (b.vendors > 0) buyable++; }
    setMolecules(prev => prev.map(m => {
      const b = map.get(m.smiles);
      return b ? { ...m, customProps: { ...m.customProps, Vendors: b.vendors, PubChemCID: b.cid } } : m;
    }));
    if (resolved > 0) {
      setCustomPropNames(prev => prev.includes('Vendors') ? prev : [...prev, 'Vendors']);
      setParetoObjectives(prev => prev.some(o => o.key === 'Vendors') ? prev : [...prev, { key: 'Vendors', direction: 'max' as const }]);
    }
    setToast(resolved === 0
      ? 'Buyability: PubChem did not respond (likely throttled) — try again'
      : `Buyability: ${buyable}/${resolved} purchasable`);
    return { resolved, buyable, total: molecules.length };
  }, [molecules]);

  // ZINC-22 catalog availability → adds 'ZINC catalogs' as a plottable axis.
  const handleCheckAvailability = useCallback(async () => {
    if (molecules.length === 0) return { inZinc: 0, total: 0 };
    const map = await fetchZincPrices(molecules.map(m => m.smiles));
    let inZinc = 0;
    for (const z of map.values()) { if (z.purchasable) inZinc++; }
    setMolecules(prev => prev.map(m => {
      const z = map.get(m.smiles);
      if (!z) return m;
      const cp = { ...m.customProps };
      if (z.catalogs > 0) cp.ZincCatalogs = z.catalogs;
      return { ...m, cost: z, customProps: cp };
    }));
    if (inZinc > 0) setCustomPropNames(prev => prev.includes('ZincCatalogs') ? prev : [...prev, 'ZincCatalogs']);
    setToast(`ZINC: ${inZinc}/${molecules.length} found in vendor catalogs`);
    return { inZinc, total: molecules.length };
  }, [molecules]);

  const handleShareURL = () => {
    if (molecules.length === 0) return;
    const currentTab = new URLSearchParams(window.location.search).get('tab') ?? undefined;
    const url = getShareableUrl(molecules, currentTab);
    navigator.clipboard.writeText(url).then(
      () => setToast('Link copied to clipboard'),
      () => {
        window.prompt('Copy this shareable link:', url);
      }
    );
  };

  const handleExportCSV = () => {
    if (molecules.length === 0) return;
    downloadCSV(molecules);
    setToast('CSV exported');
  };

  // Researcher round-trip: their molecules back as a clean CSV with the make-ability
  // scores (and any imported/formula columns) appended — same numbers the app shows.
  const handleExportScores = () => {
    if (molecules.length === 0) return;
    downloadScoredCSV(moleculesWithFormulas, allCustomPropNames);
    setToast('Scored CSV exported');
  };

  const exportContainerRef = useRef<HTMLDivElement>(null);

  const handleExportFigure = () => {
    if (molecules.length === 0) return;
    const el = exportContainerRef.current;
    const canvases = Array.from(el?.querySelectorAll('canvas') ?? []).filter(
      (c): c is HTMLCanvasElement => c instanceof HTMLCanvasElement && c.width > 0 && c.height > 0
    );
    if (canvases.length === 0) {
      setToast('No canvas to export (switch to Pareto, Egg, Radar, or Parallel tab)');
      return;
    }
    if (canvases.length === 1) {
      const url = canvases[0].toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url; a.download = 'paretomol_figure.png'; a.click();
      setToast('Figure exported');
      return;
    }
    // Multiple canvases (e.g. Pareto with 6 charts) — stitch into grid
    const cols = 2;
    const rows = Math.ceil(canvases.length / cols);
    const w = Math.max(...canvases.map(c => c.width));
    const h = Math.max(...canvases.map(c => c.height));
    const out = document.createElement('canvas');
    out.width = cols * w;
    out.height = rows * h;
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    ctx.fillRect(0, 0, out.width, out.height);
    canvases.forEach((c, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      ctx.drawImage(c, col * w, row * h, w, h);
    });
    const a = document.createElement('a');
    a.href = out.toDataURL('image/png');
    a.download = 'paretomol_figure.png';
    a.click();
    setToast(`Figure exported (${canvases.length} charts)`);
  };

  // Apply substructure + property range filters (on moleculesWithFormulas)
  const filteredMolecules = useMemo<Molecule[]>(() => {
    let result = moleculesWithFormulas;
    if (substructureFilter.trim() && result.length > 0) {
      const indices = filterBySubstructure(molecules, substructureFilter);
      const molSet = new Set(indices);
      result = result.filter((_, i) => molSet.has(i));
    }
    result = applyPropertyFilters(result, propertyFilters);
    return result;
  }, [molecules, moleculesWithFormulas, substructureFilter, propertyFilters]);

  const handleCite = () => {
    const citation = `@article{yabbarov2026paretomol,
  author  = {Yabbarov, Ilkham and Vargas-Hernández, Rodrigo A.},
  title   = {ParetoMol: A Free Web Application for Multi-Objective Pareto Analysis of Molecular Safety and Pharmacokinetics},
  journal = {ChemRxiv},
  year    = {2026},
  doi     = {10.26434/chemrxiv.15002217/v1},
  url     = {https://doi.org/10.26434/chemrxiv.15002217/v1},
  note    = {Preprint}
}`;
    navigator.clipboard.writeText(citation).then(
      () => setToast('BibTeX citation copied'),
      () => {
        window.prompt('Copy BibTeX citation:', citation);
      }
    );
  };

  return (
    <div className="h-screen max-w-[100vw] overflow-hidden bg-[var(--bg-deep)] flex flex-col font-sans text-[var(--text)]">
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 bg-[var(--surface2)] border border-[var(--accent)] rounded-md text-sm text-[var(--text)] shadow-lg animate-fade-in">
          {toast}
        </div>
      )}
      {sessionToast && molecules.length === 0 && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 bg-[var(--surface2)] border border-[var(--border-10)] rounded-lg text-[13px] text-[var(--text)] shadow-lg animate-fade-in flex items-center gap-3">
          <span>Resume previous session? ({sessionToast.molCount} molecules, {sessionToast.time})</span>
          <button
            onClick={restoreSession}
            className="px-3 py-1 bg-[var(--accent)] text-white rounded text-[12px] font-medium hover:opacity-90 transition-opacity"
          >
            Restore
          </button>
          <button
            onClick={dismissSession}
            className="px-2 py-1 text-[var(--text2)] hover:text-[var(--text)] text-[12px] transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}
      <Header
        moleculeCount={filteredMolecules.length}
        onReset={() => { setMolecules([]); setSelectedMolIdx(null); setCompareIndices([]); setSubstructureFilter(''); setPropertyFilters({}); clearSvgCache(); window.history.replaceState(null, '', window.location.pathname); }}
        onShareURL={handleShareURL}
        onExportCSV={handleExportCSV}
        onExportJSON={() => { if (molecules.length > 0) { downloadJSON(molecules); setToast('JSON exported'); } }}
        onExportSDF={() => { if (molecules.length > 0) { downloadSDF(molecules); setToast('SDF exported (all)'); } }}
        onExportSDFPareto={() => { const pareto = molecules.filter(m => m.paretoRank === 1); if (pareto.length > 0) { downloadSDFPareto(molecules); setToast(`SDF exported (${pareto.length} Pareto-optimal)`); } else { setToast('No Pareto-optimal molecules'); } }}
        onExportFigure={handleExportFigure}
        onExportManifest={() => { if (molecules.length > 0) { downloadManifest(molecules, paretoObjectives, propertyFilters, substructureFilter, formulaColumns); setToast('Reproducibility manifest exported'); } }}
        onCite={handleCite}
        onDocs={() => setDocsOpen(true)}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(v => !v)}
      />

      <main className="flex-1 flex min-h-0 relative">
        {/* Mobile sidebar backdrop */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-[var(--overlay)] z-30 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar — slide-over on mobile, static + resizable on desktop */}
        <div
          className={`fixed inset-y-0 left-0 z-40 w-[340px] max-w-[85vw] bg-[var(--bg-deep)] transform transition-transform duration-300 ease-in-out md:relative md:inset-auto md:z-auto md:max-w-none md:translate-x-0 md:transition-none md:shrink-0 ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
          }`}
          style={{ ['--sidebar-w' as string]: `${sidebarWidth}px` } as React.CSSProperties}
        >
          <Sidebar
            molecules={moleculesWithFormulas}
            setMolecules={setMolecules}
            selectedMolIdx={selectedMolIdx}
            setSelectedMolIdx={(idx) => { setSelectedMolIdx(idx); }}
            compareIndices={compareIndices}
            setCompareIndices={setCompareIndices}
            initialPayloadFromUrl={initialPayloadFromUrl}
            onUrlPayloadConsumed={() => setInitialPayloadFromUrl(null)}
            onToast={setToast}
            onInitialLoadComplete={() => setIsInitialLoading(false)}
            customPropNames={allCustomPropNames}
            setCustomPropNames={setCustomPropNames}
            paretoObjectives={paretoObjectives}
            setParetoObjectives={setParetoObjectives}
            admetPropNames={admetPropNames}
            substructureFilter={substructureFilter}
            onSubstructureFilterChange={(smarts) => {
              setSubstructureFilter(smarts);
              setSelectedMolIdx(null);
              setCompareIndices([]);
            }}
            propertyFilters={propertyFilters}
            onPropertyFiltersChange={setPropertyFilters}
            substructureInputRef={substructureInputRef}
            shortlist={shortlist}
            toggleShortlist={toggleShortlist}
          />
          {/* Drag handle — desktop only */}
          <div
            className="hidden md:block absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-[var(--accent)] opacity-0 hover:opacity-40 transition-opacity z-10"
            onMouseDown={(e) => {
              e.preventDefault();
              isDraggingRef.current = true;
              const startX = e.clientX;
              const startW = sidebarWidth;
              const onMove = (ev: MouseEvent) => {
                if (!isDraggingRef.current) return;
                const next = Math.min(600, Math.max(240, startW + ev.clientX - startX));
                setSidebarWidth(next);
              };
              const onUp = () => {
                isDraggingRef.current = false;
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
              };
              window.addEventListener('mousemove', onMove);
              window.addEventListener('mouseup', onUp);
            }}
          />
        </div>

        <div className="flex-1 bg-[var(--bg)] min-w-0 min-h-0">
          <Content
            molecules={filteredMolecules}
            compareIndices={compareIndices}
            selectedMolIdx={selectedMolIdx}
            setSelectedMolIdx={setSelectedMolIdx}
            exportContainerRef={exportContainerRef}
            setCompareIndices={setCompareIndices}
            isInitialLoading={isInitialLoading}
            customPropNames={allCustomPropNames}
            paretoObjectives={paretoObjectives}
            onADMETPredictions={handleADMETPredictions}
            onComputeMakeability={handleComputeMakeability}
            onCheckBuyability={handleCheckBuyability}
            onCheckAvailability={handleCheckAvailability}
            onExportScores={handleExportScores}
            onLoadExample={handleLoadExample}
            onOpenSidebar={() => setSidebarOpen(true)}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            showFDARef={showFDARef}
            setShowFDARef={setShowFDARef}
            onToast={setToast}
            shortlist={shortlist}
            toggleShortlist={toggleShortlist}
            formulaColumns={formulaColumns}
            setFormulaColumns={setFormulaColumns}
          />
        </div>
      </main>

      <button
        onClick={() => setIsCopilotOpen(true)}
        className="fixed bottom-6 right-6 w-12 h-12 bg-[var(--surface2)] border border-[var(--border-10)] rounded-full flex items-center justify-center text-base font-semibold text-[var(--text)] hover:bg-[var(--accent)] hover:border-transparent hover:text-[var(--text-heading)] transition-all z-40 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#5F7367]/50"
        title="AI Copilot ( / )"
      >
        AI
      </button>

      {/* Keyboard shortcuts hint — bottom left, only on desktop */}
      <button
        onClick={() => setShortcutsOpen(true)}
        className="hidden md:flex fixed bottom-6 left-6 items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-[var(--text2)]/40 hover:text-[var(--text2)] bg-[var(--surface2)]/50 border border-[var(--border-5)] rounded-md transition-colors z-40"
        title="Keyboard shortcuts"
      >
        <kbd className="text-[10px] font-mono bg-[var(--surface2)] px-1 py-0.5 rounded border border-[var(--border-10)]">?</kbd>
        <span>Shortcuts</span>
      </button>

      <KeyboardShortcuts isOpen={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      {docsOpen && <DocsPage onClose={() => setDocsOpen(false)} />}

      {/* Slide-out Copilot Panel */}
      <div
        className={`fixed inset-y-0 right-0 w-full md:w-[420px] bg-[var(--bg)] border-l border-[var(--border-5)] shadow-2xl z-50 transform transition-transform duration-300 ease-in-out ${
          isCopilotOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <CopilotPanel
          isOpen={isCopilotOpen}
          onClose={() => setIsCopilotOpen(false)}
          molecules={molecules}
          selectedMolIdx={selectedMolIdx}
        />
      </div>
    </div>
  );
}

