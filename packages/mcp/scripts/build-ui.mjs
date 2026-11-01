import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const built = await esbuild.build({
  absWorkingDir: root,
  entryPoints: ['ui/main.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  write: false,
  legalComments: 'none',
});

const js = built.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const template = readFileSync(join(root, 'ui/review.template.html'), 'utf8');
// A function replacement, so `$` sequences in the bundle are not expanded.
const html = template.replace('/*__APP__*/', () => js);
const out = join(root, 'ui/review.html');
writeFileSync(out, html);
const scripts = html.match(/<script/gi) ?? [];
if (scripts.length !== 1 || !html.includes('Experimental') || !html.includes('ParetoMol Review')) {
  throw new Error('Review UI bundle did not land in a single script');
}
