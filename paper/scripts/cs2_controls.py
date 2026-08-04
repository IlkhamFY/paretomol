"""
Case Study 2 — Strengthened controls for AhR scaffold-level finding.

1. Matched kinase inhibitor control: 50 non-EGFR kinase inhibitors
2. Population baseline: 500 approved drugs
3. Sensitivity: EGFR at pChEMBL >= 8.0 (broader set)

Steps 1-3 refetch from ChEMBL and the ADMET-AI service, replacing the deposited
inputs with whatever those services hold today. The summary they feed needs no
network, so it is reachable on its own — that is the part a reader checks:

    python3 paper/scripts/cs2_controls.py --summary-only   # deposited files, offline
    python3 paper/scripts/cs2_controls.py                  # refetch, then summarise

requests is imported by the fetch steps rather than at module scope, so the
summary runs under the dependencies paper/requirements.txt pins.

This prints the Demonstration 2 statistics; verify_fig3_data.py is what asserts
them against the manuscript.
"""

import argparse
import csv
import json
import pathlib
import sys
import time
from collections import Counter

from scipy import stats as sp

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _paths import EGFR_CSV, SCRIPTS, rel  # noqa: E402

ADMET_URL = "https://ilkhamfy-admet-ai-api.hf.space"
CHEMBL_API = "https://www.ebi.ac.uk/chembl/api/data"

# Key mapping from API response
AHR_KEY = 'NR-AhR'
CYP1A2_KEY = 'CYP1A2_Veith'
DILI_KEY = 'DILI'
HERG_KEY = 'hERG_Karim'


def predict_admet(smiles_list, batch_size=50):
    """Run ADMET predictions. API takes array of SMILES, returns {results: [...]}."""
    import requests

    all_results = {}
    for i in range(0, len(smiles_list), batch_size):
        batch = smiles_list[i:i+batch_size]
        try:
            resp = requests.post(f"{ADMET_URL}/predict",
                                 json={"smiles": batch}, timeout=120)
            if resp.status_code == 200:
                data = resp.json()
                results = data.get('results', [])
                for r in results:
                    smi = r.get('smiles', '')
                    all_results[smi] = r
            else:
                print(f"  Batch {i//batch_size} failed: {resp.status_code} {resp.text[:100]}")
        except Exception as e:
            print(f"  Batch {i//batch_size} error: {e}")
        done = min(i + batch_size, len(smiles_list))
        print(f"  Predicted {done}/{len(smiles_list)} ({len(all_results)} successful)")
        if done < len(smiles_list):
            time.sleep(0.5)
    return all_results


def fetch_chembl_actives(target_chembl_id, min_pchembl=8.0, limit=200):
    """Fetch active compounds for a target from ChEMBL."""
    import requests

    url = f"{CHEMBL_API}/activity.json"
    params = {
        'target_chembl_id': target_chembl_id,
        'pchembl_value__gte': min_pchembl,
        'assay_type': 'B',
        'limit': 100,
        'offset': 0,
    }
    results = []
    while len(results) < limit:
        resp = requests.get(url, params=params, timeout=30)
        if resp.status_code != 200:
            break
        data = resp.json()
        activities = data.get('activities', [])
        if not activities:
            break
        results.extend(activities)
        nxt = data.get('page_meta', {}).get('next')
        if not nxt:
            break
        params['offset'] += 100
        time.sleep(0.3)
    return results[:limit]


def get_molecule_smiles(chembl_ids):
    """Fetch canonical SMILES for ChEMBL molecule IDs."""
    import requests

    smiles_map = {}
    for i in range(0, len(chembl_ids), 50):
        chunk = chembl_ids[i:i+50]
        ids_str = ','.join(chunk)
        resp = requests.get(f"{CHEMBL_API}/molecule.json",
                            params={'molecule_chembl_id__in': ids_str, 'limit': 50},
                            timeout=30)
        if resp.status_code == 200:
            for mol in resp.json().get('molecules', []):
                cid = mol['molecule_chembl_id']
                structs = mol.get('molecule_structures')
                if structs and structs.get('canonical_smiles'):
                    smiles_map[cid] = structs['canonical_smiles']
        time.sleep(0.3)
    return smiles_map


