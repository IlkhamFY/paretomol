#!/usr/bin/env node
// Fetch the small ChEMBL activity set behind the agent benchmark.
//
//   node benchmarks/agents/build/fetch-chembl.mjs --write
//   node benchmarks/agents/build/fetch-chembl.mjs --check
//   node benchmarks/agents/build/fetch-chembl.mjs --reselect
//
// --write    runs the pinned query and replaces data/manifest.json,
//            data/activities.json and data/molecules.csv.
// --check    re-fetches each pinned activity id and exits 1 if a stored
//            field moved (release, pChEMBL, SMILES, assay, target).
// --reselect re-runs the full query and exits 1 if the chosen rows differ.
//
// The live API always serves the current release. The committed files are
// the freeze. Activity ids in the manifest are the citation.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', 'data');
const CANONICAL = 'https://www.ebi.ac.uk/chembl/api/data';
const FALLBACK = 'https://wwwdev.ebi.ac.uk/chembl/api/data';
const UA = 'ParetoMol/benchmark (mailto:ilkhamfy@gmail.com)';

/** Pinned targets. assay_type B is a binding assay; F is functional. */
const TARGETS = {
  CHEMBL203: { symbol: 'EGFR', name: 'Epidermal growth factor receptor', organism: 'Homo sapiens', type: 'SINGLE PROTEIN', assay_type: 'B', wild_type_only: true },
  CHEMBL1824: { symbol: 'ERBB2', name: 'Receptor tyrosine-protein kinase erbB-2', organism: 'Homo sapiens', type: 'SINGLE PROTEIN', assay_type: 'B', wild_type_only: true },
  CHEMBL221: { symbol: 'PTGS1', name: 'Prostaglandin G/H synthase 1', organism: 'Homo sapiens', type: 'SINGLE PROTEIN', assay_type: 'B', assay_types: ['B', 'F'], wild_type_only: true },
  CHEMBL230: { symbol: 'PTGS2', name: 'Prostaglandin G/H synthase 2', organism: 'Homo sapiens', type: 'SINGLE PROTEIN', assay_type: 'B', assay_types: ['B', 'F'], wild_type_only: true },
  CHEMBL402: { symbol: 'HMGCR', name: '3-hydroxy-3-methylglutaryl-coenzyme A reductase', organism: 'Homo sapiens', type: 'SINGLE PROTEIN', assay_type: 'B', assay_types: ['B', 'F'], wild_type_only: true },
  CHEMBL1949: { symbol: 'PPIA', name: 'Peptidyl-prolyl cis-trans isomerase A', organism: 'Homo sapiens', type: 'SINGLE PROTEIN', assay_type: 'B', assay_types: ['B', 'F'], wild_type_only: true },
};

/**
 * Molecules and the targets to search, in preference order.
 * `require` lists targets that must produce a row. A listed target that is not
 * required is still searched: a hit is kept, a miss is recorded in `skipped`.
 */
