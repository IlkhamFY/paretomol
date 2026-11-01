import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/sdk/types.js';
import { buildDecisionRecord, computeParetoAndDominance, decodeReview, reviewTokenFromUrl } from '@paretomol/core';
import { createServer } from '../src/server';
import { exportReviewDecision } from '../src/reviewTool';
import { analyze, asMols } from '../src/tools';

const MOLS = [
  { smiles: 'CC(=O)Oc1ccccc1C(=O)O', name: 'aspirin', props: { pIC50: 7 } },
  { smiles: 'CN1C=NC2=C1C(=O)N(C(=O)N2C)C', name: 'caffeine', props: { pIC50: 6 } },
  { smiles: 'CCO', name: 'ethanol', props: { pIC50: 3 } },
];
const OBJECTIVES = [{ key: 'MW', direction: 'min' as const }, { key: 'pIC50', direction: 'max' as const }];

const pkg = join(__dirname, '..');
let client: Client;
let close: () => Promise<void>;

interface ToolContent {
  molecules: { descriptors: { MW: number }; name: string; mpo: number; svg: string; paretoRank: number; dominatedBy?: string[] }[];
  invalid: { index: number; smiles: string }[];
  front: string[];
  counts: { onFront: number };
  fronts: { rank: number; names: string[] }[];
  edges: boolean;
  profile: { ref: string };
  profiles: { ref: string }[];
  comparison: { relation: string };
  url: string;
  ok: boolean;
  code: string;
  message: string;
  experimental: boolean;
  ui: string;
  fallbackUrl: string;
  issues: { code: string }[];
}

async function call(name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args }) as {
    isError?: boolean;
    structuredContent?: Partial<ToolContent>;
    content: { type: string; text?: string }[];
  };
  return { ...result, structuredContent: (result.structuredContent ?? {}) as ToolContent };
}

beforeAll(async () => {
  execFileSync(process.execPath, [join(pkg, 'scripts/build-ui.mjs')], { stdio: 'inherit' });
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: 't', version: '0' });
  await client.connect(clientTransport);
  close = async () => { await client.close(); await server.close(); };
}, 60000);

afterAll(async () => { await close?.(); });

