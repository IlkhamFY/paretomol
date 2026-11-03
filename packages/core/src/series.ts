// Bemis-Murcko scaffolds and single-cut matched pairs.
// RDKit.js does not export MurckoDecompose. The scaffold below follows
// Chem.MurckoDecompose: keep ring atoms, keep atoms on a shortest path between
// each pair of SSSR rings, and keep an atom outside that set when it is
// double-bonded to a kept atom (exocyclic carbonyls). The molblock is rebuilt
// and handed back to RDKit for sanitization and canonical SMILES. Hydrogen
// counts are left unspecified so aromatic nitrogen picks up [nH] or [nH+].
import type { Molecule } from './types.js';
import { readMolProp } from './cliffs.js';
import { isActivityColumn } from './assayValue.js';

export interface ScaffoldToolkit {
  get_mol: (source: string) => ScaffoldMol | null;
}

interface ScaffoldMol {
  is_valid: () => boolean;
  delete: () => void;
  get_json: () => string;
  get_smiles: () => string;
}

export interface MurckoScaffold {
  /** Canonical Bemis-Murcko SMILES. Empty when the molecule has no rings. */
  scaffold: string;
  /** Same graph with every heavy atom as carbon and every bond single. */
  generic: string;
}

interface AtomRec { z: number; chg: number }
interface BondRec { a: number; b: number; bo: number }
interface Graph { atoms: AtomRec[]; bonds: BondRec[] }

const SYMBOL: Record<number, string> = {
  0: '*', 1: 'H', 5: 'B', 6: 'C', 7: 'N', 8: 'O', 9: 'F', 14: 'Si', 15: 'P',
  16: 'S', 17: 'Cl', 34: 'Se', 35: 'Br', 53: 'I',
};

/** Variable side of a single cut, in heavy atoms. Larger changes are not paired. */
export const MMP_MAX_R_ATOMS = 8;
/** Rows kept after sorting by the largest activity change, then LogP. */
export const MMP_ROW_LIMIT = 200;
/** Buckets larger than this are paired by activity window instead of every pair. */
const MMP_FULL_BUCKET = 80;

export interface MmpCut {
  mol: number;
  context: string;
  group: string;
  contextAtoms: number;
}

export interface MmpRow {
  i: number;
  j: number;
  context: string;
  fromGroup: string;
  toGroup: string;
  contextAtoms: number;
  deltas: { key: string; delta: number }[];
}

export interface MmpTable {
  rows: MmpRow[];
  /** True when a large series was windowed or the row cap dropped pairs. */
  trimmed: boolean;
}

interface Parsed {
  atoms: AtomRec[];
  bonds: BondRec[];
  rings: number[][];
}

function parseMolJson(raw: string): Parsed | null {
  let json: { molecules?: { atoms?: { z?: number; chg?: number }[]; bonds?: { bo?: number; atoms?: number[] }[]; extensions?: { name?: string; atomRings?: number[][]; aromaticAtoms?: number[] }[] }[] };
  try { json = JSON.parse(raw); } catch { return null; }
  const mol = json.molecules?.[0];
  if (!mol?.atoms) return null;
  const atoms = mol.atoms.map((a) => ({ z: a.z ?? 6, chg: a.chg ?? 0 }));
  const bonds = (mol.bonds ?? []).map((b) => ({
    a: b.atoms?.[0] ?? 0,
    b: b.atoms?.[1] ?? 0,
    bo: b.bo ?? 1,
  }));
  const ext = (mol.extensions ?? []).find((e) => e.name === 'rdkitRepresentation');
  return { atoms, bonds, rings: ext?.atomRings ?? [] };
}

function adjacency(n: number, bonds: BondRec[]): number[][] {
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const b of bonds) {
    adj[b.a].push(b.b);
    adj[b.b].push(b.a);
  }
  for (const row of adj) row.sort((x, y) => x - y);
  return adj;
}

function bondKey(a: number, b: number): string {
  return a < b ? `${a},${b}` : `${b},${a}`;
}

/** Shortest path. Neighbours are visited in index order so ties are stable. */
function shortest(adj: number[][], src: number, dst: number): number[] | null {
  if (src === dst) return [src];
  const prev = new Int32Array(adj.length).fill(-1);
  const seen = new Uint8Array(adj.length);
  const q = [src];
  seen[src] = 1;
  for (let qi = 0; qi < q.length; qi++) {
    const u = q[qi];
    for (const v of adj[u]) {
      if (seen[v]) continue;
      seen[v] = 1;
      prev[v] = u;
      if (v === dst) {
        const out: number[] = [];
        let x = dst;
        while (x !== -1) { out.push(x); x = prev[x]; }
        return out.reverse();
      }
      q.push(v);
    }
  }
  return null;
}

