#!/usr/bin/env node
// Score an agent's answers against the ParetoMol agent benchmark.
// Usage: node benchmarks/agents/score.mjs answers.json [tasks.json]
// answers.json: { "t01": ["aspirin", ...], "t07": "caffeine", "t11": 280.4, ... }
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const norm = (s) => String(s).trim().toLowerCase();

/** Score one answer in [0, 1]. Sets use Jaccard similarity; names/strings exact (case-insensitive); numbers within tol. */
export function scoreAnswer(task, answer) {
  if (answer === undefined || answer === null) return 0;
  const truth = task.truth;
  switch (task.kind) {
    case 'set': {
      if (!Array.isArray(answer)) return 0;
      const a = new Set(answer.map(norm)), b = new Set(truth.map(norm));
      const inter = [...a].filter((x) => b.has(x)).length;
      const union = new Set([...a, ...b]).size;
      return union === 0 ? 1 : inter / union;
    }
    case 'name': case 'string': return norm(answer) === norm(truth) ? 1 : 0;
    case 'number': { const v = Number(answer); return Number.isFinite(v) && Math.abs(v - truth) <= (task.tol ?? 0) + 1e-9 ? 1 : 0; }
    default: return 0;
  }
}

export function scoreAll(tasks, answers) {
  const per = tasks.map((t) => ({ id: t.id, score: scoreAnswer(t, answers[t.id]) }));
  const total = per.reduce((s, p) => s + p.score, 0);
  return { total: Math.round(total * 1000) / 1000, max: tasks.length, pct: Math.round((1000 * total) / tasks.length) / 10, per };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [ans, tasksPath = new URL('./tasks.json', import.meta.url)] = process.argv.slice(2);
  if (!ans) { process.stderr.write('Usage: node score.mjs answers.json [tasks.json]\n'); process.exit(1); }
  const { tasks } = JSON.parse(readFileSync(tasksPath, 'utf8'));
  const r = scoreAll(tasks, JSON.parse(readFileSync(ans, 'utf8')));
  for (const p of r.per) process.stdout.write(`${p.id}\t${p.score.toFixed(2)}\n`);
  process.stdout.write(`TOTAL\t${r.total}/${r.max} (${r.pct}%)\n`);
}