describe('paretomol mcp', () => {
  it('lists the tools, including the experimental review app', async () => {
    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'apply_profile', 'explain_tradeoff', 'export_review_decision', 'list_profiles',
      'open_review_url', 'pareto_front', 'rank_input', 'review_shortlist', 'score_molecules',
      'verify_claims', 'verify_decision',
    ]);
    const review = listed.tools.find((t) => t.name === 'review_shortlist');
    expect(review?._meta).toMatchObject({ ui: { resourceUri: 'ui://paretomol/review.html' } });
    expect(review?.description?.startsWith('Experimental.')).toBe(true);
    const exp = listed.tools.find((t) => t.name === 'export_review_decision');
    expect(exp?._meta).toMatchObject({ ui: { visibility: ['app'] } });
    const pareto = listed.tools.find((t) => t.name === 'pareto_front');
    expect(pareto?.inputSchema.required).toEqual(['molecules']);
    const resource = await client.readResource({ uri: 'ui://paretomol/review.html' });
    expect(resource.contents[0].mimeType).toBe('text/html;profile=mcp-app');
    expect(String((resource.contents[0] as { text?: string }).text)).toContain('Experimental');
  });

  it('scores, ranks without edges, and returns edges on request', async () => {
    const s = (await call('score_molecules', { molecules: [...MOLS, 'not_a_smiles'] })).structuredContent;
    expect(s.molecules[0].descriptors.MW).toBeCloseTo(180.159, 2);
    expect(s.invalid).toEqual([{ index: 3, smiles: 'not_a_smiles' }]);
    const p = (await call('pareto_front', { molecules: MOLS, objectives: OBJECTIVES })).structuredContent;
    expect(p.front.sort()).toEqual(['aspirin', 'ethanol']);
    expect(p.counts.onFront).toBe(2);
    expect(p.fronts.find((f) => f.rank === 1)!.names.sort()).toEqual(['aspirin', 'ethanol']);
    expect(p.edges).toBe(false);
    expect(p.molecules[0].dominatedBy).toBeUndefined();
    const e = (await call('pareto_front', { molecules: MOLS, objectives: OBJECTIVES, edges: true })).structuredContent;
    expect(e.molecules.find((m) => m.name === 'caffeine')!.dominatedBy).toContain('aspirin');
  });

  it('caps molecule count and SMILES length with stable codes', async () => {
    const many = await call('score_molecules', { molecules: Array.from({ length: 2001 }, () => 'C') });
    expect(many.isError).toBe(true);
    expect(many.structuredContent.code).toBe('too_many_molecules');
    const lowered = await call('score_molecules', { molecules: ['C', 'CC', 'CCC'], maxMolecules: 2 });
    expect(lowered.structuredContent.code).toBe('too_many_molecules');
    const raised = await call('score_molecules', { molecules: ['C', 'CC', 'CCC'], maxMolecules: 3 });
    expect(raised.isError).not.toBe(true);
    const long = await call('score_molecules', { molecules: ['C'.repeat(10001)] });
    expect(long.structuredContent.code).toBe('smiles_too_long');
    const ceiling = await call('score_molecules', { molecules: ['C'], maxMolecules: 20001 });
    expect(ceiling.structuredContent.code).toBe('limit_too_high');
  });

  it('applies a profile, explains, lists profiles, builds a review link, verifies', async () => {
    const a = (await call('apply_profile', { molecules: MOLS, profile: 'cns@1' })).structuredContent;
    expect(a.profile.ref).toBe('cns@1');
    expect(a.molecules[0].mpo).toBeGreaterThan(0);
    const listed = (await call('list_profiles', {})).structuredContent;
    expect(listed.profiles.map((p: { ref: string }) => p.ref)).toEqual(expect.arrayContaining(['oral@1', 'cns@1', 'leadlike@1', 'lipinski@1']));
    const e = (await call('explain_tradeoff', { molecules: MOLS, objectives: OBJECTIVES, compare: ['aspirin', 'caffeine'] })).structuredContent;
    expect(e.comparison.relation).toBe('aspirin dominates caffeine');
    const u = (await call('open_review_url', { molecules: MOLS, suggested: ['caffeine'] })).structuredContent;
    expect(u.url.startsWith('https://paretomol.com/#r=')).toBe(true);
    expect(decodeReview(reviewTokenFromUrl(u.url)!).suggested).toEqual(['caffeine']);
    const v = (await call('verify_claims', { claims: [{ id: 'x', smiles: 'CCO', properties: { MW: 120 } }] })).structuredContent;
    expect(v.ok).toBe(false);
    const bad = await call('apply_profile', { molecules: MOLS, profile: 'nope@9' });
    expect(bad.isError).toBe(true);
    expect(bad.structuredContent.code).toBe('unknown_profile');
  });

  it('refuses a review link over the size limit and does not return the URL', async () => {
    // Unique hex, not a repeated digest: deflate would otherwise shrink the
    // repeated form under the limit and the refusal would never fire.
    const molecules = Array.from({ length: 500 }, (_, i) => ({
      name: `m${i}`,
      smiles: ['a', 'b', 'c', 'd'].map((s) => createHash('sha256').update(`mol-${i}-${s}`).digest('hex')).join(''),
    }));
    const u = await call('open_review_url', { molecules });
    expect(u.isError).toBe(true);
    expect(u.structuredContent.code).toBe('review_url_too_long');
    expect(JSON.stringify(u.structuredContent)).not.toContain('#r=');
    expect(u.structuredContent.message).toMatch(/decision record/);
  });

  it('review_shortlist is experimental and exports the web app decision record', async () => {
    const view = (await call('review_shortlist', {
      molecules: MOLS, objectives: OBJECTIVES, profile: 'cns@1', suggested: ['caffeine'], title: 'Kinase shortlist', source: 'test-agent',
    })).structuredContent;
    expect(view.experimental).toBe(true);
    expect(view.ui).toBe('ui://paretomol/review.html');
    expect(view.fallbackUrl.startsWith('https://paretomol.com/#r=')).toBe(true);
    expect(view.molecules[0].svg).toContain('<svg');
    expect(view.molecules.find((m) => m.name === 'aspirin')!.paretoRank).toBe(1);
    const text = (await call('review_shortlist', { molecules: MOLS })).content[0].text ?? '';
    expect(text).not.toContain('<svg');

    const timestamp = '2026-01-01T00:00:00.000Z';
    const args = {
      molecules: MOLS, objectives: OBJECTIVES, profile: 'cns@1', source: 'test-agent',
      suggested: ['caffeine'], decisions: { aspirin: 'accept', caffeine: 'reject' },
      rationale: 'Best potency at acceptable MW.', timestamp,
    };
    const out = await exportReviewDecision(args);
    expect(out.record.selected).toEqual(['aspirin']);
    expect(out.record.review).toEqual({
      source: 'test-agent',
      decisions: { aspirin: 'accept', caffeine: 'reject' },
      suggested: ['caffeine'],
    });
    expect(out.record.rationale).toBe('Best potency at acceptable MW.');
    expect(out.record.profile.ref).toBe('cns@1');
    expect(out.filename).toBe('paretomol_review.json');
    const { molecules } = await analyze(asMols(MOLS));
    computeParetoAndDominance(molecules, OBJECTIVES);
    const again = buildDecisionRecord({
      molecules, objectives: OBJECTIVES, profile: 'cns@1', selected: [0],
      rationale: args.rationale, rdkitVersion: out.record.models.rdkitjs, timestamp,
      admetEndpoint: null, view: out.record.view,
      review: { source: 'test-agent', decisions: { 0: 'accept', 1: 'reject' }, suggested: [1] },
    });
    expect(out.record).toEqual(again);

    const checked = (await call('verify_decision', { record: out.record })).structuredContent;
    expect(checked.ok).toBe(true);
    const tampered = { ...out.record, rationale: 'edited' };
    const bad = (await call('verify_decision', { record: tampered })).structuredContent;
    expect(bad.ok).toBe(false);
    expect(bad.issues.some((i: { code: string }) => i.code === 'hash')).toBe(true);
  });

  it('negotiates a protocol version the server implements', async () => {
    execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', join(pkg, 'tsconfig.json')], { stdio: 'inherit' });
    const ask = (protocolVersion: string) => new Promise<{ result: { protocolVersion: string; serverInfo: { name: string } } }>((resolve, reject) => {
      const child = spawn(process.execPath, [join(pkg, 'bin', 'paretomol-mcp.js')], { stdio: ['pipe', 'pipe', 'inherit'] });
      let buf = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('stdio timeout')); }, 20000);
      child.stdout.on('data', (d) => {
        buf += d;
        const i = buf.indexOf('\n');
        if (i < 0) return;
        clearTimeout(timer);
        child.kill();
        resolve(JSON.parse(buf.slice(0, i)));
      });
      child.stdin.write(JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion, capabilities: {}, clientInfo: { name: 't', version: '0' } },
      }) + '\n');
    });
    const supported = await ask('2025-06-18');
    expect(supported.result.protocolVersion).toBe('2025-06-18');
    expect(supported.result.serverInfo.name).toBe('paretomol');
    const unknown = await ask('1999-01-01');
    expect(unknown.result.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
    expect(unknown.result.protocolVersion).not.toBe('1999-01-01');
    expect(SUPPORTED_PROTOCOL_VERSIONS).toContain(unknown.result.protocolVersion);
  }, 60000);

  it('speaks JSON-RPC over stdio', async () => {
    const child = spawn(process.execPath, [join(pkg, 'bin', 'paretomol-mcp.js')], { stdio: ['pipe', 'pipe', 'inherit'] });
    const lines: { id?: number; result?: { serverInfo?: { name: string }; protocolVersion?: string; tools?: unknown[]; structuredContent?: { molecules: { descriptors: { MW: number } }[] } } }[] = [];
    let buf = '';
    const done = new Promise<void>((resolve) => child.stdout.on('data', (d) => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); }
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
    expect(byId[1].result.protocolVersion).toBe('2025-06-18');
    expect(byId[2].result.tools.length).toBeGreaterThanOrEqual(11);
    expect(byId[3].result.structuredContent.molecules[0].descriptors.MW).toBeCloseTo(46.069, 2);
  }, 60000);
});