function keptAtoms(parsed: Parsed): Uint8Array {
  const n = parsed.atoms.length;
  const adj = adjacency(n, parsed.bonds);
  const keep = new Uint8Array(n);
  for (const ring of parsed.rings) for (const a of ring) keep[a] = 1;
  for (let i = 0; i < parsed.rings.length; i++) {
    for (let j = i + 1; j < parsed.rings.length; j++) {
      const path = shortest(adj, parsed.rings[i][0], parsed.rings[j][0]);
      if (path) for (const a of path) keep[a] = 1;
    }
  }
  const order = new Map<string, number>();
  for (const b of parsed.bonds) order.set(bondKey(b.a, b.b), b.bo);
  for (let i = 0; i < n; i++) {
    if (keep[i]) continue;
    for (const nb of adj[i]) {
      if (!keep[nb]) continue;
      if (order.get(bondKey(i, nb)) === 2) { keep[i] = 1; break; }
    }
  }
  return keep;
}

/** V2000 atom line. Hydrogen-count and valence stay 0 so RDKit infers [nH]. */
function atomLine(symbol: string): string {
  const sym = symbol.padEnd(3, ' ').slice(0, 3);
  const chars = new Array(69).fill(' ');
  const coords = '    0.0000    0.0000    0.0000';
  for (let i = 0; i < coords.length; i++) chars[i] = coords[i];
  for (let i = 0; i < 3; i++) chars[31 + i] = sym[i];
  const put = (start: number, width: number, n: number) => {
    const s = String(n).padStart(width, ' ');
    for (let i = 0; i < width; i++) chars[start + i] = s[i];
  };
  put(34, 2, 0);
  put(36, 3, 0);
  put(39, 3, 0);
  put(42, 3, 0);
  put(45, 3, 0);
  put(48, 3, 0);
  put(51, 3, 0);
  put(54, 3, 0);
  put(57, 3, 0);
  put(60, 3, 0);
  put(63, 3, 0);
  put(66, 3, 0);
  return chars.join('');
}

function graphToMolblock(g: Graph): string | null {
  if (g.atoms.length === 0) return null;
  const lines = [
    '',
    '     RDKit          2D',
    '',
    String(g.atoms.length).padStart(3) + String(g.bonds.length).padStart(3) + '  0  0  0  0  0  0  0  0999 V2000',
  ];
  for (const a of g.atoms) lines.push(atomLine(SYMBOL[a.z] ?? 'C'));
  for (const b of g.bonds) {
    lines.push(String(b.a + 1).padStart(3) + String(b.b + 1).padStart(3) + String(b.bo).padStart(3) + '  0');
  }
  const charged = g.atoms.map((a, i) => [i, a.chg] as const).filter(([, c]) => c !== 0);
  for (let i = 0; i < charged.length; i += 8) {
    const slice = charged.slice(i, i + 8);
    let line = 'M  CHG' + String(slice.length).padStart(3);
    for (const [idx, c] of slice) line += String(idx + 1).padStart(4) + String(c).padStart(4);
    lines.push(line);
  }
  lines.push('M  END', '');
  return lines.join('\n');
}

function smilesOf(rdkit: ScaffoldToolkit, g: Graph): string {
  const block = graphToMolblock(g);
  if (!block) return '';
  const mol = rdkit.get_mol(block);
  if (!mol) return '';
  try {
    if (!mol.is_valid()) return '';
    return mol.get_smiles();
  } catch {
    return '';
  } finally {
    mol.delete();
  }
}

function subgraph(parsed: Parsed, keep: Uint8Array, generic: boolean): Graph {
  const ids: number[] = [];
  for (let i = 0; i < keep.length; i++) if (keep[i]) ids.push(i);
  const map = new Map(ids.map((id, i) => [id, i]));
  const atoms = ids.map((id) => generic ? { z: 6, chg: 0 } : parsed.atoms[id]);
  const bonds: BondRec[] = [];
  for (const b of parsed.bonds) {
    const a = map.get(b.a);
    const c = map.get(b.b);
    if (a === undefined || c === undefined) continue;
    bonds.push({ a, b: c, bo: generic ? 1 : b.bo });
  }
  return { atoms, bonds };
}

