import type { Molecule, ParetoObjective } from './types';
import { PROPERTIES, DRUG_FILTERS } from './types';

/** Escape a single CSV field value (wrap in quotes, double any internal quotes). */
function csvEscape(val: unknown): string {
  if (val === null || val === undefined) return '';
  const s = String(val);
  // Always quote to handle commas, newlines, quotes safely
  return '"' + s.replace(/"/g, '""') + '"';
}

/** Collect all custom property keys across all molecules (preserves first-seen order). */
function collectCustomKeys(molecules: Molecule[]): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const m of molecules) {
    for (const k of Object.keys(m.customProps ?? {})) {
      if (!seen.has(k)) { seen.add(k); keys.push(k); }
    }
  }
  return keys;
}

/** Build a human-readable Filters summary for a molecule, e.g. "Ro5:pass Veber:fail(2)". */
function buildFiltersSummary(m: Molecule): string {
  const shortNames: Record<string, string> = { lipinski: 'Ro5', veber: 'Veber', ghose: 'Ghose', leadlike: 'Lead' };
  return Object.entries(m.filters)
    .map(([fn, res]) => {
      const label = shortNames[fn] ?? fn;
      return res.pass ? `${label}:pass` : `${label}:fail(${res.violations})`;
    })
    .join(' ');
}

/** Build CSV content from molecules — includes all built-in props, custom props, ADMET predictions, filter details, and pareto rank. */
export function buildExportCSV(molecules: Molecule[]): string {
  const filterNames = Object.keys(DRUG_FILTERS);
  const customKeys = collectCustomKeys(molecules);

  // Header comment with export date
  const dateComment = `# ParetoMol export — ${new Date().toISOString()}\n`;

  // Column headers
  const columns = [
    'Name',
    'SMILES',
    // Built-in molecular properties
    ...PROPERTIES.map((p) => p.key),
    // Filter pass/fail per filter
    ...filterNames.map((fn) => (DRUG_FILTERS as Record<string, { label: string }>)[fn].label + '_Pass'),
    // Filters summary column
    'Filters_Summary',
    // Custom props (includes ADMET predictions)
    ...customKeys,
    // Pareto columns
    'Pareto_Rank',
    'Pareto_Optimal',
  ];

  const headerRow = columns.map(csvEscape).join(',') + '\n';

  const rows = molecules.map((m) => {
    const builtinVals = PROPERTIES.map((p) => {
      const val = m.props[p.key as keyof Molecule['props']];
      return typeof val === 'number' ? csvEscape(val.toFixed(4)) : csvEscape('');
    });
    const filterPassVals = filterNames.map((fn) => csvEscape(m.filters[fn]?.pass ?? false));
    const filtersSummary = csvEscape(buildFiltersSummary(m));
    const customVals = customKeys.map((k) => {
      const v = m.customProps?.[k];
      if (v === undefined || v === null) return csvEscape('');
      return typeof v === 'number'
        ? csvEscape(Number.isInteger(v) ? String(v) : v.toFixed(4))
        : csvEscape(v);
    });
    const paretoRank = csvEscape(m.paretoRank ?? '');
    const paretoOptimal = csvEscape(m.paretoRank === 1);

    const cells = [
      csvEscape(m.name || ''),
      csvEscape(m.smiles || ''),
      ...builtinVals,
      ...filterPassVals,
      filtersSummary,
      ...customVals,
      paretoRank,
      paretoOptimal,
    ];
    return cells.join(',') + '\n';
  });

  return dateComment + headerRow + rows.join('');
}