def dedup_by_smiles(compounds):
    """Deduplicate compound list by SMILES."""
    seen = set()
    out = []
    for c in compounds:
        smi = c.get('smiles', '')
        if smi and smi not in seen:
            seen.add(smi)
            out.append(c)
    return out


# ===== Non-EGFR kinase targets for matched control =====
CONTROL_TARGETS = {
    'CHEMBL2971':  'JAK2',
    'CHEMBL4722':  'CDK2',
    'CHEMBL5145':  'BRAF',
    'CHEMBL3009':  'MEK1',
    'CHEMBL4247':  'ALK',
    'CHEMBL2185':  'JAK1',
    'CHEMBL3616':  'CDK4',
    'CHEMBL4523':  'Aurora-A',
    'CHEMBL2842':  'PI3K-alpha',
    'CHEMBL4439':  'BTK',
}
EGFR_TARGET = 'CHEMBL203'


def step1_matched_control():
    """50 non-EGFR kinase inhibitors."""
    print("=" * 60)
    print("STEP 1: Matched kinase inhibitor control (non-EGFR)")
    print("=" * 60)

    all_compounds = []
    for tid, tname in CONTROL_TARGETS.items():
        print(f"  {tname} ({tid})...", end=' ')
        acts = fetch_chembl_actives(tid, min_pchembl=7.0, limit=30)
        seen = set()
        for a in acts:
            mid = a.get('molecule_chembl_id')
            if mid and mid not in seen:
                seen.add(mid)
                all_compounds.append({
                    'chembl_id': mid,
                    'target': tname,
                    'pchembl': float(a.get('pchembl_value', 0)),
                })
        print(f"{len(seen)} compounds")

    # Get SMILES
    ids = list(set(c['chembl_id'] for c in all_compounds))
    print(f"\n  Fetching SMILES for {len(ids)} molecules...")
    smap = get_molecule_smiles(ids)
    for c in all_compounds:
        c['smiles'] = smap.get(c['chembl_id'], '')

    # Filter + dedup + sort by potency
    with_smi = [c for c in all_compounds if c['smiles']]
    unique = dedup_by_smiles(with_smi)
    unique.sort(key=lambda x: -x['pchembl'])
    top50 = unique[:50]
    print(f"  {len(unique)} unique with SMILES, taking top 50 by potency")
    print(f"  Targets represented: {Counter(c['target'] for c in top50)}")

    # ADMET
    print(f"\n  Running ADMET predictions...")
    smi_list = [c['smiles'] for c in top50]
    admet = predict_admet(smi_list)

    for c in top50:
        pred = admet.get(c['smiles'], {})
        c['ahr'] = pred.get(AHR_KEY)
        c['cyp1a2'] = pred.get(CYP1A2_KEY)
        c['dili'] = pred.get(DILI_KEY)
        c['herg'] = pred.get(HERG_KEY)

    path = SCRIPTS / 'control_kinase_inhibitors.json'
    with open(path, 'w') as f:
        json.dump(top50, f, indent=2)
    print(f"  Saved to {path}")
    return top50