/** Bemis-Murcko scaffold and its generic carbon skeleton. Empty strings for acyclic molecules. */
export function murckoScaffold(rdkit: ScaffoldToolkit, smiles: string): MurckoScaffold {
  const empty = { scaffold: '', generic: '' };
  if (!smiles) return empty;
  const mol = rdkit.get_mol(smiles);
  if (!mol) return empty;
  let parsed: Parsed | null = null;
  try {
    if (!mol.is_valid()) return empty;
    parsed = parseMolJson(mol.get_json());
  } catch {
    return empty;
  } finally {
    mol.delete();
  }
  if (!parsed) return empty;
  const keep = keptAtoms(parsed);
  return {
    scaffold: smilesOf(rdkit, subgraph(parsed, keep, false)),
    generic: smilesOf(rdkit, subgraph(parsed, keep, true)),
  };
}

function ringBonds(parsed: Parsed): Set<string> {
  const out = new Set<string>();
  const membership = parsed.rings.map((ring) => new Set(ring));
  for (const b of parsed.bonds) {
    for (const set of membership) {
      if (set.has(b.a) && set.has(b.b)) { out.add(bondKey(b.a, b.b)); break; }
    }
  }
  return out;
}

function component(adj: number[][], start: number, blocked: number): number[] {
  const seen = new Uint8Array(adj.length);
  const out: number[] = [];
  const q = [start];
  seen[start] = 1;
  for (let qi = 0; qi < q.length; qi++) {
    const u = q[qi];
    out.push(u);
    for (const v of adj[u]) {
      if (seen[v]) continue;
      if (u === start && v === blocked) continue;
      seen[v] = 1;
      q.push(v);
    }
  }
  return out;
}

function fragmentSmiles(rdkit: ScaffoldToolkit, parsed: Parsed, side: number[], attachment: number): string {
  const map = new Map(side.map((id, i) => [id, i]));
  const atoms = side.map((id) => parsed.atoms[id]);
  atoms.push({ z: 0, chg: 0 });
  const dummy = side.length;
  const bonds: BondRec[] = [];
  const sideSet = new Set(side);
  for (const b of parsed.bonds) {
    if (!sideSet.has(b.a) || !sideSet.has(b.b)) continue;
    bonds.push({ a: map.get(b.a)!, b: map.get(b.b)!, bo: b.bo });
  }
  const attach = map.get(attachment);
  if (attach === undefined) return '';
  bonds.push({ a: attach, b: dummy, bo: 1 });
  return smilesOf(rdkit, { atoms, bonds });
}

/**
 * Single-cut matched-pair fragments for one molecule.
 * Each cut breaks one acyclic single bond. The larger piece is the context
 * and the smaller piece is the variable group. The variable group is at most
 * {@link MMP_MAX_R_ATOMS} heavy atoms.
 */
export function singleCuts(rdkit: ScaffoldToolkit, smiles: string, molIndex: number): MmpCut[] {
  const mol = rdkit.get_mol(smiles);
  if (!mol) return [];
  let parsed: Parsed | null = null;
  try {
    if (!mol.is_valid()) return [];
    parsed = parseMolJson(mol.get_json());
  } catch {
    return [];
  } finally {
    mol.delete();
  }
  if (!parsed) return [];
  const adj = adjacency(parsed.atoms.length, parsed.bonds);
  const cyclic = ringBonds(parsed);
  const cuts: MmpCut[] = [];
  const seen = new Set<string>();
  for (const b of parsed.bonds) {
    if (b.bo !== 1 || cyclic.has(bondKey(b.a, b.b))) continue;
    const leftAtoms = component(adj, b.a, b.b);
    const rightAtoms = component(adj, b.b, b.a);
    const ln = leftAtoms.length;
    const rn = rightAtoms.length;
    if (ln < 1 || rn < 1) continue;
    const small = Math.min(ln, rn);
    if (small > MMP_MAX_R_ATOMS) continue;
    const leftSmi = fragmentSmiles(rdkit, parsed, leftAtoms, b.a);
    const rightSmi = fragmentSmiles(rdkit, parsed, rightAtoms, b.b);
    if (!leftSmi || !rightSmi || leftSmi === rightSmi) continue;
    let context: string;
    let group: string;
    let contextAtoms: number;
    if (ln > rn) { context = leftSmi; group = rightSmi; contextAtoms = ln; }
    else if (rn > ln) { context = rightSmi; group = leftSmi; contextAtoms = rn; }
    else if (leftSmi < rightSmi) { context = rightSmi; group = leftSmi; contextAtoms = ln; }
    else { context = leftSmi; group = rightSmi; contextAtoms = rn; }
    const key = context + '>>' + group;
    if (seen.has(key)) continue;
    seen.add(key);
    cuts.push({ mol: molIndex, context, group, contextAtoms });
  }
  return cuts;
}

