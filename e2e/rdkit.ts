import { test as base, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures');

/**
 * A page with the RDKit CDN request served from disk.
 *
 * The application loads RDKit from a CDN at runtime. Letting the browser reach
 * out during a test would make the suite depend on a third-party host being
 * up, on the network being open, and on the same bytes being returned each
 * time — none of which a test should rest on. Requests for the bundle are
 * intercepted and fulfilled from the fixture directory instead
 * (`node e2e/fetch-fixtures.mjs` populates it).
 */
export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {
    const js = join(FIXTURES, 'RDKit_minimal.js');
    const wasm = join(FIXTURES, 'RDKit_minimal.wasm');
    if (!existsSync(js) || !existsSync(wasm)) {
      throw new Error(
        'RDKit fixtures are missing. Run `node e2e/fetch-fixtures.mjs` first.',
      );
    }

    // Served with `path` rather than a buffered `body`: the WebAssembly module
    // is 7 MB, and pushing that through the interception layer as an in-memory
    // buffer is slow enough in Firefox to exceed the navigation timeout.
    await page.route('**/RDKit_minimal.js', route =>
      route.fulfill({ contentType: 'application/javascript', path: js }),
    );
    await page.route('**/RDKit_minimal.wasm', route =>
      route.fulfill({ contentType: 'application/wasm', path: wasm }),
    );

    // A line that is not valid SMILES is treated as a compound name and sent to
    // PubChem for resolution. That is correct behaviour, but it makes any test
    // touching an unparseable line depend on a third-party service being
    // reachable and fast. Failing the lookup immediately is both hermetic and
    // the case worth covering: the application must still load the lines it
    // could parse.
    await page.route('**pubchem.ncbi.nlm.nih.gov/**', route => route.abort('failed'));

    await use(page);
  },
});

export { expect };

/** Wait until RDKit has initialised and the app is ready to accept molecules. */
export async function waitForRDKit(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as { RDKitModule?: unknown }).RDKitModule), {
    timeout: 60_000,
  });
}

/** Type SMILES into the input, run the analysis, and wait for it to finish.
 *  Waits on the rendered result rather than a fixed delay: parsing goes through
 *  the WebAssembly build and its duration varies with the machine. */
export async function analyse(page: Page, smiles: string): Promise<void> {
  const box = page.locator('textarea').first();
  await box.waitFor({ state: 'visible' });
  await box.fill(smiles);
  await page.getByRole('button', { name: /Analyze Molecules/i }).first().click();
  await expect(page.getByText(/molecules? loaded/i).first()).toBeVisible({ timeout: 60_000 });
}

/** The property line the sidebar renders for a named molecule. */
export function moleculeCard(page: Page, name: string) {
  return page.locator('div').filter({ hasText: new RegExp(`^${name}`, 'i') }).last();
}