const MOLECULES = [
  { id: 'CHEMBL939', require: ['CHEMBL203', 'CHEMBL1824'], sets: ['kinase', 'panel'] },
  { id: 'CHEMBL553', require: ['CHEMBL203', 'CHEMBL1824'], sets: ['kinase', 'panel'] },
  { id: 'CHEMBL554', require: ['CHEMBL203', 'CHEMBL1824'], sets: ['kinase', 'panel'] },
  { id: 'CHEMBL1173655', require: ['CHEMBL203', 'CHEMBL1824'], sets: ['kinase', 'panel'] },
  // Osimertinib has wild-type EGFR binding IC50 and no qualifying wild-type ERBB2 row under these filters.
  { id: 'CHEMBL3353410', require: ['CHEMBL203'], targets: ['CHEMBL203', 'CHEMBL1824'], sets: ['kinase', 'panel'] },
  { id: 'CHEMBL180022', require: ['CHEMBL203', 'CHEMBL1824'], sets: ['kinase', 'panel'] },
  { id: 'CHEMBL2110732', require: ['CHEMBL203', 'CHEMBL1824'], sets: ['kinase', 'panel'] },
  // Vandetanib: wild-type EGFR binding IC50, no qualifying wild-type ERBB2 row under these filters.
  { id: 'CHEMBL24828', require: ['CHEMBL203'], targets: ['CHEMBL203', 'CHEMBL1824'], sets: ['kinase', 'panel'] },
  // Imatinib is not in this set. The only wild-type EGFR/ERBB2 IC50 rows in ChEMBL_37
  // are a 2022 Kinase-Glo pair annotated "unknown origin" (0.11 nM and 0.06 nM),
  // which does not match the well-known micromolar EGFR activity of imatinib.
  { id: 'CHEMBL25', require: ['CHEMBL221'], sets: ['panel'] },
  { id: 'CHEMBL521', require: ['CHEMBL230'], sets: ['panel'] },
  { id: 'CHEMBL1487', require: ['CHEMBL402'], sets: ['panel'] },
  { id: 'CHEMBL160', require: ['CHEMBL1949'], sets: ['panel'] },
];

const FILTERS = {
  standard_type: 'IC50',
  standard_relation: '=',
  // pChEMBL is ChEMBL's standard -log10(molar) activity. Null means the row
  // was not standardised into that scale.
  pchembl_value__isnull: 'false',
  potential_duplicate: 'false',
  data_validity_comment__isnull: 'true',
};

function targetsFor(spec) {
  return spec.targets ?? spec.require;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getJson(url, attempt = 0) {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(45000) });
  const text = await res.text();
  if (!res.ok || (!text.startsWith('{') && !text.startsWith('['))) {
    // One retry for a transient 5xx. The production data API has been returning
    // HTML 500s while /status.json still says UP, so do not sit in a long loop.
    if (attempt < 1 && res.status >= 500) {
      await sleep(400);
      return getJson(url, attempt + 1);
    }
    throw new Error(`GET ${res.status} ${url.slice(0, 180)} ${text.slice(0, 80).replace(/\s+/g, ' ')}`);
  }
  return JSON.parse(text);
}

/** Canonical host first. /status.json can say UP while activity and molecule calls still 500, so the probe is a real molecule read. The dev host serves the same release when production data calls fail. */
async function resolveBase() {
  for (const base of [CANONICAL, FALLBACK]) {
    try {
      const status = await getJson(`${base}/status.json`);
      if (!status || status.status !== 'UP' || !status.chembl_db_version) throw new Error('status not UP');
      const mol = await getJson(`${base}/molecule/CHEMBL25.json`);
      if (mol.molecule_chembl_id !== 'CHEMBL25') throw new Error('molecule probe mismatch');
      return { base, status };
    } catch (e) {
      console.error(`probe failed for ${base}: ${e instanceof Error ? e.message : e}`);
    }
  }
  throw new Error('ChEMBL API did not answer a molecule read on the canonical or dev host');
}

