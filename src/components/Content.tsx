import { useState, useEffect, useRef, useCallback, useDeferredValue, startTransition, lazy, Suspense } from 'react';
import type { Molecule, FormulaColumn } from '../utils/types';
import { getInitialTabFromUrl } from '../utils/share';
import { useTheme } from '../contexts/ThemeContext';
import { useFDAReference } from '../hooks/useFDAReference';
import { ChartSkeleton, TableSkeleton, CanvasSkeleton, CardSkeleton, DeferredOverlay } from './Skeleton';
import Shortlist from './Shortlist';
const LandingPage = lazy(() => import('./LandingPage'));

// Lazy: all views — chart.js + plugins stay out of main bundle
const ParetoView = lazy(() => import('./views/ParetoView'));
const ScoringView = lazy(() => import('./views/ScoringView'));
const ParallelView = lazy(() => import('./views/ParallelView'));
const CompareView = lazy(() => import('./views/CompareView'));
const RadarView = lazy(() => import('./views/RadarView'));
const TableView = lazy(() => import('./views/TableView'));
const EggView = lazy(() => import('./views/EggView'));
const SimilarityMatrixView = lazy(() => import('./views/SimilarityMatrixView'));
const ActivityCliffsView = lazy(() => import('./views/ActivityCliffsView'));
const MPOView = lazy(() => import('./views/MPOView'));
const ScaffoldView = lazy(() => import('./views/ScaffoldView'));
const ChemSpaceView = lazy(() => import('./views/ChemSpaceView'));
const ADMETAIView = lazy(() => import('./views/ADMETAIView'));
const StatisticsView = lazy(() => import('./views/StatisticsView'));

