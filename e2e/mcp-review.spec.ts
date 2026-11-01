import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REVIEW_UI_URI, reviewShortlist } from '../packages/mcp/src/reviewTool';
import { reviewHtmlPath } from '../packages/mcp/src/server';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Experimental MCP App: the ui:// review page, driven the way a host would,
 * through postMessage. Structures, ranks, Accept/Reject, and the export call.
 */

const MOLS = [
  { smiles: 'CC(=O)Oc1ccccc1C(=O)O', name: 'aspirin', props: { pIC50: 7 } },
  { smiles: 'CN1C=NC2=C1C(=O)N(C(=O)N2C)C', name: 'caffeine', props: { pIC50: 6 } },
  { smiles: 'CCO', name: 'ethanol', props: { pIC50: 3 } },
];

function harness(payload: unknown): string {
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  return `<!DOCTYPE html><meta charset="utf-8"><iframe id="v" src="/review.html" style="width:900px;height:1100px;border:0"></iframe>
<script>
const payload = ${json};
window.__calls = [];
const frame = document.getElementById('v');
window.addEventListener('message', (ev) => {
  if (ev.source !== frame.contentWindow) return;
  const msg = ev.data;
  if (!msg || msg.jsonrpc !== '2.0') return;
  const reply = (result) => ev.source.postMessage({ jsonrpc: '2.0', id: msg.id, result }, '*');
  if (msg.method === 'ui/initialize') {
    reply({
      protocolVersion: msg.params.protocolVersion,
      hostInfo: { name: 'test-host', version: '0' },
      hostCapabilities: { serverTools: {} },
      hostContext: { theme: 'light', displayMode: 'inline', platform: 'web' },
    });
    return;
  }
  if (msg.method === 'ui/notifications/initialized') {
    ev.source.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: {} } }, '*');
    ev.source.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: {
      content: [{ type: 'text', text: 'review' }],
      structuredContent: payload,
      isError: false,
    } }, '*');
    return;
  }
  if (msg.method === 'tools/call') {
    window.__calls.push(msg.params);
    reply({
      content: [{ type: 'text', text: '{"schema":"paretomol.decision/0"}' }],
      structuredContent: { json: '{\\n  "schema": "paretomol.decision/0"\\n}\\n', filename: 'paretomol_review.json' },
      isError: false,
    });
    return;
  }
  if (msg.id !== undefined) reply({});
});
</script>`;
}

let url = '';
let closeServer: () => Promise<void> = async () => {};

test.beforeAll(async () => {
  execFileSync(process.execPath, [join(here, '../packages/mcp/scripts/build-ui.mjs')], { stdio: 'inherit' });
  const payload = await reviewShortlist({
    molecules: MOLS,
    objectives: [{ key: 'MW', direction: 'min' }, { key: 'pIC50', direction: 'max' }],
    profile: 'cns@1',
    title: 'Kinase shortlist',
    source: 'test-agent',
    note: 'Check caffeine.',
    suggested: ['caffeine'],
  });
  expect(REVIEW_UI_URI).toBe('ui://paretomol/review.html');
  const html = readFileSync(reviewHtmlPath(), 'utf8');
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(req.url === '/review.html' ? html : harness(payload));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  url = `http://127.0.0.1:${port}/`;
  closeServer = () => new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
});

test.afterAll(async () => { await closeServer(); });

test('review app shows structures and exports verdicts', async ({ page }) => {
  await page.goto(url);
  const frame = page.frameLocator('#v');
  await expect(frame.getByText('Experimental')).toBeVisible();
  await expect(frame.getByRole('heading', { name: 'Review: Kinase shortlist' })).toBeVisible();
  await expect(frame.getByText('Check caffeine.')).toBeVisible();
  await expect(frame.getByTestId('review-row')).toHaveCount(3);
  await expect(frame.locator('[data-testid=review-row][data-name=aspirin] svg')).toHaveCount(1);
  await expect(frame.locator('[data-testid=review-row][data-name=aspirin]')).toContainText('Rank 1');
  await expect(frame.locator('[data-testid=review-row][data-name=caffeine]')).toContainText('suggested');
  await expect(frame.getByTestId('review-fallback')).toHaveAttribute('href', /^https:\/\/paretomol\.com\/#r=/);

  await frame.getByRole('button', { name: 'Accept aspirin' }).click();
  await frame.getByRole('button', { name: 'Reject caffeine' }).click();
  await frame.getByRole('button', { name: 'Accept ethanol' }).click();
  await frame.getByRole('button', { name: 'Accept ethanol' }).click();
  await expect(frame.getByTestId('review-counts')).toHaveText('1 accepted, 1 rejected, 1 undecided');

  await frame.getByLabel('Review rationale').fill('Best potency at acceptable MW.');
  await frame.getByTestId('review-export').click();
  await page.waitForFunction(() => (window as unknown as { __calls: unknown[] }).__calls.length > 0);
  const calls = await page.evaluate(() => (window as unknown as { __calls: { name: string; arguments: Record<string, unknown> }[] }).__calls);
  expect(calls[0].name).toBe('export_review_decision');
  expect(calls[0].arguments.decisions).toEqual({ aspirin: 'accept', caffeine: 'reject' });
  expect(calls[0].arguments.rationale).toBe('Best potency at acceptable MW.');
  expect(calls[0].arguments.profile).toBe('cns@1');
  await expect(frame.getByTestId('review-record')).toContainText('paretomol.decision/0');
  await expect(frame.getByRole('link', { name: 'Download decision record' })).toBeVisible();
});
