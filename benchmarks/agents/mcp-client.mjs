#!/usr/bin/env node
// Scripted MCP client (no LLM). Runs every agent-benchmark task through the
// stdio server and scores the answers.
//
//   node benchmarks/agents/mcp-client.mjs
//
// Exit 0 only when the score is N/N. Prints the score line the README publishes.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreAll } from './score.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const SERVER = join(ROOT, 'packages', 'mcp', 'bin', 'paretomol-mcp.js');

function answerFrom(task, out) {
  switch (task.computes) {
    case 'front': case 'rank2': case 'unranked': case 'front_size': {
      if (task.computes === 'front_size') return out.front.length;
      const want = task.computes === 'front' ? 1 : task.computes === 'rank2' ? 2 : null;
      return out.molecules.filter((m) => m.paretoRank === want).map((m) => m.name).sort();
    }
    case 'top_mpo': return [...out.molecules].sort((x, y) => y.mpo - x.mpo)[0].name;
    case 'filter_fail': return out.molecules.filter((m) => !m.filterPass).map((m) => m.name).sort();
    case 'descriptor': {
      const m = out.molecules.find((x) => x.name === task.descriptor.name);
      return m.descriptors[task.descriptor.key];
    }
    case 'relation': {
      const rel = out.comparison.relation;
      const [a, b] = task.compare;
      return rel.startsWith(`${a} dominates`) ? a : rel.startsWith(`${b} dominates`) ? b : 'neither';
    }
    case 'tradeoff_pair': {
      const p = out.reading?.tradeoff;
      return p ? [p.a, p.b].sort() : [];
    }
    case 'flagged': return [...new Set(out.flags.map((f) => f.id))].sort();
    case 'quoted_csv': return out.front.slice().sort();
    case 'duplicate_ids': return out.ids.slice().sort();
    case 'decision_status': return out.ok ? 'pass' : 'fail';
    default: throw new Error(`no client for ${task.id} (${task.computes})`);
  }
}

function callFor(task) {
  const molecules = task.molecules;
  const objectives = task.objectives;
  switch (task.computes) {
    case 'front': case 'rank2': case 'unranked': case 'front_size':
      return ['pareto_front', { molecules, objectives }];
    case 'top_mpo': case 'filter_fail':
      return ['apply_profile', { molecules, profile: task.profile }];
    case 'descriptor':
      return ['score_molecules', { molecules }];
    case 'relation':
      return ['explain_tradeoff', { molecules, objectives, compare: task.compare }];
    case 'tradeoff_pair':
      return ['explain_tradeoff', { molecules, objectives }];
    case 'flagged':
      return ['verify_claims', { claims: task.claims }];
    case 'quoted_csv': case 'duplicate_ids':
      return ['rank_input', { text: task.text, ...(task.objectives ? { objectives: task.objectives } : {}) }];
    case 'decision_status':
      return ['verify_decision', { record: task.record }];
    default: throw new Error(`no tool for ${task.id} (${task.computes})`);
  }
}

function speak(child) {
  let buf = '';
  const waiters = new Map();
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      const w = waiters.get(msg.id);
      if (w) { waiters.delete(msg.id); w(msg); }
    }
  });
  let next = 1;
  return (method, params) => new Promise((resolve, reject) => {
    const id = next++;
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method} id ${id}`)), 120000);
    waiters.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

const { tasks } = JSON.parse(readFileSync(join(HERE, 'tasks.json'), 'utf8'));
const child = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'inherit'] });
const rpc = speak(child);
child.on('exit', (code) => {
  if (code && code !== 0) process.stderr.write(`mcp server exited ${code}\n`);
});

const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'paretomol-bench', version: '0' } });
if (!init.result?.serverInfo) throw new Error('initialize failed');
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

const answers = {};
for (const task of tasks) {
  const [name, arguments_] = callFor(task);
  const res = await rpc('tools/call', { name, arguments: arguments_ });
  const result = res.result;
  if (!result || result.isError) throw new Error(`${task.id} ${name}: ${result?.content?.[0]?.text ?? JSON.stringify(res)}`);
  answers[task.id] = answerFrom(task, result.structuredContent);
}

child.kill();
const scored = scoreAll(tasks, answers);
for (const p of scored.per) {
  if (p.score !== 1) process.stderr.write(`${p.id}\t${p.score}\n`);
}
const line = `TOTAL ${scored.total}/${scored.max} (${scored.pct}%)`;
process.stdout.write(line + '\n');
if (scored.total !== scored.max) process.exit(1);
