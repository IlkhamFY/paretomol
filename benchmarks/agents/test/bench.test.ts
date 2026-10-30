import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { TASKS } from '../tasks';
import { computeTruth } from '../groundtruth';
// @ts-expect-error plain JS scorer
import { scoreAll, scoreAnswer } from '../score.mjs';

const FILE = join(__dirname, '..', 'tasks.json');

describe('agent benchmark', () => {
  it('has 20 unique tasks', () => {
    expect(TASKS).toHaveLength(20);
    expect(new Set(TASKS.map((t) => t.id)).size).toBe(20);
  });

  it('tasks.json matches ground truth computed by core (UPDATE_BENCH=1 to regenerate)', async () => {
    const truth = await computeTruth();
    const doc = { schema: 'paretomol.agentbench/0', tasks: TASKS.map((t) => ({ ...t, truth: truth[t.id], computes: t.truth })) };
    if (process.env.UPDATE_BENCH || !existsSync(FILE)) writeFileSync(FILE, JSON.stringify(doc, null, 2) + '\n');
    expect(JSON.parse(readFileSync(FILE, 'utf8'))).toEqual(JSON.parse(JSON.stringify(doc)));
    for (const t of doc.tasks) {
      if (t.kind === 'set') expect((t.truth as string[]).length, t.id).toBeGreaterThan(0);
    }
  }, 60000);

  it('scores perfect, empty and partial answers', () => {
    const { tasks } = JSON.parse(readFileSync(FILE, 'utf8'));
    const perfect = Object.fromEntries(tasks.map((t: { id: string; truth: unknown }) => [t.id, t.truth]));
    expect(scoreAll(tasks, perfect).total).toBe(20);
    expect(scoreAll(tasks, {}).total).toBe(0);
    expect(scoreAnswer({ kind: 'set', truth: ['a', 'b'] }, ['A', 'c'])).toBeCloseTo(1 / 3);
    expect(scoreAnswer({ kind: 'number', truth: 10, tol: 0.5 }, 10.4)).toBe(1);
    expect(scoreAnswer({ kind: 'number', truth: 10, tol: 0.5 }, 10.6)).toBe(0);
    expect(scoreAnswer({ kind: 'name', truth: 'Caffeine' }, 'caffeine ')).toBe(1);
  });
});
