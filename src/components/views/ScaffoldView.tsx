import React, { useEffect, useMemo, useState } from 'react';
import type { Molecule, MmpCut, MmpRow, SaliCliff } from '@paretomol/core';
import {
  DEFAULT_SALI_SIMILARITY,
  MMP_MAX_R_ATOMS,
  activityHeader,
  isActivityColumn,
  murckoScaffold,
  pairCuts,
  saliPairsInRange,
  singleCuts,
} from '@paretomol/core';
import { getMolSvg, initRDKitCache } from '../../utils/chem';
import { useTheme } from '../../contexts/ThemeContext';

type Section = 'scaffolds' | 'pairs' | 'cliffs';

interface Props {
  molecules: Molecule[];
  customPropNames?: string[];
  selectedMolIdx?: number | null;
  setSelectedMolIdx?: (idx: number | null) => void;
  section?: Section;
  onComparePair?: (i: number, j: number) => void;
}

interface Assigned {
  index: number;
  scaffold: string;
  generic: string;
}

interface Group {
  smiles: string;
  indices: number[];
  avgMW: number;
  avgLogP: number;
  paretoFraction: number;
}

const scaffoldCache = new Map<string, Assigned[]>();
const cutCache = new Map<string, MmpCut[]>();

function seriesKey(molecules: Molecule[]): string {
  let key = String(molecules.length);
  for (const m of molecules) key += '\n' + m.smiles;
  return key;
}

function activityChoices(names: string[], molecules: Molecule[]): string[] {
  const found = new Set(names);
  for (const m of molecules) {
    for (const k of Object.keys(m.customProps ?? {})) found.add(k);
  }
  const keys = [...found].filter((k) => isActivityColumn(k));
  const pScaled = keys.filter((k) => activityHeader(k)?.alreadyP);
  return (pScaled.length ? pScaled : keys).sort();
}

