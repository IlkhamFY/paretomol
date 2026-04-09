import React, { useState, useMemo } from 'react';
import type { Molecule, FormulaColumn } from '../../utils/types';
import { PROPERTIES, DRUG_FILTERS } from '../../utils/types';
import { validateFormula, parseFormula } from '../../utils/formula';

const PAGE_SIZE = 100; // rows per page — keeps DOM small

const FILTER_COLORS: Record<string, string> = {
  lipinski: '#22c55e',
  veber: '#22c55e',
  ghose: '#22c55e',
  leadlike: '#22c55e',
};

type SortState = { key: string; dir: 1 | -1 } | null;

function SortIndicator({ active, dir }: { active: boolean; dir: 1 | -1 }) {
  if (!active) return <span className="ml-1 opacity-20 text-[10px]">⇅</span>;
  return <span className="ml-1 text-[#5F7367] text-[10px]">{dir === 1 ? '▲' : '▼'}</span>;
}

function TableView({ molecules, selectedMolIdx, setSelectedMolIdx, customPropNames = [], formulaColumns, setFormulaColumns }: { molecules: Molecule[], selectedMolIdx: number | null, setSelectedMolIdx?: (idx: number | null) => void, customPropNames?: string[], formulaColumns?: FormulaColumn[], setFormulaColumns?: (cols: FormulaColumn[]) => void }) {
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set(Object.keys(DRUG_FILTERS)));
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(0);
  const [nameSearch, setNameSearch] = useState('');
  const [showFormulaModal, setShowFormulaModal] = useState(false);
  const [formulaName, setFormulaName] = useState('');
  const [formulaExpr, setFormulaExpr] = useState('');
  const [formulaError, setFormulaError] = useState<string | null>(null);

  const toggleFilter = (name: string) => {
    setActiveFilters(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  // Three-click cycle: none → asc → desc → none
  const handleSort = (key: string) => {
    setSort(prev => {
      if (!prev || prev.key !== key) return { key, dir: 1 };
      if (prev.dir === 1) return { key, dir: -1 };
      return null; // third click clears
    });
    setPage(0);
  };

  const searchLower = nameSearch.toLowerCase();

  const sortedMolecules = useMemo(() => {
    let list = [...molecules];
    // Apply name search filter
    if (searchLower) {
      list = list.filter(m => m.name.toLowerCase().includes(searchLower));
    }
    if (!sort) return list;
    const { key, dir } = sort;
    const isCustom = customPropNames.includes(key);
    return list.sort((a, b) => {
      const vA = isCustom ? (a.customProps[key] ?? 0) : (a.props[key as keyof Molecule['props']] as number);
      const vB = isCustom ? (b.customProps[key] ?? 0) : (b.props[key as keyof Molecule['props']] as number);
      return (vA - vB) * dir;
    });
  }, [molecules, sort, customPropNames, searchLower]);

  const pageCount = Math.ceil(sortedMolecules.length / PAGE_SIZE);
  const visibleRows = sortedMolecules.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const filterCols = Array.from(activeFilters);

  const thClass = (key: string) =>
    `p-3 font-medium cursor-pointer select-none whitespace-nowrap hover:text-[var(--text-heading)] transition-colors ${sort?.key === key ? 'text-[var(--text-heading)]' : ''}`;

  return (
    <div className="space-y-6">
      {/* Filters row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-[var(--text2)] py-1">Show filters:</span>
        {Object.entries(DRUG_FILTERS).map(([fname, fdef]) => (
          <button
            key={fname}
            onClick={() => toggleFilter(fname)}
            style={activeFilters.has(fname) ? { backgroundColor: `${FILTER_COLORS[fname] ?? '#22c55e'}15`, borderColor: FILTER_COLORS[fname] ?? '#22c55e', color: FILTER_COLORS[fname] ?? '#22c55e' } : {}}
            className={`px-3 py-1 text-[11px] rounded-full border transition-colors ${
              activeFilters.has(fname)
                ? ''
                : 'bg-[var(--surface2)] border-[var(--border-5)] text-[var(--text2)] hover:border-[var(--accent)]'
            }`}
          >
            {(fdef as { label: string }).label}
          </button>
        ))}
      </div>

      <div className="bg-[var(--surface)] border border-[var(--border-5)] rounded-lg overflow-hidden">
        <div className="p-4 border-b border-[var(--border-5)] flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-[14px] font-medium text-[var(--text-heading)]">Molecular Properties</h3>
            <p className="text-[12px] text-[var(--text2)]">click column headers to sort · click again to reverse · third click to clear</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Add computed column button */}
            {setFormulaColumns && (
              <button
                onClick={() => { setShowFormulaModal(true); setFormulaName(''); setFormulaExpr(''); setFormulaError(null); }}
                className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] text-[var(--text2)] hover:text-[var(--text)] border border-[var(--border-5)] hover:border-[var(--accent)] rounded-md transition-colors"
                title="Add computed column"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                Column
              </button>
            )}
            {/* Name search */}
            <div className="relative">
              <input
                type="text"
                value={nameSearch}
                onChange={(e) => { setNameSearch(e.target.value); setPage(0); }}
                placeholder="Filter by name..."
                className="bg-[var(--bg)] border border-[var(--border-5)] rounded-md px-3 py-1.5 text-[12px] text-[var(--text)] placeholder-[var(--text2)]/60 outline-none focus:border-[#5F7367] transition-colors w-[180px]"
              />
              {nameSearch && (
                <button
                  onClick={() => { setNameSearch(''); setPage(0); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text2)] hover:text-[var(--text)] text-[11px]"
                >✕</button>
              )}
            </div>
          </div>
        </div>

        {/* Formula column modal */}
        {showFormulaModal && (
          <div className="p-4 border-b border-[var(--border-5)] bg-[var(--bg)]">
            <div className="text-[13px] font-medium text-[var(--text-heading)] mb-2">Add Computed Column</div>
            <div className="flex flex-col gap-2">
              <input
                type="text"
                value={formulaName}
                onChange={e => setFormulaName(e.target.value)}
                placeholder="Column name (e.g. LLE)"
                className="bg-[var(--surface)] border border-[var(--border-5)] rounded px-2.5 py-1.5 text-[12px] text-[var(--text)] outline-none focus:border-[#5F7367] transition-colors w-full"
              />
              <input
                type="text"
                value={formulaExpr}
                onChange={e => {
                  setFormulaExpr(e.target.value);
                  if (e.target.value.trim()) {
                    const availVars = ['MW', 'LogP', 'HBD', 'HBA', 'TPSA', 'RotBonds', 'FrCSP3', 'HeavyAtoms', 'MR', 'Rings', 'AromaticRings', 'NumAtoms', ...customPropNames];
                    const result = validateFormula(e.target.value, availVars);
                    setFormulaError(result.valid ? null : (result.error ?? 'Invalid'));
                  } else {
                    setFormulaError(null);
                  }
                }}
                placeholder="Expression (e.g. LogP - log(MW))"
                className="bg-[var(--surface)] border border-[var(--border-5)] rounded px-2.5 py-1.5 text-[12px] font-mono text-[var(--text)] outline-none focus:border-[#5F7367] transition-colors w-full"
              />
              {formulaError && <div className="text-[11px] text-[#ef4444]">{formulaError}</div>}
              {/* Preview value for first molecule */}
              {formulaExpr.trim() && !formulaError && molecules.length > 0 && (
                <div className="text-[11px] text-[var(--text2)]">
                  Preview ({molecules[0].name}): {(() => {
                    try {
                      const fn = parseFormula(formulaExpr);
                      const vars = { ...molecules[0].props, ...molecules[0].customProps };
                      return fn(vars).toFixed(3);
                    } catch { return 'error'; }
                  })()}
                </div>
              )}
              {/* Available variables */}
              <div className="flex flex-wrap gap-1">
                {['MW', 'LogP', 'HBD', 'HBA', 'TPSA', 'RotBonds', 'FrCSP3', ...customPropNames].map(v => (
                  <button
                    key={v}
                    onClick={() => setFormulaExpr(prev => prev + (prev.length > 0 && !/[\s(+\-*/^,]$/.test(prev) ? ' ' : '') + v)}
                    className="px-1.5 py-0.5 text-[10px] font-mono bg-[var(--surface2)] border border-[var(--border-5)] rounded hover:border-[var(--accent)] text-[var(--text2)] transition-colors"
                  >
                    {v}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 mt-1">
                <button
                  onClick={() => {
                    if (!formulaName.trim() || !formulaExpr.trim() || formulaError) return;
                    const cols = formulaColumns ?? [];
                    setFormulaColumns?.([...cols.filter(c => c.name !== formulaName.trim()), { name: formulaName.trim(), expr: formulaExpr.trim() }]);
                    setShowFormulaModal(false);
                  }}
                  disabled={!formulaName.trim() || !formulaExpr.trim() || !!formulaError}
                  className="px-3 py-1.5 text-[12px] font-medium bg-[var(--accent)] text-white rounded hover:opacity-90 transition-opacity disabled:opacity-30"
                >
                  Add
                </button>
                <button
                  onClick={() => setShowFormulaModal(false)}
                  className="px-3 py-1.5 text-[12px] text-[var(--text2)] hover:text-[var(--text)] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
        
        <div className="overflow-x-auto" style={{ maxWidth: '100%' }}>
          <table className="min-w-full text-left border-collapse text-[12px]" style={{ width: 'max-content' }}>
            <thead className="sticky top-0 z-20">
              <tr className="bg-[var(--bg)] text-[var(--text2)] border-b border-[var(--border-10)] uppercase tracking-wider">
                <th className="p-3 font-medium whitespace-nowrap min-w-[200px] sticky left-0 bg-[var(--bg)] z-10">Molecule</th>
                {(['MW', 'LogP', 'HBD', 'HBA', 'TPSA', 'RotBonds'] as const).map(key => (
                  <th key={key} className={thClass(key)} onClick={() => handleSort(key)}>
                    {key}<SortIndicator active={sort?.key === key} dir={sort?.dir ?? 1} />
                  </th>
                ))}
                {customPropNames.map(cp => {
                  const isFormula = formulaColumns?.some(fc => fc.name === cp);
                  return (
                    <th key={cp} className={`${thClass(cp)} text-[#14b8a6]/70 hover:text-[#14b8a6]`} onClick={() => handleSort(cp)}>
                      <span className="inline-flex items-center gap-1">
                        {cp}<SortIndicator active={sort?.key === cp} dir={sort?.dir ?? 1} />
                        {isFormula && setFormulaColumns && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setFormulaColumns((formulaColumns ?? []).filter(fc => fc.name !== cp)); }}
                            className="text-[9px] text-[var(--text2)]/40 hover:text-[#ef4444] ml-0.5"
                            title="Remove computed column"
                          >✕</button>
                        )}
                      </span>
                    </th>
                  );
                })}
                {filterCols.map(fn => (
                  <th key={fn} className="p-3 font-medium whitespace-nowrap">{(DRUG_FILTERS as Record<string, { label: string }>)[fn]?.label}</th>
                ))}
                <th className="p-3 font-medium cursor-pointer select-none hover:text-[var(--text-heading)] whitespace-nowrap" onClick={() => handleSort('paretoRank')}>
                  Pareto<SortIndicator active={sort?.key === 'paretoRank'} dir={sort?.dir ?? 1} />
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={7 + customPropNames.length + filterCols.length + 1} className="p-6 text-center text-[var(--text2)] text-[12px]">
                    No molecules match "{nameSearch}"
                  </td>
                </tr>
              ) : visibleRows.map(m => {
                const originalIdx = molecules.indexOf(m);
                const isSelected = selectedMolIdx === originalIdx;
                
                return (
                  <tr
                    key={m.smiles}
                    className={`border-b border-[var(--border-5)] hover:bg-[var(--bg)] cursor-pointer ${isSelected ? 'bg-[#14b8a6]/10' : ''}`}
                    onClick={() => setSelectedMolIdx?.(isSelected ? null : originalIdx)}
                  >
                    <td className="p-3 font-medium text-[var(--text-heading)] truncate max-w-[200px] sticky left-0 bg-[var(--surface)] z-10" title={m.name}>{m.name}</td>
                    
                    {(['MW', 'LogP', 'HBD', 'HBA', 'TPSA', 'RotBonds'] as const).map(key => {
                      const v = m.props[key] as number;
                      const propDef = PROPERTIES.find(p => p.key === key);
                      const isBad = propDef?.lipinski ? v > propDef.lipinski.max : false;
                      return (
                        <td key={key} className={`p-3 font-mono ${isBad ? 'text-[#ef4444]' : 'text-[var(--text2)]'}`}>
                          {v.toFixed(1)}
                        </td>
                      );
                    })}

                    {customPropNames.map(cp => (
                      <td key={cp} className="p-3 font-mono text-[#14b8a6]/80">
                        {m.customProps[cp] != null ? m.customProps[cp].toFixed(2) : '—'}
                      </td>
                    ))}

                    {filterCols.map(fn => {
                      const res = m.filters[fn];
                      return (
                        <td key={fn} className="p-3">
                          {res?.pass ? (
                            <span className="text-[#22c55e]">pass</span>
                          ) : (
                            <span className="text-[#ef4444]">{res?.violations || 1} fail</span>
                          )}
                        </td>
                      );
                    })}

                    <td className={`p-3 font-medium ${m.paretoRank === 1 ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
                      {m.paretoRank === 1 ? 'yes' : 'no'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="flex items-center justify-between text-[12px] text-[var(--text2)] px-1">
          <span>{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sortedMolecules.length)} of {sortedMolecules.length}{nameSearch ? ` (filtered from ${molecules.length})` : ''}</span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage(0)}
              disabled={page === 0}
              className="px-2 py-1 rounded bg-[var(--surface2)] border border-[var(--border-5)] disabled:opacity-30 hover:border-[var(--accent)] transition-colors"
            >«</button>
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-2 py-1 rounded bg-[var(--surface2)] border border-[var(--border-5)] disabled:opacity-30 hover:border-[var(--accent)] transition-colors"
            >‹</button>
            {Array.from({ length: Math.min(5, pageCount) }, (_, i) => {
              const start = Math.max(0, Math.min(page - 2, pageCount - 5));
              const p = start + i;
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`px-2 py-1 rounded border transition-colors ${p === page ? 'bg-[#5F7367]/20 border-[#5F7367]/50 text-[#9db8a5]' : 'bg-[var(--surface2)] border-[var(--border-5)] hover:border-[var(--accent)]'}`}
                >{p + 1}</button>
              );
            })}
            <button
              onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
              disabled={page === pageCount - 1}
              className="px-2 py-1 rounded bg-[var(--surface2)] border border-[var(--border-5)] disabled:opacity-30 hover:border-[var(--accent)] transition-colors"
            >›</button>
            <button
              onClick={() => setPage(pageCount - 1)}
              disabled={page === pageCount - 1}
              className="px-2 py-1 rounded bg-[var(--surface2)] border border-[var(--border-5)] disabled:opacity-30 hover:border-[var(--accent)] transition-colors"
            >»</button>
          </div>
        </div>
      )}

      <DominanceMatrix molecules={molecules} />
    </div>
  );
}

export default React.memo(TableView);

function DominanceMatrix({ molecules }: { molecules: Molecule[] }) {
  const n = molecules.length;
  // For large datasets, skip the matrix -- summary table below handles it
  const showMatrix = n <= 30;
  const cellSize = n <= 8 ? 44 : n <= 15 ? 36 : 30;
  const fontSize = n <= 8 ? 11 : n <= 15 ? 10 : 9;
  const labelWidth = n <= 8 ? 100 : n <= 15 ? 80 : 65;

  return (
    <div className="bg-[var(--surface)] border border-[var(--border-5)] rounded-lg p-5">
      {showMatrix && (
        <>
          <div className="mb-4">
            <h3 className="text-[14px] font-medium text-[var(--text-heading)]">Dominance Matrix</h3>
            <p className="text-[12px] text-[var(--text2)]">Row dominates column? (on MW, LogP, HBD, HBA, TPSA, RotBonds)</p>
          </div>

          <div className="overflow-auto" style={{ maxHeight: 500 }}>
            <table className="border-collapse" style={{ borderSpacing: 0 }}>
              <thead>
                <tr>
                  <th style={{ width: labelWidth, minWidth: labelWidth }} />
                  {molecules.map((m, j) => (
                    <th
                      key={j}
                      className="text-[var(--text2)] font-normal truncate"
                      style={{
                        width: cellSize, minWidth: cellSize, maxWidth: cellSize,
                        fontSize: fontSize - 1, padding: '2px 1px 4px',
                        textAlign: 'center', verticalAlign: 'bottom',
                      }}
                      title={m.name}
                    >
                      <div className="truncate" style={{ maxWidth: cellSize }}>{m.name.replace(/_/g, ' ')}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {molecules.map((rowMol, i) => (
                  <tr key={i}>
                    <td
                      className="text-[var(--text2)] truncate text-right pr-2"
                      style={{ fontSize, width: labelWidth, maxWidth: labelWidth }}
                      title={rowMol.name}
                    >
                      {rowMol.name.replace(/_/g, ' ')}
                    </td>
                    {molecules.map((_colMol, j) => {
                      const isDiag = i === j;
                      const dominates = rowMol.dominates?.includes(j);
                      const dominated = rowMol.dominatedBy?.includes(j);
                      return (
                        <td
                          key={j}
                          className="text-center font-mono select-none"
                          style={{
                            width: cellSize, height: cellSize,
                            minWidth: cellSize, maxWidth: cellSize,
                            fontSize,
                            backgroundColor: isDiag ? 'var(--surface2)' : dominates ? 'rgba(34,197,94,0.15)' : dominated ? 'rgba(239,68,68,0.15)' : 'var(--surface)',
                            color: dominates ? '#22c55e' : dominated ? '#ef4444' : 'var(--text2)',
                            fontWeight: dominates ? 700 : 400,
                            opacity: isDiag ? 0.5 : (!dominates && !dominated) ? 0.3 : 1,
                            padding: 0,
                          }}
                          title={isDiag ? rowMol.name : dominates ? `${rowMol.name} dominates ${molecules[j].name}` : dominated ? `${rowMol.name} dominated by ${molecules[j].name}` : ''}
                        >
                          {isDiag ? '-' : dominates ? 'DOM' : dominated ? 'dom' : '~'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className={showMatrix ? 'mt-6 border-t border-[var(--border-5)] pt-4' : ''}>
        <h4 className="text-[13px] font-medium text-[var(--text-heading)] mb-3">Dominance Summary</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[12px]">
          {molecules.map(m => (
            <div key={'s_'+m.smiles} className="flex justify-between items-center p-2 bg-[var(--bg)] rounded border border-[var(--border-5)]">
              <span className="text-[var(--text-heading)] font-medium truncate" style={{ maxWidth: 150 }}>{m.name}</span>
              <span className="text-[var(--text2)] flex-1 text-center">
                dominates {m.dominates?.length || 0}, dominated by {m.dominatedBy?.length || 0}
              </span>
              <span className={`shrink-0 text-right font-medium ${m.paretoRank === 1 ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
                {m.paretoRank === 1 ? 'pareto-optimal' : 'dominated'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
