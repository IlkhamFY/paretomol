// Node-only RDKit.js loader. The main `@paretomol/core` entry does not import
// this file, so the browser bundle stays free of the WebAssembly package.
// CLI and MCP both load the same npm build the app loads from the CDN.
import { createRequire } from 'node:module';
import type { RDKitLike } from './analyze.js';

export interface RDKitNode extends RDKitLike {
  version(): string;
}

let rdkit: Promise<RDKitNode> | null = null;

/** Load `@rdkit/rdkit` (2025.3.4, the same build as the web app). */
export function loadRDKit(): Promise<RDKitNode> {
  if (!rdkit) {
    const require = createRequire(import.meta.url);
    const init = require('@rdkit/rdkit') as () => Promise<RDKitNode>;
    rdkit = init();
  }
  return rdkit;
}
