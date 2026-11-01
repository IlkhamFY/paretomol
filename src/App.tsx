import { useState, useEffect, useRef, useCallback, startTransition, useMemo } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import Content from './components/Content';
import DocsPage from './components/DocsPage';
import CopilotPanel from './components/CopilotPanel';
import KeyboardShortcuts from './components/KeyboardShortcuts';
import type { Molecule, ParetoObjective, FormulaColumn } from '@paretomol/core';
import { objectivesForPreset, rankUnder } from '@paretomol/core';
import type { Constraint, ObjectiveWindow, ScoringPreset } from '@paretomol/core';
import { EXAMPLES } from './data/examples';
import { parseFormula } from '@paretomol/core';
import { autoSave, loadAutoSession, clearAutoSession, formatSessionTime, CURRENT_SCHEMA_VERSION } from './utils/session';
import type { SerializedMolecule } from './utils/session';
import { packFingerprint, parseAndAnalyze, filterBySubstructure, initRDKitCache } from './utils/chem';
import { useTheme } from './contexts/ThemeContext';
import { detectLocalServer } from './utils/admetTiers';
import { warmupAdmetEndpoint, getAdmetAIEndpoint } from './utils/admetAI';
import { buildDecisionRecord, parseDecisionRecord, selectedIndices, reviewTokenFromUrl, decodeReview, getProfile, verifyDecision } from '@paretomol/core';
import type { CurveType, ReviewVerdict } from '@paretomol/core';
import { decisionExportFields } from './utils/decisionExport';
import ReviewPanel from './components/ReviewPanel';
import type { ReviewState } from './components/ReviewPanel';
import { fetchRAScore, getRascoreUrl } from './utils/rascore';
import { fetchBuyabilityBatch } from './utils/cost';
import { fetchZincPrices } from './utils/zinc';