function deltaRows(a: Molecule, b: Molecule, keys: readonly string[]): { key: string; delta: number }[] {
  const out: { key: string; delta: number }[] = [];
  for (const key of keys) {
    const va = readMolProp(a, key);
    const vb = readMolProp(b, key);
    if (va === undefined || vb === undefined) continue;
    out.push({ key, delta: vb - va });
  }
  return out;
}

function pairScore(deltas: { key: string; delta: number }[], activity: readonly string[]): number {
  let best = 0;
  for (const d of deltas) {
    const weight = activity.includes(d.key) ? 1000 : (d.key === 'LogP' || d.key === 'MW' ? 1 : 0);
    if (weight === 0) continue;
    const s = Math.abs(d.delta) * weight;
    if (s > best) best = s;
  }
  return best;
}

function emitPairs(
  entries: MmpCut[],
  molecules: readonly Molecule[],
  keys: readonly string[],
  activity: readonly string[],
  consider: (row: MmpRow, score: number) => void,
  windowed: boolean,
): boolean {
  const byMol = new Map<number, MmpCut>();
  for (const e of entries) if (!byMol.has(e.mol)) byMol.set(e.mol, e);
  const uniq = [...byMol.values()];
  const add = (a: MmpCut, b: MmpCut) => {
    if (a.mol === b.mol || a.group === b.group) return;
    const i = Math.min(a.mol, b.mol);
    const j = Math.max(a.mol, b.mol);
    const left = a.mol < b.mol ? a : b;
    const right = a.mol < b.mol ? b : a;
    const deltas = deltaRows(molecules[i], molecules[j], keys);
    const row: MmpRow = {
      i, j,
      context: left.context,
      fromGroup: left.group,
      toGroup: right.group,
      contextAtoms: left.contextAtoms,
      deltas,
    };
    consider(row, pairScore(deltas, activity));
  };
  if (!windowed && uniq.length <= MMP_FULL_BUCKET) {
    for (let a = 0; a < uniq.length; a++) {
      for (let b = a + 1; b < uniq.length; b++) add(uniq[a], uniq[b]);
    }
    return false;
  }
  const activityKey = activity[0];
  const value = (e: MmpCut) => activityKey ? (readMolProp(molecules[e.mol], activityKey) ?? 0) : (molecules[e.mol].props.LogP);
  uniq.sort((a, b) => value(a) - value(b));
  const span = 25;
  for (let a = 0; a < uniq.length; a++) {
    const lo = Math.max(0, a - span);
    const hi = Math.min(uniq.length - 1, a + span);
    for (let b = lo; b <= hi; b++) if (b !== a) add(uniq[a], uniq[b]);
    if (a > span) add(uniq[a], uniq[0]);
    if (a < uniq.length - 1 - span) add(uniq[a], uniq[uniq.length - 1]);
  }
  return true;
}

/**
 * Matched pairs from single-cut fragments. `keys` are the properties whose
 * change (molecule j minus molecule i) is reported. Activity columns sort first.
 */
export function pairCuts(
  cuts: readonly MmpCut[],
  molecules: readonly Molecule[],
  keys: readonly string[],
  limit = MMP_ROW_LIMIT,
): MmpTable {
  const activity = keys.filter((k) => isActivityColumn(k));
  const buckets = new Map<string, MmpCut[]>();
  for (const cut of cuts) {
    const list = buckets.get(cut.context);
    if (list) list.push(cut);
    else buckets.set(cut.context, [cut]);
  }
  const best = new Map<string, { row: MmpRow; score: number; atoms: number }>();
  let trimmed = false;
  const consider = (row: MmpRow, score: number) => {
    const id = `${row.i}:${row.j}`;
    const prev = best.get(id);
    if (prev && (prev.atoms > row.contextAtoms || (prev.atoms === row.contextAtoms && prev.score >= score))) return;
    best.set(id, { row, score, atoms: row.contextAtoms });
  };
  for (const entries of buckets.values()) {
    if (emitPairs(entries, molecules, keys, activity, consider, entries.length > MMP_FULL_BUCKET)) trimmed = true;
  }
  let rows = [...best.values()];
  if (rows.length > limit) {
    trimmed = true;
    rows.sort((a, b) => b.score - a.score || b.atoms - a.atoms);
    rows = rows.slice(0, limit);
  }
  rows.sort((a, b) => b.score - a.score || b.atoms - a.atoms || a.row.i - b.row.i);
  return { rows: rows.map((r) => r.row), trimmed };
}
