import { describe, it, expect } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeReview, reviewTokenFromUrl } from '@paretomol/core';
import { handle, TOOLS } from '../src/server.js';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

interface ToolCallResult<T> {
  structuredContent: T;
  isError: boolean;
  content: { text: string }[];
}
interface RpcResult<T> { result: T }
interface ScoreBody { molecules: { descriptors: Record<string, number> }[]; invalid: { index: number; smiles: string }[] }
interface FrontBody { front: string[] }
interface ProfileBody { profile: { ref: string }; molecules: { mpo: number }[] }
interface TradeoffBody { comparison: { relation: string } }
interface ReviewBody { url: string }
interface VerifyBody { ok: boolean }
interface RpcLine {
  id?: number;
  result?: {
    serverInfo?: { name?: string };
    tools?: unknown[];
    structuredContent?: { molecules?: { descriptors?: { MW?: number } }[] };
  };
}

const MOLS = [
  { smiles: 'CC(=O)Oc1ccccc1C(=O)O', name: 'aspirin', props: { pIC50: 7 } },
  { smiles: 'CN1C=NC2=C1C(=O)N(C(=O)N2C)C', name: 'caffeine', props: { pIC50: 6 } },
  { smiles: 'CCO', name: 'ethanol', props: { pIC50: 3 } },
];
const call = async <T,>(name: string, args: Record<string, unknown>): Promise<ToolCallResult<T>> => {
  const r = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) as RpcResult<ToolCallResult<T>> | null;
  if (!r) throw new Error('MCP server returned no response');
  return r.result;
};

describe('paretomol mcp', () => {
  it('lists six tools', async () => {
    const r = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) as RpcResult<{ tools: { name: string }[] }> | null;
    if (!r) throw new Error('MCP server returned no response');
    expect(r.result.tools.map((t: { name: string }) => t.name).sort()).toEqual(['apply_profile', 'explain_tradeoff', 'open_review_url', 'pareto_front', 'score_molecules', 'verify_claims']);
    expect(TOOLS).toHaveLength(6);
  });

  it('scores and ranks', async () => {
    const s = (await call<ScoreBody>('score_molecules', { molecules: [...MOLS, 'not_a_smiles'] })).structuredContent;
    expect(s.molecules[0].descriptors.MW).toBeCloseTo(180.159, 2);
    expect(s.invalid).toEqual([{ index: 3, smiles: 'not_a_smiles' }]);
    const p = (await call<FrontBody>('pareto_front', { molecules: MOLS, objectives: [{ key: 'MW', direction: 'min' }, { key: 'pIC50', direction: 'max' }] })).structuredContent;
    expect(p.front.sort()).toEqual(['aspirin', 'ethanol']);
  });

  it('applies a profile, explains, builds a review link, verifies', async () => {
    const a = (await call<ProfileBody>('apply_profile', { molecules: MOLS, profile: 'cns@1' })).structuredContent;
    expect(a.profile.ref).toBe('cns@1');
    expect(a.molecules[0].mpo).toBeGreaterThan(0);
    const e = (await call<TradeoffBody>('explain_tradeoff', { molecules: MOLS, objectives: [{ key: 'MW', direction: 'min' }, { key: 'pIC50', direction: 'max' }], compare: ['aspirin', 'caffeine'] })).structuredContent;
    expect(e.comparison.relation).toBe('aspirin dominates caffeine');
    const u = (await call<ReviewBody>('open_review_url', { molecules: MOLS, suggested: ['caffeine'] })).structuredContent;
    expect(u.url.startsWith('https://paretomol.com/#r=')).toBe(true);
    expect(decodeReview(reviewTokenFromUrl(u.url)!).suggested).toEqual(['caffeine']);
    const v = (await call<VerifyBody>('verify_claims', { claims: [{ id: 'x', smiles: 'CCO', properties: { MW: 120 } }] })).structuredContent;
    expect(v.ok).toBe(false);
    const bad = await call<ProfileBody>('apply_profile', { molecules: MOLS, profile: 'nope@9' });
    expect(bad.isError).toBe(true);
  });

  it('speaks JSON-RPC over stdio', async () => {
    const pkg = join(here, '..');
    execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', join(pkg, 'tsconfig.json')], { stdio: 'inherit' });
    const child = spawn(process.execPath, [join(pkg, 'bin', 'paretomol-mcp.js')], { stdio: ['pipe', 'pipe', 'inherit'] });
    const stdout = child.stdout;
    if (!stdout) throw new Error('MCP child has no stdout');
    const lines: RpcLine[] = [];
    let buf = '';
    const done = new Promise<void>((resolve) => stdout.on('data', (d: Buffer | string) => {
      buf += typeof d === 'string' ? d : d.toString('utf8'); let i;
      while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i)) as RpcLine); buf = buf.slice(i + 1); }
      if (lines.length >= 3) resolve();
    }));
    const send = (m: unknown) => child.stdin.write(JSON.stringify(m) + '\n');
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'score_molecules', arguments: { molecules: ['CCO'] } } });
    await done;
    child.kill();
    const byId = Object.fromEntries(lines.map((l) => [l.id, l]));
    expect(byId[1].result.serverInfo.name).toBe('paretomol');
    expect(byId[2].result.tools).toHaveLength(6);
    expect(byId[3].result.structuredContent.molecules[0].descriptors.MW).toBeCloseTo(46.069, 2);
  }, 60000);
});