def step2_population_baseline():
    """500 approved small molecule drugs."""
    import requests

    print("\n" + "=" * 60)
    print("STEP 2: Population baseline (500 approved drugs)")
    print("=" * 60)

    url = f"{CHEMBL_API}/molecule.json"
    results = []
    seen = set()
    offset = 0
    while len(results) < 500 and offset < 5000:
        resp = requests.get(url, params={
            'max_phase': 4, 'molecule_type': 'Small molecule',
            'limit': 100, 'offset': offset
        }, timeout=30)
        if resp.status_code != 200:
            break
        for mol in resp.json().get('molecules', []):
            structs = mol.get('molecule_structures')
            if structs and structs.get('canonical_smiles'):
                smi = structs['canonical_smiles']
                if smi not in seen and len(smi) < 200:
                    seen.add(smi)
                    results.append({
                        'chembl_id': mol['molecule_chembl_id'],
                        'name': mol.get('pref_name', ''),
                        'smiles': smi
                    })
        offset += 100
        time.sleep(0.3)
        if len(results) % 200 < 100:
            print(f"  {len(results)} drugs collected...")
    results = results[:500]
    print(f"  Got {len(results)} approved drugs")

    print(f"  Running ADMET predictions...")
    smi_list = [d['smiles'] for d in results]
    admet = predict_admet(smi_list)

    for d in results:
        pred = admet.get(d['smiles'], {})
        d['ahr'] = pred.get(AHR_KEY)
        d['cyp1a2'] = pred.get(CYP1A2_KEY)

    path = SCRIPTS / 'population_baseline.json'
    with open(path, 'w') as f:
        json.dump(results, f, indent=2)
    print(f"  Saved to {path}")
    return results


def step3_egfr_sensitivity():
    """EGFR at pChEMBL >= 8.0 (broader than top 50)."""
    print("\n" + "=" * 60)
    print("STEP 3: EGFR sensitivity (pChEMBL >= 8.0)")
    print("=" * 60)

    acts = fetch_chembl_actives(EGFR_TARGET, min_pchembl=8.0, limit=300)
    seen = set()
    compounds = []
    for a in acts:
        mid = a.get('molecule_chembl_id')
        if mid and mid not in seen:
            seen.add(mid)
            compounds.append({
                'chembl_id': mid,
                'pchembl': float(a.get('pchembl_value', 0)),
            })
    print(f"  {len(compounds)} unique EGFR actives at pChEMBL >= 8.0")

    ids = [c['chembl_id'] for c in compounds]
    smap = get_molecule_smiles(ids)
    for c in compounds:
        c['smiles'] = smap.get(c['chembl_id'], '')
    compounds = [c for c in compounds if c['smiles']]
    compounds = dedup_by_smiles(compounds)
    print(f"  {len(compounds)} with unique SMILES")

    print(f"  Running ADMET predictions...")
    smi_list = [c['smiles'] for c in compounds]
    admet = predict_admet(smi_list)

    for c in compounds:
        pred = admet.get(c['smiles'], {})
        c['ahr'] = pred.get(AHR_KEY)

    path = SCRIPTS / 'egfr_broad.json'
    with open(path, 'w') as f:
        json.dump(compounds, f, indent=2)
    print(f"  Saved to {path}")
    return compounds


# The manuscript reports two-sided tests: p = 5.61e-10 against the controls and
# 8.52e-30 against the baseline. The one-sided alternative this used to pass
# gives 2.81e-10 and 4.26e-30 for the same two comparisons -- numbers no
# sentence in the paper contains.
ALTERNATIVE = 'two-sided'
THRESHOLD = 0.5


def mean(values):
    return sum(values) / len(values)


def sd(values):
    """Population SD (ddof = 0), the convention the manuscript's SDs use.

    The sample SD gives 0.129 for the EGFR series and 0.320 for the controls
    where the paper prints 0.127 and 0.317; verify_fig3_data.py establishes this
    against the same deposited files.
    """
    m = mean(values)
    return (sum((v - m) ** 2 for v in values) / len(values)) ** 0.5


def ahr_values(records):
    return [r['ahr'] for r in records if r.get('ahr') is not None]


def egfr_top50_ahr():
    """The EGFR series the manuscript reports: pChEMBL >= 8.92, n = 50.

    The abstract, Sec. 4.2, Fig. 3 and SI Tables S2-S3 all describe this set, and
    generate_fig3_cs2.py draws it. The summary below used a literal [0.890] * 50
    in its place, so every EGFR statistic it printed came from a constant vector
    -- zero variance, and a test statistic derived from one means nothing.
    """
    with EGFR_CSV.open() as f:
        return [float(r['NR-AhR']) for r in csv.DictReader(f)
                if (r.get('NR-AhR') or '').strip() != '']


