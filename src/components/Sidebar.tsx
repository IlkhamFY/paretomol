import { useState, useEffect, useRef, useCallback } from 'react';
import type { Molecule, ParetoObjective } from '../utils/types';
import { EXAMPLES, DEFAULT_PARETO_OBJECTIVES, DRUG_FILTERS } from '../utils/types';
import { initRDKitCache, parseAndAnalyze, parseAndAnalyzeChunked, parseSDFFile, fetchChEMBLBatch, computeParetoAndDominance, getMolSvg, filterBySubstructure, mergeAssayData, enrichMoleculeNames } from '../utils/chem';
import { useTheme } from '../contexts/ThemeContext';
import { loadFDAReference, getFDAPercentile, PROP_TO_FDA } from '../utils/fda_reference';
import type { FDADrug } from '../utils/fda_reference';
import Mol3DViewer from './Mol3DViewer';
import PropertyFilters from './PropertyFilters';

interface SidebarProps {
  molecules: Molecule[];
  setMolecules: (m: Molecule[]) => void;
  selectedMolIdx: number | null;
  setSelectedMolIdx: (idx: number | null) => void;
  compareIndices: number[];
  setCompareIndices: React.Dispatch<React.SetStateAction<number[]>>;
  initialPayloadFromUrl?: string | null;
  onUrlPayloadConsumed?: () => void;
  onToast?: (msg: string) => void;
  onInitialLoadComplete?: () => void;
  customPropNames: string[];
  setCustomPropNames: (names: string[]) => void;
  paretoObjectives: ParetoObjective[];
  setParetoObjectives: (objectives: ParetoObjective[]) => void;
  admetPropNames?: string[];
  substructureFilter?: string;
  onSubstructureFilterChange?: (smarts: string) => void;
  propertyFilters?: Record<string, { min: number; max: number }>;
  onPropertyFiltersChange?: (filters: Record<string, { min: number; max: number }>) => void;
  /** Optional ref forwarded to the substructure search input for keyboard focus */
  substructureInputRef?: React.RefObject<HTMLInputElement | null>;
  shortlist?: Set<number>;
  toggleShortlist?: (idx: number) => void;
}

