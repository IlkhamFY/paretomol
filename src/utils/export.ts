import type { Molecule, ParetoObjective, FormulaColumn } from './types';
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

/** Minimal CSV cell: quote only when the value contains a comma, quote, or newline.
 *  Numbers stay unquoted so the file is clean and parses with pandas out of the box. */
function csvCell(val: unknown): string {
  if (val === null || val === undefined) return '';
  const s = String(val);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Researcher-friendly "scored" CSV: each molecule's identity plus every custom column —
 *  the columns imported from the source file (kept in their original order and names) and
 *  the computed make-ability scores SA_Score / RAScore / SCScore, alongside any
 *  formula/assay columns. Pandas-ready: no leading comment line, minimal quoting, so a
 *  researcher drops in a file and gets it straight back with the scores appended. */
export function buildScoredCSV(molecules: Molecule[], propNames: string[]): string {
  const header = ['smiles', 'name', ...propNames].map(csvCell).join(',') + '\n';
  const rows = molecules.map((m) => {
    const cells = [
      csvCell(m.smiles || ''),
      csvCell(m.name || ''),
      ...propNames.map((k) => {
        const v = m.customProps?.[k];
        return v === undefined || v === null || (typeof v === 'number' && !isFinite(v)) ? '' : csvCell(v);
      }),
    ];
    return cells.join(',') + '\n';
  });
  return header + rows.join('');
}

/** Trigger download of the scored CSV. */
export function downloadScoredCSV(molecules: Molecule[], propNames: string[], filename = 'paretomol_scored.csv'): void {
  const blob = new Blob([buildScoredCSV(molecules, propNames)], { type: 'text/csv' });
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

// ─── Reproducibility manifest ────────────────────────────────────────────────
// A self-contained, re-runnable record of the analysis: the exact objectives,
// filters, and derived columns; the input molecules; tool/data versions; and a
// timestamp. Makes any ParetoMol result citable and reproducible.
export function downloadManifest(
  molecules: Molecule[],
  objectives: ParetoObjective[],
  propertyFilters: Record<string, { min: number; max: number }>,
  substructureFilter: string,
  formulaColumns: FormulaColumn[],
  filename = 'paretomol_manifest.json'
): void {
  const manifest = {
    tool: 'ParetoMol',
    url: 'https://paretomol.com',
    generatedAt: new Date().toISOString(),
    methods: {
      descriptors: 'RDKit.js 2025.03 (WebAssembly, client-side)',
      fingerprint: 'Morgan ECFP4, 2048-bit',
      admet: 'ADMET-AI v2.0.1 (Chemprop D-MPNN, Therapeutics Data Commons)',
      chembl: 'ChEMBL 34',
    },
    analysis: {
      objectives: objectives.map(o => ({ key: o.key, direction: o.direction })),
      propertyFilters,
      substructureFilter: substructureFilter || null,
      formulaColumns: formulaColumns.map(f => ({ name: f.name, expr: f.expr })),
      nMolecules: molecules.length,
      nParetoOptimal: molecules.filter(m => m.paretoRank === 1).length,
    },
    molecules: molecules.map(m => ({
      name: m.name,
      smiles: m.smiles,
      paretoRank: m.paretoRank ?? null,
      props: { ...m.props },
      customProps: { ...m.customProps },
    })),
  };
  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
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

// ─── Figure export (editable SVG) ────────────────────────────────────────────

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  // Defer cleanup: revoking the object URL synchronously after click() can cancel
  // the (async) download in some browsers.
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 0);
}

function svgIntrinsicSize(svg: SVGSVGElement): { w: number; h: number } {
  const wAttr = parseFloat(svg.getAttribute('width') || '');
  const hAttr = parseFloat(svg.getAttribute('height') || '');
  if (isFinite(wAttr) && isFinite(hAttr) && wAttr > 0 && hAttr > 0) return { w: wAttr, h: hAttr };
  const vb = svg.getAttribute('viewBox');
  if (vb) { const p = vb.split(/[ ,]+/).map(Number); if (p.length === 4 && p[2] > 0) return { w: p[2], h: p[3] }; }
  const r = svg.getBoundingClientRect();
  return { w: r.width || 200, h: r.height || 150 };
}

/**
 * Export the active view as a single editable SVG file.
 * 2D structure depictions (RDKit) are written as true vector graphics; Chart.js
 * canvases are embedded as raster `<image>` elements so the resulting .svg is
 * always placeable in a vector editor / manuscript. Returns false if nothing
 * exportable was found. Background matches the app's current theme.
 */
export function exportViewAsSVG(container: HTMLElement, filename = 'paretomol_figure.svg'): boolean {
  const NS = 'http://www.w3.org/2000/svg';
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#ffffff';

  // Only export figure-sized SVGs (2D depictions/heatmaps), skipping UI-chrome
  // icons (chevrons, info/download glyphs, which live inside buttons or are tiny).
  const MIN_FIG = 64; // px
  const svgEls = (Array.from(container.querySelectorAll('svg')) as SVGSVGElement[])
    .filter(s => {
      if (s.closest('button')) return false;
      const r = s.getBoundingClientRect();
      return r.width >= MIN_FIG && r.height >= MIN_FIG;
    });
  const canvases = Array.from(container.querySelectorAll('canvas'))
    .filter((c): c is HTMLCanvasElement => c instanceof HTMLCanvasElement && c.width > 0 && c.height > 0);

  // Export vector structures and chart canvases together so a tab with both
  // (or only one) always yields the actual figure rather than an icon grid.
  const cells: { content: string; w: number; h: number }[] = [];
  for (const svg of svgEls) {
    const { w, h } = svgIntrinsicSize(svg);
    const viewBox = svg.getAttribute('viewBox') || `0 0 ${w} ${h}`;
    cells.push({ content: `<svg x="0" y="0" width="${w}" height="${h}" viewBox="${viewBox}" xmlns="${NS}">${svg.innerHTML}</svg>`, w, h });
  }
  for (const c of canvases) {
    cells.push({ content: `<image x="0" y="0" width="${c.width}" height="${c.height}" href="${c.toDataURL('image/png')}" />`, w: c.width, h: c.height });
  }
  if (cells.length === 0) return false;

  const pad = 12;
  const ncols = cells.length === 1 ? 1 : 2;
  const nrows = Math.ceil(cells.length / ncols);
  const cellW = Math.max(...cells.map(c => c.w));
  const cellH = Math.max(...cells.map(c => c.h));
  const totalW = ncols * cellW + (ncols + 1) * pad;
  const totalH = nrows * cellH + (nrows + 1) * pad;

  const body = cells.map((cell, i) => {
    const x = pad + (i % ncols) * (cellW + pad);
    const y = pad + Math.floor(i / ncols) * (cellH + pad);
    return `<g transform="translate(${x},${y})">${cell.content}</g>`;
  }).join('');

  const doc = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="${NS}" xmlns:xlink="http://www.w3.org/1999/xlink" width="${totalW}" height="${totalH}" ` +
    `viewBox="0 0 ${totalW} ${totalH}"><rect width="100%" height="100%" fill="${bg}"/>${body}</svg>`;
  triggerDownload(new Blob([doc], { type: 'image/svg+xml' }), filename);
  return true;
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
