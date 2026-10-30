// Minimal MCP server over stdio (newline-delimited JSON-RPC 2.0), no SDK
// dependency. Implements initialize, ping, tools/list and tools/call.
import { createInterface } from 'node:readline';
import { CORE_VERSION } from '@paretomol/core';
import { TOOLS } from './tools.js';

export { TOOLS } from './tools.js';
export const PROTOCOL_VERSION = '2025-06-18';

interface Req { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: Record<string, unknown> }

/** Handle one JSON-RPC message. Returns the response, or null for notifications. */
export async function handle(msg: Req): Promise<Record<string, unknown> | null> {
  const isNote = msg.id === undefined;
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id, result });
  const err = (code: number, message: string) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } });
  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params?.protocolVersion;
      return ok({
        protocolVersion: typeof asked === 'string' ? asked : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'paretomol', version: CORE_VERSION },
        instructions: 'ParetoMol: deterministic RDKit descriptors, Pareto ranking, scoring profiles and claim checks. Prefer these tools over estimating chemistry numbers, and hand final picks to a human with open_review_url.',
      });
    }
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'tools/call': {
      const name = msg.params?.name;
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return err(-32602, `Unknown tool: ${String(name)}`);
      try {
        const out = await tool.run((msg.params?.arguments ?? {}) as Record<string, unknown>);
        return ok({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: out, isError: false });
      } catch (e) {
        return ok({ content: [{ type: 'text', text: (e as Error).message }], isError: true });
      }
    }
    default:
      return isNote ? null : err(-32601, `Method not found: ${msg.method}`);
  }
}

export function serveStdio(input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): void {
  const rl = createInterface({ input });
  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let msg: Req;
    try { msg = JSON.parse(line) as Req; } catch {
      output.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n');
      return;
    }
    const res = await handle(msg);
    if (res) output.write(JSON.stringify(res) + '\n');
  });
}