function lowerMedian(rows) {
  const sorted = rows.slice().sort((a, b) => {
    const dp = Number(a.pchembl_value) - Number(b.pchembl_value);
    if (dp !== 0) return dp;
    return Number(a.activity_id) - Number(b.activity_id);
  });
  // Lower median, so the cited row is always a real measurement.
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

function qualifies(row, target, assayType) {
  if (row.target_chembl_id !== target) return false;
  if (row.standard_type !== 'IC50' || row.standard_relation !== '=') return false;
  if (row.pchembl_value === null || row.pchembl_value === undefined || row.pchembl_value === '') return false;
  if (row.data_validity_comment) return false;
  if (row.potential_duplicate) return false;
  const spec = TARGETS[target];
  if (row.assay_type !== assayType) return false;
  if (row.target_organism !== spec.organism) return false;
  if (spec.wild_type_only && row.assay_variant_mutation) return false;
  if (spec.type === 'SINGLE PROTEIN' && row.bao_label !== 'single protein format') return false;
  return true;
}

async function fetchActivities(base, moleculeId, targetId) {
  const spec = TARGETS[targetId];
  // Binding first. Functional IC50 is used only when that target has no qualifying binding row.
  const types = spec.assay_types ?? [spec.assay_type];
  for (const assayType of types) {
    const rows = [];
    let offset = 0;
    const limit = 500;
    for (;;) {
      const q = new URLSearchParams({
        molecule_chembl_id: moleculeId,
        target_chembl_id: targetId,
        assay_type: assayType,
        ...FILTERS,
        limit: String(limit),
        offset: String(offset),
      });
      const page = await getJson(`${base}/activity.json?${q}`);
      const batch = page.activities ?? [];
      rows.push(...batch);
      const total = page.page_meta?.total_count ?? rows.length;
      offset += limit;
      if (offset >= total || batch.length === 0) break;
      await sleep(120);
    }
    const kept = rows.filter((r) => qualifies(r, targetId, assayType));
    if (kept.length) return kept;
  }
  return [];
}

async function fetchMolecule(base, id) {
  const m = await getJson(`${base}/molecule/${id}.json`);
  const smiles = m.molecule_structures?.canonical_smiles;
  if (!smiles) throw new Error(`${id} has no canonical SMILES`);
  if (!m.pref_name) throw new Error(`${id} has no pref_name`);
  return { id, pref_name: m.pref_name, smiles, max_phase: m.max_phase ?? null };
}

function rowFrom(mol, targetId, chosen, n) {
  const spec = TARGETS[targetId];
  return {
    molecule_chembl_id: mol.id,
    pref_name: mol.pref_name,
    name: mol.pref_name.toLowerCase(),
    max_phase: mol.max_phase,
    canonical_smiles: mol.smiles,
    target_chembl_id: targetId,
    target_symbol: spec.symbol,
    target_pref_name: spec.name,
    assay_chembl_id: chosen.assay_chembl_id,
    assay_type: chosen.assay_type,
    bao_label: chosen.bao_label,
    activity_id: Number(chosen.activity_id),
    document_chembl_id: chosen.document_chembl_id,
    document_year: chosen.document_year ?? null,
    standard_type: chosen.standard_type,
    standard_relation: chosen.standard_relation,
    standard_units: chosen.standard_units,
    standard_value: chosen.standard_value,
    pchembl_value: String(chosen.pchembl_value),
    n_qualifying: n,
    sets: undefined,
  };
}

async function selectAll(base) {
  const activities = [];
  const skipped = [];
  for (const spec of MOLECULES) {
    const mol = await fetchMolecule(base, spec.id);
    await sleep(100);
    const wanted = targetsFor(spec);
    const hits = [];
    for (const tid of wanted) {
      const rows = await fetchActivities(base, spec.id, tid);
      console.error(`${spec.id} ${TARGETS[tid].symbol}: ${rows.length} qualifying`);
      if (rows.length) hits.push({ tid, rows });
      await sleep(100);
    }
    const required = new Set(spec.require ?? []);
    const missing = wanted.filter((tid) => !hits.some((h) => h.tid === tid));
    for (const tid of missing) {
      if (required.has(tid) && !spec.optional) {
        throw new Error(`${spec.id} ${mol.pref_name}: no qualifying ${TARGETS[tid].symbol} (${tid}) activity`);
      }
    }
    if (hits.length === 0) {
      if (spec.optional) {
        skipped.push({ id: spec.id, name: mol.pref_name, reason: 'no qualifying activity on any listed target' });
        continue;
      }
      throw new Error(`${spec.id} ${mol.pref_name}: no qualifying activity`);
    }
    // Required targets: keep each hit. When nothing is required, or for targets
    // listed after the required ones, keep the first hit in preference order.
    const chosenHits = [];
    for (const tid of wanted) {
      const hit = hits.find((h) => h.tid === tid);
      if (!hit) continue;
      if (required.has(tid)) chosenHits.push(hit);
    }
    if (required.size === 0) {
      chosenHits.push(hits[0]);
    } else {
      for (const tid of wanted) {
        if (required.has(tid)) continue;
        const hit = hits.find((h) => h.tid === tid);
        if (hit) { chosenHits.push(hit); break; }
      }
    }
    for (const tid of missing) {
      skipped.push({ id: spec.id, name: mol.pref_name, target_chembl_id: tid, reason: 'searched, no qualifying activity' });
    }
    for (const hit of chosenHits) {
      const chosen = lowerMedian(hit.rows);
      const row = rowFrom(mol, hit.tid, chosen, hit.rows.length);
      row.sets = spec.sets;
      activities.push(row);
    }
  }
  return { activities, skipped };
}

function moleculesFrom(activities) {
  const order = [];
  const byId = new Map();
  for (const a of activities) {
    let m = byId.get(a.molecule_chembl_id);
    if (!m) {
      m = {
        molecule_chembl_id: a.molecule_chembl_id,
        pref_name: a.pref_name,
        name: a.name,
        max_phase: a.max_phase,
        smiles: a.canonical_smiles,
        sets: a.sets,
        pchembl: {},
      };
      byId.set(a.molecule_chembl_id, m);
      order.push(m);
    }
    m.pchembl[a.target_symbol] = {
      value: Number(a.pchembl_value),
      pchembl_value: a.pchembl_value,
      target_chembl_id: a.target_chembl_id,
      assay_chembl_id: a.assay_chembl_id,
      activity_id: a.activity_id,
      n_qualifying: a.n_qualifying,
    };
  }
  return order;
}

function csvEscape(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_COLUMNS = [
  'molecule_chembl_id', 'pref_name', 'name', 'canonical_smiles', 'max_phase',
  'target_chembl_id', 'target_symbol', 'target_pref_name', 'assay_chembl_id', 'assay_type', 'bao_label',
  'activity_id', 'document_chembl_id', 'document_year', 'standard_type', 'standard_relation',
  'standard_units', 'standard_value', 'pchembl_value', 'n_qualifying', 'sets',
];

function toCsv(activities) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const a of activities) {
    const flat = { ...a, sets: a.sets.join('|') };
    lines.push(CSV_COLUMNS.map((c) => csvEscape(flat[c])).join(','));
  }
  return lines.join('\n') + '\n';
}