/** Trigger download of CSV file. */
export function downloadCSV(molecules: Molecule[], filename = 'paretomol_export.csv'): void {
  const csv = buildExportCSV(molecules);
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Build SDF export with properties as SD tags.
 *  Uses RDKit.js molblock if available, otherwise a stub molblock. */
export function buildExportSDF(molecules: Molecule[]): string {
  const RDKit = (window as unknown as { RDKitModule?: { get_mol: (s: string) => { is_valid: () => boolean; get_molblock: () => string; delete: () => void } | null } }).RDKitModule;
  return molecules.map(m => {
    // Try to get a proper molblock from RDKit.js
    let molblock = `${m.name}\n     RDKit          \n\n  0  0  0  0  0  0  0  0  0  0999 V2000\nM  END`;
    if (RDKit) {
      try {
        const mol = RDKit.get_mol(m.smiles);
        if (mol && mol.is_valid()) {
          molblock = mol.get_molblock().trimEnd();
          mol.delete();
        }
      } catch { /* fall through to stub */ }
    }
    const propTags = Object.entries(m.props)
      .map(([k, v]) => `> <${k}>\n${typeof v === 'number' ? v.toFixed(3) : v}\n`)
      .join('\n');
    const customTags = Object.entries(m.customProps ?? {})
      .map(([k, v]) => `> <${k}>\n${typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(3)) : v}\n`)
      .join('\n');
    const filterTags = Object.entries(m.filters)
      .map(([k, v]) => `> <Filter_${k}>\n${v.pass ? 'PASS' : 'FAIL'}\n`)
      .join('\n');
    const parts = [
      molblock,
      `> <Name>\n${m.name}`,
      `> <SMILES>\n${m.smiles}`,
      propTags.trimEnd(),
      customTags.trimEnd(),
      filterTags.trimEnd(),
      `> <Pareto_Rank>\n${m.paretoRank ?? 'N/A'}`,
      `> <Pareto_Optimal>\n${m.paretoRank === 1 ? 'YES' : 'NO'}`,
      '$$$$',
    ].filter(p => p.trim());
    return parts.join('\n') + '\n';
  }).join('');
}

/** Build SDF for Pareto-optimal molecules only (paretoRank === 1). */
export function buildExportSDFPareto(molecules: Molecule[]): string {
  return buildExportSDF(molecules.filter(m => m.paretoRank === 1));
}

/** Trigger SDF download. */
export function downloadSDF(molecules: Molecule[], filename = 'paretomol_export.sdf'): void {
  const sdf = buildExportSDF(molecules);
  const blob = new Blob([sdf], { type: 'chemical/x-mdl-sdfile' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Trigger SDF download for Pareto-optimal subset only. */
export function downloadSDFPareto(molecules: Molecule[], filename = 'pareto_optimal.sdf'): void {
  const sdf = buildExportSDFPareto(molecules);
  const blob = new Blob([sdf], { type: 'chemical/x-mdl-sdfile' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Build structured JSON export. */
export function buildExportJSON(molecules: Molecule[]): string {
  const data = molecules.map(m => ({
    name: m.name,
    smiles: m.smiles,
    properties: { ...m.props },
    filters: Object.fromEntries(
      Object.entries(m.filters).map(([k, v]) => [k, { pass: v.pass, violations: v.violations }])
    ),
    paretoRank: m.paretoRank,
    paretoOptimal: m.paretoRank === 1,
  }));
  return JSON.stringify({ molecules: data, exportedAt: new Date().toISOString(), version: '0.19.0' }, null, 2);
}

/** Trigger download of JSON file. */
export function downloadJSON(molecules: Molecule[], filename = 'paretomol_export.json'): void {
  const json = buildExportJSON(molecules);
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ─── Markdown Report ─────────────────────────────────────────────────────────

function fmtNum(v: number): string {
  if (!isFinite(v)) return '—';
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

function propStats(molecules: Molecule[], key: string): { min: number; max: number; mean: number } | null {
  const vals = molecules.map(m => {
    const v = (m.props as unknown as Record<string, number | undefined>)[key] ?? m.customProps?.[key];
    return typeof v === 'number' && isFinite(v) ? v : null;
  }).filter((v): v is number => v !== null);
  if (vals.length === 0) return null;
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  return { min: Math.min(...vals), max: Math.max(...vals), mean };
}

/** Build a Markdown analysis report. */
export function buildSummaryReport(
  molecules: Molecule[],
  paretoObjectives: ParetoObjective[],
  admetPropNames?: string[]
): string {
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const paretoMols = molecules.filter(m => m.paretoRank === 1);
  const top5 = paretoMols.slice(0, 5);

  const corePropKeys = ['MW', 'LogP', 'HBD', 'HBA', 'TPSA', 'RotBonds'];

  const lines: string[] = [
    '# ParetoMol Analysis Report',
    '',
    `**Date:** ${date}`,
    `**Generated by:** [ParetoMol](https://paretomol.com)`,
    '',
    '---',
    '',
    '## Dataset Summary',
    '',
    `| Item | Value |`,
    `|------|-------|`,
    `| Total molecules | ${molecules.length} |`,
    `| Pareto-optimal | ${paretoMols.length} (${molecules.length > 0 ? ((paretoMols.length / molecules.length) * 100).toFixed(1) : 0}%) |`,
    `| Lipinski Ro5 pass | ${molecules.filter(m => m.filters.lipinski?.pass).length} |`,
    `| Lipinski Ro5 fail | ${molecules.filter(m => !m.filters.lipinski?.pass).length} |`,
    '',
    '---',
    '',
    '## Pareto Objectives',
    '',
    '| Property | Direction |',
    '|----------|-----------|',
    ...paretoObjectives.map(o => `| ${o.key} | ${o.direction === 'min' ? '↓ minimize' : '↑ maximize'} |`),
    '',
    '---',
    '',
    '## Top 5 Pareto-Optimal Molecules',
    '',
  ];

  if (top5.length === 0) {
    lines.push('_No Pareto-optimal molecules found._', '');
  } else {
    const propHeader = corePropKeys.join(' | ');
    const propSep = corePropKeys.map(() => '---').join(' | ');
    lines.push(`| # | Name | SMILES | ${propHeader} |`);
    lines.push(`|---|------|--------|${propSep}|`);
    top5.forEach((m, i) => {
      const propVals = corePropKeys.map(k => {
        const v = (m.props as unknown as Record<string, number | undefined>)[k];
        return typeof v === 'number' ? fmtNum(v) : '—';
      }).join(' | ');
      lines.push(`| ${i + 1} | ${m.name} | \`${m.smiles}\` | ${propVals} |`);
    });
    lines.push('');
  }

  lines.push(
    '---',
    '',
    '## Property Statistics',
    '',
    '| Property | Min | Max | Mean (all) | Mean (Pareto) |',
    '|----------|-----|-----|------------|---------------|',
  );

  for (const key of corePropKeys) {
    const allS = propStats(molecules, key);
    const paretoS = propStats(paretoMols, key);
    if (!allS) continue;
    lines.push(
      `| ${key} | ${fmtNum(allS.min)} | ${fmtNum(allS.max)} | ${fmtNum(allS.mean)} | ${paretoS ? fmtNum(paretoS.mean) : '—'} |`
    );
  }
  lines.push('');

  // Drug filter summary
  lines.push(
    '---',
    '',
    '## Drug-likeness Filters',
    '',
    '| Filter | Pass | Fail |',
    '|--------|------|------|',
  );
  for (const [key, filter] of Object.entries(DRUG_FILTERS)) {
    const pass = molecules.filter(m => m.filters[key]?.pass).length;
    const fail = molecules.length - pass;
    lines.push(`| ${(filter as { label: string }).label} | ${pass} | ${fail} |`);
  }
  lines.push('');

  // ADMET section (if available)
  if (admetPropNames && admetPropNames.length > 0 && molecules.some(m => Object.keys(m.customProps).length > 0)) {
    lines.push(
      '---',
      '',
      '## ADMET Predictions (AI)',
      '',
      '| Property | Min | Max | Mean (all) | Mean (Pareto) |',
      '|----------|-----|-----|------------|---------------|',
    );
    for (const key of admetPropNames.slice(0, 15)) {
      const allS = propStats(molecules, key);
      const paretoS = propStats(paretoMols, key);
      if (!allS) continue;
      lines.push(
        `| ${key} | ${fmtNum(allS.min)} | ${fmtNum(allS.max)} | ${fmtNum(allS.mean)} | ${paretoS ? fmtNum(paretoS.mean) : '—'} |`
      );
    }
    lines.push('');
  }

  lines.push(
    '---',
    '',
    '_Report generated by ParetoMol · https://paretomol.com_',
    ''
  );

  return lines.join('\n');
}

/** Download the summary report as a .md file. */
export function downloadSummaryReport(
  molecules: Molecule[],
  paretoObjectives: ParetoObjective[],
  admetPropNames?: string[],
  filename = 'paretomol_report.md'
): void {
  const md = buildSummaryReport(molecules, paretoObjectives, admetPropNames);
  const blob = new Blob([md], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
