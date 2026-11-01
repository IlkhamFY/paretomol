// ParetoMol MCP server on the official TypeScript SDK. Protocol versions are
// negotiated by the SDK: a version this server implements is accepted, and
// anything else comes back as the latest version the server speaks.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { CORE_VERSION, listProfiles } from '@paretomol/core';
import { ToolError } from './errors.js';
import { REVIEW_UI_URI, exportReviewDecision, reviewShortlist } from './reviewTool.js';
import { limitShape, maxMoleculesField, maxSmilesLengthField, moleculesField, objectivesField } from './schemas.js';
import {
  applyProfile, explainTradeoff, listProfilesTool, openReviewUrl, paretoFront, rankInput,
  scoreMolecules, verifyClaimsTool, verifyDecisionTool,
} from './tools.js';
import { z } from 'zod';

const INSTRUCTIONS = [
  'ParetoMol computes RDKit descriptors, Pareto ranks, scoring profiles and claim checks. Use these tools instead of estimating chemistry numbers.',
  'Molecule lists are capped at 2000, the same cap as the web app, and SMILES at 10000 characters. Pass maxMolecules or maxSmilesLength to raise either cap.',
  'pareto_front returns fronts and counts. Dominance edges are omitted unless edges is true.',
  'Hand a shortlist to a person with review_shortlist (experimental MCP App) or open_review_url.',
  'A review link over the size limit is refused. Write a decision record file instead.',
  'Check a finished record with verify_decision.',
].join(' ');

export function reviewHtmlPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, '../ui/review.html'), join(here, '../../ui/review.html')];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('Review UI is missing. Run npm run build -w @paretomol/mcp.');
  return found;
}

type ToolResult = {
  content: { type: 'text'; text: string }[];
  structuredContent: Record<string, unknown>;
  isError?: boolean;
};

async function run(fn: () => Promise<unknown> | unknown, textOf?: (data: Record<string, unknown>) => string): Promise<ToolResult> {
  try {
    const data = await fn() as Record<string, unknown>;
    return {
      content: [{ type: 'text', text: textOf ? textOf(data) : JSON.stringify(data, null, 2) }],
      structuredContent: data,
    };
  } catch (e) {
    const code = e instanceof ToolError ? e.code : 'tool_error';
    const message = e instanceof Error ? e.message : String(e);
    const body = { code, message };
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify(body) }],
      structuredContent: body,
    };
  }
}

function withoutSvg(data: Record<string, unknown>): string {
  const molecules = Array.isArray(data.molecules)
    ? data.molecules.map((m) => {
      if (!m || typeof m !== 'object') return m;
      const { svg: _svg, ...rest } = m as { svg?: unknown };
      void _svg;
      return rest;
    })
    : data.molecules;
  return JSON.stringify({ ...data, molecules }, null, 2);
}