function scalableSvg(svg: string): string {
  const w = svg.match(/width=['"](\d+)/)?.[1] ?? '200';
  const h = svg.match(/height=['"](\d+)/)?.[1] ?? '150';
  return svg
    .replace(/width=['"][^'"]*['"]/, "width='100%'")
    .replace(/height=['"][^'"]*['"]/, "height='100%'")
    .replace(/<svg /, `<svg viewBox='0 0 ${w} ${h}' `);
}

function Structure({ smiles }: { smiles: string }) {
  if (!smiles) {
    return <div className="text-[12px] text-[var(--text2)]">No ring</div>;
  }
  const svg = getMolSvg(smiles);
  if (!svg) return <div className="text-[11px] font-mono text-[var(--text2)] break-all">{smiles}</div>;
  return <span className="block w-full h-full" dangerouslySetInnerHTML={{ __html: scalableSvg(svg) }} />;
}

function fmt(n: number): string {
  const abs = Math.abs(n);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  const text = n.toFixed(digits);
  return n > 0 ? `+${text}` : text;
}

function Toggle({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={pressed ? 'text-[var(--text)] font-medium' : 'text-[var(--text2)] hover:text-[var(--text)]'}
    >
      {children}
    </button>
  );
}

function ScaffoldView({
  molecules,
  customPropNames = [],
  selectedMolIdx,
  setSelectedMolIdx,
  section: initialSection = 'scaffolds',
  onComparePair,
}: Props) {
  useTheme();
  const [section, setSection] = useState<Section>(initialSection);
  const [generic, setGeneric] = useState(false);
  const [assigned, setAssigned] = useState<Assigned[] | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [cutState, setCutState] = useState<{ key: string; cuts: MmpCut[] } | null>(null);
  const [cutProgress, setCutProgress] = useState(0);
  const [threshold, setThreshold] = useState(DEFAULT_SALI_SIMILARITY);
  const [cliffState, setCliffState] = useState<{ molecules: Molecule[]; activity: string; threshold: number; rows: SaliCliff[] } | null>(null);
  const [cliffProgress, setCliffProgress] = useState(0);

  const activities = useMemo(() => activityChoices(customPropNames, molecules), [customPropNames, molecules]);
  const [activityChoice, setActivityChoice] = useState<string | null>(null);
  const activity = activityChoice && activities.includes(activityChoice) ? activityChoice : (activities[0] ?? null);

  useEffect(() => {
    if (molecules.length === 0) return;
    const key = seriesKey(molecules);
    const cached = scaffoldCache.get(key);
    let cancelled = false;
    const start = setTimeout(() => {
      if (cancelled) return;
      if (cached) {
        setAssigned(cached);
        setProgress(molecules.length);
        setError(null);
        return;
      }
      setAssigned(null);
      setProgress(0);
      setError(null);
      void (async () => {
        try {
          const RDKit = await initRDKitCache();
          const out: Assigned[] = [];
          const chunk = 8;
          for (let i = 0; i < molecules.length; i += chunk) {
            if (cancelled) return;
            const end = Math.min(i + chunk, molecules.length);
            for (let k = i; k < end; k++) {
              const got = murckoScaffold(RDKit, molecules[k].smiles);
              out.push({ index: k, scaffold: got.scaffold, generic: got.generic });
            }
            setProgress(end);
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
          if (cancelled) return;
          scaffoldCache.set(key, out);
          setAssigned(out);
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : 'Scaffold grouping failed');
        }
      })();
    }, 0);
    return () => { cancelled = true; clearTimeout(start); };
  }, [molecules]);

  useEffect(() => {
    if (section !== 'pairs' || molecules.length === 0) return;
    const key = seriesKey(molecules);
    const cached = cutCache.get(key);
    let cancelled = false;
    const start = setTimeout(() => {
      if (cancelled) return;
      if (cached) { setCutState({ key, cuts: cached }); setCutProgress(molecules.length); return; }
      setCutState(null);
      setCutProgress(0);
      void (async () => {
        try {
          const RDKit = await initRDKitCache();
          const out: MmpCut[] = [];
          const chunk = 4;
          for (let i = 0; i < molecules.length; i += chunk) {
            if (cancelled) return;
            const end = Math.min(i + chunk, molecules.length);
            for (let k = i; k < end; k++) out.push(...singleCuts(RDKit, molecules[k].smiles, k));
            setCutProgress(end);
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
          if (cancelled) return;
          cutCache.set(key, out);
          setCutState({ key, cuts: out });
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : 'Pair search failed');
        }
      })();
    }, 0);
    return () => { cancelled = true; clearTimeout(start); };
  }, [section, molecules]);

  const scaffoldRows = assigned && assigned.length === molecules.length ? assigned : null;

  const groups = useMemo<Group[]>(() => {
    if (!scaffoldRows) return [];
    const map = new Map<string, number[]>();
    for (const row of scaffoldRows) {
      const smiles = generic ? row.generic : row.scaffold;
      const list = map.get(smiles);
      if (list) list.push(row.index);
      else map.set(smiles, [row.index]);
    }
    const infos: Group[] = [];
    for (const [smiles, indices] of map) {
      const mols = indices.map((i) => molecules[i]);
      infos.push({
        smiles,
        indices,
        avgMW: mols.reduce((s, m) => s + m.props.MW, 0) / mols.length,
        avgLogP: mols.reduce((s, m) => s + m.props.LogP, 0) / mols.length,
        paretoFraction: mols.filter((m) => m.paretoRank === 1).length / mols.length,
      });
    }
    infos.sort((a, b) => b.indices.length - a.indices.length || (a.smiles || ' ').localeCompare(b.smiles || ' '));
    return infos;
  }, [scaffoldRows, generic, molecules]);

  const selectedSmiles = groups.some((g) => g.smiles === selected) ? selected : (groups[0]?.smiles ?? null);
  const active = groups.find((g) => g.smiles === selectedSmiles) ?? null;

  const pairKeys = useMemo(() => {
    const keys = ['MW', 'LogP', 'TPSA'];
    for (const k of activities) if (!keys.includes(k)) keys.push(k);
    return keys;
  }, [activities]);

  const liveCuts = cutState && cutState.key === seriesKey(molecules) ? cutState.cuts : null;
  const pairs = useMemo(() => {
    if (!liveCuts) return null;
    return pairCuts(liveCuts, molecules, pairKeys);
  }, [liveCuts, molecules, pairKeys]);

  useEffect(() => {
    if (section !== 'cliffs' || !activity) return;
    let cancelled = false;
    const acc: SaliCliff[] = [];
    const chunk = 30;
    const step = (start: number) => {
      if (cancelled) return;
      const end = Math.min(start + chunk, molecules.length);
      acc.push(...saliPairsInRange(molecules, activity, threshold, start, end));
      setCliffProgress(end);
      if (end < molecules.length) {
        setTimeout(() => step(end), 0);
        return;
      }
      acc.sort((a, b) => b.sali - a.sali);
      setCliffState({ molecules, activity, threshold, rows: acc.slice(0, 50) });
    };
    const handle = setTimeout(() => {
      if (cancelled) return;
      setCliffState(null);
      setCliffProgress(0);
      step(0);
    }, 0);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [section, molecules, activity, threshold]);

  const cliffs = cliffState && cliffState.molecules === molecules && cliffState.activity === activity && cliffState.threshold === threshold
    ? cliffState.rows
    : null;
  const deltaKeys = (row: MmpRow) => row.deltas.filter((d) => d.key === 'MW' || d.key === 'LogP' || isActivityColumn(d.key));

  return (
    <div className="bg-[var(--surface)] border border-[var(--border-5)] rounded-lg p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1" role="group" aria-label="Series">
        <Toggle pressed={section === 'scaffolds'} onClick={() => setSection('scaffolds')}>Scaffolds</Toggle>
        <Toggle pressed={section === 'pairs'} onClick={() => setSection('pairs')}>Pairs</Toggle>
        <Toggle pressed={section === 'cliffs'} onClick={() => setSection('cliffs')}>Cliffs</Toggle>
      </div>

      {error && <p className="mt-3 text-[13px] text-[var(--red)]">{error}</p>}

      {section === 'scaffolds' && (
        <div className="mt-4">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <p className="text-[13px] text-[var(--text)]">
              {scaffoldRows
                ? `${groups.length} Murcko scaffold${groups.length === 1 ? '' : 's'} from ${molecules.length} molecule${molecules.length === 1 ? '' : 's'}.`
                : `Grouping scaffolds. ${progress} of ${molecules.length}.`}
            </p>
            <Toggle pressed={generic} onClick={() => setGeneric((v) => !v)}>Generic</Toggle>
          </div>
          <p className="mt-1 text-[12px] text-[var(--text2)] leading-relaxed max-w-2xl">
            {generic
              ? 'Generic scaffolds turn every atom into carbon and every bond into a single bond. Acyclic molecules stay in the no-ring group.'
              : 'Bemis-Murcko scaffolds keep the rings, the atoms that link them, and exocyclic double bonds. Side chains are removed. Acyclic molecules stay in the no-ring group.'}
          </p>
          {scaffoldRows && groups.length > 0 && (
            <div className="mt-4 grid gap-4 md:grid-cols-[240px_1fr]">
              <div className="flex flex-col gap-1 max-h-[560px] overflow-y-auto" role="listbox" aria-label="Scaffolds">
                {groups.map((g) => (
                  <button
                    key={g.smiles || 'none'}
                    type="button"
                    aria-pressed={g.smiles === selectedSmiles}
                    onClick={() => setSelected(g.smiles)}
                    className={`text-left px-2 py-1.5 rounded-md border ${g.smiles === selectedSmiles ? 'border-[var(--text)] text-[var(--text)]' : 'border-transparent text-[var(--text2)] hover:text-[var(--text)]'}`}
                  >
                    <span className="block text-[13px]">{g.smiles ? `${g.indices.length} molecules` : `No ring, ${g.indices.length}`}</span>
                    <span className="block text-[11px] font-mono truncate">{g.smiles || 'acyclic'}</span>
                  </button>
                ))}
              </div>
              {active && (
                <div>
                  <div className="h-36 max-w-xs border border-[var(--border-5)] rounded-md bg-[var(--bg)] flex items-center justify-center p-2">
                    <Structure smiles={active.smiles} />
                  </div>
                  <p className="mt-2 text-[12px] text-[var(--text2)]">
                    MW {active.avgMW.toFixed(0)} · LogP {active.avgLogP.toFixed(1)}
                    {active.paretoFraction > 0 ? ` · ${Math.round(active.paretoFraction * active.indices.length)} on the front` : ''}
                  </p>
                  {active.smiles && <p className="mt-1 text-[12px] font-mono text-[var(--text)] break-all">{active.smiles}</p>}
                  <ul className="mt-3 flex flex-col gap-1">
                    {active.indices.map((idx) => (
                      <li key={idx}>
                        <button
                          type="button"
                          onClick={() => setSelectedMolIdx?.(idx)}
                          className={idx === selectedMolIdx ? 'text-[13px] text-[var(--text)] font-medium' : 'text-[13px] text-[var(--text2)] hover:text-[var(--text)]'}
                        >
                          {molecules[idx].name}
                          {molecules[idx].paretoRank === 1 ? ' · front' : ''}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {section === 'pairs' && (
        <div className="mt-4">
          <p className="text-[13px] text-[var(--text)]">
            {pairs
              ? `${pairs.rows.length} matched pair${pairs.rows.length === 1 ? '' : 's'}.`
              : `Cutting pairs. ${cutProgress} of ${molecules.length}.`}
          </p>
          <p className="mt-1 text-[12px] text-[var(--text2)] leading-relaxed max-w-2xl">
            A pair is two molecules that share one side of a single bond cut. The variable part is at most {MMP_MAX_R_ATOMS} heavy atoms. Changes are the second molecule minus the first.
            {pairs?.trimmed ? ' A large series was limited to the strongest changes.' : ''}
          </p>
          {pairs && pairs.rows.length === 0 && (
            <p className="mt-4 text-[13px] text-[var(--text2)]">No single-cut pairs in this set.</p>
          )}
          {pairs && pairs.rows.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-[12px] border-collapse">
                <thead>
                  <tr className="text-[var(--text2)] border-b border-[var(--border-5)]">
                    <th className="py-1.5 pr-3 font-medium">Pair</th>
                    <th className="py-1.5 pr-3 font-medium">Change</th>
                    <th className="py-1.5 pr-3 font-medium">ΔMW</th>
                    <th className="py-1.5 pr-3 font-medium">ΔLogP</th>
                    {activities.map((k) => <th key={k} className="py-1.5 pr-3 font-medium">Δ{k}</th>)}
                    <th className="py-1.5 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {pairs.rows.map((row) => {
                    const byKey = new Map(deltaKeys(row).map((d) => [d.key, d.delta]));
                    return (
                      <tr key={`${row.i}-${row.j}`} className="border-b border-[var(--border-5)] align-top">
                        <td className="py-1.5 pr-3 text-[var(--text)]">
                          <button type="button" className="hover:underline" onClick={() => setSelectedMolIdx?.(row.i)}>{molecules[row.i].name}</button>
                          <span className="text-[var(--text2)]"> / </span>
                          <button type="button" className="hover:underline" onClick={() => setSelectedMolIdx?.(row.j)}>{molecules[row.j].name}</button>
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-[11px] text-[var(--text)]">
                          <div>{row.fromGroup} to {row.toGroup}</div>
                          <div className="text-[var(--text2)] truncate max-w-[220px]" title={row.context}>{row.context}</div>
                        </td>
                        <td className="py-1.5 pr-3 tabular-nums">{byKey.has('MW') ? fmt(byKey.get('MW')!) : ''}</td>
                        <td className="py-1.5 pr-3 tabular-nums">{byKey.has('LogP') ? fmt(byKey.get('LogP')!) : ''}</td>
                        {activities.map((k) => (
                          <td key={k} className="py-1.5 pr-3 tabular-nums">{byKey.has(k) ? fmt(byKey.get(k)!) : ''}</td>
                        ))}
                        <td className="py-1.5">
                          {onComparePair && (
                            <button type="button" className="text-[var(--text2)] hover:text-[var(--text)]" onClick={() => onComparePair(row.i, row.j)}>Compare</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {section === 'cliffs' && (
        <div className="mt-4">
          {!activity && (
            <p className="text-[13px] text-[var(--text)] max-w-xl">
              No activity column yet. Import an IC50, Ki, or pIC50 column and cliffs will use that column only.
            </p>
          )}
          {activity && (
            <>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1" role="group" aria-label="Activity column">
                {activities.map((k) => (
                  <Toggle key={k} pressed={k === activity} onClick={() => setActivityChoice(k)}>{k}</Toggle>
                ))}
              </div>
              <label className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-[var(--text2)]">
                Similarity at least {threshold.toFixed(2)}
                <input
                  type="range"
                  min={0.2}
                  max={0.9}
                  step={0.05}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  aria-label="Similarity threshold"
                />
              </label>
              <p className="mt-1 text-[12px] text-[var(--text2)] leading-relaxed max-w-2xl">
                SALI is the absolute change in {activity} divided by one minus the Morgan similarity.
                Pairs below {threshold.toFixed(2)} are left out, and a similarity of 1 is left out.
                {cliffs === null ? ` Scoring cliffs. ${cliffProgress} of ${molecules.length}.` : ''}
              </p>
              {cliffs && cliffs.length === 0 && (
                <p className="mt-4 text-[13px] text-[var(--text2)]">No cliffs at this threshold.</p>
              )}
              {cliffs && cliffs.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-[12px] border-collapse">
                    <thead>
                      <tr className="text-[var(--text2)] border-b border-[var(--border-5)]">
                        <th className="py-1.5 pr-3 font-medium">Pair</th>
                        <th className="py-1.5 pr-3 font-medium">Similarity</th>
                        <th className="py-1.5 pr-3 font-medium">Δ{activity}</th>
                        <th className="py-1.5 pr-3 font-medium">SALI</th>
                        <th className="py-1.5 font-medium" />
                      </tr>
                    </thead>
                    <tbody>
                      {cliffs.map((row) => (
                        <tr key={`${row.i}-${row.j}`} className="border-b border-[var(--border-5)]">
                          <td className="py-1.5 pr-3">
                            <button type="button" className="hover:underline text-[var(--text)]" onClick={() => setSelectedMolIdx?.(row.i)}>{molecules[row.i].name}</button>
                            <span className="text-[var(--text2)]"> / </span>
                            <button type="button" className="hover:underline text-[var(--text)]" onClick={() => setSelectedMolIdx?.(row.j)}>{molecules[row.j].name}</button>
                          </td>
                          <td className="py-1.5 pr-3 tabular-nums">{row.similarity.toFixed(2)}</td>
                          <td className="py-1.5 pr-3 tabular-nums">{fmt(row.activityDelta)}</td>
                          <td className="py-1.5 pr-3 tabular-nums">{row.sali.toFixed(1)}</td>
                          <td className="py-1.5">
                            {onComparePair && (
                              <button type="button" className="text-[var(--text2)] hover:text-[var(--text)]" onClick={() => onComparePair(row.i, row.j)}>Compare</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default React.memo(ScaffoldView);
