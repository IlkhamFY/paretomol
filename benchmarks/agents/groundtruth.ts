// Computes ground truth for TASKS with @paretomol/core through the MCP tool functions.
import { paretoFront, applyProfile, scoreMolecules, explainTradeoff, verifyClaimsTool } from '@paretomol/mcp/tools';
import { TASKS, type Task } from './tasks';

export type Answer = string | number | string[];

export async function truthFor(t: Task): Promise<Answer> {
  const a = { molecules: t.molecules, objectives: t.objectives, profile: t.profile } as Record<string, unknown>;
  switch (t.truth) {
    case 'front': case 'rank2': case 'unranked': case 'front_size': {
      const r = await paretoFront(a);
      if (t.truth === 'front_size') return r.front.length;
      const want = t.truth === 'front' ? 1 : t.truth === 'rank2' ? 2 : null;
      return r.molecules.filter((m) => m.paretoRank === want).map((m) => m.name).sort();
    }
    case 'top_mpo': { const r = await applyProfile(a); return [...r.molecules].sort((x, y) => y.mpo - x.mpo)[0].name; }
    case 'filter_fail': { const r = await applyProfile(a); return r.molecules.filter((m) => !m.filterPass).map((m) => m.name).sort(); }
    case 'descriptor': {
      const r = await scoreMolecules(a);
      const m = r.molecules.find((x) => x.name === t.descriptor!.name)!;
      return m.descriptors[t.descriptor!.key];
    }
    case 'relation': {
      const r = await explainTradeoff({ ...a, compare: t.compare });
      const rel = (r.comparison as { relation: string }).relation;
      return rel.startsWith(`${t.compare![0]} dominates`) ? t.compare![0] : rel.startsWith(`${t.compare![1]} dominates`) ? t.compare![1] : 'neither';
    }
    case 'tradeoff_pair': { const r = await explainTradeoff(a); const p = r.reading?.tradeoff; return p ? [p.a, p.b].sort() : []; }
    case 'flagged': { const r = await verifyClaimsTool({ claims: t.claims }); return [...new Set(r.flags.map((f) => f.id))].sort(); }
  }
}

export async function computeTruth(): Promise<Record<string, Answer>> {
  const out: Record<string, Answer> = {};
  for (const t of TASKS) out[t.id] = await truthFor(t);
  return out;
}
