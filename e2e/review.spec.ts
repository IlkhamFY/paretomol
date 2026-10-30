import { test, expect } from './rdkit';
import { readFileSync } from 'node:fs';
import { encodeReview, parseDecisionRecord, getProfile } from '../packages/core/src/index';

/**
 * Open review URL: an agent-produced link opens straight into review mode,
 * the reviewer accepts or rejects each molecule, and the verdicts export as a
 * verifiable decision record.
 */

const payload = {
  title: 'Kinase shortlist',
  source: 'e2e-agent',
  note: 'Two candidates look best; check caffeine.',
  profile: 'cns@1',
  objectives: [{ key: 'MW', direction: 'min' as const }, { key: 'pIC50', direction: 'max' as const }],
  suggested: ['aspirin', 'ibuprofen'],
  molecules: [
    { name: 'aspirin', smiles: 'CC(=O)Oc1ccccc1C(=O)O', customProps: { pIC50: 6.2 } },
    { name: 'ibuprofen', smiles: 'CC(C)Cc1ccc(cc1)C(C)C(=O)O', customProps: { pIC50: 7.1 } },
    { name: 'caffeine', smiles: 'CN1C=NC2=C1C(=O)N(C(=O)N2C)C', customProps: { pIC50: 5.0 } },
    { name: 'metformin', smiles: 'CN(C)C(=N)NC(=N)N', customProps: { pIC50: 4.4 } },
  ],
};

test('review link opens in review mode and exports the verdicts as a decision record', async ({ page }) => {
  await page.goto(`/#r=${encodeReview(payload)}`);
  const panel = page.getByTestId('review-panel');
  await expect(panel).toBeVisible({ timeout: 60_000 });
  await expect(panel).toContainText('Kinase shortlist');
  await expect(panel).toContainText('e2e-agent');
  await expect(page.getByTestId('review-note')).toContainText('check caffeine');
  await expect(page.getByTestId('review-row')).toHaveCount(4);

  await page.getByRole('button', { name: 'Accept aspirin' }).click();
  await page.getByRole('button', { name: 'Accept ibuprofen' }).click();
  await page.getByRole('button', { name: 'Reject caffeine' }).click();
  // Toggling a verdict off leaves the molecule undecided.
  await page.getByRole('button', { name: 'Accept metformin' }).click();
  await page.getByRole('button', { name: 'Accept metformin' }).click();
  await expect(page.getByTestId('review-counts')).toHaveText('2 accepted · 1 rejected · 1 undecided');

  await page.getByLabel('Review rationale').fill('Best potency at acceptable MW.');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('review-export').click()]);
  const rec = parseDecisionRecord(readFileSync((await dl.path())!, 'utf8'));

  expect(rec.selected).toEqual(['aspirin', 'ibuprofen']);
  expect(rec.rationale).toBe('Best potency at acceptable MW.');
  expect(rec.profile).toEqual({ ref: 'cns@1', hash: getProfile('cns@1').hash });
  expect(rec.objectives).toEqual(payload.objectives);
  expect(rec.review).toEqual({
    source: 'e2e-agent',
    decisions: { aspirin: 'accept', ibuprofen: 'accept', caffeine: 'reject' },
    suggested: ['aspirin', 'ibuprofen'],
  });
  expect(rec.input.molecules.map(m => m.customProps?.pIC50)).toEqual([6.2, 7.1, 5.0, 4.4]);
  expect(rec.results.every(r => typeof r.paretoRank === 'number')).toBe(true);
});

test('review link also works as ?r= and a corrupt link says so', async ({ page }) => {
  await page.goto(`/?r=${encodeReview({ molecules: payload.molecules.slice(0, 2) })}`);
  await expect(page.getByTestId('review-row')).toHaveCount(2, { timeout: 60_000 });
  await expect(page.getByTestId('review-panel')).toContainText('profile oral@1');

  await page.goto('/#r=not-a-real-payload');
  await expect(page.getByText(/Could not open review link/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('review-panel')).toHaveCount(0);
});
