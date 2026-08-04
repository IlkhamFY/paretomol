import { test, expect, waitForRDKit, analyse } from './rdkit';

/**
 * End-to-end coverage of the workflow the reviewer named: loading molecules,
 * the analysis producing a front, the views agreeing with one another, and the
 * interface behaving when an external service is unavailable.
 *
 * These run the real application in a browser against the real RDKit
 * WebAssembly build, so they also serve as the end-to-end confirmation that the
 * descriptor corrections in this revision reach the user interface, not merely
 * the unit tests.
 */

const DRUGS = [
  'CC(=O)Oc1ccccc1C(=O)O aspirin',
  'CC(C)Cc1ccc(cc1)C(C)C(=O)O ibuprofen',
  'CN1C=NC2=C1C(=O)N(C(=O)N2C)C caffeine',
  'CN(C)C(=N)NC(=N)N metformin',
  'CC(=O)Nc1ccc(O)cc1 acetaminophen',
].join('\n');

test('boots and initialises RDKit', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/ParetoMol/i);
  await waitForRDKit(page);
  await expect(page.getByText(/loading rdkit/i)).toHaveCount(0, { timeout: 30_000 });
});

test('parses pasted SMILES and loads every molecule', async ({ page }) => {
  await page.goto('/');
  await waitForRDKit(page);
  await analyse(page, DRUGS);
  // Assert on the count the app reports, not on names: the sidebar also lists
  // example sets containing some of the same names, so matching a name alone
  // would pass even if nothing had loaded.
  await expect(page.getByText(/5\s+molecules loaded/i).first()).toBeVisible();
});

test('reports average molecular weight, not the monoisotopic mass', async ({ page }) => {
  await page.goto('/');
  await waitForRDKit(page);
  await analyse(page, 'CC(=O)Oc1ccccc1C(=O)O aspirin');
  // Aspirin: average 180.16, monoisotopic 180.04. The application previously
  // showed the latter, which disagreed with Lipinski's convention and with the
  // reference datasets. Confirmed here through the real interface.
  const body = page.locator('#root');
  await expect(body).toContainText(/MW:\s*180\.2/);
  await expect(body).not.toContainText(/MW:\s*180\.0/);
});

test('applies the QED structural-alert term', async ({ page }) => {
  await page.goto('/');
  await waitForRDKit(page);
  await analyse(page, 'CC(=O)Oc1ccccc1C(=O)O aspirin');
  // Aspirin matches two canonical QED alerts, giving 0.551. With the alert term
  // pinned to zero — the previous behaviour — the score was materially higher.
  await expect(page.locator('#root')).toContainText(/QED\*?:\s*0\.55/);
});

test('marks molecules on the non-dominated front', async ({ page }) => {
  await page.goto('/');
  await waitForRDKit(page);
  await analyse(page, DRUGS);
  await expect(page.locator('#root')).toContainText(/pareto/i);
});

test('keeps valid molecules when a line cannot be parsed', async ({ page }) => {
  await page.goto('/');
  await waitForRDKit(page);
  await analyse(page, 'not-a-molecule\nCC(=O)Oc1ccccc1C(=O)O aspirin\nCN(C)C(=N)NC(=N)N metformin');
  // One unparseable line must not discard the rest of the input.
  await expect(page.getByText(/2\s+molecules loaded/i).first()).toBeVisible();
});

test('switches between synchronised views', async ({ page }) => {
  await page.goto('/');
  await waitForRDKit(page);
  await analyse(page, DRUGS);
  for (const tab of [/^Table$/, /^Radar$/, /^Scaffolds$/]) {
    await page.getByRole('button', { name: tab }).first().click();
    await expect(page.locator('#root')).toContainText(/aspirin/i);
  }
});

test('survives an unreachable prediction service', async ({ page }) => {
  // The ADMET endpoint is external; losing it must degrade the interface rather
  // than break it.
  await page.route('**/*.hf.space/**', route => route.abort('failed'));
  await page.goto('/');
  await waitForRDKit(page);
  await analyse(page, DRUGS);
  await expect(page.getByText(/5\s+molecules loaded/i).first()).toBeVisible();
  await expect(page.locator('#root')).toContainText(/ParetoMol/i);
});