def load_deposited():
    """The control, baseline and sensitivity inputs as deposited. No network."""
    def records(name):
        return json.loads((SCRIPTS / name).read_text())
    return (records('control_kinase_inhibitors.json'),
            records('population_baseline.json'),
            records('egfr_broad.json'))


def summary(control, population, egfr_broad, source):
    print("\n" + "=" * 60)
    print("RESULTS SUMMARY")
    print("=" * 60)
    # A refetch and a rerun over the deposit print the same table with different
    # numbers in it, so each says where its groups came from.
    print(f"  EGFR top 50:                    {rel(EGFR_CSV)}")
    print(f"  controls, baseline, broad set:  {source}")

    def stats(name, values):
        n = len(values)
        if n == 0:
            print(f"\n{name}: NO DATA")
            return
        above = sum(1 for v in values if v > THRESHOLD)
        print(f"\n{name} (n={n}):")
        print(f"  AhR mean: {mean(values):.3f} (SD {sd(values):.3f})")
        print(f"  AhR > {THRESHOLD}: {above}/{n} ({100*above/n:.1f}%)")
        print(f"  AhR range: [{min(values):.3f}, {max(values):.3f}]")

    egfr_ahr = egfr_top50_ahr()
    ctrl_ahr = ahr_values(control)
    pop_ahr = ahr_values(population)
    broad_ahr = ahr_values(egfr_broad)

    stats("EGFR top 50 (pChEMBL >= 8.92) — the set the paper reports", egfr_ahr)
    stats("Control: non-EGFR kinase inhibitors", ctrl_ahr)
    stats("Population: approved drugs", pop_ahr)
    stats("EGFR sensitivity set (pChEMBL >= 8.0)", broad_ahr)
    # Described, not tested: the manuscript reports no test over the sensitivity
    # set, and a second p-value for the same comparison printed beside the
    # reported ones would read as contradicting them.

    if ctrl_ahr:
        u, p = sp.mannwhitneyu(egfr_ahr, ctrl_ahr, alternative=ALTERNATIVE)
        # Glass's delta, not Cohen's d: the denominator is the control SD alone,
        # not the pooled SD. Naming and printing it makes the choice checkable
        # from the output; pooled would give 1.46 where the manuscript says 1.12.
        control_sd = sd(ctrl_ahr)
        glass_delta = (mean(egfr_ahr) - mean(ctrl_ahr)) / control_sd
        print("\n--- EGFR top 50 vs control kinase inhibitors ---")
        print(f"  Mann-Whitney U ({ALTERNATIVE}): {u:.0f}, p = {p:.2e}")
        print(f"  Glass's delta: {glass_delta:.2f}"
              f"  (mean difference / control SD {control_sd:.3f})")

    if pop_ahr:
        u2, p2 = sp.mannwhitneyu(egfr_ahr, pop_ahr, alternative=ALTERNATIVE)
        print("\n--- EGFR top 50 vs population baseline ---")
        print(f"  Mann-Whitney U ({ALTERNATIVE}): {u2:.0f}, p = {p2:.2e}")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    ap.add_argument('--summary-only', action='store_true',
                    help='recompute the reported statistics from the deposited '
                         'files; no network, and nothing is written')
    args = ap.parse_args(argv)

    if args.summary_only:
        summary(*load_deposited(), source=f'deposited JSON in {rel(SCRIPTS)}')
        return 0

    control = step1_matched_control()
    population = step2_population_baseline()
    egfr_broad = step3_egfr_sensitivity()
    summary(control, population, egfr_broad,
            source='refetched this run from ChEMBL and ADMET-AI')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
