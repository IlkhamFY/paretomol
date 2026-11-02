// Fetch the RDKit WebAssembly bundle used by the end-to-end tests.
//
// The application loads RDKit from a CDN at runtime. The e2e tests serve it
// from disk instead, via request interception, so a browser test never depends
// on a third-party host being reachable or on it serving the same bytes twice.
// The files are large (7 MB) and are a build input rather than source, so they
// are gitignored and fetched on demand.
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, 'fixtures');
// Must match the version pinned in index.html.
const VERSION = '2025.3.4-1.0.0';
const BASE = `https://unpkg.com/@rdkit/rdkit@${VERSION}/dist`;
const FILES = ['RDKit_minimal.js', 'RDKit_minimal.wasm'];

await mkdir(DIR, { recursive: true });
for (const name of FILES) {
  const target = join(DIR, name);
  try {
    const s = await stat(target);
    if (s.size > 0) { console.log(`have ${name} (${s.size} bytes)`); continue; }
  } catch { /* not cached yet */ }
  const res = await fetch(`${BASE}/${name}`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(target, buf);
  console.log(`fetched ${name} (${buf.length} bytes)`);
}