function manifestFor(status, base, activities, skipped) {
  const assays = [...new Set(activities.map((a) => a.assay_chembl_id))].sort();
  const targets = [...new Set(activities.map((a) => a.target_chembl_id))].sort();
  return {
    schema: 'paretomol.agentbench.chembl/1',
    chembl_db_version: status.chembl_db_version,
    chembl_release_date: status.chembl_release_date,
    release_doi: 'https://doi.org/10.6019/CHEMBL.database.37',
    citation: 'Mendez D, Gaulton A, Bento AP, et al. ChEMBL: towards direct deposition of bioassay data. Nucleic Acids Res. 2019, 47(D1):D930-D940. DOI: 10.1093/nar/gky1075',
    license: 'CC BY-SA 3.0',
    license_url: 'https://creativecommons.org/licenses/by-sa/3.0/',
    attribution: 'ChEMBL, EMBL-EBI. ChEMBL IDs are preserved. Release number is ChEMBL_37.',
    api: {
      canonical: CANONICAL,
      fetched_from: base,
      fetched_at: new Date().toISOString(),
      ...(base === CANONICAL ? {} : {
        note: 'The canonical data API returned an error during this fetch. The dev host served the same ChEMBL_37 release.',
      }),
    },
    selection: {
      standard_type: 'IC50',
      standard_relation: '=',
      pchembl: 'not null',
      potential_duplicate: false,
      data_validity_comment: null,
      assay_type: 'B (binding) preferred. F (functional) only when that molecule and target have no qualifying binding IC50. Kinases are binding only.',
      wild_type: 'assay_variant_mutation is null',
      single_protein_bao: 'single protein format',
      representative: 'lower median pchembl_value; ties broken by the smaller activity_id. One cited row per molecule per target.',
    },
    targets: targets.map((id) => ({ target_chembl_id: id, ...TARGETS[id] })),
    assay_chembl_ids: assays,
    activity_ids: activities.map((a) => a.activity_id),
    skipped,
  };
}

