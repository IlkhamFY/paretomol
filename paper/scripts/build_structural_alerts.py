#!/usr/bin/env python3
"""Build src/data/structural_alerts.json from RDKit's canonical FilterCatalog data.

Parses RDKit's FilterCatalog `.in` C++ data files (PAINS A/B/C, Brenk, NIH) into a
compact JSON catalog of {name, smarts} entries per rule set, used by ParetoMol for
client-side structural-alert detection and matched-fragment highlighting.

Source: https://github.com/rdkit/rdkit (BSD-3-Clause), Code/GraphMol/FilterCatalog/.
The RDKit ref is pinned (RDKIT_REF) to the release matching the app's RDKit.js
version (@rdkit/rdkit 2025.3.4) so regenerating yields an identical catalog.
Run from repo root:  python paper/scripts/build_structural_alerts.py
"""
import json, re, sys, urllib.request, pathlib

# Pinned to the RDKit release matching the app's RDKit.js (index.html: 2025.3.4).
RDKIT_REF = "Release_2025_03_4"
BASE = f"https://raw.githubusercontent.com/rdkit/rdkit/{RDKIT_REF}/Code/GraphMol/FilterCatalog"
FILES = {
    "PAINS": ["pains_a.in", "pains_b.in", "pains_c.in"],
    "Brenk": ["brenk.in"],
    "NIH":   ["nih.in"],
}
# Entry formats:
#   PAINS:      {"name","smarts"...}
#   Brenk/NIH:  {"name", "smarts"..., 0, ""}
# The SMARTS may be split across several ADJACENT C++ string literals, which the
# compiler concatenates into one pattern, e.g.
#   {"activated_acetylene", "[...EWG...]" "C#[C;...]", 0, ""}
# Capture the name (first literal), then ALL adjacent SMARTS literals up to the
# entry terminator ( , <int>   for Brenk/NIH,  or  }  for PAINS), and join them.
ENTRY = re.compile(
    r'\{\s*"((?:[^"\\]|\\.)*)"\s*,\s*'      # group 1: name literal
    r'((?:"(?:[^"\\]|\\.)*"\s*)+?)'          # group 2: one or more SMARTS literals
    r'(?:,\s*\d|\})',                        # terminator
    re.DOTALL)
LITERAL = re.compile(r'"((?:[^"\\]|\\.)*)"')

def fetch(name):
    url = f"{BASE}/{name}"
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "paretomol"}), timeout=30).read().decode("utf-8", "replace")

def main():
    catalog = {}
    for rule_set, files in FILES.items():
        entries = []
        for fn in files:
            text = fetch(fn)
            for m in ENTRY.finditer(text):
                name = m.group(1).strip()
                # Concatenate adjacent C++ string literals into the full SMARTS.
                smarts = ''.join(LITERAL.findall(m.group(2))).replace('\\\\', '\\')
                if smarts:
                    entries.append({"name": name, "smarts": smarts})
        catalog[rule_set] = entries
        print(f"{rule_set:6s}: {len(entries)} patterns", file=sys.stderr)
    out = pathlib.Path(__file__).resolve().parents[2] / "src" / "data" / "structural_alerts.json"
    out.write_text(json.dumps(catalog, separators=(",", ":")))
    print(f"wrote {out} ({out.stat().st_size//1024} KB)", file=sys.stderr)

if __name__ == "__main__":
    main()