export function createServer(): McpServer {
  const server = new McpServer(
    { name: 'paretomol', version: CORE_VERSION },
    { instructions: INSTRUCTIONS },
  );

  const profiles = listProfiles().map((p) => p.ref).join(', ');

  server.registerTool('score_molecules', {
    description: 'Compute RDKit descriptors (MW, LogP, TPSA, HBD, HBA, RotBonds, FrCSP3, rings, QED, SC estimate) for molecules. Use this instead of estimating descriptors yourself.',
    inputSchema: { molecules: moleculesField, ...limitShape },
  }, async (args) => run(() => scoreMolecules(args as Record<string, unknown>)));

  server.registerTool('pareto_front', {
    description: 'Rank molecules by Pareto dominance. Returns each front and the counts per rank. Dominance edges are omitted unless edges is true.',
    inputSchema: {
      molecules: moleculesField,
      objectives: objectivesField.optional(),
      edges: z.boolean().optional().describe('Include dominatedBy and dominates. Off by default; the edge list is quadratic in the number of molecules.'),
      ...limitShape,
    },
  }, async (args) => run(() => paretoFront(args as Record<string, unknown>)));

  server.registerTool('apply_profile', {
    description: `Score molecules with a versioned scoring profile (MPO desirability, filter rules, profile objectives). Profiles: ${profiles}.`,
    inputSchema: {
      molecules: moleculesField,
      profile: z.string().optional().describe('Profile ref, default oral@1'),
      ...limitShape,
    },
  }, async (args) => run(() => applyProfile(args as Record<string, unknown>)));

  server.registerTool('explain_tradeoff', {
    description: 'Explain the trade-off structure: front size, sharpest anti-correlated objective pair, and optionally a head-to-head of two named molecules.',
    inputSchema: {
      molecules: moleculesField,
      objectives: objectivesField.optional(),
      compare: z.array(z.string()).min(2).max(2).optional().describe('Two molecule names to compare.'),
      ...limitShape,
    },
  }, async (args) => run(() => explainTradeoff(args as Record<string, unknown>)));

  server.registerTool('open_review_url', {
    description: 'Build a paretomol.com review link (#r=) so a human can Accept or Reject your picks and export a decision record. Refuses a link over the size limit instead of returning one that browsers will cut. Suggest a decision record file in that case.',
    inputSchema: {
      molecules: moleculesField,
      objectives: objectivesField.optional(),
      profile: z.string().optional(),
      title: z.string().optional(),
      note: z.string().optional(),
      source: z.string().optional(),
      suggested: z.array(z.string()).optional().describe('Molecule names to mark as suggested. Nothing is pre-accepted.'),
      ...limitShape,
    },
  }, async (args) => run(() => openReviewUrl(args as Record<string, unknown>)));

  server.registerTool('verify_claims', {
    description: 'Check descriptor values and optimisation directions claimed for molecules (yours or another agent\'s) against RDKit. Flags invalid SMILES, value mismatches and flipped directions.',
    inputSchema: {
      claims: z.array(z.object({
        id: z.string().optional(),
        smiles: z.string(),
        properties: z.record(z.string(), z.number()).optional(),
        objectives: objectivesField.optional(),
      })).min(1),
      ...limitShape,
    },
  }, async (args) => run(() => verifyClaimsTool(args as Record<string, unknown>)));

  server.registerTool('list_profiles', {
    description: `List versioned scoring profiles with their content hashes and objectives. Profiles: ${profiles}.`,
    inputSchema: z.object({}),
  }, async () => run(() => listProfilesTool()));

  server.registerTool('rank_input', {
    description: 'Parse a CSV, TSV or "SMILES name" text (quoted fields kept intact) and return Pareto ranks plus decision-record ids. A repeated name is disambiguated as name~2, name~3, in input order.',
    inputSchema: {
      text: z.string().describe('CSV, TSV or SMILES lines'),
      objectives: objectivesField.optional(),
      ...limitShape,
    },
  }, async (args) => run(() => rankInput(args as Record<string, unknown>)));

  server.registerTool('verify_decision', {
    description: 'Check a paretomol.decision/1 or /0 record: hashes, then a recomputed front and MPO. Returns a diff. ok is false when anything does not match.',
    inputSchema: z.object({
      record: z.record(z.string(), z.unknown()).optional().describe('A paretomol.decision/1 or /0 object. You can also pass the record itself.'),
      schema: z.string().optional(),
      maxMolecules: maxMoleculesField,
      maxSmilesLength: maxSmilesLengthField,
    }).passthrough(),
  }, async (args) => run(() => verifyDecisionTool(args as Record<string, unknown>)));

  registerAppTool(server, 'review_shortlist', {
    title: 'Review shortlist (experimental)',
    description: 'Experimental. Interactive review of a shortlist: structures, objectives, Pareto rank, and Accept or Reject per molecule. Export writes a paretomol.decision/1 record with a review block, the same record the web app writes. Hosts without MCP Apps get a paretomol.com review link in the tool result. A link over the size limit is reported as an error and is not returned.',
    inputSchema: {
      molecules: moleculesField,
      objectives: objectivesField.optional(),
      profile: z.string().optional(),
      title: z.string().optional(),
      note: z.string().optional(),
      source: z.string().optional(),
      suggested: z.array(z.string()).optional(),
      ...limitShape,
    },
    _meta: { ui: { resourceUri: REVIEW_UI_URI } },
  }, async (args) => run(() => reviewShortlist(args as Record<string, unknown>), withoutSvg));

  registerAppTool(server, 'export_review_decision', {
    title: 'Export review decision (experimental)',
    description: 'Experimental. Called by the review UI. Builds a paretomol.decision/1 record from Accept and Reject verdicts. selected is the accepted ids. The review block records every verdict.',
    inputSchema: {
      molecules: moleculesField,
      objectives: objectivesField.optional(),
      profile: z.string().optional(),
      source: z.string().optional(),
      suggested: z.array(z.string()).optional(),
      decisions: z.record(z.string(), z.enum(['accept', 'reject'])).optional().describe('Verdicts keyed by molecule id. Omit undecided molecules.'),
      rationale: z.string().optional(),
      timestamp: z.string().optional().describe('ISO-8601 timestamp. Omit for the current time.'),
      ...limitShape,
    },
    _meta: { ui: { resourceUri: REVIEW_UI_URI, visibility: ['app'] } },
  }, async (args) => run(
    () => exportReviewDecision(args as Record<string, unknown>),
    (data) => typeof data.json === 'string' ? data.json : JSON.stringify(data.record, null, 2),
  ));

  registerAppResource(server, 'ParetoMol review', REVIEW_UI_URI, {
    description: 'Experimental review UI for an agent shortlist.',
    _meta: { ui: { prefersBorder: true } },
  }, async () => ({
    contents: [{
      uri: REVIEW_UI_URI,
      mimeType: RESOURCE_MIME_TYPE,
      text: readFileSync(reviewHtmlPath(), 'utf8'),
    }],
  }));

  return server;
}

export async function serveStdio(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}
