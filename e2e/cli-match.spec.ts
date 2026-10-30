import { test, expect, waitForRDKit, analyse } from './rdkit';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDecisionRecord } from '../packages/core/src/index';
import { rank } from '../packages/cli/src/rank';

/**
 * The CLI and the app must agree: same CSV in, same decision record out
 * (molecules, input hash, objectives, profile, Pareto ranks, MPO, RDKit
 * version). Only timestamp, rationale, view and recordHash may differ.
 */

const CSV = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'cli-match.csv'), 'utf8');

test('app export equals CLI output for the same CSV', async ({ page }) => {
  await page.goto('/');
  await waitForRDKit(page);
  await analyse(page, CSV);
  page.once('dialog', d => d.accept(''));
  await page.getByRole('button', { name: /^Export/ }).first().click();
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Decision record \(JSON\)/ }).click(),
  ]);
  const app = parseDecisionRecord(readFileSync((await dl.path())!, 'utf8'));
  const { record: cli } = await rank(CSV, { profile: 'oral@1' });

  expect(app.input).toEqual(cli.input);
  expect(app.objectives).toEqual(cli.objectives);
  expect(app.profile).toEqual(cli.profile);
  expect(app.models).toEqual(cli.models);
  expect(app.results).toEqual(cli.results);
  expect(app.selected).toEqual(cli.selected);
  expect(cli.results.filter(r => r.paretoRank === 1).length).toBeGreaterThan(0);
});
