#!/usr/bin/env python3
"""Fetch 10k drug-like molecules from ChEMBL for benchmark extension."""
import urllib.request
import json
import time
import csv
from pathlib import Path

OUTPUT = Path(__file__).parent / "chembl_10k.csv"
BATCH_SIZE = 1000
TARGET = 10000

# No filters — just paginate and filter locally for valid SMILES + no salts
url_template = (
    "https://www.ebi.ac.uk/chembl/api/data/molecule"
    "?format=json"
    "&limit={limit}"
    "&offset={offset}"
)

smiles_list = []
offset = 0

while len(smiles_list) < TARGET:
    url = url_template.format(limit=BATCH_SIZE, offset=offset)
    print(f"Fetching offset={offset}, have {len(smiles_list)} so far ...", flush=True)
    try:
        req = urllib.request.urlopen(url, timeout=60)
        data = json.loads(req.read())
    except Exception as e:
        print(f"Error: {e}")
        break

    molecules = data.get("molecules", [])
    if not molecules:
        print("No more molecules.")
        break

    for mol in molecules:
        s = mol.get("molecule_structures") or {}
        smi = s.get("canonical_smiles")
        props = mol.get("molecule_properties") or {}
        mw = props.get("mw_freebase")
        # Filter: valid SMILES, no mixtures, MW < 700
        if smi and "." not in smi and mw and float(mw) < 700:
            smiles_list.append(smi)
            if len(smiles_list) >= TARGET:
                break

    total_avail = data["page_meta"]["total_count"]
    print(f"  Got {len(molecules)} molecules, {len(smiles_list)} valid SMILES so far")
    offset += BATCH_SIZE

    if offset >= total_avail:
        print("Exhausted all molecules.")
        break

    time.sleep(0.2)

# Write CSV
smiles_list = smiles_list[:TARGET]
with open(OUTPUT, "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f)
    writer.writerow(["SMILES", "Name"])
    for i, smi in enumerate(smiles_list):
        writer.writerow([smi, f"chembl_mol_{i+1}"])

print(f"\nDone. Saved {len(smiles_list)} SMILES to {OUTPUT}")