export default function Content({ molecules, compareIndices, selectedMolIdx, setSelectedMolIdx, exportContainerRef, setCompareIndices, isInitialLoading, customPropNames = [], onADMETPredictions, onLoadExample, onOpenSidebar, activeTab: activeTabProp, setActiveTab: setActiveTabProp, showFDARef: showFDARefProp, setShowFDARef: setShowFDARefProp, onToast, shortlist, toggleShortlist, formulaColumns, setFormulaColumns }: { molecules: Molecule[]; compareIndices: number[]; selectedMolIdx: number | null; setSelectedMolIdx?: (idx: number | null) => void; exportContainerRef?: React.RefObject<HTMLDivElement | null>; setCompareIndices?: React.Dispatch<React.SetStateAction<number[]>>; isInitialLoading?: boolean; customPropNames?: string[]; onADMETPredictions?: (predictions: Map<string, Record<string, number>>) => void; onLoadExample?: (key: string) => void; onOpenSidebar?: () => void; activeTab?: string; setActiveTab?: (tab: string) => void; showFDARef?: boolean; setShowFDARef?: (v: boolean | ((prev: boolean) => boolean)) => void; onToast?: (msg: string) => void; shortlist?: Set<number>; toggleShortlist?: (idx: number) => void; formulaColumns?: FormulaColumn[]; setFormulaColumns?: (cols: FormulaColumn[]) => void }) {
  // Use lifted state from App if provided, otherwise fallback to local state
  const validTabs = ['pareto','admet-ai','egg','table','radar','scaffolds','chemspace','scoring','mpo','cliffs','compare','parallel','similarity','statistics'];
  // Legacy tab IDs → new tab IDs (for old shared URLs)
  const legacyTabMap: Record<string, string> = { histograms: 'statistics', boxplots: 'statistics', correlations: 'statistics', 'scaffold-intel': 'scaffolds' };
  const urlTab = getInitialTabFromUrl();
  const resolvedTab = urlTab ? (legacyTabMap[urlTab] ?? urlTab) : null;
  const [localActiveTab, setLocalActiveTabRaw] = useState(resolvedTab && validTabs.includes(resolvedTab) ? resolvedTab : 'pareto');
  const setLocalActiveTab = (tab: string) => startTransition(() => setLocalActiveTabRaw(tab));
  const activeTab = activeTabProp ?? localActiveTab;
  const setActiveTab = setActiveTabProp ?? setLocalActiveTab;
  const { themeVersion } = useTheme();
  const deferredMolecules = useDeferredValue(molecules);
  const [localShowFDARef, setLocalShowFDARef] = useState(false);
  const showFDARef = showFDARefProp ?? localShowFDARef;
  const setShowFDARef = setShowFDARefProp ?? setLocalShowFDARef;
  const fdaData = useFDAReference(showFDARef);
  const [shortlistOpen, setShortlistOpen] = useState(false);

  // Expose activeTab changes to URL (for share link)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (activeTab !== 'pareto') {
      params.set('tab', activeTab);
    } else {
      params.delete('tab');
    }
    const newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
    window.history.replaceState(null, '', newUrl);
  }, [activeTab]);

  // Tab bar scroll fade state (must be before any early return)
  const tabsRef = useRef<HTMLDivElement>(null);
  const [tabScroll, setTabScroll] = useState({ left: false, right: false });
  const updateTabScroll = useCallback(() => {
    const el = tabsRef.current;
    if (!el) return;
    const left = el.scrollLeft > 4;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setTabScroll(prev => (prev.left === left && prev.right === right) ? prev : { left, right });
  }, []);
  useEffect(() => {
    updateTabScroll();
    const el = tabsRef.current;
    if (!el) return;
    const ro = new ResizeObserver(updateTabScroll);
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateTabScroll, molecules.length]);

  if (molecules.length === 0) {
    if (isInitialLoading) {
      return (
        <div className="flex flex-col items-center justify-center h-[calc(100vh-73px)] text-[var(--text2)] text-center gap-3">
          <div className="w-5 h-5 border-2 border-[#5F7367]/30 border-t-[#5F7367] rounded-full animate-spin" />
          <p className="text-[13px]">Loading molecules...</p>
        </div>
      );
    }
    return <Suspense fallback={<div className="flex items-center justify-center h-[calc(100vh-73px)]"><div className="w-5 h-5 border-2 border-[#5F7367]/30 border-t-[#5F7367] rounded-full animate-spin" /></div>}><LandingPage onLoadExample={onLoadExample} onOpenSidebar={onOpenSidebar} /></Suspense>;
  }

  return (
    <div className="p-3 sm:p-4 md:p-6 overflow-y-auto max-h-[calc(100vh-73px)] custom-scrollbar">
      {/* Toolbar row — shortlist chip + selected molecule + FDA toggle */}
      <Shortlist
        molecules={molecules}
        shortlist={shortlist ?? new Set()}
        toggleShortlist={toggleShortlist ?? (() => {})}
        setSelectedMolIdx={setSelectedMolIdx}
        onToast={onToast}
        isOpen={shortlistOpen}
        setIsOpen={setShortlistOpen}
        trailing={
          <div className="flex items-center gap-2 text-[12px] text-[var(--text2)]">
            {selectedMolIdx != null && molecules[selectedMolIdx] && (
              <>
                <span className="text-[var(--text2)] truncate max-w-[120px]">{molecules[selectedMolIdx].name.replace(/_/g, ' ')}</span>
                <button
                  onClick={() => setSelectedMolIdx?.(null)}
                  className="text-[var(--text2)]/40 hover:text-[var(--text2)] text-[10px]"
                  title="Deselect"
                >✕</button>
              </>
            )}
            <label
              className="flex items-center gap-1.5 cursor-pointer select-none"
              title="Overlay FDA-approved oral drug reference data"
            >
              <span className="text-[11px] text-[var(--text2)]">FDA ref</span>
              <button
                role="switch"
                aria-checked={showFDARef}
                onClick={() => setShowFDARef(v => !v)}
                className={`relative w-7 h-4 rounded-full transition-colors ${
                  showFDARef ? 'bg-[var(--accent)]' : 'bg-[var(--border-10)]'
                }`}
              >
                <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                  showFDARef ? 'translate-x-3' : 'translate-x-0'
                }`} />
              </button>
              {fdaData && showFDARef && <span className="text-[10px] text-[var(--text2)]/50">({fdaData.length})</span>}
            </label>
            <button
              onClick={() => {
                const container = exportContainerRef?.current;
                const canvases = Array.from(container?.querySelectorAll('canvas') ?? []).filter(
                  (c): c is HTMLCanvasElement => c instanceof HTMLCanvasElement && c.width > 0 && c.height > 0
                );
                if (canvases.length === 0) { onToast?.('No chart to export on this tab'); return; }
                let out: HTMLCanvasElement;
                if (canvases.length === 1) {
                  out = canvases[0];
                } else {
                  const cols = 2;
                  const rows = Math.ceil(canvases.length / cols);
                  const w = Math.max(...canvases.map(c => c.width));
                  const h = Math.max(...canvases.map(c => c.height));
                  out = document.createElement('canvas');
                  out.width = cols * w; out.height = rows * h;
                  const ctx = out.getContext('2d')!;
                  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
                  ctx.fillRect(0, 0, out.width, out.height);
                  canvases.forEach((c, i) => ctx.drawImage(c, (i % cols) * w, Math.floor(i / cols) * h, w, h));
                }
                out.toBlob(blob => {
                  if (!blob) return;
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `paretomol-${activeTab}.png`;
                  a.click();
                  URL.revokeObjectURL(url);
                }, 'image/png');
              }}
              title="Download chart as PNG"
              className="px-2 py-1 text-[11px] text-[var(--text2)] hover:text-[var(--text)] border border-[var(--border-5)] rounded hover:border-[var(--accent)] transition-colors"
            >
              PNG ↓
            </button>
          </div>
        }
      />

      {/* Tabs with scroll arrows + fade indicators */}
      <div className="relative mb-6">
        {/* Gradient fades */}
        {tabScroll.left && (
          <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-[var(--bg)] to-transparent z-10 pointer-events-none" />
        )}
        {tabScroll.right && (
          <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-[var(--bg)] to-transparent z-10 pointer-events-none" />
        )}
        {/* Scroll arrow buttons */}
        {tabScroll.left && (
          <button
            onClick={() => { const el = tabsRef.current; if (el) el.scrollBy({ left: -200, behavior: 'smooth' }); }}
            className="absolute left-0 top-0 bottom-0 z-20 w-7 flex items-center justify-center text-[var(--text2)] hover:text-[var(--text-heading)] bg-gradient-to-r from-[var(--bg)] via-[var(--bg)] to-transparent transition-colors"
            aria-label="Scroll tabs left"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
        )}
        {tabScroll.right && (
          <button
            onClick={() => { const el = tabsRef.current; if (el) el.scrollBy({ left: 200, behavior: 'smooth' }); }}
            className="absolute right-0 top-0 bottom-0 z-20 w-7 flex items-center justify-center text-[var(--text2)] hover:text-[var(--text-heading)] bg-gradient-to-l from-[var(--bg)] via-[var(--bg)] to-transparent transition-colors"
            aria-label="Scroll tabs right"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
        )}
        <div
          ref={tabsRef}
          className="flex items-center border-b border-[var(--border-5)] pb-0 overflow-x-auto scrollbar-none"
          onScroll={updateTabScroll}
        >
          {/* Group 1: Core */}
          {[
            { id: 'pareto', label: 'Pareto' },
            { id: 'admet-ai', label: 'ADMET' },
            { id: 'egg', label: 'BOILED-Egg' },
            { id: 'table', label: 'Table' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 sm:px-4 py-2 text-[12px] sm:text-[13px] font-medium transition-colors border-b-2 whitespace-nowrap shrink-0 ${
                activeTab === tab.id
                  ? 'border-[var(--accent)] text-[var(--text-heading)]'
                  : 'border-transparent text-[var(--text2)] hover:text-[var(--text)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
          {/* Divider */}
          <div className="w-px h-5 bg-[var(--border-10)] shrink-0 mx-1" />
          {/* Group 2: Properties & Structure */}
          {[
            { id: 'radar', label: 'Radar' },
            { id: 'scaffolds', label: 'Scaffolds' },
            { id: 'chemspace', label: 'Chem Space' },
            { id: 'scoring', label: 'Scoring' },
            { id: 'mpo', label: 'MPO' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 sm:px-4 py-2 text-[12px] sm:text-[13px] font-medium transition-colors border-b-2 whitespace-nowrap shrink-0 ${
                activeTab === tab.id
                  ? 'border-[var(--accent)] text-[var(--text-heading)]'
                  : 'border-transparent text-[var(--text2)] hover:text-[var(--text)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
          {/* Divider */}
          <div className="w-px h-5 bg-[var(--border-10)] shrink-0 mx-1" />
          {/* Group 3: Comparison & Analysis */}
          {[
            { id: 'cliffs', label: 'Cliffs' },
            { id: 'compare', label: 'Compare' },
            { id: 'parallel', label: 'Parallel' },
            { id: 'similarity', label: 'Similarity' },
            { id: 'statistics', label: 'Statistics' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 sm:px-4 py-2 text-[12px] sm:text-[13px] font-medium transition-colors border-b-2 whitespace-nowrap shrink-0 ${
                activeTab === tab.id
                  ? 'border-[var(--accent)] text-[var(--text-heading)]'
                  : 'border-transparent text-[var(--text2)] hover:text-[var(--text)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* View Content — Suspense shows skeleton while lazy chunks load */}
      <div className="view-container relative" ref={exportContainerRef}>
        <DeferredOverlay isStale={deferredMolecules !== molecules} />
        <Suspense key={themeVersion} fallback={<SuspenseFallback tab={activeTab} />}>
          {activeTab === 'pareto' && <ParetoView molecules={deferredMolecules} onSelectMolecule={setSelectedMolIdx ? (idx) => setSelectedMolIdx(idx) : undefined} selectedMolIdx={selectedMolIdx} fdaData={fdaData ?? undefined} customPropNames={customPropNames} />}
          {activeTab === 'admet-ai' && <ADMETAIView molecules={deferredMolecules} selectedMolIdx={selectedMolIdx} setSelectedMolIdx={setSelectedMolIdx} onPredictionsReady={onADMETPredictions} />}
          {activeTab === 'egg' && <EggView molecules={deferredMolecules} selectedMolIdx={selectedMolIdx} setSelectedMolIdx={setSelectedMolIdx} fdaData={fdaData ?? undefined} />}
          {activeTab === 'table' && <TableView molecules={deferredMolecules} selectedMolIdx={selectedMolIdx} setSelectedMolIdx={setSelectedMolIdx} customPropNames={customPropNames} formulaColumns={formulaColumns} setFormulaColumns={setFormulaColumns} />}
          {activeTab === 'radar' && <RadarView molecules={deferredMolecules} selectedMolIdx={selectedMolIdx} setSelectedMolIdx={setSelectedMolIdx} shortlist={shortlist} />}
          {activeTab === 'scaffolds' && <ScaffoldView molecules={deferredMolecules} selectedMolIdx={selectedMolIdx} setSelectedMolIdx={setSelectedMolIdx} />}
          {activeTab === 'chemspace' && <ChemSpaceView molecules={deferredMolecules} selectedMolIdx={selectedMolIdx} setSelectedMolIdx={setSelectedMolIdx} />}
          {activeTab === 'scoring' && <ScoringView molecules={deferredMolecules} selectedMolIdx={selectedMolIdx} setSelectedMolIdx={setSelectedMolIdx} />}
          {activeTab === 'mpo' && <MPOView molecules={deferredMolecules} selectedMolIdx={selectedMolIdx} setSelectedMolIdx={setSelectedMolIdx} />}
          {activeTab === 'cliffs' && <ActivityCliffsView molecules={deferredMolecules} onComparePair={setCompareIndices ? (i, j) => { setCompareIndices([i, j]); setActiveTab('compare'); } : undefined} />}
          {activeTab === 'compare' && <CompareView molecules={deferredMolecules} compareIndices={compareIndices} setCompareIndices={setCompareIndices} />}
          {activeTab === 'parallel' && <ParallelView molecules={deferredMolecules} selectedMolIdx={selectedMolIdx} setSelectedMolIdx={setSelectedMolIdx} />}
          {activeTab === 'similarity' && <SimilarityMatrixView molecules={deferredMolecules} onComparePair={setCompareIndices ? (i, j) => { setCompareIndices([i, j]); setActiveTab('compare'); } : undefined} />}
          {activeTab === 'statistics' && <StatisticsView molecules={deferredMolecules} customPropNames={customPropNames} />}
        </Suspense>
      </div>
    </div>
  );
}

/** Tab-specific skeleton shown while lazy view chunk loads */
function SuspenseFallback({ tab }: { tab: string }) {
  switch (tab) {
    case 'table':
      return <TableSkeleton />;
    case 'similarity':
    case 'chemspace':
    case 'parallel':
      return <CanvasSkeleton />;
    case 'scaffolds':
    case 'compare':
    case 'cliffs':
    case 'statistics':
      return <CardSkeleton />;
    default:
      return <ChartSkeleton />;
  }
}

