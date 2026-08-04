#!/usr/bin/env python3
"""Reviewer 1, Point 1.3a — BAO_LABEL / assay-type composition of the exact 50
EGFR inhibitors used in Demonstration 2 (the compounds in paper/egfr_top50.csv).

For each of the 50 compounds, queries ChEMBL for its bioactivities against EGFR
(CHEMBL203) and records the assay format (BAO_LABEL, assay_type, standard_type)
of its highest-pChEMBL activity --- i.e. the assay underlying the potency value
used in the manuscript. Writes paper/scripts/egfr_assay_composition_table.tex.

Run from repo root (needs network to www.ebi.ac.uk):
    python paper/scripts/egfr_assay_composition.py
"""
import collections, csv, json, pathlib, urllib.request, urllib.parse

ROOT = pathlib.Path(__file__).resolve().parents[2]
TARGET = "CHEMBL203"

def ids_from_csv():
    return [r["Name"].strip() for r in csv.DictReader(open(ROOT / "paper/egfr_top50.csv"))
            if r["Name"].strip().upper().startswith("CHEMBL")]

def fetch_for(ids):
    out = []
    base = "https://www.ebi.ac.uk/chembl/api/data/activity.json"
    for i in range(0, len(ids), 20):
        chunk = ids[i:i+20]
        params = {"target_chembl_id": TARGET,
                  "molecule_chembl_id__in": ",".join(chunk), "limit": 1000}
        url = base + "?" + urllib.parse.urlencode(params)
        while url:
            req = urllib.request.Request(url, headers={"User-Agent": "paretomol"})
            data = json.load(urllib.request.urlopen(req, timeout=90))
            out.extend(data["activities"])
            nxt = data.get("page_meta", {}).get("next")
            url = ("https://www.ebi.ac.uk" + nxt) if nxt else None
    return out

def main():
    ids = ids_from_csv()
    acts = fetch_for(ids)
    # highest-pChEMBL activity per molecule
    best = {}
    for a in acts:
        p = a.get("pchembl_value")
        if p is None:
            continue
        m = a["molecule_chembl_id"]
        if m not in best or float(p) > float(best[m]["pchembl_value"]):
            best[m] = a
    found = [best[m] for m in ids if m in best]
    print(f"compounds in CSV: {len(ids)} | with ChEMBL activity returned: {len(found)}")

    def counts(field): return collections.Counter((a.get(field) or "unspecified") for a in found)
    for field in ("bao_label", "assay_type", "standard_type"):
        print(f"\n{field}:")
        for k, v in counts(field).most_common():
            print(f"  {v:3d}  {k}")

    bao = counts("bao_label"); atype = counts("assay_type")
    binding = sum(v for k, v in atype.items() if k == "B")
    lines = [r"\begin{table}[h]\centering",
        r"\caption{BAO\_LABEL / assay-type composition of the 50 EGFR inhibitors used in "
        r"Demonstration~2 (assay format of each compound's highest-pChEMBL activity against EGFR).}",
        r"\label{tbl:egfr_assays}", r"\begin{tabular}{lr}", r"\toprule",
        r"BAO\_LABEL (assay format) & compounds \\", r"\midrule"]
    for k, v in bao.most_common():
        lines.append(f"{k} & {v} \\\\")
    lines += [r"\midrule",
              f"\\textit{{assay\\_type B (binding)}} & {binding} \\\\",
              r"\bottomrule", r"\end{tabular}", r"\end{table}"]
    out = ROOT / "paper/scripts/egfr_assay_composition_table.tex"
    out.write_text("\n".join(lines))
    print(f"\nbinding (assay_type=B): {binding}/{len(found)}")
    print(f"wrote {out}")

if __name__ == "__main__":
    main()
