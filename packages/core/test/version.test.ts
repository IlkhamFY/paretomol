import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { CORE_VERSION, getProfile, loadProfile } from '../src/index';
import { RDKIT_WASM_SHA256 } from '../src/rdkitBuild';

function pkg(rel: string): string {
  return JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')).version as string;
}

describe('one version line', () => {
  it('reads CORE_VERSION from packages/core/package.json and matches cli and mcp', () => {
    expect(CORE_VERSION).toBe(pkg('../package.json'));
    expect(pkg('../../cli/package.json')).toBe(CORE_VERSION);
    expect(pkg('../../mcp/package.json')).toBe(CORE_VERSION);
  });
});

describe('profile data files', () => {
  it('loads oral@1 from the JSON file with the same hash as getProfile', () => {
    const raw = JSON.parse(readFileSync(new URL('../src/profiles/oral@1.json', import.meta.url), 'utf8'));
    expect(loadProfile(raw).hash).toBe(getProfile('oral@1').hash);
    expect(loadProfile(raw).ref).toBe('oral@1');
  });
});

describe('vendored RDKit wasm', () => {
  it('records the sha256 of the pinned RDKit_minimal.wasm', () => {
    const wasm = readFileSync(new URL('../../../node_modules/@rdkit/rdkit/dist/RDKit_minimal.wasm', import.meta.url));
    const hex = createHash('sha256').update(wasm).digest('hex');
    expect(RDKIT_WASM_SHA256).toBe(`sha256:${hex}`);
  });
});
