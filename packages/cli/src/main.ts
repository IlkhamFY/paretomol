import { readFileSync, writeFileSync } from 'node:fs';
import { stringifyDecisionRecord, verifyClaims } from '@paretomol/core';
import type { Claim } from '@paretomol/core';
import { rank, parseObjectives, loadRDKit } from './rank.js';

const USAGE = `Usage: paretomol rank <in.csv|in.smi|-> [options]
       paretomol verify <claims.json|->   (exit 2 when any claim is flagged)

Options:
  --profile <id@version>   scoring profile (default oral@1)
  --out <file>             write the decision record here (default stdout)
  --objectives <spec>      e.g. "MW:min,LogP:max,pIC50:max" (default: app defaults)
  --select <ids>           comma-separated molecule ids to mark as selected
  --rationale <text>       why these picks
  --timestamp <iso>        fixed timestamp, for reproducible files
  -h, --help               show this help
`;

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === '-h' || cmd === '--help') { process.stdout.write(USAGE); return cmd ? 0 : 1; }
  if (cmd === 'verify') return verify(rest);
  if (cmd !== 'rank') { process.stderr.write(`Unknown command: ${cmd}\n${USAGE}`); return 1; }
  const flags: Record<string, string> = {};
  const pos: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '-h' || a === '--help') { process.stdout.write(USAGE); return 0; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else { const v = rest[++i]; if (v === undefined) { process.stderr.write(`Missing value for ${a}\n`); return 1; } flags[a.slice(2)] = v; }
    } else pos.push(a);
  }
  const known = new Set(['profile', 'out', 'objectives', 'select', 'rationale', 'timestamp']);
  for (const k of Object.keys(flags)) if (!known.has(k)) { process.stderr.write(`Unknown option --${k}\n`); return 1; }
  if (pos.length !== 1) { process.stderr.write(USAGE); return 1; }
  try {
    const input = readFileSync(pos[0] === '-' ? 0 : pos[0], 'utf8');
    const t0 = performance.now();
    const { record, errors } = await rank(input, {
      profile: flags.profile,
      objectives: flags.objectives ? parseObjectives(flags.objectives) : undefined,
      select: flags.select ? flags.select.split(',').map((s) => s.trim()) : undefined,
      rationale: flags.rationale,
      timestamp: flags.timestamp,
    });
    const json = stringifyDecisionRecord(record);
    if (flags.out) writeFileSync(flags.out, json); else process.stdout.write(json);
    const front = record.results.filter((r) => r.paretoRank === 1).length;
    process.stderr.write(`${record.input.count} molecules (${errors} skipped), ${front} on the front, profile ${record.profile.ref}, ${((performance.now() - t0) / 1000).toFixed(2)} s\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`paretomol: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}

/** claims.json: an array of {id, smiles, properties, objectives} or {claims: [...]}. Prints a JSON report. */
async function verify(args: string[]): Promise<number> {
  if (args.length !== 1) { process.stderr.write(USAGE); return 1; }
  try {
    const raw = JSON.parse(readFileSync(args[0] === '-' ? 0 : args[0], 'utf8'));
    const claims = (Array.isArray(raw) ? raw : raw.claims) as Claim[];
    if (!Array.isArray(claims)) throw new Error('expected an array of claims or {"claims": [...]}');
    const rep = verifyClaims(claims, await loadRDKit());
    process.stdout.write(JSON.stringify(rep, null, 2) + '\n');
    process.stderr.write(`${claims.length} claims, ${rep.checked} checks, ${rep.flags.length} flagged\n`);
    return rep.ok ? 0 : 2;
  } catch (e) {
    process.stderr.write(`paretomol: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}
