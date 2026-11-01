// Copy the pinned @rdkit/rdkit bundle next to the e2e tests.
//
// The app loads /rdkit/RDKit_minimal.js from the build (the same npm package).
// Tests intercept that request and fulfill it from this directory so a browser
// run does not depend on a third-party host.
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, 'fixtures');
const SRC = join(HERE, '..', 'node_modules', '@rdkit', 'rdkit', 'dist');
const FILES = ['RDKit_minimal.js', 'RDKit_minimal.wasm'];

await mkdir(DIR, { recursive: true });
for (const name of FILES) {
  const from = join(SRC, name);
  const target = join(DIR, name);
  const srcStat = await stat(from);
  try {
    const s = await stat(target);
    if (s.size === srcStat.size) { console.log(`have ${name} (${s.size} bytes)`); continue; }
  } catch { /* not copied yet */ }
  await copyFile(from, target);
  console.log(`copied ${name} (${srcStat.size} bytes)`);
}
