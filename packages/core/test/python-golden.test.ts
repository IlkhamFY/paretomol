import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { buildPythonGolden } from './pythonGolden.js';

const GOLDEN = join(__dirname, '../../../python/tests/fixtures/golden.json');

describe('python golden fixture', () => {
  it('matches @paretomol/core on ranks, scores and hashes', () => {
    const golden = buildPythonGolden();
    if (process.env.WRITE_GOLDEN === '1') {
      writeFileSync(GOLDEN, JSON.stringify(golden, null, 2) + '\n');
    }
    expect(existsSync(GOLDEN), 'golden.json missing; run with WRITE_GOLDEN=1').toBe(true);
    const saved = JSON.parse(readFileSync(GOLDEN, 'utf8'));
    expect(saved).toEqual(golden);
  });
});