function writeOut(status, base, activities, skipped) {
  mkdirSync(DATA, { recursive: true });
  const clean = activities.map(({ sets, ...rest }) => ({ ...rest, sets }));
  const manifest = manifestFor(status, base, clean, skipped);
  writeFileSync(join(DATA, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(join(DATA, 'activities.json'), JSON.stringify({ schema: 'paretomol.agentbench.activities/1', activities: clean }, null, 2) + '\n');
  writeFileSync(join(DATA, 'molecules.json'), JSON.stringify({ schema: 'paretomol.agentbench.molecules/1', molecules: moleculesFrom(clean) }, null, 2) + '\n');
  writeFileSync(join(DATA, 'molecules.csv'), toCsv(clean));
  console.error(`wrote ${clean.length} activities, ${moleculesFrom(clean).length} molecules`);
}

function loadActivities() {
  const doc = JSON.parse(readFileSync(join(DATA, 'activities.json'), 'utf8'));
  return doc.activities;
}

async function check(base, status) {
  const manifest = JSON.parse(readFileSync(join(DATA, 'manifest.json'), 'utf8'));
  if (manifest.chembl_db_version !== status.chembl_db_version) {
    throw new Error(`release moved: manifest ${manifest.chembl_db_version}, API ${status.chembl_db_version}`);
  }
  const activities = loadActivities();
  if (activities.length !== manifest.activity_ids.length) throw new Error('manifest activity_ids length does not match activities.json');
  for (const a of activities) {
    const live = await getJson(`${base}/activity/${a.activity_id}.json`);
    const problems = [];
    if (String(live.pchembl_value) !== String(a.pchembl_value)) problems.push(`pchembl ${live.pchembl_value} != ${a.pchembl_value}`);
    if (live.molecule_chembl_id !== a.molecule_chembl_id) problems.push('molecule');
    if (live.assay_chembl_id !== a.assay_chembl_id) problems.push('assay');
    if (live.target_chembl_id !== a.target_chembl_id) problems.push('target');
    if (live.canonical_smiles !== a.canonical_smiles) problems.push('smiles');
    if (problems.length) throw new Error(`activity ${a.activity_id} drifted: ${problems.join(', ')}`);
    await sleep(80);
  }
  console.error(`check ok: ${activities.length} activities on ${status.chembl_db_version}`);
}

const flag = process.argv[2] ?? '--check';
const { base, status } = await resolveBase();
console.error(`API ${base} ${status.chembl_db_version} ${status.chembl_release_date}`);
if (flag === '--write') {
  const { activities, skipped } = await selectAll(base);
  writeOut(status, base, activities, skipped);
} else if (flag === '--check') {
  await check(base, status);
} else if (flag === '--reselect') {
  const { activities, skipped } = await selectAll(base);
  const fresh = JSON.stringify(activities.map(({ sets, ...r }) => ({ ...r, sets })));
  const prev = JSON.stringify(loadActivities());
  if (fresh !== prev) {
    console.error('reselect differs from activities.json');
    console.error('skipped', JSON.stringify(skipped));
    process.exit(1);
  }
  console.error('reselect matches activities.json');
} else {
  console.error('Usage: node fetch-chembl.mjs --write|--check|--reselect');
  process.exit(1);
}