import { getInitialPayloadFromUrl, getInitialTabFromUrl, getShareableUrl } from './utils/share';
import { track } from './lib/track';
import { downloadDecisionRecord, downloadCSV, downloadScoredCSV, downloadJSON, downloadSDF, downloadSDFPareto, downloadManifest, downloadSummaryReport, downloadCanvasPng } from './utils/export';
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
  const [scoringPreset, setScoringPreset] = useState<ScoringPreset>('oral@1');
  const [customWindows, setCustomWindows] = useState<Record<string, ObjectiveWindow> | null>(null);
  const [paretoObjectives, setParetoObjectives] = useState<ParetoObjective[]>(() => objectivesForPreset('oral@1'));
  const [mpoCurve, setMpoCurve] = useState<CurveType>('linear');
  const [constraints, setConstraints] = useState<Constraint[]>([]);
  const [robustFront, setRobustFront] = useState(false);
  const scoringProfileRef = scoringPreset === 'paper' || scoringPreset === 'custom' ? 'oral@1' : scoringPreset;
  const [admetPropNames, setAdmetPropNames] = useState<string[]>([]);
  const rankObjectives = useMemo(() => {
    if (!robustFront) return paretoObjectives;
    const predicted = new Set(admetPropNames);
    return paretoObjectives.map((o) => predicted.has(o.key) ? { ...o, epsilon: 0.05 } : o);
  }, [paretoObjectives, robustFront, admetPropNames]);
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
  const [review, setReview] = useState<ReviewState | null>(null);
  const [reviewLinkError, setReviewLinkError] = useState<string | null>(null);
  // Captured on first render, before any effect rewrites the URL.
  const [reviewToken] = useState(() => reviewTokenFromUrl(window.location.href));
  const [sessionToast, setSessionToast] = useState<{ molCount: number; time: string } | null>(null);
  const sessionRestoreRef = useRef(false);

  // Probe for a local ADMET server, then wake whatever endpoint predictions will use.
  // One GET /health per page session; failures stay silent and nothing here blocks paint.
  useEffect(() => {
    void detectLocalServer().finally(() => {
      warmupAdmetEndpoint();
    });
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
        scoringProfile: scoringProfileRef,
        mpoCurve,
        constraints,
      });
    }, 2000);
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
  }, [molecules, paretoObjectives, formulaColumns, customPropNames, activeTab, shortlist, scoringProfileRef, mpoCurve, constraints]);

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

    let restored: Molecule[];
    if ((session.schemaVersion ?? 0) < CURRENT_SCHEMA_VERSION) {
      // The stored properties were computed under superseded conventions —
      // monoisotopic mass in place of average molecular weight, and QED with
      // the structural-alert term pinned to zero — so replaying them would
      // quietly resurrect corrected numbers. Descriptors are recomputed from
      // structure; imported and predicted columns are data rather than derived
      // quantities and are carried across unchanged.
      const text = session.molecules.map(sm => `${sm.smiles} ${sm.name}`).join('\n');
      const { molecules: fresh } = await parseAndAnalyze(text);
      const previous = new Map(session.molecules.map(sm => [sm.smiles, sm]));
      restored = fresh.map(m => ({
        ...m,
        customProps: { ...(previous.get(m.smiles)?.customProps ?? {}) },
      }));
    } else {
      restored = session.molecules.map(sm => ({
        ...sm,
        svg: '',
        props: sm.props as unknown as import('@paretomol/core').MolProps,
        fpPacked: packFingerprint(sm.fingerprint),
      }));
    }

    // Ranks are always recomputed: front indices are derived from the active
    // objectives, and a stored rank can only be stale.
    rankUnder(restored, session.objectives ?? objectivesForPreset('oral@1'), session.constraints ?? []);
    setMolecules(restored);
    if (session.objectives) setParetoObjectives(session.objectives);
    if (session.scoringProfile) {
      try { setScoringPreset(getProfile(session.scoringProfile).ref as ScoringPreset); } catch { /* keep the default */ }
    }
    if (session.mpoCurve === 'linear' || session.mpoCurve === 'sigmoid') setMpoCurve(session.mpoCurve);
    if (session.constraints) setConstraints(session.constraints);
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

  // Open review link (#r= or ?r=, docs/review-url.md): an agent's shortlist
  // opens straight into review mode with Accept/Reject per molecule.
  useEffect(() => {
    const token = reviewToken;
    if (!token) return;
    void (async () => {
      try {
        const payload = decodeReview(token);
        const text = payload.molecules.map(m => `${m.smiles} ${m.name}`).join('\n');
        const { molecules: fresh } = await parseAndAnalyze(text);
        if (fresh.length !== payload.molecules.length) throw new Error(`${payload.molecules.length - fresh.length} structures did not parse`);
        const mols = fresh.map((m, i) => ({ ...m, name: payload.molecules[i].name, customProps: { ...(payload.molecules[i].customProps ?? {}) } }));
        const objectives = payload.objectives ?? objectivesForPreset(payload.profile ?? 'oral@1');
        if (payload.profile) {
          try { setScoringPreset(getProfile(payload.profile).ref as ScoringPreset); } catch { /* payload profile already validated */ }
        }
        rankUnder(mols, objectives, constraints);
        setMolecules(mols);
        setParetoObjectives(objectives);
        setCustomPropNames(Array.from(new Set(mols.flatMap(m => Object.keys(m.customProps)))));
        setShortlist(new Set());
        setSessionToast(null);
        setReview({ payload, decisions: {} });
        track('review/opened');
        setToast(`Review: ${mols.length} molecules${payload.source ? ` from ${payload.source}` : ''}`);
      } catch (e) {
        setReviewLinkError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [reviewToken]);

  const handleReviewDecide = useCallback((idx: number, v: ReviewVerdict | null) => {
    setReview(prev => {
      if (!prev) return prev;
      const decisions = { ...prev.decisions };
      if (v) decisions[idx] = v; else delete decisions[idx];
      return { ...prev, decisions };
    });
    setShortlist(prev => { const next = new Set(prev); if (v === 'accept') next.add(idx); else next.delete(idx); return next; });
  }, []);

  const handleReviewExport = async (note: string) => {
    if (!review || molecules.length === 0) return;
    const RDKit = await initRDKitCache();
    const accepted = Object.entries(review.decisions).filter(([, v]) => v === 'accept').map(([k]) => Number(k));
    const names = new Map(molecules.map((m, i) => [m.name, i] as const));
    const scoring = decisionExportFields({
      kind: 'review',
      profileRef: scoringProfileRef,
      curve: mpoCurve,
      reviewProfile: review.payload.profile,
      admetColumns: admetPropNames.length,
      admetEndpoint: getAdmetAIEndpoint(),
    });
    const rec = buildDecisionRecord({
      molecules,
      objectives: rankObjectives,
      constraints,
      profile: scoring.profile,
      curve: scoring.curve,
      selected: accepted,
      rationale: note,
      rdkitVersion: typeof RDKit?.version === 'function' ? String(RDKit.version()) : 'unknown',
      admetEndpoint: scoring.admetEndpoint,
      view: { activeTab, formulaColumns, customPropNames, admetPropNames, propertyFilters, substructureFilter },
      review: { source: review.payload.source, decisions: review.decisions, suggested: (review.payload.suggested ?? []).flatMap(n => names.has(n) ? [names.get(n)!] : []) },
    });
    downloadDecisionRecord(rec, 'paretomol_review.json');
    track('review/exported');
    setToast(`Review exported: ${accepted.length} accepted`);
  };

  const handleLoadExample = useCallback(async (key: string) => {
    const smiles = (EXAMPLES as Record<string, string>)[key];
    if (!smiles) return;
    try {
      const { molecules: newMols } = await parseAndAnalyze(smiles);
      if (newMols.length > 0) {
        rankUnder(newMols, paretoObjectives, constraints);
        setMolecules(newMols);
        setSelectedMolIdx(null);
        setCompareIndices([]);
        setToast(`Loaded ${newMols.length} molecules`);
        track('molecules/example');
      }
    } catch {
      setToast('Failed to load example');
    }
  }, [paretoObjectives, constraints]);

  const rankKey = JSON.stringify(rankObjectives);
  const constraintKey = JSON.stringify(constraints);
  useEffect(() => {
    setMolecules((prev) => {
      if (prev.length === 0) return prev;
      rankUnder(prev, rankObjectives, constraints);
      return [...prev];
    });
    // Recompute when the objective list or the constraints change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankKey, constraintKey]);

  const applyScoringPreset = useCallback((preset: ScoringPreset, windows?: Record<string, ObjectiveWindow> | null) => {
    setScoringPreset(preset);
    const nextWindows = windows === undefined ? customWindows : windows;
    if (windows !== undefined) setCustomWindows(windows);
    setParetoObjectives(objectivesForPreset(preset, customPropNames, nextWindows));
  }, [customPropNames, customWindows]);

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

      const focus = e.target as HTMLElement | null;
      const inList = Boolean(focus?.closest('[data-mol-list], [data-pareto-chart]'));
      if (!inList) return;
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
    // Columns the user imported are experimental measurements. A prediction of
    // the same name must not overwrite them: that silently replaces a
    // measurement with an estimate and leaves the two indistinguishable
    // downstream, in the exports and in the Pareto analysis alike. Such
    // predictions are given a distinct "(pred)" column so both are kept and
    // can be told apart.
    const userSupplied = new Set(customPropNames.filter(k => !admetPropNames.includes(k)));
    const updated = molecules.map(m => {
      const pred = predictions.get(m.smiles) || predictions.get(m.name);
      if (!pred) return m;
      const newCustom = { ...m.customProps };
      for (const [k, v] of Object.entries(pred)) {
        if (BUILTIN_PROP_KEYS.has(k)) continue; // don't shadow built-in computed properties
        const key = userSupplied.has(k) ? `${k} (pred)` : k;
        newCustom[key] = v;
        admetKeys.add(key);
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

  // Decision record (paretomol.decision/1): export the current decision and
  // re-open it later with the exact same view. See docs/decision-record.md.
  const handleExportDecisionRecord = async () => {
    if (molecules.length === 0) return;
    const rationale = window.prompt('Why these picks? (optional, saved in the record)', '');
    if (rationale === null) return;
    const RDKit = await initRDKitCache();
    const scoring = decisionExportFields({
      kind: 'workspace',
      profileRef: scoringProfileRef,
      curve: mpoCurve,
      admetColumns: admetPropNames.length,
      admetEndpoint: getAdmetAIEndpoint(),
    });
    const rec = buildDecisionRecord({
      molecules,
      objectives: rankObjectives,
      constraints,
      profile: scoring.profile,
      curve: scoring.curve,
      selected: Array.from(shortlist),
      rationale,
      rdkitVersion: typeof RDKit?.version === 'function' ? String(RDKit.version()) : 'unknown',
      admetEndpoint: scoring.admetEndpoint,
      view: { activeTab, formulaColumns, customPropNames, admetPropNames, propertyFilters, substructureFilter },
    });
    downloadDecisionRecord(rec);
    setToast(`Decision record exported (${rec.selected.length} selected)`);
  };

  const handleImportDecisionRecord = async (file: File) => {
    try {
      const raw = await file.text();
      const RDKit = await initRDKitCache();
      const check = verifyDecision(raw, RDKit);
      const blocking = check.issues.filter((i) => i.code !== 'rank' && i.code !== 'mpo');
      if (blocking.length || check.recomputed.length === 0) {
        setToast(`Could not open record: ${(blocking[0] ?? check.issues[0])?.message ?? 'unreadable record'}`);
        return;
      }
      const rec = parseDecisionRecord(raw);
      const text = rec.input.molecules.map(m => `${m.smiles} ${m.name}`).join('\n');
      const { molecules: fresh } = await parseAndAnalyze(text);
      if (fresh.length !== rec.input.molecules.length) throw new Error(`${rec.input.molecules.length - fresh.length} structures did not parse`);
      const restored = fresh.map((m, i) => ({ ...m, name: rec.input.molecules[i].name, customProps: { ...(rec.input.molecules[i].customProps ?? {}) } }));
      rankUnder(restored, rec.objectives, rec.constraints ?? []);
      const v = rec.view ?? {};
      setMolecules(restored);
      setParetoObjectives(rec.objectives);
      setConstraints(rec.constraints ?? []);
      try { setScoringPreset(getProfile(rec.profile.ref).ref as ScoringPreset); } catch { /* unknown profile: leave the current one */ }
      if (rec.profile.curve === 'linear' || rec.profile.curve === 'sigmoid') setMpoCurve(rec.profile.curve);
      setFormulaColumns(v.formulaColumns ?? []);
      setCustomPropNames(v.customPropNames ?? Array.from(new Set(restored.flatMap(m => Object.keys(m.customProps)))));
      setAdmetPropNames(v.admetPropNames ?? []);
      setPropertyFilters(v.propertyFilters ?? {});
      setSubstructureFilter(v.substructureFilter ?? '');
      setShortlist(new Set(selectedIndices(rec)));
      setSelectedMolIdx(null);
      setCompareIndices([]);
      setSessionToast(null);
      if (v.activeTab) setActiveTab(v.activeTab);
      track('decision/imported');
      if (check.issues.length) {
        setToast(`Opened record with differences. ${check.issues.slice(0, 2).map((i) => i.message).join(' ')}`);
      } else {
        setToast(`Opened decision record: ${restored.length} molecules, ${rec.selected.length} selected`);
      }
    } catch (e) {
      setToast(`Could not open record: ${e instanceof Error ? e.message : String(e)}`);
    }
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
      downloadCanvasPng(canvases[0], 'paretomol_figure.png');
      setToast('Figure exported');
      return;
    }
    // Multiple canvases (e.g. Pareto with 6 charts): stitch into a grid, then add the citation footer.
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
    downloadCanvasPng(out, 'paretomol_figure.png');
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

  return (
    <div className="h-screen max-w-[100vw] overflow-hidden bg-[var(--bg-deep)] flex flex-col font-sans text-[var(--text)]">
      {toast && (
        <div className="fixed top-14 inset-x-3 z-[60] px-4 py-2 bg-[var(--surface2)] border border-[var(--accent)] rounded-md text-sm text-[var(--text)] shadow-lg animate-fade-in md:top-4 md:inset-x-auto md:left-1/2 md:-translate-x-1/2">
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
        onReset={() => { setReview(null); setMolecules([]); setSelectedMolIdx(null); setCompareIndices([]); setSubstructureFilter(''); setPropertyFilters({}); clearSvgCache(); window.history.replaceState(null, '', window.location.pathname); }}
        onShareURL={handleShareURL}
        onExportCSV={handleExportCSV}
        onExportJSON={() => { if (molecules.length > 0) { downloadJSON(molecules); setToast('JSON exported'); } }}
        onExportSDF={() => { if (molecules.length > 0) { downloadSDF(molecules); setToast('SDF exported (all)'); } }}
        onExportSDFPareto={() => { const pareto = molecules.filter(m => m.paretoRank === 1); if (pareto.length > 0) { downloadSDFPareto(molecules); setToast(`SDF exported (${pareto.length} Pareto-optimal)`); } else { setToast('No Pareto-optimal molecules'); } }}
        onExportFigure={handleExportFigure}
        onExportSummaryReport={() => { if (molecules.length > 0) { downloadSummaryReport(molecules, paretoObjectives, admetPropNames); setToast('Summary report exported'); } }}
        onExportDecisionRecord={handleExportDecisionRecord}
        onImportDecisionRecord={handleImportDecisionRecord}
        onExportManifest={() => { if (molecules.length > 0) { downloadManifest(molecules, paretoObjectives, propertyFilters, substructureFilter, formulaColumns); setToast('Reproducibility manifest exported'); } }}
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
            scoringPreset={scoringPreset}
            onScoringPreset={applyScoringPreset}
            objectiveWindows={scoringPreset === 'custom' ? customWindows : scoringPreset === 'paper' ? null : getProfile(scoringPreset).desirability}
            constraints={constraints}
            onConstraints={setConstraints}
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

        {review && (
          <div className="fixed inset-0 z-[45] flex min-h-0 flex-col bg-[var(--bg)] md:static md:inset-auto md:z-auto md:h-full md:w-[320px] md:shrink-0 md:border-l md:border-[var(--border-5)]">
            <ReviewPanel
              review={review}
              molecules={molecules}
              objectives={paretoObjectives}
              onDecide={handleReviewDecide}
              onExport={(note) => { void handleReviewExport(note); }}
              onExit={() => { setReview(null); window.history.replaceState(null, '', window.location.pathname + window.location.search); }}
              onSelect={setSelectedMolIdx}
            />
          </div>
        )}

        <div className="flex-1 bg-[var(--bg)] min-w-0 min-h-0 flex flex-col">
          {reviewLinkError && (
            <div role="alert" className="m-4 rounded-md border border-[var(--border-10)] bg-[var(--surface)] p-3 text-[13px] text-[var(--text)]">
              <p>Could not open review link: {reviewLinkError}</p>
              <button type="button" className="mt-2 text-[12px] text-[var(--text2)]" onClick={() => setReviewLinkError(null)}>Dismiss</button>
            </div>
          )}
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
            scoringPreset={scoringPreset}
            onScoringPreset={applyScoringPreset}
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
            scoringProfileRef={scoringProfileRef}
            onScoringProfileRef={(ref) => applyScoringPreset(ref === 'custom@1' ? 'custom' : ref as ScoringPreset)}
            mpoCurve={mpoCurve}
            onMpoCurve={setMpoCurve}
            robustFront={robustFront}
            onRobustFront={setRobustFront}
          />
        </div>
      </main>

      <button
        onClick={() => setIsCopilotOpen(true)}
        className="hidden md:flex fixed bottom-6 right-6 w-12 h-12 bg-[var(--surface2)] border border-[var(--border-10)] rounded-full items-center justify-center text-base font-semibold text-[var(--text)] hover:bg-[var(--accent)] hover:border-transparent hover:text-[var(--text-heading)] transition-all z-40 shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--text)]"
        title="AI Copilot ( / )"
      >
        AI
      </button>

      {/* Quiet footer controls. Shortcuts stay desktop-only; Cite is always there. */}
      <div className="fixed bottom-6 left-6 flex items-center gap-2 z-40">
        <button
          onClick={() => setShortcutsOpen(true)}
          className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-[var(--text2)] hover:text-[var(--text)] bg-[var(--surface2)] border border-[var(--border-5)] rounded-md transition-colors"
          title="Keyboard shortcuts"
        >
          <kbd className="text-[10px] font-mono bg-[var(--surface2)] px-1 py-0.5 rounded border border-[var(--border-10)]">?</kbd>
          <span>Shortcuts</span>
        </button>
      </div>

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

