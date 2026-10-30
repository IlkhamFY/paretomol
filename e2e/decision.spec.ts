import { test, expect, waitForRDKit, analyse } from './rdkit';
import type { Page } from '@playwright/test';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDecisionRecord, stringifyDecisionRecord, recordHash } from '../packages/core/src/index';
import type { DecisionRecord } from '../packages/core/src/index';

/**
 * Decision record v0 round trip: export, re-open in a fresh page, and get the
 * exact same view and the exact same record back (timestamp aside).
 */

const DRUGS = [
  'CC(=O)Oc1ccccc1C(=O)O aspirin',
  'CC(C)Cc1ccc(cc1)C(C)C(=O)O ibuprofen',
  'CN1C=NC2=C1C(=O)N(C(=O)N2C)C caffeine',
  'CN(C)C(=N)NC(=N)N metformin',
  'CC(=O)Nc1ccc(O)cc1 acetaminophen',
].join('\n');

const DIR = mkdtempSync(join(tmpdir(), 'pm-decision-'));

async function exportRecord(page: Page, rationale: string): Promise<DecisionRecord> {
  page.once('dialog', d => d.accept(rationale));
  await page.getByRole('button', { name: /^Export/ }).first().click();
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Decision record \(JSON\)/ }).click(),
  ]);
  const path = await dl.path();
  return parseDecisionRecord(readFileSync(path!, 'utf8'));
}

async function importRecord(page: Page, rec: DecisionRecord): Promise<void> {
  const file = join(DIR, `rec-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, stringifyDecisionRecord(rec));
  await page.getByTestId('decision-record-input').setInputFiles(file);
  await expect(page.getByText(/Opened decision record/).first()).toBeVisible();
  // Charts mount lazily; wait for the summary line before reading the view.
  await expect(page.getByText(/compounds are Pareto-optimal across/).first()).toBeVisible();
  await expect(page.getByText(/Show all \d+ plots/).first()).toBeVisible();
}

function strip(r: DecisionRecord) {
  const { timestamp: _t, recordHash: _h, ...rest } = r;
  return rest;
}

test('decision record round-trips to the exact same view', async ({ page }) => {
  await page.goto('/');
  await waitForRDKit(page);
  await analyse(page, DRUGS);
  const a = await exportRecord(page, 'first pass');
  expect(a.input.count).toBe(5);
  expect(a.profile.ref).toBe('oral@1');

  // Pick two and edit the rationale offline, as an agent or a colleague would.
  const { recordHash: _old, ...body } = { ...a, selected: ['caffeine', 'aspirin'].sort(), rationale: 'lowest MW pair' };
  const edited = { ...body, recordHash: recordHash(body) } as DecisionRecord;

  await importRecord(page, edited);
  const viewA = await page.locator('#root').innerText();
  const b = await exportRecord(page, 'lowest MW pair');
  expect(strip(b)).toEqual(strip(edited));

  // Fresh load in the same fixture page (RDKit routes already wired).
  await page.goto('/');
  await waitForRDKit(page);
  await importRecord(page, b);
  const viewB = await page.locator('#root').innerText();
  expect(viewB.replace(/Opened decision record[^\n]*/g, '')).toBe(viewA.replace(/Opened decision record[^\n]*/g, ''));
  const c = await exportRecord(page, 'lowest MW pair');
  expect(strip(c)).toEqual(strip(b));
});