export default function Sidebar({
  molecules,
  setMolecules,
  selectedMolIdx,
  setSelectedMolIdx,
  compareIndices,
  setCompareIndices,
  initialPayloadFromUrl,
  onUrlPayloadConsumed,
  onToast,
  onInitialLoadComplete,
  customPropNames,
  setCustomPropNames,
  paretoObjectives,
  setParetoObjectives,
  admetPropNames = [],
  substructureFilter = '',
  onSubstructureFilterChange,
  propertyFilters = {},
  onPropertyFiltersChange,
  substructureInputRef,
  shortlist,
  toggleShortlist,
}: SidebarProps) {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRDKitReady, setIsRDKitReady] = useState(false);
  const [status, setStatus] = useState<{msg: string, type: 'success'|'error'|'info'}>({ msg: 'loading rdkit...', type: 'info' });
  const [progress, setProgress] = useState<{ done: number; total: number; phase?: 'resolve' | 'analyze' } | null>(null);
  const [chemblInput, setChemblInput] = useState('');
  const [chemblOpen, setChemblOpen] = useState(false);
  const [targetInput, setTargetInput] = useState('');
  const [targetOpen, setTargetOpen] = useState(false);
  const [inputCollapsed, setInputCollapsed] = useState(false);
  const [objectivesExpanded, setObjectivesExpanded] = useState(false);
  const [substructureInput, setSubstructureInput] = useState(substructureFilter);
  const [substructureMatchCount, setSubstructureMatchCount] = useState<number | null>(null);
  const [substructureError, setSubstructureError] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const prevMolCount = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const assayFileRef = useRef<HTMLInputElement>(null);
  const [assayStatus, setAssayStatus] = useState<string | null>(null);

  // Auto-collapse input and clear status when molecules are first loaded
  useEffect(() => {
    if (molecules.length > 0 && prevMolCount.current === 0) {
      setInputCollapsed(true);
      setStatus({ msg: '', type: 'info' });
    }
    prevMolCount.current = molecules.length;
  }, [molecules.length]);

  const CHUNK_THRESHOLD = 30;

  useEffect(() => {
    initRDKitCache()
      .then(() => {
        setIsRDKitReady(true);
        setStatus({ msg: 'rdkit loaded — paste SMILES and click analyze', type: 'success' });
        onInitialLoadComplete?.();
      })
      .catch((e) => {
        setStatus({ msg: 'failed to load rdkit: ' + e.message, type: 'error' });
        onInitialLoadComplete?.();
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isRDKitReady || !initialPayloadFromUrl?.trim() || !onUrlPayloadConsumed) return;
    setStatus({ msg: 'Loading from link...', type: 'info' });
    parseAndAnalyze(initialPayloadFromUrl)
      .then(({ molecules: newMols, errors, failedLookups }) => {
        setMolecules(newMols);
        setCompareIndices([]);
        setSelectedMolIdx(null);
        onUrlPayloadConsumed();
        enrichMoleculeNames(newMols, (enriched) => setMolecules(enriched));
        if (newMols.length > 0) {
          setStatus({ msg: `Loaded ${newMols.length} molecules from link`, type: 'success' });
          onToast?.('Loaded from link');
        } else {
          setStatus({ msg: 'No valid molecules in link', type: 'error' });
        }
        if (errors > 0 || failedLookups > 0) {
          setStatus((s) => ({ ...s, msg: `${s.msg} (${errors} errors, ${failedLookups} lookup failures)` }));
        }
      })
      .catch((e: unknown) => {
        onUrlPayloadConsumed();
        setStatus({ msg: 'Failed to load from link: ' + (e instanceof Error ? e.message : String(e)), type: 'error' });
      });
  }, [isRDKitReady, initialPayloadFromUrl, onUrlPayloadConsumed, setMolecules, setCompareIndices, setSelectedMolIdx, onToast]);

  const MOL_LIMIT = 2000;

  const handleAnalyze = async () => {
    if (!input.trim() || !isRDKitReady) return;
    const lineCount = input.trim().split('\n').filter((l) => l.trim()).length;
    if (lineCount > MOL_LIMIT) {
      const proceed = window.confirm(
        `You're about to analyze ${lineCount.toLocaleString()} molecules. Above ${MOL_LIMIT.toLocaleString()}, performance may degrade significantly (slow parsing, unreadable scatter plots, large memory use).\n\nConsider filtering your dataset first.\n\nContinue anyway?`
      );
      if (!proceed) return;
    }
    setIsLoading(true);
    setProgress(null);
    const useChunked = lineCount >= CHUNK_THRESHOLD;
    setStatus({ msg: useChunked ? `Starting… 0/${lineCount}` : 'Crunching descriptors...', type: 'info' });

    try {
      const result = useChunked
        ? await parseAndAnalyzeChunked(input, {
            chunkSize: 25,
            onProgress: (done, total, phase) => {
              setProgress({ done, total, phase });
              const msg = phase === 'resolve' ? `Resolving names ${done}/${total}...` : `Analyzing ${done}/${total}...`;
              setStatus({ msg, type: 'info' });
            },
          })
        : await parseAndAnalyze(input);
      const { molecules: newMols, errors, failedLookups, customPropNames: newCustomProps } = result;
      setCustomPropNames(newCustomProps);
      // Reset objectives: keep defaults + add new custom props as maximize
      if (newCustomProps.length > 0) {
        setParetoObjectives([
          ...DEFAULT_PARETO_OBJECTIVES,
          ...newCustomProps.map(k => ({ key: k, direction: 'max' as const })),
        ]);
      } else {
        setParetoObjectives(DEFAULT_PARETO_OBJECTIVES);
      }
      setMolecules(newMols);
      setCompareIndices([]);
      setSelectedMolIdx(null);
      setProgress(null);

      // Background: resolve real names for SMILES-only inputs (mol_N fallbacks)
      enrichMoleculeNames(newMols, (enriched) => setMolecules(enriched));

      let finalMsg = `${newMols.length} molecules analyzed`;
      if (newCustomProps.length > 0) finalMsg += ` · ${newCustomProps.length} custom props`;
      if (errors > 0 || failedLookups > 0) {
        finalMsg += ` (${errors} errors, ${failedLookups} lookup failures)`;
        setStatus({ msg: finalMsg, type: 'error' });
      } else {
        setStatus({ msg: finalMsg, type: 'success' });
      }
    } catch (e: unknown) {
      setProgress(null);
      setStatus({ msg: 'analysis error: ' + (e instanceof Error ? e.message : String(e)), type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleExampleLoad = (key: keyof typeof EXAMPLES) => {
    setInput(EXAMPLES[key]);
  };

  const handleAssayMerge = async (file: File) => {
    if (!file.name.match(/\.(csv|tsv|txt)$/i)) {
      setAssayStatus('CSV or TSV file required');
      return;
    }
    const text = await file.text();
    const result = mergeAssayData(text, molecules, customPropNames);
    if (result.newPropNames.length === 0) {
      setAssayStatus('No numeric columns found in file');
      return;
    }
    if (result.matchCount === 0) {
      setAssayStatus('No molecules matched — check SMILES or Name column');
      return;
    }
    // Merge new prop names
    const merged = [...customPropNames];
    for (const n of result.newPropNames) {
      if (!merged.includes(n)) merged.push(n);
    }
    setCustomPropNames(merged);
    // Add new objectives (default direction: min for IC50/Ki, max otherwise)
    const IC50_KEYS = /ic50|ki|kd|ec50|inhibit|potency/i;
    const newObjs = result.newPropNames
      .filter(n => !paretoObjectives.find(o => o.key === n))
      .map(n => ({ key: n, direction: (IC50_KEYS.test(n) ? 'min' : 'max') as 'min' | 'max' }));
    if (newObjs.length > 0) setParetoObjectives([...paretoObjectives, ...newObjs]);
    // Update molecules + recompute Pareto
    computeParetoAndDominance(result.molecules, [...paretoObjectives, ...newObjs]);
    setMolecules([...result.molecules]);
    setAssayStatus(`Merged ${result.newPropNames.join(', ')} — ${result.matchCount}/${molecules.length} molecules matched`);
    onToast?.(`Assay data merged: ${result.matchCount} matches`);
  };

  const handleFileUpload = async (file: File) => {
    if (!isRDKitReady) {
      setStatus({ msg: 'Waiting for RDKit...', type: 'info' });
      return;
    }

    const isSDF = file.name.match(/\.(sdf|sd)$/i);
    const isCSV = file.name.match(/\.(csv|tsv|txt)$/i);

    if (!isSDF && !isCSV) {
      setStatus({ msg: 'Supported formats: .sdf, .sd, .csv, .tsv, .txt', type: 'error' });
      return;
    }

    setIsLoading(true);
    setStatus({ msg: isSDF ? 'Parsing SDF...' : 'Parsing CSV/TSV...', type: 'info' });

    try {
      const text = await file.text();

      if (isSDF) {
        const lines = await parseSDFFile(text);
        if (lines.length === 0) {
          setStatus({ msg: 'No valid molecules found in SDF', type: 'error' });
          return;
        }
        const { molecules: newMols, errors, failedLookups } = await parseAndAnalyze(lines.join('\n'));
        setCustomPropNames([]);
        setParetoObjectives(DEFAULT_PARETO_OBJECTIVES);
        setMolecules(newMols);
        setCompareIndices([]);
        setSelectedMolIdx(null);
        setInput(lines.join('\n'));
        let finalMsg = `Loaded ${newMols.length} molecules from ${file.name}`;
        if (errors > 0 || failedLookups > 0) finalMsg += ` (${errors} errors, ${failedLookups} lookup failures)`;
        setStatus({ msg: finalMsg, type: errors + failedLookups > 0 ? 'error' : 'success' });
        onToast?.(`Loaded ${newMols.length} from SDF`);
      } else {
        // CSV/TSV — paste the raw text into input and trigger analyze
        setInput(text);
        const result = await parseAndAnalyze(text);
        const { molecules: newMols, errors, failedLookups, customPropNames: newCustomProps } = result;
        setCustomPropNames(newCustomProps);
        if (newCustomProps.length > 0) {
          setParetoObjectives([
            ...DEFAULT_PARETO_OBJECTIVES,
            ...newCustomProps.map(k => ({ key: k, direction: 'max' as const })),
          ]);
        } else {
          setParetoObjectives(DEFAULT_PARETO_OBJECTIVES);
        }
        setMolecules(newMols);
        setCompareIndices([]);
        setSelectedMolIdx(null);
        let finalMsg = `Loaded ${newMols.length} molecules from ${file.name}`;
        if (newCustomProps.length > 0) finalMsg += ` + ${newCustomProps.length} custom properties`;
        if (errors > 0 || failedLookups > 0) finalMsg += ` (${errors} errors)`;
        setStatus({ msg: finalMsg, type: errors + failedLookups > 0 ? 'error' : 'success' });
        onToast?.(`Loaded ${newMols.length} from ${file.name}`);
      }
    } catch (e: unknown) {
      setStatus({ msg: 'File parse error: ' + (e instanceof Error ? e.message : String(e)), type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileUpload(file);
  };

  const onDragOver = (e: React.DragEvent) => {
    const hasFiles = e.dataTransfer.types?.includes('Files') ?? false;
    if (hasFiles) e.preventDefault();
  };

  const onDragEnter = (e: React.DragEvent) => {
    const hasFiles = e.dataTransfer.types?.includes('Files') ?? false;
    if (hasFiles) { e.preventDefault(); setIsDragging(true); }
  };

  const onDragLeave = (e: React.DragEvent) => {
    // Only clear if leaving the element itself (not entering a child)
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsDragging(false);
    }
  };

  const handleFetchChEMBL = async () => {
    const ids = chemblInput.split(/[\s,;]+/).filter((s) => s.trim().toUpperCase().startsWith('CHEMBL'));
    if (ids.length === 0) {
      setStatus({ msg: 'Enter ChEMBL IDs (e.g. CHEMBL1, CHEMBL2)', type: 'error' });
      return;
    }
    if (!isRDKitReady) return;
    setIsLoading(true);
    setProgress({ done: 0, total: ids.length });
    setStatus({ msg: `Fetching ChEMBL ${0}/${ids.length}...`, type: 'info' });
    try {
      const lines = await fetchChEMBLBatch(ids, (done, total) => {
        setProgress({ done, total });
        setStatus({ msg: `Fetching ChEMBL ${done}/${total}...`, type: 'info' });
      });
      setProgress(null);
      if (lines.length === 0) {
        setStatus({ msg: 'No molecules found for these ChEMBL IDs', type: 'error' });
        return;
      }
      setInput(lines.join('\n'));
      const { molecules: newMols, errors, failedLookups } = await parseAndAnalyze(lines.join('\n'));
      setCustomPropNames([]);
      setParetoObjectives(DEFAULT_PARETO_OBJECTIVES);
      setMolecules(newMols);
      setCompareIndices([]);
      setSelectedMolIdx(null);
      setStatus({ msg: `Loaded ${newMols.length} from ChEMBL${errors + failedLookups > 0 ? ` (${errors} errors, ${failedLookups} not found)` : ''}`, type: errors + failedLookups > 0 ? 'error' : 'success' });
      setChemblOpen(false);
      setChemblInput('');
    } catch (e: unknown) {
      setProgress(null);
      setStatus({ msg: 'ChEMBL fetch error: ' + (e instanceof Error ? e.message : String(e)), type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };


  const handleFetchTarget = async () => {
    if (!targetInput.trim() || !isRDKitReady) return;
    setIsLoading(true);
    setStatus({ msg: 'Fetching from ChEMBL API...', type: 'info' });

    try {
      const targetId = targetInput.trim().toUpperCase();
      const url = `https://www.ebi.ac.uk/chembl/api/data/activity.json?target_chembl_id=${targetId}&pChEMBL_value__gte=5&limit=500`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`ChEMBL API error: ${res.status}`);
      const data = await res.json();

      if (!data.activities || data.activities.length === 0) {
        setStatus({ msg: 'No active compounds found for this target', type: 'error' });
        setIsLoading(false);
        return;
      }

      // Deduplicate by SMILES, keep best pChEMBL
      const molMap = new Map<string, { smiles: string; name: string; pchembl: number; ic50: number }>();
      for (const act of data.activities) {
        if (!act.canonical_smiles) continue;
        const existing = molMap.get(act.canonical_smiles);
        const pchembl = parseFloat(act.pchembl_value) || 0;
        const ic50 = parseFloat(act.standard_value) || 0;
        if (!existing || pchembl > existing.pchembl) {
          molMap.set(act.canonical_smiles, {
            smiles: act.canonical_smiles,
            name: act.molecule_chembl_id || act.canonical_smiles.slice(0, 20),
            pchembl,
            ic50,
          });
        }
      }

      const entries = Array.from(molMap.values());
      setStatus({ msg: `Found ${entries.length} unique compounds, analyzing...`, type: 'info' });

      // Build SMILES lines with names
      const lines = entries.map(e => `${e.smiles} ${e.name}`).join('\n');
      const result = await parseAndAnalyze(lines);

      // Inject pChEMBL and IC50 as custom properties
      for (const mol of result.molecules) {
        const entry = entries.find(e => e.name === mol.name);
        if (entry) {
          mol.customProps = mol.customProps || {};
          mol.customProps['pChEMBL'] = entry.pchembl;
          if (entry.ic50 > 0) mol.customProps['IC50_nM'] = entry.ic50;
        }
      }

      const customProps = ['pChEMBL'];
      if (entries.some(e => e.ic50 > 0)) customProps.push('IC50_nM');

      setCustomPropNames([...result.customPropNames, ...customProps]);
      setParetoObjectives([
        ...DEFAULT_PARETO_OBJECTIVES,
        { key: 'pChEMBL', direction: 'max' as const },
      ]);
      setMolecules(result.molecules);
      setCompareIndices([]);
      setSelectedMolIdx(null);
      setInput(lines);
      setStatus({ msg: `Loaded ${result.molecules.length} compounds from ${targetId} (${data.activities.length} activities)`, type: 'success' });
      onToast?.(`${result.molecules.length} compounds from ${targetId}`);
    } catch (e: unknown) {
      setStatus({ msg: `ChEMBL error: ${e instanceof Error ? e.message : String(e)}`, type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <aside className="border-r border-[var(--border-5)] p-4 sm:p-5 overflow-y-auto h-full max-h-[100vh] md:max-h-[calc(100vh-73px)] custom-scrollbar">
      {/* Collapsed input bar when molecules loaded */}
      {molecules.length > 0 && inputCollapsed ? (
        <button
          onClick={() => setInputCollapsed(false)}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          className={`w-full flex items-center justify-between text-[11px] uppercase tracking-[1.2px] font-semibold cursor-pointer select-none hover:text-[var(--text)] transition-colors ${
            isDragging ? 'p-2.5 border border-dashed border-[#5F7367] bg-[#5F7367]/10 rounded-md text-[var(--text)]' : 'text-[var(--text2)]'
          }`}
        >
          <span>{isDragging ? 'Drop file to import' : `${molecules.length} molecules loaded`}</span>
          <span className="text-[10px] text-[var(--text2)] font-normal normal-case tracking-normal opacity-50">{isDragging ? '↓' : 'edit'}</span>
        </button>
      ) : (
        <>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] uppercase tracking-[1.2px] text-[var(--text2)] font-semibold">
              Input SMILES
            </div>
            {molecules.length > 0 && (
              <button
                onClick={() => setInputCollapsed(true)}
                className="text-[10px] text-[var(--text2)] hover:text-[var(--text)] transition-colors"
              >
                collapse
              </button>
            )}
          </div>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragEnter={onDragEnter}
            onDragLeave={onDragLeave}
            className={`w-full h-[140px] bg-[var(--surface)] border rounded-md text-[var(--text)] font-mono text-[13px] p-3 resize-y outline-none transition-colors focus:border-[var(--accent)] ${
              isDragging ? 'border-[#5F7367] border-dashed bg-[#5F7367]/10' : 'border-[var(--border-5)]'
            }`}
            placeholder={"SMILES name (one per line):\nCC(=O)Oc1ccccc1C(=O)O aspirin\nCC(C)Cc1ccc(cc1)C(C)C(=O)O ibuprofen\n\nor drop a CSV with SMILES + any numeric columns:\nSMILES,Name,IC50_nM,pIC50,selectivity\nCC(=O)Oc1ccccc1C(=O)O,aspirin,45.2,7.3,12.1\n\nDrag & drop: .sdf .csv .tsv .txt\nAlready loaded? Use 'Add IC50 / assay data' below."}
          />
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleAnalyze}
              disabled={isLoading || !input.trim() || !isRDKitReady}
              className="flex-1 bg-[#5F7367] text-white py-2.5 rounded-md text-[13px] font-semibold flex items-center justify-center gap-2 hover:bg-[var(--accent2)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isLoading ? <span className="spinner-ring" /> : null}
              {isLoading ? 'loading...' : (isRDKitReady ? 'Analyze Molecules' : 'Loading RDKit...')}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".sdf,.sd,.csv,.tsv,.txt"
              className="hidden"
              onChange={onFileChange}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!isRDKitReady || isLoading}
              title="Upload .sdf, .csv, .tsv, or .txt file"
              className="px-3 py-1.5 bg-[var(--surface2)] border border-[var(--border-5)] rounded-md text-[var(--text)] hover:border-[var(--accent)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex flex-col items-center gap-0"
            >
              <span className="text-[13px] font-medium leading-tight">File</span>
              <span className="text-[9px] text-[var(--text2)] leading-tight whitespace-nowrap">SDF, CSV, TSV</span>
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  const text = await navigator.clipboard.readText();
                  if (!text.trim()) { onToast?.('Clipboard is empty'); return; }
                  setInput(text);
                  // Auto-analyze if content looks like structured data (TSV/CSV with newlines)
                  const lines = text.trim().split('\n');
                  if (lines.length >= 2 && (text.includes('\t') || text.includes(','))) {
                    setTimeout(() => handleAnalyze(), 0);
                  }
                } catch {
                  onToast?.('Clipboard access denied — paste manually into the text box');
                }
              }}
              disabled={!isRDKitReady || isLoading}
              title="Paste tab-separated or CSV data from clipboard"
              className="px-3 py-1.5 bg-[var(--surface2)] border border-[var(--border-5)] rounded-md text-[var(--text)] hover:border-[var(--accent)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex flex-col items-center gap-0"
            >
              <span className="text-[13px] font-medium leading-tight">Paste</span>
              <span className="text-[9px] text-[var(--text2)] leading-tight whitespace-nowrap">TSV, CSV</span>
            </button>
          </div>
          {/* Assay merge — only when molecules already loaded */}
          {molecules.length > 0 && (
            <div className="mt-2">
              <input
                ref={assayFileRef}
                type="file"
                accept=".csv,.tsv,.txt"
                className="hidden"
                onChange={async e => {
                  const f = e.target.files?.[0];
                  if (f) await handleAssayMerge(f);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => { setAssayStatus(null); assayFileRef.current?.click(); }}
                className="w-full text-left px-3 py-2 bg-[var(--surface)] border border-[var(--border-5)] rounded-md text-[12px] text-[var(--text2)] hover:border-[var(--accent)] hover:text-[var(--text)] transition-colors"
              >
                <span className="text-[var(--text)] font-medium">Merge assay data</span>
                <span className="block text-[10px] text-[var(--text2)]/70 mt-0.5">Add IC50, Ki, pIC50 columns to loaded molecules</span>
              </button>
              {assayStatus && (
                <div className={`mt-1 text-[11px] ${assayStatus.startsWith('No') || assayStatus.startsWith('CSV') ? 'text-[var(--red)]' : 'text-[var(--green)]'}`}>
                  {assayStatus}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {status.msg && (
        <div className={`mt-2 text-[11px] ${status.type === 'error' ? 'text-[var(--red)]' : status.type === 'success' ? 'text-[var(--green)]' : 'text-[var(--text2)]'}`}>
          {status.msg}
        </div>
      )}
      {progress && (
        <div className="mt-1.5 h-1 bg-[var(--bg)] rounded-full overflow-hidden">
          <div
            className="h-full bg-[#5F7367] transition-all duration-300"
            style={{ width: `${(progress.done / progress.total) * 100}%` }}
          />
        </div>
      )}

      {/* Quick Load + ChEMBL: show when no molecules, hide behind toggle when loaded */}
      {molecules.length === 0 ? (
        <>
          <div className="mt-4">
            <div className="text-[11px] uppercase tracking-[1.2px] text-[var(--text2)] mb-2 font-semibold">
              Quick Load
            </div>
            {Object.entries({
              'Kinase inhibitors': 'kinase',
              'FDA approved drugs': 'fda_approved',
              'Statins': 'statins',
              'CNS drugs': 'cns_drugs',
              'Antihypertensives': 'antihypertensives',
            }).map(([name, key]) => (
              <button
                key={key}
                onClick={() => handleExampleLoad(key as keyof typeof EXAMPLES)}
                className="w-full text-left p-2 bg-[var(--surface)] border border-[var(--border-5)] rounded-md text-[var(--text2)] text-[12px] mb-1.5 transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
              >
                <span className="text-[var(--text)] font-medium">{name}</span>
              </button>
            ))}
          </div>

          <div className="mt-4">
            <button
              type="button"
              onClick={() => setChemblOpen(!chemblOpen)}
              className="w-full text-left p-2 bg-[var(--surface)] border border-[var(--border-5)] rounded-md text-[var(--text2)] text-[12px] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
            >
              <span className="text-[var(--text)] font-medium">Fetch by ChEMBL IDs</span>
            </button>
            {chemblOpen && (
              <div className="mt-2 p-2 bg-[var(--bg)] border border-[var(--border-5)] rounded-md">
                <input
                  type="text"
                  value={chemblInput}
                  onChange={(e) => setChemblInput(e.target.value)}
                  placeholder="CHEMBL1, CHEMBL2, ..."
                  className="w-full bg-[var(--surface)] border border-[var(--border-5)] rounded px-2 py-1.5 text-[12px] text-[var(--text)] placeholder-[var(--text2)] outline-none focus:border-[var(--accent)]"
                />
                <button
                  type="button"
                  onClick={handleFetchChEMBL}
                  disabled={!isRDKitReady || isLoading}
                  className="mt-2 w-full py-1.5 bg-[#5F7367] text-white text-[12px] font-medium rounded hover:bg-[var(--accent2)] disabled:opacity-40"
                >
                  Fetch and analyze
                </button>
              </div>
            )}
          </div>

          <div className="mt-2">
            <button
              type="button"
              onClick={() => setTargetOpen(!targetOpen)}
              className="w-full text-left p-2 bg-[var(--surface)] border border-[var(--border-5)] rounded-md text-[var(--text2)] text-[12px] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
            >
              <span className="text-[var(--text)] font-medium">Fetch by Target</span>
              <span className="ml-2 text-[10px] text-[var(--text2)]">pChEMBL ≥ 5</span>
            </button>
            {targetOpen && (
              <div className="mt-2 p-2 bg-[var(--bg)] border border-[var(--border-5)] rounded-md">
                <input
                  type="text"
                  value={targetInput}
                  onChange={(e) => setTargetInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleFetchTarget(); }}
                  placeholder="e.g. CHEMBL203 (EGFR)"
                  className="w-full bg-[var(--surface)] border border-[var(--border-5)] rounded px-2 py-1.5 text-[12px] text-[var(--text)] placeholder-[var(--text2)] outline-none focus:border-[var(--accent)]"
                />
                <p className="mt-1.5 text-[10px] text-[var(--text2)] leading-snug">
                  CHEMBL203 = EGFR · CHEMBL279 = VEGFR2 · CHEMBL301 = BRAF
                </p>
                <button
                  type="button"
                  onClick={handleFetchTarget}
                  disabled={!isRDKitReady || isLoading || !targetInput.trim()}
                  className="mt-2 w-full py-1.5 bg-[#5F7367] text-white text-[12px] font-medium rounded hover:bg-[var(--accent2)] disabled:opacity-40"
                >
                  Fetch compounds
                </button>
              </div>
            )}
          </div>
        </>
      ) : null}

      {/* Assay Data Merge — hidden in expanded input view instead */}

      {/* Pareto Objectives Selector */}
      {molecules.length > 0 && (
        <div className="mt-4">
          <button
            onClick={() => setObjectivesExpanded(!objectivesExpanded)}
            className="w-full flex items-center justify-between"
          >
            <span className="text-[11px] uppercase tracking-[1.2px] text-[var(--text2)] font-semibold hover:text-[var(--text)] transition-colors">
              Molecular Properties
            </span>
            <span className="text-[10px] text-[var(--text2)] font-normal normal-case tracking-normal opacity-50">
              {objectivesExpanded ? 'collapse' : 'expand'}
            </span>
          </button>
          {!objectivesExpanded ? null : (
          <div className="mt-2 p-2 bg-[var(--bg)] border border-[var(--border-5)] rounded-md space-y-1">
            {/* Built-in properties */}
            {(['MW', 'LogP', 'HBD', 'HBA', 'TPSA', 'RotBonds'] as const).map(key => {
              const obj = paretoObjectives.find(o => o.key === key);
              const isActive = !!obj;
              return (
                <div key={key} className="flex items-center gap-2 text-[11px]">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={() => {
                      if (isActive) {
                        setParetoObjectives(paretoObjectives.filter(o => o.key !== key));
                      } else {
                        setParetoObjectives([...paretoObjectives, { key, direction: 'min' }]);
                      }
                    }}
                    className="accent-[#5F7367] w-3 h-3"
                  />
                  <span className="text-[var(--text)] flex-1">{key}</span>
                  {isActive && (
                    <button
                      onClick={() => setParetoObjectives(paretoObjectives.map(o => o.key === key ? { ...o, direction: o.direction === 'min' ? 'max' : 'min' } : o))}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                        obj.direction === 'min'
                          ? 'bg-[#5F7367]/15 border-[#5F7367]/40 text-[#9db8a5]'
                          : 'bg-[#14b8a6]/15 border-[#14b8a6]/40 text-[#14b8a6]'
                      }`}
                    >
                      {obj.direction}
                    </button>
                  )}
                </div>
              );
            })}
            {/* QED — built-in drug-likeness score, maximize */}
            {(() => {
              const obj = paretoObjectives.find(o => o.key === 'QED');
              const isActive = !!obj;
              return (
                <div className="flex items-center gap-2 text-[11px]">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={() => {
                      if (isActive) setParetoObjectives(paretoObjectives.filter(o => o.key !== 'QED'));
                      else setParetoObjectives([...paretoObjectives, { key: 'QED', direction: 'max' }]);
                    }}
                    className="accent-[#5F7367] w-3 h-3"
                  />
                  <span className="text-[var(--text)] flex-1" title="Quantitative Estimate of Drug-likeness (Bickerton 2012); approx. — structural alerts counted as 0">QED ↑ *</span>
                  {isActive && (
                    <button
                      onClick={() => setParetoObjectives(paretoObjectives.map(o => o.key === 'QED' ? { ...o, direction: o.direction === 'min' ? 'max' : 'min' } : o))}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                        obj.direction === 'min'
                          ? 'bg-[#5F7367]/15 border-[#5F7367]/40 text-[#9db8a5]'
                          : 'bg-[#14b8a6]/15 border-[#14b8a6]/40 text-[#14b8a6]'
                      }`}
                    >
                      {obj.direction}
                    </button>
                  )}
                </div>
              );
            })()}
            {/* Custom properties (non-ADMET only) */}
            {customPropNames.filter(k => !admetPropNames.includes(k)).length > 0 && (
              <>
                <div className="border-t border-[var(--border-5)] pt-1 mt-1">
                  <span className="text-[10px] text-[var(--text2)]/60 uppercase tracking-wider">Custom</span>
                </div>
                {customPropNames.filter(k => !admetPropNames.includes(k)).map(key => {
                  const obj = paretoObjectives.find(o => o.key === key);
                  const isActive = !!obj;
                  return (
                    <div key={key} className="flex items-center gap-2 text-[11px]">
                      <input
                        type="checkbox"
                        checked={isActive}
                        onChange={() => {
                          if (isActive) {
                            setParetoObjectives(paretoObjectives.filter(o => o.key !== key));
                          } else {
                            setParetoObjectives([...paretoObjectives, { key, direction: 'max' }]);
                          }
                        }}
                        className="accent-[#14b8a6] w-3 h-3"
                      />
                      <span className="text-[#14b8a6] flex-1">{key}</span>
                      {isActive && (
                        <button
                          onClick={() => setParetoObjectives(paretoObjectives.map(o => o.key === key ? { ...o, direction: o.direction === 'min' ? 'max' : 'min' } : o))}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                            obj.direction === 'min'
                              ? 'bg-[#5F7367]/15 border-[#5F7367]/40 text-[#9db8a5]'
                              : 'bg-[#14b8a6]/15 border-[#14b8a6]/40 text-[#14b8a6]'
                          }`}
                        >
                          {obj.direction}
                        </button>
                      )}
                    </div>
                  );
                })}
              </>
            )}
            {/* ADMET Predictions */}
            {admetPropNames.length > 0 && (() => {
              const ADMET_PRESETS: { label: string; keys: { key: string; dir: 'min' | 'max' }[] }[] = [
                { label: 'Drug Safety', keys: [{ key: 'hERG', dir: 'min' }, { key: 'AMES', dir: 'min' }, { key: 'DILI', dir: 'min' }, { key: 'ClinTox', dir: 'min' }] },
                { label: 'Oral Profile', keys: [{ key: 'HIA_Hou', dir: 'max' }, { key: 'BBB_Martins', dir: 'max' }, { key: 'Pgp_Broccatelli', dir: 'min' }, { key: 'Bioavailability_Ma', dir: 'max' }] },
                { label: 'Metabolism', keys: [{ key: 'CYP2C9_Veith', dir: 'min' }, { key: 'CYP2D6_Veith', dir: 'min' }, { key: 'CYP3A4_Veith', dir: 'min' }, { key: 'CYP1A2_Veith', dir: 'min' }] },
              ];
              return (
                <>
                  <div className="border-t border-[var(--border-5)] pt-1 mt-1">
                    <span className="text-[10px] text-[#f59e0b]/60 uppercase tracking-wider">ADMET Predictions</span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1 mb-1">
                    {ADMET_PRESETS.map(preset => {
                      const availableKeys = preset.keys.filter(k => admetPropNames.includes(k.key));
                      if (availableKeys.length === 0) return null;
                      const allActive = availableKeys.every(k => paretoObjectives.some(o => o.key === k.key));
                      return (
                        <button
                          key={preset.label}
                          onClick={() => {
                            if (allActive) {
                              setParetoObjectives(paretoObjectives.filter(o => !availableKeys.some(k => k.key === o.key)));
                            } else {
                              const toAdd = availableKeys.filter(k => !paretoObjectives.some(o => o.key === k.key));
                              setParetoObjectives([...paretoObjectives, ...toAdd.map(k => ({ key: k.key, direction: k.dir }))]);
                            }
                          }}
                          className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                            allActive
                              ? 'bg-[#f59e0b]/15 border-[#f59e0b]/40 text-[#f59e0b]'
                              : 'bg-[var(--surface2)] border-[var(--border-10)] text-[var(--text2)] hover:border-[#f59e0b]/40'
                          }`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                  {admetPropNames.map(key => {
                    const obj = paretoObjectives.find(o => o.key === key);
                    const isActive = !!obj;
                    return (
                      <div key={key} className="flex items-center gap-2 text-[11px]">
                        <input
                          type="checkbox"
                          checked={isActive}
                          onChange={() => {
                            if (isActive) {
                              setParetoObjectives(paretoObjectives.filter(o => o.key !== key));
                            } else {
                              setParetoObjectives([...paretoObjectives, { key, direction: 'min' }]);
                            }
                          }}
                          className="accent-[#f59e0b] w-3 h-3"
                        />
                        <span className="text-[#f59e0b] flex-1">{key}</span>
                        {isActive && (
                          <button
                            onClick={() => setParetoObjectives(paretoObjectives.map(o => o.key === key ? { ...o, direction: o.direction === 'min' ? 'max' : 'min' } : o))}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                              obj.direction === 'min'
                                ? 'bg-[#5F7367]/15 border-[#5F7367]/40 text-[#9db8a5]'
                                : 'bg-[#f59e0b]/15 border-[#f59e0b]/40 text-[#f59e0b]'
                            }`}
                          >
                            {obj.direction}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </>
              );
            })()}
            <button
              onClick={() => {
                const updated = [...molecules];
                computeParetoAndDominance(updated, paretoObjectives);
                setMolecules(updated);
                onToast?.('Pareto recomputed');
              }}
              className="w-full mt-1 py-1.5 bg-[#5F7367]/20 border border-[#5F7367]/30 text-[#9db8a5] text-[11px] font-medium rounded hover:bg-[#5F7367]/30 transition-colors"
            >
              Recompute Pareto
            </button>
          </div>
          )}
        </div>
      )}

      {/* Substructure filter — collapsed by default, expands on click */}
      {molecules.length > 0 && (
        <details className="mt-4 group">
          <summary className="text-[11px] uppercase tracking-[1.2px] text-[var(--text2)] font-semibold cursor-pointer select-none hover:text-[var(--text)] transition-colors list-none flex items-center justify-between">
            <span>Substructure Filter</span>
            <span className="text-[10px] text-[var(--text2)] font-normal normal-case tracking-normal opacity-50 group-open:hidden">expand</span>
            <span className="text-[10px] text-[var(--text2)] font-normal normal-case tracking-normal opacity-50 hidden group-open:inline">collapse</span>
          </summary>
          <div className="flex gap-1.5 mt-2">
            <div className="relative flex-1">
              <input
                ref={substructureInputRef}
                type="text"
                value={substructureInput}
                onChange={(e) => setSubstructureInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const smarts = substructureInput.trim();
                    if (!smarts) {
                      onSubstructureFilterChange?.('');
                      setSubstructureMatchCount(null);
                      setSubstructureError(false);
                      return;
                    }
                    const indices = filterBySubstructure(molecules, smarts);
                    if (indices.length === 0 && smarts) {
                      // Could be an invalid SMARTS or genuinely no matches
                      setSubstructureError(false);
                    } else {
                      setSubstructureError(false);
                    }
                    setSubstructureMatchCount(indices.length);
                    onSubstructureFilterChange?.(smarts);
                  }
                }}
                placeholder="SMARTS (e.g. c1ccccc1)"
                className={`w-full bg-[var(--surface)] border rounded px-2 py-1.5 text-[12px] font-mono text-[var(--text)] placeholder-[var(--text2)]/60 outline-none focus:border-[var(--accent)] transition-colors ${
                  substructureError ? 'border-[var(--red)]' : 'border-[var(--border-5)]'
                }`}
              />
            </div>
            {substructureFilter && (
              <button
                onClick={() => {
                  setSubstructureInput('');
                  setSubstructureMatchCount(null);
                  setSubstructureError(false);
                  onSubstructureFilterChange?.('');
                }}
                className="px-2 py-1.5 bg-[var(--surface2)] border border-[var(--border-5)] rounded text-[var(--text2)] hover:text-[var(--text)] hover:border-[var(--accent)] transition-colors text-[12px]"
                title="Clear filter"
              >
                ✕
              </button>
            )}
          </div>
          <div className="mt-1.5 text-[11px]">
            {substructureMatchCount !== null && substructureFilter ? (
              <span className={substructureMatchCount > 0 ? 'text-[#22c55e]' : 'text-[var(--red)]'}>
                {substructureMatchCount}/{molecules.length} molecules match
              </span>
            ) : (
              <span className="text-[var(--text2)]/60">Press Enter to filter</span>
            )}
          </div>
        </details>
      )}

      {/* Range Filters */}
      {molecules.length > 0 && onPropertyFiltersChange && (
        <PropertyFilters
          molecules={molecules}
          paretoObjectives={paretoObjectives}
          propertyFilters={propertyFilters}
          onFiltersChange={onPropertyFiltersChange}
        />
      )}

      <MoleculeList
        molecules={molecules}
        selectedMolIdx={selectedMolIdx}
        setSelectedMolIdx={setSelectedMolIdx}
        compareIndices={compareIndices}
        setCompareIndices={setCompareIndices}
        onToast={onToast}
        shortlist={shortlist}
        toggleShortlist={toggleShortlist}
      />
    </aside>
  );
}

// ─── Virtualized Molecule List ────────────────────────────────────────────────
const CARD_HEIGHT = 140; // estimated height per collapsed card (px)
const BUFFER = 10;       // extra cards above/below viewport

function MoleculeList({ molecules, selectedMolIdx, setSelectedMolIdx, compareIndices, setCompareIndices, onToast, shortlist, toggleShortlist }: {
  molecules: Molecule[];
  selectedMolIdx: number | null;
  setSelectedMolIdx: (idx: number | null) => void;
  compareIndices: number[];
  setCompareIndices: React.Dispatch<React.SetStateAction<number[]>>;
  onToast?: (msg: string) => void;
  shortlist?: Set<number>;
  toggleShortlist?: (idx: number) => void;
}) {
  const { themeVersion } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 30 });

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const scrollTop = el.scrollTop;
    const viewHeight = el.clientHeight;
    const start = Math.max(0, Math.floor(scrollTop / CARD_HEIGHT) - BUFFER);
    const end = Math.min(molecules.length, Math.ceil((scrollTop + viewHeight) / CARD_HEIGHT) + BUFFER);
    setVisibleRange({ start, end });
  }, [molecules.length]);

  // Recalculate on mount and when molecules change
  useEffect(() => {
    handleScroll();
  }, [handleScroll]);

  // Scroll selected molecule into view
  useEffect(() => {
    if (selectedMolIdx === null || !containerRef.current) return;
    const targetTop = selectedMolIdx * CARD_HEIGHT;
    const el = containerRef.current;
    if (targetTop < el.scrollTop || targetTop > el.scrollTop + el.clientHeight - CARD_HEIGHT) {
      el.scrollTo({ top: Math.max(0, targetTop - CARD_HEIGHT), behavior: 'smooth' });
    }
  }, [selectedMolIdx]);

  if (molecules.length === 0) return null;

  const totalHeight = molecules.length * CARD_HEIGHT;
  const topPad = visibleRange.start * CARD_HEIGHT;
  const bottomPad = Math.max(0, totalHeight - visibleRange.end * CARD_HEIGHT);

  return (
    <div
      ref={containerRef}
      className="mt-6 flex-1 overflow-y-auto custom-scrollbar pb-20"
      style={{ maxHeight: 'calc(100vh - 200px)' }}
      onScroll={handleScroll}
    >
      <div style={{ paddingTop: topPad, paddingBottom: bottomPad }}>
        <div className="flex flex-col gap-2">
          {molecules.slice(visibleRange.start, visibleRange.end).map((m, offsetIdx) => {
            const i = visibleRange.start + offsetIdx;
            return (
              <MoleculeCard
                key={`${i}-${themeVersion}`}
                molecule={m}
                isSelected={selectedMolIdx === i}
                isCompared={compareIndices.includes(i)}
                isShortlisted={shortlist?.has(i) ?? false}
                onSelect={() => setSelectedMolIdx(selectedMolIdx === i ? null : i)}
                onContextMenu={() => {
                  setCompareIndices((prev: number[]) => {
                    if (prev.includes(i)) return prev.filter((x: number) => x !== i);
                    if (prev.length >= 2) return [prev[1], i];
                    return [...prev, i];
                  });
                }}
                onToggleShortlist={toggleShortlist ? () => toggleShortlist(i) : undefined}
                onToast={onToast}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Individual Molecule Card ─────────────────────────────────────────────────
function MoleculeCard({ molecule: m, isSelected, isCompared, isShortlisted, onSelect, onContextMenu, onToggleShortlist, onToast }: {
  molecule: Molecule;
  isSelected: boolean;
  isCompared: boolean;
  isShortlisted: boolean;
  onSelect: () => void;
  onContextMenu: () => void;
  onToggleShortlist?: () => void;
  onToast?: (msg: string) => void;
}) {
  const [fdaDrugs, setFdaDrugs] = useState<FDADrug[] | null>(null);

  // Lazily load FDA reference when card is expanded (selected)
  useEffect(() => {
    if (isSelected && !fdaDrugs) {
      loadFDAReference().then(setFdaDrugs).catch(() => {});
    }
  }, [isSelected, fdaDrugs]);
  return (
    <div
      onClick={onSelect}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(); }}
      className={`p-3 bg-[var(--surface)] border rounded-md transition-colors cursor-pointer ${
        isCompared
          ? 'border-[#06b6d4] bg-[#06b6d4]/10'
          : isSelected
            ? 'border-[#2dd4bf] ring-1 ring-[#2dd4bf] shadow-[0_0_10px_rgba(45,212,191,0.2)]'
            : m.paretoRank === 1
              ? 'border-[#22c55e]/50 hover:border-[#22c55e]'
              : 'border-[var(--border-5)] hover:border-[var(--border-20)]'
      }`}
    >
      <div className="flex gap-3">
        <div
          className="w-[100px] h-[75px] rounded shrink-0 flex items-center justify-center [&>svg]:max-w-full [&>svg]:max-h-full"
          dangerouslySetInnerHTML={{ __html: getMolSvg(m.smiles) }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <div className="text-[13px] font-medium text-[var(--text-heading)] truncate flex-1" title={m.name}>{m.name.replace(/_/g, ' ')}</div>
            {onToggleShortlist && (
              <button
                onClick={(e) => { e.stopPropagation(); onToggleShortlist(); }}
                title={isShortlisted ? 'Remove from shortlist' : 'Add to shortlist'}
                className={`shrink-0 w-5 h-5 flex items-center justify-center text-[12px] rounded transition-colors ${
                  isShortlisted
                    ? 'text-[var(--accent)]'
                    : 'text-[var(--text2)]/30 hover:text-[var(--accent)]'
                }`}
              >
                {isShortlisted ? '★' : '☆'}
              </button>
            )}
          </div>
          <div className="text-[11px] text-[var(--text2)] mt-1 space-y-0.5">
            <div className="flex justify-between">
              <span>MW:</span>
              <span className="font-mono text-[var(--text-heading)]">{m.props.MW.toFixed(1)}</span>
            </div>
            <div className="flex justify-between">
              <span>LogP:</span>
              <span className="font-mono text-[var(--text-heading)]">{m.props.LogP.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span title="Quantitative Estimate of Drug-likeness (Bickerton 2012; approx. — no PAINS alert count)">QED*:</span>
              <span className={`font-mono ${m.props.QED >= 0.6 ? 'text-[#22c55e]' : 'text-[var(--text-heading)]'}`}>{m.props.QED.toFixed(3)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-2 flex gap-1.5 flex-wrap">
        {m.paretoRank === 1 && (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[#22c55e]/15 text-[#22c55e]">
            pareto
          </span>
        )}
        {Object.entries(m.filters).map(([fname, res]) => {
          const shortNames: Record<string, string> = { lipinski: 'Ro5', veber: 'veb', ghose: 'gho', leadlike: 'lead' };
          const short = shortNames[fname] ?? fname.slice(0, 3);
          // Build rich per-rule tooltip from DRUG_FILTERS definition
          const filterDef = DRUG_FILTERS[fname as keyof typeof DRUG_FILTERS];
          const tooltipLines: string[] = [];
          if (filterDef) {
            tooltipLines.push(`${filterDef.label}:`);
            for (const rule of filterDef.rules) {
              const val = m.props[rule.key as keyof Molecule['props']] as number;
              if (val === undefined) continue;
              let pass: boolean;
              if (rule.op === '<=') pass = val <= rule.val;
              else if (rule.op === '>=') pass = val >= rule.val;
              else pass = true;
              const fmt = (v: number) => Number.isInteger(v) ? String(v) : v.toFixed(2);
              const icon = pass ? 'ok' : 'x';
              const diff = !pass
                ? rule.op === '<=' ? ` (+${(val - rule.val).toFixed(1)} over)` : ` (-${(rule.val - val).toFixed(1)} under)`
                : '';
              tooltipLines.push(`  ${icon} ${rule.key} ${rule.op} ${rule.val}: ${fmt(val)}${diff}`);
            }
            if (filterDef.maxViolations > 0) {
              tooltipLines.push(`(${filterDef.maxViolations} violation${filterDef.maxViolations > 1 ? 's' : ''} allowed)`);
            }
          } else {
            tooltipLines.push(res.pass ? 'pass' : `${res.violations} violation(s)`);
          }
          const tooltip = tooltipLines.join('\n');
          return (
            <span
              key={fname}
              title={tooltip}
              className={`px-2 py-0.5 rounded text-[10px] font-medium cursor-help select-none ${
                res.pass ? 'bg-[var(--border-10)] text-[var(--text-heading)]' : 'bg-[#ef4444]/15 text-[#ef4444]'
              }`}
            >
              {short} {res.pass ? 'pass' : 'fail'}
            </span>
          );
        })}
        {/* Structural alert badges from ADMET-AI predictions */}
        {([['PAINS_alert', 'PAINS'], ['BRENK_alert', 'Brenk'], ['NIH_alert', 'NIH']] as const).map(([key, label]) =>
          m.customProps?.[key] === 1 ? (
            <span key={key} title={`${label} structural alert`} className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[#f59e0b]/20 text-[#f59e0b]">
              {label}
            </span>
          ) : null
        )}
      </div>

      {/* Expanded details when selected */}
      {isSelected && (
        <div className="mt-3 pt-3 border-t border-[var(--border-5)] space-y-2">
          {/* Stop click/mousedown propagation so 3D rotation doesn't close the card */}
          <div onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
            <Mol3DViewer smiles={m.smiles} height={140} className="w-full" />
          </div>
          <div className="grid grid-cols-3 gap-x-3 gap-y-1 text-[11px]">
            {(['HBD', 'HBA', 'TPSA', 'RotBonds', 'FrCSP3', 'Rings'] as const).map(k => (
              <div key={k} className="flex justify-between">
                <span className="text-[var(--text2)]">{k}</span>
                <span className="font-mono text-[var(--text)]">{typeof m.props[k] === 'number' ? (m.props[k] as number).toFixed(k === 'FrCSP3' ? 2 : 0) : m.props[k]}</span>
              </div>
            ))}
            <div className="flex justify-between col-span-1">
              <span className="text-[var(--text2)]" title="Quantitative Estimate of Drug-likeness (Bickerton 2012) — structural alerts counted as 0 (approx.)">QED*</span>
              <span className={`font-mono ${m.props.QED >= 0.6 ? 'text-[#22c55e]' : m.props.QED >= 0.4 ? 'text-[var(--text)]' : 'text-[var(--text2)]'}`}>{m.props.QED.toFixed(3)}</span>
            </div>
          </div>
          {/* FDA Percentile ranks */}
          {fdaDrugs && fdaDrugs.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] text-[var(--text2)] font-medium">vs FDA oral drugs</div>
              <div className="grid grid-cols-3 gap-1">
                {(['MW', 'LogP', 'HBD', 'HBA', 'TPSA', 'RotBonds'] as const).map(k => {
                  const fdaKey = PROP_TO_FDA[k];
                  if (!fdaKey || fdaKey === 'n' || fdaKey === 's') return null;
                  const pct = getFDAPercentile(fdaDrugs, fdaKey as 'mw'|'logp'|'hbd'|'hba'|'tpsa'|'rb', m.props[k] as number);
                  return (
                    <div key={k} className="flex items-center gap-1 text-[10px]">
                      <div className="flex-1 h-[3px] bg-[var(--border-5)] rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${pct}%`, opacity: 0.6 }} />
                      </div>
                      <span className="text-[var(--text2)] w-8 shrink-0 text-right font-mono">{pct}%</span>
                      <span className="text-[var(--text2)]/50 w-7 shrink-0">{k === 'RotBonds' ? 'Rot' : k}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div
            className="mt-1 p-1.5 bg-[var(--bg)] rounded text-[10px] font-mono text-[var(--text2)] break-all cursor-pointer hover:text-[var(--text)] transition-colors"
            title="Click to copy SMILES"
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(m.smiles).then(() => onToast?.('SMILES copied'));
            }}
          >
            {m.smiles}
          </div>
          <div className="flex gap-2 mt-1">
            <a
              href={`https://pubchem.ncbi.nlm.nih.gov/#query=${encodeURIComponent(m.smiles)}&input_type=smiles`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="flex-1 text-center px-2 py-1 text-[10px] bg-[var(--surface2)] border border-[var(--border-5)] rounded text-[var(--text2)] hover:text-[var(--text)] hover:border-[var(--accent)] transition-colors"
            >
              PubChem ↗
            </a>
          </div>
        </div>
      )}
    </div>
  );
}


