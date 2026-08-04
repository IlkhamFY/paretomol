#!/usr/bin/env python3
"""Fetch 50k drug-like molecules from ChEMBL."""
import urllib.request
import json
import time
import csv
from pathlib import Path

OUTPUT = Path(__file__).parent / "chembl_50k.csv"
BATCH_SIZE = 1000
TARGET = 50000

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
    print(f"Fetching offset={offset}, have {len(smiles_list)} ...", flush=True)
    try:
        req = urllib.request.urlopen(url, timeout=60)
        data = json.loads(req.read())
    except Exception as e:
        print(f"Error: {e}")
        break

    molecules = data.get("molecules", [])
    if not molecules:
        break

    for mol in molecules:
        s = mol.get("molecule_structures") or {}
        smi = s.get("canonical_smiles")
        props = mol.get("molecule_properties") or {}
        mw = props.get("mw_freebase")
        if smi and "." not in smi and mw and float(mw) < 700:
            smiles_list.append(smi)
            if len(smiles_list) >= TARGET:
                break

    offset += BATCH_SIZE
    if offset >= data["page_meta"]["total_count"]:
        break
    time.sleep(0.2)

smiles_list = smiles_list[:TARGET]
with open(OUTPUT, "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f)
    writer.writerow(["SMILES", "Name"])
    for i, smi in enumerate(smiles_list):
        writer.writerow([smi, f"chembl_mol_{i+1}"])

print(f"\nDone. Saved {len(smiles_list)} SMILES to {OUTPUT}")
