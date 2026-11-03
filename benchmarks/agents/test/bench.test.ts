import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TASKS } from '../tasks';
import { computeTruth } from '../groundtruth';
// @ts-expect-error plain JS scorer, no declaration file
import { scoreAll, scoreAnswer } from '../score.mjs';

const FILE = fileURLToPath(new URL('../tasks.json', import.meta.url));

describe('agent benchmark', () => {
  it('has 27 unique tasks', () => {
    expect(TASKS).toHaveLength(27);
    expect(new Set(TASKS.map((t) => t.id)).size).toBe(27);
    expect(TASKS.filter((t) => t.source !== 'core').map((t) => t.id)).toEqual(['t21', 't22', 't23', 't24', 't25', 't26', 't27']);
  });

  it('tasks.json matches ground truth computed by core (UPDATE_BENCH=1 to regenerate)', async () => {
    const truth = await computeTruth();
    expect(await computeTruth()).toEqual(truth);
    const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'manifest.json'), 'utf8'));
    const doc = {
      schema: 'paretomol.agentbench/1',
      data: {
        chembl_release: manifest.chembl_db_version,
        manifest: 'data/manifest.json',
        activities: 'data/activities.json',
        molecules: 'data/molecules.json',
        rdkit_python: 'data/rdkit_python.json',
        license: 'CC BY-SA 3.0',
      },
      tasks: TASKS.map((t) => {
        const { answer: _answer, truth: computes, ...rest } = t;
        return { ...rest, computes, truth: truth[t.id], source: t.source };
      }),
    };
    if (process.env.UPDATE_BENCH || !existsSync(FILE)) writeFileSync(FILE, JSON.stringify(doc, null, 2) + '\n');
    expect(JSON.parse(readFileSync(FILE, 'utf8'))).toEqual(JSON.parse(JSON.stringify(doc)));
    for (const t of doc.tasks) {
      if (t.kind === 'set') expect((t.truth as string[]).length, t.id).toBeGreaterThan(0);
    }
  }, 60000);

  it('scores perfect, empty and partial answers', () => {
    const { tasks } = JSON.parse(readFileSync(FILE, 'utf8'));
    const perfect = Object.fromEntries(tasks.map((t: { id: string; truth: unknown }) => [t.id, t.truth]));
    expect(scoreAll(tasks, perfect).total).toBe(tasks.length);
    expect(scoreAll(tasks, {}).total).toBe(0);
    expect(scoreAnswer({ kind: 'set', truth: ['a', 'b'] }, ['A', 'c'])).toBeCloseTo(1 / 3);
    expect(scoreAnswer({ kind: 'number', truth: 10, tol: 0.5 }, 10.4)).toBe(1);
    expect(scoreAnswer({ kind: 'number', truth: 10, tol: 0.5 }, 10.6)).toBe(0);
    expect(scoreAnswer({ kind: 'name', truth: 'Caffeine' }, 'caffeine ')).toBe(1);
  });

  it('reference MCP client scores every task through the stdio server', () => {
    const out = execFileSync(process.execPath, [join(__dirname, '..', 'mcp-client.mjs')], { encoding: 'utf8' });
    const line = out.trim().split('\n').pop();
    expect(line).toBe(`TOTAL ${TASKS.length}/${TASKS.length} (100%)`);
    expect(readFileSync(join(__dirname, '..', 'README.md'), 'utf8')).toContain(line!);
  }, 120000);
});
